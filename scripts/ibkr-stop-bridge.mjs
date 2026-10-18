import http from 'node:http'
import { createGatewayDisconnectAlerts } from '../lib/ibkr/gateway-notifications.mjs'
import { createGatewaySessionMaintainer } from '../lib/ibkr/gateway-session.mjs'
import { fetchWebStopOrders, requestWebJson } from '../lib/ibkr/web-stop-orders.mjs'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import {
  buildInitialStopSyncDatabaseUpdate,
  buildStopSyncDatabaseUpdate,
  matchCachedStopsToClosedTrades,
  matchFilledStopsToClosedTrades,
  matchOpenStopsToTrades,
  reconcileStopOrderSymbols,
} from '../lib/ibkr/open-stop-orders.ts'

const gatewayAlerts = createGatewayDisconnectAlerts()
const maintainGatewaySession = createGatewaySessionMaintainer()

const BRIDGE_PORT = Number(process.env.IBKR_STOP_BRIDGE_PORT || 4317)
const DESKTOP_ORDERS_APP = join(homedir(), 'Applications', 'Trading Analyzer IBKR Reader.app')
const DESKTOP_ORDERS_HELPER = process.env.IBKR_DESKTOP_ORDERS_HELPER
  || join(
    DESKTOP_ORDERS_APP,
    'Contents',
    'MacOS',
    'ibkr-desktop-orders',
  )
const STOP_HISTORY_DIR = join(homedir(), 'Library', 'Application Support', 'Trading Analyzer')
const STOP_HISTORY_PATH = join(STOP_HISTORY_DIR, 'ibkr-stop-order-history.json')
const STOP_HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const execFileAsync = promisify(execFile)

async function readStopHistory() {
  try {
    const history = JSON.parse(await readFile(STOP_HISTORY_PATH, 'utf8'))
    return Array.isArray(history?.snapshots) ? history.snapshots : []
  } catch {
    return []
  }
}

async function saveStopHistory(snapshots, orders) {
  const capturedAt = new Date().toISOString()
  const cutoff = Date.now() - STOP_HISTORY_MAX_AGE_MS
  const retained = snapshots.filter(snapshot => Date.parse(snapshot?.capturedAt) >= cutoff)
  retained.push({ capturedAt, orders })

  await mkdir(STOP_HISTORY_DIR, { recursive: true })
  const temporaryPath = `${STOP_HISTORY_PATH}.${process.pid}.tmp`
  await writeFile(temporaryPath, JSON.stringify({ version: 1, snapshots: retained }), { mode: 0o600 })
  await rename(temporaryPath, STOP_HISTORY_PATH)
  return retained
}

function isAllowedOrigin(origin) {
  if (origin === 'https://trading-analyzer-web.vercel.app') return true
  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

function corsHeaders(origin, request) {
  if (!isAllowedOrigin(origin)) return {}
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  }
  if (request.headers['access-control-request-private-network'] === 'true') {
    headers['Access-Control-Allow-Private-Network'] = 'true'
  }
  return headers
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(JSON.stringify(body))
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
      if (body.length > 20_000) reject(new Error('Request body is too large'))
    })
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    request.on('error', reject)
  })
}

async function fetchOpenStopOrders(knownSymbols) {
  if (process.env.IBKR_WEB_API_URL) return fetchWebStopOrders(process.env, requestWebJson, undefined, maintainGatewaySession)
  const symbolList = [...new Set(knownSymbols)].join(',')
  let workingDirectory
  try {
    let stdout
    if (process.platform === 'darwin' && !process.env.IBKR_DESKTOP_ORDERS_HELPER) {
      workingDirectory = await mkdtemp(join(tmpdir(), 'trading-analyzer-ibkr-reader-'))
      const outputPath = join(workingDirectory, 'result.json')
      await execFileAsync('/usr/bin/open', [
        '-W',
        '-n',
        DESKTOP_ORDERS_APP,
        '--args',
        '--output',
        outputPath,
        '--known-symbols',
        symbolList,
      ], { timeout: 30_000, maxBuffer: 1_000_000 })
      stdout = await readFile(outputPath, 'utf8')
    } else {
      const result = await execFileAsync(DESKTOP_ORDERS_HELPER, [], {
        timeout: 30_000,
        maxBuffer: 1_000_000,
        env: { ...process.env, IBKR_KNOWN_SYMBOLS: symbolList },
      })
      stdout = result.stdout
    }
    const result = JSON.parse(stdout)
    if (typeof result?.error === 'string') throw new Error(result.error)
    if (Array.isArray(result)) return { orders: result, scan: null }
    if (!result || !Array.isArray(result.orders)) {
      throw new Error('Desktop order reader returned invalid data')
    }
    return { orders: result.orders, scan: result }
  } catch (error) {
    const stderr = error?.stderr?.trim()
    throw new Error(stderr || error?.message || 'Could not read IBKR Desktop open orders')
  } finally {
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true })
  }
}

function requireEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase environment variables are missing')
  return { url, serviceRoleKey }
}

const marketDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function marketDateKey(value) {
  const parts = Object.fromEntries(
    marketDateFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

async function performStopSync(userId) {
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('A valid user ID is required')
  }

  // Fail before database queries and history processing when Gateway is offline.
  if (process.env.IBKR_WEB_API_URL) await maintainGatewaySession()

  const { url, serviceRoleKey } = requireEnvironment()
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: trades, error } = await supabase
    .from('trades')
    .select('id, symbol, side, shares, entry_time, entry_price, stop_loss, current_stop_loss, initial_risk_amount')
    .eq('user_id', userId)
    .is('exit_time', null)

  if (error) throw new Error(`Could not load open trades: ${error.message}`)

  const recentCutoff = new Date(Date.now() - STOP_HISTORY_MAX_AGE_MS).toISOString()
  const { data: recentClosedTrades, error: closedError } = await supabase
    .from('trades')
    .select('id, symbol, side, shares, entry_time, entry_price, exit_time, exit_price, stop_loss, current_stop_loss, initial_risk_amount')
    .eq('user_id', userId)
    .not('exit_time', 'is', null)
    .is('stop_loss', null)
    .gte('exit_time', recentCutoff)
  if (closedError) throw new Error(`Could not load recent closed trades: ${closedError.message}`)

  const sameDayClosedTrades = (recentClosedTrades ?? []).filter(trade => (
    trade.entry_time != null
    && trade.exit_time != null
    && marketDateKey(trade.entry_time) === marketDateKey(trade.exit_time)
  ))
  const knownSymbols = [...(trades ?? []), ...sameDayClosedTrades].map(trade => trade.symbol)
  let stopHistory = await readStopHistory()
  let orders = []
  let scan = null
  let desktopError
  try {
    const desktopResult = await fetchOpenStopOrders(knownSymbols)
    orders = desktopResult.orders
    scan = desktopResult.scan
    stopHistory = await saveStopHistory(stopHistory, orders)
  } catch (error) {
    desktopError = error instanceof Error ? error.message : String(error)
    if (stopHistory.length === 0) throw error
  }

  const reconcile = process.env.IBKR_WEB_API_URL ? orders => orders : reconcileStopOrderSymbols
  const activeOrders = reconcile(
    orders.filter(order => ['SUBMITTED', 'PRESUBMITTED'].includes(order.status?.toUpperCase() ?? 'SUBMITTED')),
    trades ?? [],
  )
  const matched = matchOpenStopsToTrades(trades ?? [], activeOrders)
  let updated = 0
  let unchanged = 0
  let initialSlInitialized = 0

  for (const update of matched.updates) {
    const trade = trades?.find(candidate => candidate.id === update.tradeId)
    if (!trade) continue
    const initializesInitialSl = trade.stop_loss == null
    const currentStopUnchanged = trade.current_stop_loss != null
      && Math.abs(trade.current_stop_loss - update.stopPrice) < 0.000001
    if (currentStopUnchanged && !initializesInitialSl) {
      unchanged += 1
      continue
    }

    const updatePayload = buildStopSyncDatabaseUpdate(trade, update.stopPrice)

    const { error: updateError } = await supabase
      .from('trades')
      .update(updatePayload)
      .eq('id', update.tradeId)
      .eq('user_id', userId)
      .is('exit_time', null)
    if (updateError) throw new Error(`Could not update ${update.symbol}: ${updateError.message}`)
    updated += 1
    if (initializesInitialSl) initialSlInitialized += 1
  }

  const closedTradeOrders = reconcileStopOrderSymbols(orders, sameDayClosedTrades)
  const filledMatched = matchFilledStopsToClosedTrades(sameDayClosedTrades, closedTradeOrders)
  for (const update of filledMatched.updates) {
    const trade = sameDayClosedTrades.find(candidate => candidate.id === update.tradeId)
    if (!trade) continue
    const updatePayload = buildInitialStopSyncDatabaseUpdate(trade, update.stopPrice)
    const { error: updateError } = await supabase
      .from('trades')
      .update(updatePayload)
      .eq('id', update.tradeId)
      .eq('user_id', userId)
      .not('exit_time', 'is', null)
      .is('stop_loss', null)
    if (updateError) throw new Error(`Could not initialize ${update.symbol} Initial SL: ${updateError.message}`)
    updated += 1
    initialSlInitialized += 1
  }

  const filledTradeIds = new Set(filledMatched.updates.map(update => update.tradeId))
  const cachedClosedTrades = (recentClosedTrades ?? [])
    .filter(trade => !filledTradeIds.has(trade.id))
  const cachedMatched = matchCachedStopsToClosedTrades(
    cachedClosedTrades,
    stopHistory,
  )
  for (const update of cachedMatched.updates) {
    const trade = cachedClosedTrades.find(candidate => candidate.id === update.tradeId)
    if (!trade) continue
    const updatePayload = buildInitialStopSyncDatabaseUpdate(trade, update.stopPrice)
    const { error: updateError } = await supabase
      .from('trades')
      .update(updatePayload)
      .eq('id', update.tradeId)
      .eq('user_id', userId)
      .not('exit_time', 'is', null)
      .is('stop_loss', null)
    if (updateError) throw new Error(`Could not initialize ${update.symbol} Initial SL: ${updateError.message}`)
    updated += 1
    initialSlInitialized += 1
  }

  const scanWarning = scan?.recognizedRows < scan?.expectedRows
      ? `IBKR scanned ${scan.pageCount ?? 1} order page(s), but only ${scan.recognizedRows}/${scan.expectedRows} rows were readable.`
      : undefined
  const warning = [
    desktopError ? `IBKR order source was unavailable; cached stop history was used (${desktopError}).` : null,
    scanWarning,
  ].filter(Boolean).join(' ') || undefined
  const result = {
    liveOrdersAvailable: !desktopError,
    source: desktopError ? 'cached IBKR stop history' : process.env.IBKR_WEB_API_URL ? 'IBKR Web API' : 'IBKR Desktop',
    openStopOrders: activeOrders.length,
    filledStopOrders: orders.filter(order => order.status?.toUpperCase() === 'FILLED').length,
    updated,
    unchanged,
    initialSlInitialized,
    skipped: [...matched.skipped, ...filledMatched.skipped, ...cachedMatched.skipped],
    scan: scan == null ? undefined : {
      view: scan.view,
      expectedRows: scan.expectedRows,
      recognizedRows: scan.recognizedRows,
      pageCount: scan.pageCount ?? 1,
    },
    warning,
  }
  console.log(JSON.stringify({ event: 'stop-sync', userId, ...result }))
  return result
}

