import { requestWebJson } from './web-stop-orders.mjs'

export function createGatewaySessionMaintainer(env = process.env, request = requestWebJson) {
  let pending = null
  let lastFailure = null
  let lastHealthyAt = null
  async function maintain() {
    if (!env.IBKR_WEB_API_URL) return
    const base = new URL(env.IBKR_WEB_API_URL.replace(/\/$/, '') + '/')
    try {
      // Heartbeat only. Never initialize a session, reauthenticate, or trigger 2FA.
      const heartbeat = await request(new URL('tickle', base), {
        allowSelfSigned: env.IBKR_WEB_API_ALLOW_SELF_SIGNED === 'true',
        timeoutMs: 1500,
      })
      const status = heartbeat?.iserver?.authStatus
      if (status?.competing === true) throw new Error('Another IBKR session is active; please log in manually when ready')
      if (status?.authenticated !== true || status?.connected !== true) {
        throw new Error('Gateway is not authenticated; please log in manually at https://localhost:5050')
      }
      lastFailure = null
      lastHealthyAt = new Date().toISOString()
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }
  const ensure = () => {
    if (!pending) pending = maintain().finally(() => { pending = null })
    return pending
  }
  ensure.state = () => ({ autoReconnect: false, lastHealthyAt, lastFailure })
  return ensure
}
