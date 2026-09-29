import http from 'node:http'
import net from 'node:net'

import { createClient } from '@supabase/supabase-js'
import { EventName, IBApi } from '@stoqey/ib'

import { matchOpenStopsToTrades } from '../lib/ibkr/open-stop-orders.ts'

const BRIDGE_PORT = Number(process.env.IBKR_STOP_BRIDGE_PORT || 4317)
const IBKR_HOST = process.env.IBKR_TWS_HOST || '127.0.0.1'
const DEFAULT_TWS_PORTS = [7496, 7497, 4001, 4002]
const INACTIVE_STATUSES = new Set(['Cancelled', 'ApiCancelled', 'Filled', 'Inactive'])

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

function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: IBKR_HOST, port })
    const finish = connected => {
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(350)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function findTwsPort() {
  if (process.env.IBKR_TWS_PORT) {
    const configured = Number(process.env.IBKR_TWS_PORT)
    if (!Number.isFinite(configured)) throw new Error('IBKR_TWS_PORT must be a number')
    return configured
  }
  for (const port of DEFAULT_TWS_PORTS) {
    if (await canConnect(port)) return port
  }
  throw new Error('TWS API is unavailable. Open TWS and enable API socket clients, then try Sync Now again.')
}

function stopPriceFor(order) {
  const orderType = String(order.orderType ?? '').trim().toUpperCase()
  if (orderType.startsWith('TRAIL')) {
    const value = Number(order.trailStopPrice)
    return Number.isFinite(value) && value > 0 && value < 1_000_000_000 ? value : null
  }
  if (orderType === 'STP' || orderType === 'STP LMT' || orderType === 'STP PRT') {
    const value = Number(order.auxPrice)
    return Number.isFinite(value) && value > 0 && value < 1_000_000_000 ? value : null
  }
  return null
}

async function fetchOpenStopOrders(port) {
  return new Promise((resolve, reject) => {
    const api = new IBApi({ host: IBKR_HOST, port, clientId: 0 })
    const orders = []
    let settled = false
    const timer = setTimeout(() => finish(new Error('Timed out while reading TWS open orders')), 15_000)

    function finish(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { api.disconnect() } catch {}
      if (error) reject(error)
      else resolve(orders)
    }

    api.on(EventName.connected, () => api.reqOpenOrders())
    api.on(EventName.openOrder, (orderId, contract, order, orderState) => {
      if (INACTIVE_STATUSES.has(String(orderState?.status ?? ''))) return
      const stopPrice = stopPriceFor(order)
      const symbol = String(contract?.symbol ?? '').trim().toUpperCase()
      const quantity = Number(order?.totalQuantity)
      if (!symbol || stopPrice == null || !Number.isFinite(quantity) || quantity <= 0) return
      orders.push({
        orderId: Number(orderId),
        symbol,
        action: String(order.action ?? '').trim().toUpperCase(),
        quantity,
        orderType: String(order.orderType ?? ''),
        stopPrice,
      })
    })
    api.on(EventName.openOrderEnd, () => finish())
    api.on(EventName.error, (error, code) => {
      const numericCode = Number(code)
      if ([2104, 2106, 2107, 2108, 2158].includes(numericCode)) return
      if (!api.isConnected || numericCode === 502 || numericCode === 504) {
        finish(new Error(error?.message ?? String(error)))
      }
    })

    try {
      api.connect()
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
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

  const port = await findTwsPort()
  const orders = await fetchOpenStopOrders(port)
  const { url, serviceRoleKey } = requireEnvironment()
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: trades, error } = await supabase
    .from('trades')
    .select('id, symbol, side, shares, entry_time, current_stop_loss')
    .eq('user_id', userId)
    .is('exit_time', null)

  if (error) throw new Error(`Could not load open trades: ${error.message}`)

  const matched = matchOpenStopsToTrades(trades ?? [], orders)
  let updated = 0
  let unchanged = 0

  for (const update of matched.updates) {
    const trade = trades?.find(candidate => candidate.id === update.tradeId)
    if (trade?.current_stop_loss != null && Math.abs(trade.current_stop_loss - update.stopPrice) < 0.000001) {
      unchanged += 1
      continue
    }

    const { error: updateError } = await supabase
      .from('trades')
      .update({ current_stop_loss: update.stopPrice })
      .eq('id', update.tradeId)
      .eq('user_id', userId)
      .is('exit_time', null)
    if (updateError) throw new Error(`Could not update ${update.symbol}: ${updateError.message}`)
    updated += 1
  }

  return {
    port,
    openStopOrders: orders.length,
    updated,
    unchanged,
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
