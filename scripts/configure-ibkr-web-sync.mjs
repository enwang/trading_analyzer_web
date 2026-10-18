import { chmod, readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { requestWebJson } from '../lib/ibkr/web-stop-orders.mjs'

// Only read the authenticated account list; never initialize or compete for a session.
const base = new URL('https://localhost:5050/v1/api/')
const options = { allowSelfSigned: true }
const auth = await requestWebJson(new URL('iserver/auth/status', base), options)
if (auth.authenticated !== true || auth.connected !== true || auth.competing === true) {
  throw new Error('Please log in at https://localhost:5050 first')
}
const response = await requestWebJson(new URL('iserver/accounts', base), options)
if (!Array.isArray(response.accounts) || response.accounts.length !== 1 || typeof response.accounts[0] !== 'string') {
  throw new Error('Multiple/no accounts found. Set IBKR_WEB_API_ACCOUNT_ID and IBKR_STOP_SYNC_USER_ID manually; see docs/ibkr-api-stops.md')
}
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data, error } = await supabase.from('user_settings').select('user_id').not('ibkr_token', 'is', null)
if (error || data?.length !== 1) throw new Error('Could not identify one website user. Configure the account/user mapping manually.')
const settings = {
  IBKR_WEB_API_URL: base.toString().replace(/\/$/, ''),
  IBKR_WEB_API_ACCOUNT_ID: response.accounts[0],
  IBKR_WEB_API_ALLOW_SELF_SIGNED: 'true',
  IBKR_STOP_SYNC_USER_ID: data[0].user_id,
  IBKR_STOP_AUTO_SYNC_SECONDS: '3600',
}
let content = await readFile('.env.local', 'utf8')
for (const [key, value] of Object.entries(settings)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  content = pattern.test(content) ? content.replace(pattern, line) : `${content.replace(/\n?$/, '\n')}${line}\n`
}
await writeFile('.env.local', content, { mode: 0o600 })
await chmod('.env.local', 0o600)
console.log('Gateway account and website user configured. Restart the stop bridge to enable automatic sync every hour.')
