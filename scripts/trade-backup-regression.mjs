import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as crypto from 'node:crypto'

function loadTs(path, dependencies) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, {
    module, exports: module.exports, console: { error() {} },
    require(name) { assert.ok(name in dependencies, name); return dependencies[name] },
  }, { filename: path })
  return module.exports
}
const snapshots = loadTs('../lib/trade-snapshots.ts', { 'node:crypto': crypto })
const jobs = []
const { scheduleTradeBackup } = loadTs('../lib/trade-backup.ts', {
  'next/server': { after: job => jobs.push(job) }, '@/lib/trade-snapshots': snapshots,
})
let rows = [{ id: '1', user_id: 'u1', notes: 'Original note', stop_loss: 95, execution_legs: [{ time: '1', shares: 10, price: 100 }] }]
let stored = []
let failWrite = false
let readRanges = []
const db = {
  from(table) {
    let userId, action = 'read', payload, fields = '', range
    const query = {
      select(value) { fields = value; return query },
      eq(key, value) { if (key === 'user_id') userId = value; return query },
      order() { return query }, limit() { return query }, maybeSingle() { return query }, single() { return query },
      range(from, to) { range = [from, to]; return query },
      insert(value) { action = 'insert'; payload = value; return query },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (table === 'trades') {
            assert.ok(userId, 'Scope every trade read to its user')
            readRanges.push(range)
            const data = rows.filter(row => row.user_id === userId)
            return { data: range ? data.slice(range[0], range[1] + 1) : data, error: null }
          }
          assert.equal(table, 'trade_snapshots')
          if (action === 'insert') {
            if (failWrite) return { data: null, error: new Error('Backup insert unavailable') }
            const snapshot = { ...payload, id: `s${stored.length + 1}`, created_at: new Date().toISOString() }
            stored.push(structuredClone(snapshot))
            return { data: snapshot, error: null }
          }
          assert.ok(userId, 'Scope every backup lookup to its user')
          const matches = stored.filter(snapshot => snapshot.user_id === userId).reverse()
          if (range) return { data: matches.slice(range[0], range[1] + 1).map(({ id }) => ({ id })), error: null }
          assert.ok(!fields.split(',').map(x => x.trim()).includes('payload'), 'Never download full backups just to check their digest')
          const latest = matches[0]
          return { data: latest ? { id: latest.id, fingerprint: latest.payload.fingerprint } : null, error: null }
        }).then(resolve, reject)
      },
    }
    return query
  },
}
const options = { reason: 'ibkr-sync', reuseIfUnchanged: true }
const first = await snapshots.createTradeSnapshot(db, 'u1', options)
assert.equal(first.reused, false)
assert.equal(stored.length, 1)
const same = await snapshots.createTradeSnapshot(db, 'u1', options)
assert.equal(same.reused, true)
assert.equal(same.id, first.id)
assert.equal(stored.length, 1)
// An older backup without a digest must never be assumed to match.
delete stored[0].payload.fingerprint
assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, false)
for (const change of [{ notes: 'Edited journal' }, { stop_loss: 98 }, { setup_tag: 'new setup' }, { mfe: 32 }, { execution_legs: [{ shares: 11, price: 100, time: '1' }] }]) {
  Object.assign(rows[0], change)
  assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, false, JSON.stringify(change))
  assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, true)
}
const beforeManual = stored.length
await snapshots.createTradeSnapshot(db, 'u1', { reason: 'manual' })
assert.equal(stored.length, beforeManual + 1, 'Explicit manual backups still create a version')
const originalOrder = [{ id: '1', notes: 'a', execution_legs: [{ shares: 2, price: 3 }] }, { id: '2', notes: 'b' }]
const reordered = [{ notes: 'b', id: '2' }, { execution_legs: [{ price: 3, shares: 2 }], notes: 'a', id: '1' }]
assert.equal(snapshots.tradeSnapshotFingerprint(originalOrder), snapshots.tradeSnapshotFingerprint(reordered))
assert.notEqual(snapshots.tradeSnapshotFingerprint(originalOrder), snapshots.tradeSnapshotFingerprint([...originalOrder, { id: '3' }]))
rows = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), user_id: 'u1', notes: `note ${i}` }))
readRanges = []
await snapshots.createTradeSnapshot(db, 'u1', options)
assert.equal(stored.at(-1).payload.trades.length, 1001, 'Do not silently truncate backups at the database page limit')
assert.deepEqual(readRanges, [[0, 999], [1000, 1999]])
rows[1000].notes = 'Last page edited'
assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, false)
rows.push({ id: 'other', user_id: 'u2', notes: 'Other user' })
await snapshots.createTradeSnapshot(db, 'u2', options)
assert.equal(stored.at(-1).user_id, 'u2')
assert.equal(stored.at(-1).payload.trades.length, 1)
// A save schedules preparation, without performing any backup writes inline.
rows[0].notes = 'Newly saved note'
const beforeBackground = stored.length
scheduleTradeBackup(db, 'u1')
assert.equal(jobs.length, 1)
assert.equal(stored.length, beforeBackground)
await jobs.shift()()
assert.equal(stored.length, beforeBackground + 1)
assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, true)
// A failed background attempt never records a successful digest. Sync retries.
rows[0].notes = 'Not yet backed up'
failWrite = true
scheduleTradeBackup(db, 'u1')
await jobs.shift()()
await assert.rejects(snapshots.createTradeSnapshot(db, 'u1', options), /Backup insert unavailable/)
failWrite = false
assert.equal((await snapshots.createTradeSnapshot(db, 'u1', options)).reused, false)
assert.equal(stored.at(-1).payload.trades[0].notes, 'Not yet backed up')
// Verify that the actual journal route schedules only after a successful save.
const callbacks = []
function journalRoute(saveError) {
  const query = { update: () => query, eq: () => query, then: resolve => Promise.resolve(resolve({ error: saveError })) }
  return loadTs('../app/api/trades/[id]/journal/route.ts', {
    '@/lib/trade-backup': { scheduleTradeBackup: (_db, userId) => callbacks.push(userId) },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => query }) },
    'next/server': { NextResponse: { json: (body, init = {}) => ({ body, ...init }) } },
  })
}
await journalRoute(null).PATCH({ json: async () => ({ notes: 'Save', setupTag: 'breakout' }) }, { params: Promise.resolve({ id: '1' }) })
assert.deepEqual(callbacks, ['u1'])
const rejected = await journalRoute({ message: 'Save failed' }).PATCH({ json: async () => ({}) }, { params: Promise.resolve({ id: '1' }) })
assert.equal(rejected.status, 400)
assert.deepEqual(callbacks, ['u1'])
console.log('trade-backup-regression: PASS (persisted reuse, edits, legacy/manual snapshots, pagination, user isolation, background preparation/failure, actual journal save)')
