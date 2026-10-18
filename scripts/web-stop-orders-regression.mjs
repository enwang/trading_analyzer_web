import assert from 'node:assert/strict'
import { fetchWebStopOrders, parseWebStopOrders, requestWebJson } from '../lib/ibkr/web-stop-orders.mjs'
const row = { acct: 'U1', secType: 'STK', ticker: 'AAPL', orderId: 12, side: 'SELL', status: 'Submitted', origOrderType: 'STP', price: '180', remainingQuantity: 5, totalSize: 10 }
assert.equal(parseWebStopOrders([row], 'U1')[0].stopPrice, 180)
assert.equal(parseWebStopOrders([row], 'U1')[0].quantity, 5)
assert.deepEqual(parseWebStopOrders([row], 'U2'), [])
assert.equal(parseWebStopOrders([{ ...row, origOrderType: 'STP LMT', auxPrice: 179, price: 178 }], 'U1')[0].stopPrice, 179)
assert.throws(() => parseWebStopOrders([{ ...row, origOrderType: 'STP LMT' }], 'U1'), /missing trigger/)
assert.deepEqual(parseWebStopOrders([{ ...row, origOrderType: 'TRAIL', auxPrice: 2 }], 'U1'), [])
assert.deepEqual(parseWebStopOrders([{ ...row, secType: 'OPT' }], 'U1'), [])
assert.equal(parseWebStopOrders([{ ...row, status: 'Filled', remainingQuantity: 0, avgPrice: '179.9' }], 'U1')[0].quantity, 10)
const env = { IBKR_WEB_API_URL: 'https://localhost:5000/v1/api', IBKR_WEB_API_ACCOUNT_ID: 'U1' }
const urls = []
const result = await fetchWebStopOrders(env, async url => {
  urls.push(url.toString())
  return urls.length === 1 ? { authenticated: true, connected: true } : urls.length === 2 ? {} : urls.length === 3 ? { orders: [], snapshot: true } : { orders: [row], snapshot: true }
}, async () => {})
assert.equal(result.orders.length, 1)
assert.equal(urls[0], 'https://localhost:5000/v1/api/iserver/auth/status')
assert.equal(urls[1], 'https://localhost:5000/v1/api/tickle')
assert.equal(urls[2], 'https://localhost:5000/v1/api/iserver/account/orders?accountId=U1&force=true')
assert.equal(urls[3], 'https://localhost:5000/v1/api/iserver/account/orders?accountId=U1')
await assert.rejects(fetchWebStopOrders(env, async () => ({ authenticated: false })), /session is unavailable/)
await assert.rejects(fetchWebStopOrders(env, async url => url.pathname.endsWith('status') ? { authenticated: true, connected: true } : { orders: [] }, async () => {}), /snapshot is not ready/)
await assert.rejects(fetchWebStopOrders({ ...env, IBKR_WEB_API_ACCOUNT_ID: '' }), /ACCOUNT_ID/)
assert.throws(() => requestWebJson(new URL('https://example.com'), { allowSelfSigned: true }), /only on loopback/)
assert.throws(() => requestWebJson(new URL('http://example.com')), /HTTPS/)
console.log('Web stop orders regression passed')
