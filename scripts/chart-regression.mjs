import { deduplicateDailyCandles } from '../lib/market/chart-utils.ts'

function fail(message) {
  console.error(`chart-regression: FAIL - ${message}`)
  process.exit(1)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCandle(isoDate, offsetSec = 0, close = 100) {
  const base = Date.parse(isoDate) / 1000
  return { time: base + offsetSec, open: close, high: close, low: close, close, volume: null }
}

// ── Test: no duplicates – passthrough ─────────────────────────────────────

{
  const candles = [
    makeCandle('2026-03-10T00:00:00Z'),
    makeCandle('2026-03-11T00:00:00Z'),
    makeCandle('2026-03-12T00:00:00Z'),
  ]
  const result = deduplicateDailyCandles(candles)
  assert(result.length === 3, `expected 3 candles, got ${result.length}`)
}

// ── Test: Yahoo returns midnight + market-open for same day ────────────────
// Regression: UMAC 3/13 showed two candles because Yahoo returned
//   2026-03-13T00:00:00Z  (midnight UTC)  and
//   2026-03-13T14:30:00Z  (9:30 AM ET)
// Both are the same calendar day; only one should survive.

{
  const midnightTs  = Date.parse('2026-03-13T00:00:00Z') / 1000   // 1741824000
  const marketOpen  = Date.parse('2026-03-13T14:30:00Z') / 1000   // 1741876200

  const candles = [
    makeCandle('2026-03-12T00:00:00Z'),            // previous day – keep
    { time: midnightTs,  open: 50, high: 52, low: 49, close: 51, volume: 100 },
    { time: marketOpen,  open: 55, high: 58, low: 54, close: 57, volume: 200 }, // keep (later)
  ]

  const result = deduplicateDailyCandles(candles)

  assert(result.length === 2, `expected 2 candles after dedup, got ${result.length}`)

  const mar13 = result.find((c) => new Date(c.time * 1000).toISOString().startsWith('2026-03-13'))
  assert(mar13 !== undefined, 'missing 2026-03-13 candle after dedup')
  assert(mar13.time === marketOpen, `expected market-open timestamp ${marketOpen}, got ${mar13.time}`)
  assert(mar13.close === 57, `expected close 57 (market-open candle), got ${mar13.close}`)
}

// ── Test: multiple duplicates on same day ─────────────────────────────────

{
  const t1 = Date.parse('2026-03-13T00:00:00Z') / 1000
  const t2 = Date.parse('2026-03-13T09:00:00Z') / 1000
  const t3 = Date.parse('2026-03-13T14:30:00Z') / 1000

  const candles = [
    { time: t1, open: 10, high: 11, low: 9,  close: 10, volume: null },
    { time: t2, open: 20, high: 21, low: 19, close: 20, volume: null },
    { time: t3, open: 30, high: 31, low: 29, close: 30, volume: null },
  ]

  const result = deduplicateDailyCandles(candles)
  assert(result.length === 1, `expected 1 candle for 3 same-day entries, got ${result.length}`)
  assert(result[0].time === t3, `expected latest timestamp ${t3}, got ${result[0].time}`)
}

// ── Test: output remains sorted by time ───────────────────────────────────

{
  const candles = [
    makeCandle('2026-03-13T00:00:00Z'),
    makeCandle('2026-03-11T00:00:00Z'),
    makeCandle('2026-03-12T00:00:00Z'),
  ]
  const result = deduplicateDailyCandles(candles)
  assert(result.length === 3, 'expected 3 candles')
  for (let i = 1; i < result.length; i++) {
    assert(result[i].time > result[i - 1].time, `candles not sorted at index ${i}`)
  }
}

console.log('chart-regression: PASS')
