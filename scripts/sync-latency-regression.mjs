import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Execute the real route and snapshot helper with deterministic database/broker
// transports. No production credentials or writes are used.
function loadTs(path, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, performance, console,
    require(name) {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
  }, { filename: path })
  return module.exports
}
const snapshots = loadTs('../lib/trade-snapshots.ts')
const hidden = loadTs('../lib/hidden-trades.ts')

async function scenario(failure) {
  const events = []
  let backupSaved = false
  let writtenRows
  const manual = {
    user_id: 'user-1', symbol: 'ABC', entry_time: '2026-01-02T14:30:00', exit_time: '2026-01-03T15:00:00',
    entry_price: 100, stop_loss: 95, current_stop_loss: null,
    stop_loss_locked: true, initial_risk_amount: 50, r_multiple: 2,
    notes: 'Keep my journal', setup_tag: 'breakout', needs_review: true,
  }
  const incoming = { ...manual, notes: null, setup_tag: 'untagged', needs_review: false, stop_loss: null, r_multiple: null }
  const excluded = { ...incoming, symbol: 'HIDDEN' }
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from(table) {
      let action = 'read', payload, filters = []
      const query = {
        select() { return query },
        eq(...args) { filters.push(args); return query },
        in() { return query }, order() { return query }, single() { return query },
        is() { return query }, not() { return query },
        insert(value) { action = 'insert'; payload = value; return query },
        upsert(value) { action = 'upsert'; payload = value; return query },
        delete() { action = 'delete'; return query },
        throwOnError() { return query },
        then(resolve, reject) {
          return (async () => {
            events.push(`${table}:${action}:start`)
            if (table === 'trades' && action !== 'read') assert.ok(backupSaved, 'Trade mutation before backup completed')
            await new Promise(resolve => setImmediate(resolve))
            if (failure === `${table}:${action}`) throw new Error('injected database failure')
            let data = []
            if (table === 'user_settings' && action === 'read') data = { ibkr_token: 'fake', ibkr_query_id: 'fake' }
            if (table === 'trades' && action === 'read') {
              assert.ok(filters.some(([key, value]) => key === 'user_id' && value === 'user-1'))
              data = [manual]
            }
            if (table === 'hidden_trades') data = [excluded]
            if (table === 'trade_snapshots' && action === 'insert') {
              assert.equal(payload.payload.trades[0].notes, manual.notes)
              backupSaved = true
              data = { id: 'snapshot-1' }
            }
            if (table === 'trades' && action === 'upsert') { writtenRows = payload; data = [{ id: 'trade-1' }] }
            events.push(`${table}:${action}:end`)
            return { data, error: null }
          })().then(resolve, reject)
        },
      }
      return query
    },
  }
  const route = loadTs('../app/api/ibkr/fetch/route.ts', {
    '@/lib/supabase/server': { createClient: async () => db },
    '@/lib/ibkr/flex': { fetchFlexAll: async () => ({ trades: [incoming, excluded], navDaily: [{}], navChange: [{}], cashTransactions: [{}] }) },
    '@/lib/ibkr/stock-splits': { preservedPriceScaleForKnownSplit: () => 1, scalePreservedPrice: x => x },
    '@/lib/trade-snapshots': snapshots,
    '@/lib/hidden-trades': hidden,
    '@/lib/market/stop-loss': { usesStopLossFirstSizing: () => false },
    'next/server': { after: () => {}, NextResponse: { json: (body, init) => ({ body, ...init }) } },
  })
  const response = await route.POST({ json: async () => ({}) })
  return { response, events, writtenRows }
}
const { response, events, writtenRows } = await scenario()
assert.equal(response.status, 200)
assert.equal(response.body.upserted, 1)
assert.equal(response.body.skipped, 1)
assert.equal(events.filter(e => e === 'trades:read:start').length, 1, 'Read trades once for backup and preservation')
const starts = ['account_nav_daily', 'account_nav_change', 'account_cash_transactions', 'hidden_trades']
const firstEnd = Math.min(...starts.map(table => events.indexOf(`${table}:${table === 'hidden_trades' ? 'read' : 'upsert'}:end`)))
for (const table of starts) assert.ok(events.indexOf(`${table}:${table === 'hidden_trades' ? 'read' : 'upsert'}:start`) < firstEnd, `${table} was serialized`)
assert.equal(writtenRows.length, 1)
assert.equal(writtenRows[0].notes, 'Keep my journal')
assert.equal(writtenRows[0].stop_loss, 95)
assert.equal(writtenRows[0].stop_loss_locked, true)
assert.equal(writtenRows[0].setup_tag, 'breakout')
assert.ok(response.body.timings.total >= 0)
assert.ok(response.headers['Server-Timing'].includes('total;dur='))
for (const failure of ['trades:read', 'trade_snapshots:insert', 'account_nav_daily:upsert', 'trades:upsert']) {
  const result = await scenario(failure)
  assert.equal(result.response.status, 500, failure)
  assert.equal(result.writtenRows, undefined, failure)
  assert.ok(!result.events.includes('user_settings:upsert:start'), 'Do not record successful sync on failure')
}
console.log('sync-latency-regression: PASS (real route: concurrent writes, one trade read, backup ordering, preservation, hidden trades, failure paths)')
