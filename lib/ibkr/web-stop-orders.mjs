import https from 'node:https'
import http from 'node:http'
import { setTimeout as pause } from 'node:timers/promises'

function positive(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function parseWebStopOrders(rows, accountId) {
  const orders = []
  for (const row of rows) {
    if ((row.acct ?? row.account) !== accountId) continue
    if (row.secType !== 'STK') continue
    const type = String(row.origOrderType ?? row.orderType ?? '').toUpperCase().replaceAll('_', ' ')
    if (!['STP', 'STOP', 'STP LMT', 'STOP LIMIT'].includes(type)) continue
    // A stop-limit's limit price must never be substituted for its trigger.
    const stopPrice = positive(row.stopPrice ?? row.stop_price ?? row.auxPrice)
      ?? (['STP', 'STOP'].includes(type) ? positive(row.price) : null)
    const quantity = positive(row.remainingQuantity) ?? positive(row.totalSize)
    const orderId = positive(row.orderId)
    const symbol = String(row.ticker ?? '').trim().toUpperCase()
    const action = String(row.side ?? '').toUpperCase()
    const status = String(row.status ?? '').toUpperCase().replaceAll(' ', '')
    if (!['SUBMITTED', 'PRESUBMITTED', 'FILLED', 'CANCELLED', 'CANCELED'].includes(status)) continue
    if (!stopPrice || !quantity || !orderId || !symbol || !['BUY', 'SELL'].includes(action)) {
      throw new Error(`IBKR Web API stop order ${row.orderId ?? 'unknown'} is missing trigger price or matching fields`)
    }
    orders.push({ orderId, symbol, action, quantity, orderType: type, stopPrice, status,
      fillPrice: positive(row.avgPrice) })
  }
  return orders
}

export function requestWebJson(url, { allowSelfSigned = false, method = 'GET', body, timeoutMs = 5000 } = {}) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('IBKR Web API URL must use HTTPS (HTTP is allowed only on loopback)')
  }
  if (allowSelfSigned && !local) throw new Error('Self-signed certificates are allowed only on loopback')
  // Read-only broker transport: authentication and order writes are both forbidden.
  if (method !== 'GET' || body != null) {
    throw new Error('All broker writes and automatic authentication requests are prohibited')
  }
  const payload = body == null ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const request = transport.request(url, { method, rejectUnauthorized: !allowSelfSigned, family: 4, headers: { 'User-Agent': 'TradingAnalyzer/1.0', Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) } }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 2_000_000) request.destroy(new Error('IBKR Web API response too large'))
      })
      response.on('error', reject)
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`IBKR Web API HTTP ${response.statusCode}; check Gateway login`))
        try {
          const json = JSON.parse(body)
          if (json.error) throw new Error('IBKR Web API returned an error; check Gateway session')
          resolve(json)
        } catch (error) { reject(error) }
      })
    })
    const deadline = setTimeout(() => request.destroy(new Error('IBKR Web API timed out')), timeoutMs)
    request.once('close', () => clearTimeout(deadline))
    request.on('error', reject)
    request.end(payload)
  })
}

export async function fetchWebStopOrders(env = process.env, getJson = requestWebJson, wait = pause, ensureSession) {
  if (!env.IBKR_WEB_API_ACCOUNT_ID) throw new Error('Set IBKR_WEB_API_ACCOUNT_ID to the account being synced')
  const base = new URL(`${env.IBKR_WEB_API_URL.replace(/\/$/, '')}/`)
  const options = { allowSelfSigned: env.IBKR_WEB_API_ALLOW_SELF_SIGNED === 'true' }
  if (ensureSession) await ensureSession()
  const auth = await getJson(new URL('iserver/auth/status', base), options)
  if (auth.authenticated !== true || auth.connected !== true || auth.competing === true) {
    throw new Error('IBKR Web API brokerage session is unavailable; sign in to Client Portal Gateway')
  }
  // A read-only heartbeat keeps an existing login alive; never reauthenticate or compete.
  await getJson(new URL('tickle', base), options)
  const url = new URL('iserver/account/orders', base)
  url.searchParams.set('accountId', env.IBKR_WEB_API_ACCOUNT_ID)
  // force=true clears IBKR's orders cache and may return an empty response.
  // Do not treat that response as the actual orders snapshot.
  const refreshUrl = new URL(url)
  refreshUrl.searchParams.set('force', 'true')
  await getJson(refreshUrl, options)
  await wait(5_000) // Respect the live orders endpoint rate limit.
  const result = await getJson(url, options)
  if (!Array.isArray(result.orders) || result.snapshot !== true) {
    throw new Error('IBKR Web API orders snapshot is not ready; retry sync')
  }
  return { orders: parseWebStopOrders(result.orders, env.IBKR_WEB_API_ACCOUNT_ID), scan: null }
}
