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

  const openRowsBySymbol = new Map()
  for (const existing of existingRows) {
    if (existing.exit_time != null) continue
    const list = openRowsBySymbol.get(existing.symbol) ?? []
    list.push(existing)
    openRowsBySymbol.set(existing.symbol, list)
  }

  // Closed: symbol|entry_time|exit_time. Open: symbol|entry_time.
  const byKey = new Map(
    existingRows.map(r => {
      const key = r.exit_time
        ? `${r.symbol}|${normalizeTs(r.entry_time)}|${normalizeTs(r.exit_time)}`
        : `${r.symbol}|${normalizeTs(r.entry_time)}`
      return [key, r]
    })
  )
  for (const row of newRows) {
    const key = row.exit_time
      ? `${row.symbol}|${normalizeTs(row.entry_time)}|${normalizeTs(row.exit_time)}`
      : `${row.symbol}|${normalizeTs(row.entry_time)}`
    const exactExisting = byKey.get(key)
    const symbolOpenRows = openRowsBySymbol.get(row.symbol) ?? []
    const existing = exactExisting ?? (row.exit_time == null && symbolOpenRows.length === 1 ? symbolOpenRows[0] : null)
    if (!existing) continue
    if (row.setup_tag === 'untagged' && existing.setup_tag) row.setup_tag = existing.setup_tag
    if (!row.notes && existing.notes) row.notes = existing.notes
    if (!row.needs_review && existing.needs_review) row.needs_review = existing.needs_review
    if (row.stop_loss == null && existing.stop_loss != null) row.stop_loss = existing.stop_loss
    if (row.r_multiple == null && existing.r_multiple != null) row.r_multiple = existing.r_multiple
  }
  return newRows
}

const existingDbRows = [
  // Open trade with manual override — entry_time is the CSV-stored value
  { symbol: 'GSAT', entry_time: '2026-04-14T14:00:00.000Z', exit_time: null,
    stop_loss: 77.77, r_multiple: null, setup_tag: 'momentum', notes: 'my note', needs_review: true },
  // Another open trade with manual stop
  { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null,
    stop_loss: 25.00, r_multiple: null, setup_tag: 'untagged', notes: null, needs_review: false },
  // Closed trade keyed by symbol|entry|exit
  { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z',
    stop_loss: 822.99, r_multiple: -1.13, setup_tag: 'breakout', notes: null, needs_review: false },
]

// New rows from IBKR — GSAT entry_time differs by 1 second (XML openDateTime ≠ CSV stored time)
const newRows = [
  { symbol: 'GSAT', entry_time: '2026-04-14T14:00:01.000Z', exit_time: null,
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null, needs_review: false },
  { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null,
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null, needs_review: false },
  { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z',
    stop_loss: null, r_multiple: null, setup_tag: 'untagged', notes: null, needs_review: false },
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
if (!gsatRow.needs_review) {
  fail(`manual GSAT needs_review not preserved after sync (entry_time mismatch) — got ${gsatRow.needs_review}`)
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
    // GSAT: no entry_price/shares → suggestedStopLossFromRisk returns null → row preserved
    { symbol: 'GSAT', entry_time: '2026-04-14T14:00:01.000Z', exit_time: null, side: 'long', stop_loss: 77.77 },
    // ADEA: no stop_loss — enrichment must calculate one
    { symbol: 'ADEA', entry_time: '2026-04-07T13:30:00.000Z', exit_time: null, side: 'long', entry_price: 24.50, shares: 1000, stop_loss: null },
    // LITE: closed trade — enrichment must skip it
    { symbol: 'LITE', entry_time: '2026-04-14T19:00:00.000Z', exit_time: '2026-04-15T13:30:00.000Z', side: 'long', stop_loss: null },
  ],
  [],
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
if (lookupCalls !== 0) {
  fail(`expected no legacy market lookups, got ${lookupCalls}`)
}
const enrichedAdea = enriched.find(r => r.symbol === 'ADEA')
if (enrichedAdea.stop_loss == null) {
  fail('ADEA should have received a calculated stop_loss from enrichment')
}
if (enrichedAdea.stop_loss !== 22.50) {
  fail(`expected ADEA $2000-risk stop_loss 22.50, got ${enrichedAdea.stop_loss}`)
}

const futureStopLossFirst = await enrichOpenTradesWithStopLosses(
  [
    { symbol: 'NEW', entry_time: '2026-08-31T13:30:00.000Z', exit_time: null, side: 'long', entry_price: 50, shares: 100, stop_loss: null },
  ],
  []
)

const futureRow = futureStopLossFirst.find(r => r.symbol === 'NEW')
if (futureRow.stop_loss != null) {
  fail(`new stop-loss-first trades should not receive an automatic $2000 stop_loss — got ${futureRow.stop_loss}`)
}

// ---------------------------------------------------------------------------
// 4. Delete scope: delete open rows for new open positions AND for positions
//    that just closed (had an existing open row, got a close, no new open row)
// ---------------------------------------------------------------------------
function symbolsToDelete(newRows, existingRows) {
  const symbolsWithNewOpenSet = new Set(newRows.filter(r => r.exit_time == null).map(r => r.symbol))
  const symbolsWithExistingOpen = new Set(existingRows.filter(r => r.exit_time == null).map(r => r.symbol))
  const symbolsThatJustClosed = [...new Set(
    newRows.filter(r => r.exit_time != null && symbolsWithExistingOpen.has(r.symbol) && !symbolsWithNewOpenSet.has(r.symbol)).map(r => r.symbol)
  )]
  return [...new Set([...symbolsWithNewOpenSet, ...symbolsThatJustClosed])]
}

const existingOpen = [
  { symbol: 'GSAT', exit_time: null },
  { symbol: 'ADEA', exit_time: null },
]

// All rows are closed, no existing open rows — nothing deleted
const scope1 = symbolsToDelete(
  [{ symbol: 'LITE', exit_time: '2026-04-15T13:30:00.000Z' }],
  []
)
if (scope1.length !== 0) {
  fail(`no existing open rows, all-closed response must not delete anything, got: ${JSON.stringify(scope1)}`)
}

// GSAT had an existing open row and just got a close (no new open) — must be deleted
const scope2 = symbolsToDelete(
  [{ symbol: 'GSAT', exit_time: '2026-04-20T14:00:00.000Z' }],
  [{ symbol: 'GSAT', exit_time: null }]
)
if (scope2.length !== 1 || !scope2.includes('GSAT')) {
  fail(`GSAT just closed but open row not in delete scope: ${JSON.stringify(scope2)}`)
}

// ADEA still open, GSAT just closed — both in delete scope
const scope3 = symbolsToDelete(
  [
    { symbol: 'GSAT', exit_time: '2026-04-20T14:00:00.000Z' },
    { symbol: 'ADEA', exit_time: null },
  ],
  existingOpen
)
if (scope3.length !== 2 || !scope3.includes('GSAT') || !scope3.includes('ADEA')) {
  fail(`expected GSAT (just closed) and ADEA (still open) in delete scope: ${JSON.stringify(scope3)}`)
}

// Closed trade for symbol with NO existing open row — must NOT appear in delete scope
const scope4 = symbolsToDelete(
  [{ symbol: 'LITE', exit_time: '2026-04-15T13:30:00.000Z' }],
  existingOpen   // LITE not in existingOpen
)
if (scope4.length !== 0) {
  fail(`LITE has no existing open row, close should not trigger delete: ${JSON.stringify(scope4)}`)
}

console.log('sync-open-trades-regression: PASS')
