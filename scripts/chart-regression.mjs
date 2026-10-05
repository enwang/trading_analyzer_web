import {
  dateKeyInMarketTimeZone,
  deduplicateDailyCandles,
  calculateIntradayRvol,
  nextUtcDayStartSec,
  synthesizeDailyCandle,
} from '../lib/market/chart-utils.ts'
import { buildSwingDataSnapshot, tradeSwingAnchorDateKeys } from '../lib/market/swing-data.ts'

function fail(message) {
  console.error(`chart-regression: FAIL - ${message}`)
  process.exit(1)
}

// ── Test: intraday RVOL uses cumulative RTH volume at the same minute ─────

{
  const sessionDates = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-21']
  const candles = sessionDates.flatMap((date, dayIndex) => [
    makeCandle(`${date}T13:30:00Z`, 0, 100 + dayIndex),
    makeCandle(`${date}T13:35:00Z`, 0, 100 + dayIndex),
  ].map((candle, barIndex) => ({
    ...candle,
    volume: dayIndex < 5 ? (barIndex === 0 ? 100 : 200) : (barIndex === 0 ? 200 : 100),
  })))

  const result = calculateIntradayRvol(candles)
  const finalSession = result.slice(-2)
  assert(finalSession.length === 2, 'expected RVOL values for the sixth session')
  assert(finalSession[0].value === 2, `expected opening RVOL 2.0, got ${finalSession[0].value}`)
  assert(finalSession[1].value === 1, `expected cumulative RVOL 1.0, got ${finalSession[1].value}`)
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

// ── Test: 1D chart period2 includes the exit calendar day ─────────────────

{
  const exitAtUtcMidnight = Date.parse('2026-03-13T00:00:00Z')
  const expectedNextDayStart = Date.parse('2026-03-14T00:00:00Z') / 1000

  const result = nextUtcDayStartSec(exitAtUtcMidnight)

  assert(
    result === expectedNextDayStart,
    `expected next UTC day start ${expectedNextDayStart}, got ${result}`
  )
}

// ── Test: intraday candles can synthesize a current daily candle ──────────

{
  const candles = [
    { time: 1787059800, open: 248.79, high: 249, low: 243, close: 248.41, volume: 262334 },
    { time: 1787060100, open: 248.40, high: 253.45, low: 247, close: 250.10, volume: 100000 },
    { time: 1787083200, open: 246, high: 246, low: 246, close: 246, volume: 0 },
  ]

  const result = synthesizeDailyCandle(candles)

  assert(result != null, 'expected synthesized candle')
  assert(result.time === 1787059800, `expected first intraday timestamp, got ${result.time}`)
  assert(result.open === 248.79, `expected open 248.79, got ${result.open}`)
  assert(result.high === 253.45, `expected high 253.45, got ${result.high}`)
  assert(result.low === 243, `expected low 243, got ${result.low}`)
  assert(result.close === 246, `expected close 246, got ${result.close}`)
  assert(result.volume === 362334, `expected volume 362334, got ${result.volume}`)
}

// ── Test: market date key uses US exchange timezone ───────────────────────

{
  const marketOpenMs = Date.parse('2026-08-18T13:30:00Z')
  const result = dateKeyInMarketTimeZone(marketOpenMs)

  assert(result === '2026-08-18', `expected market date 2026-08-18, got ${result}`)
}

// ── Test: Swing Data Desktop/Replay session levels ───────────────────────

{
  const anchorMs = Date.parse('2026-09-22T13:30:00Z')
  const dailyCandles = Array.from({ length: 220 }, (_, index) => {
    const close = 120 + index * 0.005
    return {
      time: Math.floor((anchorMs - (219 - index) * 86400_000) / 1000),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    }
  })
  const intradayCandles = [0, 5, 10, 15, 20, 25, 30].map((minutes, index) => ({
    time: Math.floor((anchorMs + minutes * 60_000) / 1000),
    open: 121 + index * 0.1,
    high: 122 + index * 0.1,
    low: 120.5 - index * 0.05,
    close: 121.5 + index * 0.1,
    volume: 100_000,
  }))

  const snapshot = buildSwingDataSnapshot(intradayCandles, dailyCandles, '2026-09-22')
  assert(snapshot != null, 'expected Swing Data snapshot')
  const keys = new Set(snapshot.levels.map((level) => level.key))
  assert(keys.has('sma10'), 'expected 10D SMA level')
  assert(keys.has('sma200'), 'expected 200D SMA level')
  assert(keys.has('pd-high') && keys.has('pd-low'), 'expected previous-day high/low levels')
  assert(keys.has('today-low'), 'expected today-low level')
  assert(keys.has('or5') && keys.has('or30'), 'expected 5m and 30m opening-range levels')

  const liveSnapshot = buildSwingDataSnapshot(intradayCandles, dailyCandles.slice(0, -1), '2026-09-22')
  assert(liveSnapshot != null, 'expected current session to synthesize a missing daily candle')
  assert(liveSnapshot.levels.some((level) => level.key === 'sma200'), 'expected live 200D SMA level')

  const closedTradeDates = tradeSwingAnchorDateKeys(
    '2026-09-22T14:00:00Z',
    '2026-09-24T18:00:00Z',
    '2026-09-25',
  )
  assert(closedTradeDates.join(',') === '2026-09-22,2026-09-24', 'expected entry and exit Swing Data dates')
  const sameDayDates = tradeSwingAnchorDateKeys(
    '2026-09-22T14:00:00Z',
    '2026-09-22T19:00:00Z',
    '2026-09-25',
  )
  assert(sameDayDates.length === 1, 'expected same-day entry and exit to share one Swing Data date')
}

console.log('chart-regression: PASS')
