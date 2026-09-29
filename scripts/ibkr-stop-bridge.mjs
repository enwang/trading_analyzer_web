import http from 'node:http'
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import { buildStopSyncDatabaseUpdate, matchOpenStopsToTrades } from '../lib/ibkr/open-stop-orders.ts'

const BRIDGE_PORT = Number(process.env.IBKR_STOP_BRIDGE_PORT || 4317)
const DESKTOP_ORDERS_HELPER = process.env.IBKR_DESKTOP_ORDERS_HELPER
  || join(
    homedir(),
    'Applications',
    'Trading Analyzer IBKR Reader.app',
    'Contents',
    'MacOS',
    'ibkr-desktop-orders',
  )
const execFileAsync = promisify(execFile)

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

async function fetchOpenStopOrders() {
  try {
    const { stdout } = await execFileAsync(DESKTOP_ORDERS_HELPER, [], {
      timeout: 15_000,
      maxBuffer: 1_000_000,
    })
    const orders = JSON.parse(stdout)
    if (!Array.isArray(orders)) throw new Error('Desktop order reader returned invalid data')
    return orders
  } catch (error) {
    const stderr = error?.stderr?.trim()
    throw new Error(stderr || error?.message || 'Could not read IBKR Desktop open orders')
  }
}

function requireEnvironment() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) throw new Error('Supabase environment variables are missing')
  return { url, serviceRoleKey }
}

async function syncStops(userId) {
  if (typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error('A valid user ID is required')
  }

  const orders = await fetchOpenStopOrders()
  const { url, serviceRoleKey } = requireEnvironment()
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: trades, error } = await supabase
    .from('trades')
    .select('id, symbol, side, shares, entry_time, entry_price, stop_loss, current_stop_loss, initial_risk_amount')
    .eq('user_id', userId)
    .is('exit_time', null)

  if (error) throw new Error(`Could not load open trades: ${error.message}`)

  const matched = matchOpenStopsToTrades(trades ?? [], orders)
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

  return {
    source: 'IBKR Desktop',
    openStopOrders: orders.length,
    updated,
    unchanged,
    initialSlInitialized,
    skipped: matched.skipped,
  }
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? ''
  const headers = corsHeaders(origin, request)

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin not allowed' })
    response.writeHead(204, headers)
    return response.end()
  }

  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { ok: true }, headers)
  }

  if (request.method !== 'POST' || request.url !== '/sync-stops') {
    return sendJson(response, 404, { error: 'Not found' }, headers)
  }
  if (!isAllowedOrigin(origin)) return sendJson(response, 403, { error: 'Origin not allowed' })

  try {
    const body = await readJson(request)
    const result = await syncStops(body.userId)
    sendJson(response, 200, result, headers)
  } catch (error) {
    sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) }, headers)
  }
})

server.listen(BRIDGE_PORT, '127.0.0.1', () => {
  console.log(`IBKR stop bridge listening on http://127.0.0.1:${BRIDGE_PORT}`)
})

server.on('error', error => {
  console.error(`IBKR stop bridge could not start: ${error.message}`)
  process.exitCode = 1
})
