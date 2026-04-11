import { NextResponse } from 'next/server'
import { deduplicateDailyCandles, repairCorruptVolume } from '@/lib/market/chart-utils'

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          close?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
  }
}

// Yahoo Finance intraday data age limits
const AGE_1M  =  7 * 86_400_000
const AGE_5M  = 60 * 86_400_000
const AGE_15M = 60 * 86_400_000
const AGE_30M = 60 * 86_400_000
const AGE_1H  = 730 * 86_400_000

function pickInterval(spanMs: number, fromMs: number, timeframe: string): string {
  const ageMs = Date.now() - fromMs
  const day = 86_400_000

  if (timeframe !== 'auto') {
    if (timeframe === '1m'  && ageMs <= AGE_1M)  return '1m'
    if (timeframe === '5m'  && ageMs <= AGE_5M)  return '5m'
    if (timeframe === '15m' && ageMs <= AGE_15M) return '15m'
    if (timeframe === '30m' && ageMs <= AGE_30M) return '30m'
    if (timeframe === '1h') return '60m'
    if (timeframe === '1d') return '1d'
    // Fall through to auto when requested interval too old
  }

  if (spanMs <= 6 * 60 * 60_000) {
    if (ageMs <= AGE_1M)  return '1m'
    if (ageMs <= AGE_5M)  return '5m'
    if (ageMs <= AGE_1H)  return '60m'
    return '1d'
  }
  if (spanMs <= day) {
    if (ageMs <= AGE_5M)  return '5m'
    if (ageMs <= AGE_1H)  return '60m'
    return '1d'
  }
  if (spanMs <= 3 * day) {
    if (ageMs <= AGE_15M) return '15m'
    if (ageMs <= AGE_1H)  return '60m'
    return '1d'
  }
  if (spanMs <= 30 * day) {
    if (ageMs <= AGE_1H) return '60m'
    return '1d'
  }
  return '1d'
}

function preEntryLookbackMs(timeframe: string): number {
  const day = 86_400_000
  switch (timeframe) {
    case '1m': return 3 * day
    case '5m': return 14 * day
    case '15m': return 30 * day
    case '30m': return 45 * day
    case '1h': return 90 * day
    case '1d': return 365 * day
    default: return 30 * day
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol    = searchParams.get('symbol')
  const entryTime = searchParams.get('entryTime')
  const exitTime  = searchParams.get('exitTime')
  const timeframe = searchParams.get('timeframe') ?? 'auto'

  // Charting Library datafeed passes explicit period1/period2 (Unix seconds)
  const p1Param = searchParams.get('period1')
  const p2Param = searchParams.get('period2')

  if (!symbol) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }

  let period1: number
  let period2: number
  let entryMs: number
  let exitMs: number
  let spanMs: number
  let lookbackMs = preEntryLookbackMs(timeframe)

  if (p1Param && p2Param) {
    // Explicit range from the Charting Library datafeed
    period1 = Number(p1Param)
    period2 = Number(p2Param)
    entryMs = (Number(p1Param) + Number(p2Param)) / 2 * 1000 // midpoint (used only for interval picking)
    exitMs  = entryMs
    spanMs  = (Number(p2Param) - Number(p1Param)) * 1000
    lookbackMs = Math.max(lookbackMs, Math.floor(spanMs * 0.5))
  } else {
    if (!entryTime) {
      return NextResponse.json({ error: 'entryTime or period1/period2 are required' }, { status: 400 })
    }
    entryMs = Date.parse(entryTime)
    if (Number.isNaN(entryMs)) {
      return NextResponse.json({ error: 'Invalid entryTime' }, { status: 400 })
    }
    const exitMsRaw = exitTime ? Date.parse(exitTime) : Number.NaN
    exitMs  = Number.isNaN(exitMsRaw) ? entryMs : exitMsRaw
    const hasExit   = exitTime && !Number.isNaN(exitMsRaw)
    const fromMs  = Math.min(entryMs, exitMs)
    const toMs    = Math.max(entryMs, exitMs)
    spanMs        = Math.max(toMs - fromMs, 30 * 60_000)
    const padding = Math.max(spanMs * 0.5, 4 * 60 * 60_000)
    period1 = Math.floor((fromMs - Math.max(padding, lookbackMs)) / 1000)
    // For open trades (no exit), extend to now so live data is included.
    // For closed trades, cap at exit + padding to avoid today's partial data bleeding in.
    period2 = Math.ceil((hasExit ? toMs + padding : Math.max(toMs + padding, Date.now())) / 1000)
  }

  const interval = pickInterval(spanMs, period1 * 1000, timeframe)

  // For 1D charts on closed trades: cap period2 at end of exit calendar day + 2 extra days.
  // This prevents large spanMs padding from reaching today's partial candle while still
  // providing post-trade context.
  if (interval === '1d' && exitTime && !Number.isNaN(exitMs)) {
    const exitDayEndSec = Math.ceil(exitMs / 86_400_000) * 86400 // midnight UTC after exit day
    period2 = Math.min(period2, exitDayEndSec + 2 * 86400) // at most 2 extra days after exit
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}&includePrePost=false`

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market chart data' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Market data source error' }, { status: 502 })
  }

  const payload    = (await response.json()) as YahooChartResponse
  const result     = payload.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote      = result?.indicators?.quote?.[0]

  if (timestamps.length === 0) {
    return NextResponse.json({ error: 'No chart candles available' }, { status: 404 })
  }

  const opens   = quote?.open   ?? []
  const highs   = quote?.high   ?? []
  const lows    = quote?.low    ?? []
  const closes  = quote?.close  ?? []
  const volumes = quote?.volume ?? []

  let candles = timestamps
    .map((tsSec, i) => {
      const open  = opens[i];  const high = highs[i]
      const low   = lows[i];   const close = closes[i]
      if ([open, high, low, close].some((v) => v == null || !Number.isFinite(v))) return null
      return { time: tsSec, open: open!, high: high!, low: low!, close: close!, volume: volumes[i] ?? null }
    })
    .filter((c): c is NonNullable<typeof c> => c != null)

  // Yahoo Finance sometimes returns two entries for the same calendar day on 1D charts
  // (e.g. one at midnight UTC and one at market open). Deduplicate by date.
  if (interval === '1d') {
    candles = deduplicateDailyCandles(candles)
  }

  // Repair corrupt volume values (Yahoo sometimes returns placeholder values like 745).
  // Re-fetches the affected days at 1h resolution and sums hourly volumes.
  candles = await repairCorruptVolume(symbol, candles)

  const visiblePreMs = Math.max(spanMs * 0.8, Math.floor(lookbackMs * 0.6))
  // For 1D charts, show 2 calendar days of context after exit so the outcome is easy to judge
  const visiblePostMs = interval === '1d'
    ? 2 * 86_400_000
    : Math.max(spanMs * 0.4, 2 * 60 * 60_000)
  const visibleFrom = Math.floor((entryMs - visiblePreMs) / 1000)
  // For open trades (no exitTime), extend visible range to now so today's candles are visible
  const visibleToMs = exitTime ? exitMs : Math.max(exitMs, Date.now())
  const visibleTo   = Math.ceil((visibleToMs + visiblePostMs) / 1000)

  return NextResponse.json({
    symbol, interval, timeframe, candles,
    entryTimeSec: entryTime ? Math.floor(entryMs / 1000) : null,
    exitTimeSec:  exitTime  ? Math.floor(exitMs  / 1000) : null,
    visibleRange: { from: visibleFrom, to: visibleTo },
  })
}