// Serialize all reads/writes, including background and manual syncs.
let pendingSync = null
let autoSyncUserId = process.env.IBKR_STOP_SYNC_USER_ID || null
let lastAutoError = null
function syncStops(userId) {
  if (pendingSync) {
    return pendingSync.then(() => syncStops(userId))
  }
  if (process.env.IBKR_STOP_SYNC_USER_ID && userId !== process.env.IBKR_STOP_SYNC_USER_ID) {
    return Promise.reject(new Error('This bridge is configured for a different website user'))
  }
  pendingSync = performStopSync(userId).finally(() => { pendingSync = null })
  return pendingSync
}

const autoSyncSeconds = Number(process.env.IBKR_STOP_AUTO_SYNC_SECONDS || 3600)
if (!Number.isFinite(autoSyncSeconds) || autoSyncSeconds < 30) {
  throw new Error('IBKR_STOP_AUTO_SYNC_SECONDS must be at least 30')
}
async function autoSync() {
  if (!process.env.IBKR_WEB_API_URL || !autoSyncUserId || pendingSync) return
  try {
    const result = await syncStops(autoSyncUserId)
    lastAutoError = result.warning ?? null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Log only changed failures, rather than repeating login errors every minute.
    if (message !== lastAutoError) console.error(JSON.stringify({ event: 'auto-stop-sync-error', message }))
    lastAutoError = message
  }
}
const autoSyncTimer = setInterval(() => { void autoSync() }, autoSyncSeconds * 1000)
autoSyncTimer.unref()

// Keep an existing login alive independently of the hourly order sync.
let heartbeatError = null
let heartbeatPending = false
async function keepGatewayAlive() {
  if (!process.env.IBKR_WEB_API_URL || heartbeatPending) return
  heartbeatPending = true
  try {
    await maintainGatewaySession()
    heartbeatError = null
  } catch (error) {
    heartbeatError = error instanceof Error ? error.message : String(error)
  } finally {
    await gatewayAlerts(heartbeatError === null).catch(error => {
      console.error(JSON.stringify({ event: 'gateway-notification-error', message: error.message }))
    })
    heartbeatPending = false
  }
}
const heartbeatTimer = setInterval(() => { void keepGatewayAlive() }, 60_000)
heartbeatTimer.unref()

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? ''
  const headers = corsHeaders(origin, request)

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin not allowed' })
    response.writeHead(204, headers)
    return response.end()
  }

  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { ok: true, source: process.env.IBKR_WEB_API_URL ? 'IBKR Web API' : 'IBKR Desktop', autoSync: Boolean(process.env.IBKR_WEB_API_URL && autoSyncUserId), autoSyncSeconds, lastAutoError, heartbeatSeconds: process.env.IBKR_WEB_API_URL ? 60 : null, heartbeatError, sessionRecovery: maintainGatewaySession.state(), notifications: gatewayAlerts.state() }, headers)
  }

  if (request.method !== 'POST' || request.url !== '/sync-stops') {
    return sendJson(response, 404, { error: 'Not found' }, headers)
  }
  if (!isAllowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin not allowed' })

  try {
    const body = await readJson(request)
    // Also avoid waiting behind an earlier sync when authentication is unavailable.
    if (process.env.IBKR_WEB_API_URL) await maintainGatewaySession()
    const result = await syncStops(body.userId)
    autoSyncUserId = body.userId
    sendJson(response, 200, result, headers)
  } catch (error) {
    sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) }, headers)
  }
})

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`IBKR stop bridge listening on http://127.0.0.1:${BRIDGE_PORT}`)
  void autoSync()
  void keepGatewayAlive()
})

server.on('error', error => {
  console.error(`IBKR stop bridge could not start: ${error.message}`)
  process.exitCode = 1
})
