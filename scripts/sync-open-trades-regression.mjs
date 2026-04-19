/**
 * Regression tests for three sync bugs that wiped open trades and overrode
 * manually-set stop losses:
 *
 * 1. Manual stop_loss is preserved even when the new row's entry_time
 *    differs from what's stored in the DB (symbol-keyed lookup for open trades)
 * 2. enrichOpenTradesWithStopLosses must NOT overwrite a manual stop_loss
 * 3. Delete scope: only open rows for symbols with incoming open positions
 *    should be deleted — not every symbol that appeared in the response
 */

import { enrichOpenTradesWithStopLosses } from '../lib/market/stop-loss.ts'
import { parseFlexCsv } from '../lib/ibkr/flex.ts'
import fs from 'fs'

function fail(message) {
  console.error(`sync-open-trades-regression: FAIL — ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. CSV parser produces open trades (sanity-check, full coverage in
//    parser-regression.mjs)
// ---------------------------------------------------------------------------
if (fs.existsSync('./mytrade.csv')) {
  const trades = parseFlexCsv(fs.readFileSync('./mytrade.csv', 'utf8'))
  const openCount = trades.filter(t => t.outcome === 'open').length
  if (openCount === 0) {
    fail(`parseFlexCsv returned 0 open trades from mytrade.csv — open position parsing is broken`)
  }
}

// ---------------------------------------------------------------------------
// 2. Manual stop_loss preserved when open-trade key matches by symbol only.
//    This mirrors the fixed key logic in all three sync/fetch/upload routes.
// ---------------------------------------------------------------------------
function preserveManualFields(newRows, existingRows) {
  const normalizeTs = (t) => t ? t.slice(0, 19) : ''
  const byKey = new Map(
    existingRows.map(r => {
      // Open trades: keyed by symbol only (openDateTime from XML can differ from CSV)
      const key = r.exit_time
        ? `${r.symbol}|${normalizeTs(r.entry_time)}|${normalizeTs(r.exit_time)}`
        : r.symbol
      return [key, r]
    })
  )
  for (const row of newRows) {
    const key = row.exit_time
      ? `${row.symbol}|${normalizeTs(row.entry_time)}|${normalizeTs(row.exit_time)}`
      : row.symbol
    const existing = byKey.get(key)
    if (!existing) continue
    if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
    if (!row.notes && existing.notes) row.notes = existing.notes
    if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = existing.stop_loss
    if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
  }
  return newRows
}

const existingDbRows = [
  // Open trade with manual override — entry_time is the CSV-stored value
  { symbol: 'GSAT', entry_time: '2026-04-14T14:00:00.000Z', exit_time: null,
    stop_loss: 77.77, r_multiple: null, setup_tag: 'momentum', notes: 'my note' },
  // Another open trade with manual stop
  { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null,
    stop_loss: 25.00, r_multiple: null, setup_tag: 'untagged', notes: null },
  // Closed trade keyed by symbol|entry|exit
  { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z',
    stop_loss: 822.99, r_multiple: -1.13, setup_tag: 'breakout', notes: null },
]

// New rows from IBKR — GSAT entry_time differs by 1 second (XML openDateTime ≠ CSV stored time)
const newRows = [
  { symbol: 'GSAT', entry_time: '2026-04-14T14:00:01.000Z', exit_time: null,
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null },
  { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null,
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null },
  { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z',
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null },
]

preserveManualFields(newRows, existingDbRows)

const gsatRow = newRows.find(r => r.symbol === 'GSAT')
if (gsatRow.stop_loss !== 77.77) {
  fail(`manual GSAT stop_loss 77.77 not preserved after sync (entry_time mismatch) — got ${gsatRow.stop_loss}`)
}
if (gsatRow.setup_tag !== 'momentum') {
  fail(`manual GSAT setup_tag not preserved — got ${gsatRow.setup_tag}`)
}
if (gsatRow.notes !== 'my note') {
  fail(`manual GSAT notes not preserved — got ${gsatRow.notes}`)
}

const adeaRow = newRows.find(r => r.symbol === 'ADEA')
if (adeaRow.stop_loss !== 25.00) {
  fail(`manual ADEA stop_loss not preserved — got ${adeaRow.stop_loss}`)
}

const liteRow = newRows.find(r => r.symbol === 'LITE')
if (liteRow.stop_loss !== 822.99) {
  fail(`manual LITE (closed) stop_loss not preserved — got ${liteRow.stop_loss}`)
}
if (liteRow.setup_tag !== 'breakout') {
  fail(`manual LITE setup_tag not preserved — got ${liteRow.setup_tag}`)
}

// ---------------------------------------------------------------------------
// 3. enrichOpenTradesWithStopLosses must NOT overwrite a manual stop_loss
// ---------------------------------------------------------------------------
let lookupCalls = 0
const enriched = await enrichOpenTradesWithStopLosses(
  [
    // GSAT: manual stop_loss already set — enrichment must skip it
    { symbol: 'GSAT', entry_time: '2026-04-14T14:00:01.000Z', exit_time: null, side: 'long', stop_loss: 77.77 },
    // ADEA: no stop_loss — enrichment must calculate one
    { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null, side: 'long', stop_loss: null },
    // LITE: closed trade — enrichment must skip it
    { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z', side: 'long', stop_loss: null },
  ],
  async (symbol) => {
    lookupCalls++
    if (symbol === 'ADEA') return { low: 24.50, high: 26.00 }
    return null
  }
)

const enrichedGsat = enriched.find(r => r.symbol === 'GSAT')
if (enrichedGsat.stop_loss !== 77.77) {
  fail(`enrichment overwrote manual GSAT stop_loss — got ${enrichedGsat.stop_loss}`)
}
if (lookupCalls !== 1) {
  fail(`expected exactly 1 market lookup (ADEA only), got ${lookupCalls}`)
}
const enrichedAdea = enriched.find(r => r.symbol === 'ADEA')
if (enrichedAdea.stop_loss == null) {
  fail('ADEA should have received a calculated stop_loss from enrichment')
}
if (enrichedAdea.stop_loss !== 24.49) {
  fail(`expected ADEA calculated stop_loss 24.49 (low 24.50 - 0.01), got ${enrichedAdea.stop_loss}`)
}

// ---------------------------------------------------------------------------
// 4. Delete scope: only delete open rows for symbols with incoming open trades
// ---------------------------------------------------------------------------
function symbolsToDelete(rows) {
  return [...new Set(rows.filter(r => r.exit_time == null).map(r => r.symbol))]
}

// All rows are closed — nothing should be deleted
const scope1 = symbolsToDelete([
  { symbol: 'LITE', exit_time: '2026-04-15T13:30:00.000Z' },
  { symbol: 'CAR',  exit_time: '2026-04-15T14:00:00.000Z' },
])
if (scope1.length !== 0) {
  fail(`all-closed response must not delete any open rows, but got scope: ${JSON.stringify(scope1)}`)
}

// Only GSAT is open — only GSAT should be in delete scope
const scope2 = symbolsToDelete([
  { symbol: 'GSAT', exit_time: null },
  { symbol: 'LITE', exit_time: '2026-04-15T13:30:00.000Z' },
])
if (scope2.length !== 1 || scope2[0] !== 'GSAT') {
  fail(`only GSAT open in response, but delete scope was: ${JSON.stringify(scope2)}`)
}

// Multiple open symbols
const scope3 = symbolsToDelete([
  { symbol: 'GSAT', exit_time: null },
  { symbol: 'ADEA', exit_time: null },
  { symbol: 'LITE', exit_time: '2026-04-15T13:30:00.000Z' },
])
if (scope3.length !== 2 || !scope3.includes('GSAT') || !scope3.includes('ADEA')) {
  fail(`expected GSAT and ADEA in delete scope, got: ${JSON.stringify(scope3)}`)
}

console.log('sync-open-trades-regression: PASS')
