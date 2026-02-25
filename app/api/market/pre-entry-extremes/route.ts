import { NextResponse } from 'next/server'

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      meta?: {
        exchangeTimezoneName?: string
      }
      indicators?: {
        quote?: Array<{
          high?: Array<number | null>
          low?: Array<number | null>
        }>
      }
    }>
  }
}

function formatDateInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

interface CandleData {
  timestamps: number[]
  highs: (number | null)[]
  lows: (number | null)[]
  timeZone: string
}

async function fetchCandles(symbol: string, interval: string, range: string): Promise<CandleData | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as YahooChartResponse
    const result = data.chart?.result?.[0]
    if (!result) return null
    return {
      timestamps: result.timestamp ?? [],
      highs: result.indicators?.quote?.[0]?.high ?? [],
      lows: result.indicators?.quote?.[0]?.low ?? [],
      timeZone: result.meta?.exchangeTimezoneName ?? 'America/New_York',
    }
  } catch {
    return null
  }
}

function findPreEntryExtremes(
  candles: CandleData,
  entryMs: number,
  entryDateInExchange: string,
  requireSameDay: boolean
): { low: number; high: number } | null {
  let minLow = Number.POSITIVE_INFINITY
  let maxHigh = Number.NEGATIVE_INFINITY

  for (let i = 0; i < candles.timestamps.length; i++) {
    const tsMs = candles.timestamps[i] * 1000
    if (tsMs >= entryMs) continue

    if (requireSameDay) {
      const iso = new Date(tsMs).toISOString()
      const candleDate = formatDateInTimeZone(iso, candles.timeZone)
      if (candleDate !== entryDateInExchange) continue
    }

    const low = candles.lows[i]
    const high = candles.highs[i]
    if (low != null && Number.isFinite(low) && low < minLow) minLow = low
    if (high != null && Number.isFinite(high) && high > maxHigh) maxHigh = high
  }

  if (!Number.isFinite(minLow) || !Number.isFinite(maxHigh)) return null
  return { low: minLow, high: maxHigh }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const entryTime = searchParams.get('entryTime')

  if (!symbol || !entryTime) {
    return NextResponse.json({ error: 'symbol and entryTime are required' }, { status: 400 })
  }

  const entryMs = Date.parse(entryTime)
  if (Number.isNaN(entryMs)) {
    return NextResponse.json({ error: 'Invalid entryTime' }, { status: 400 })
  }

  // Try multiple resolutions: 1m (5d) → 1h (3mo) → 1d (1y)
  const attempts: { interval: string; range: string; requireSameDay: boolean }[] = [
    { interval: '1m',  range: '5d',  requireSameDay: true },
    { interval: '1h',  range: '3mo', requireSameDay: true },
    { interval: '1d',  range: '1y',  requireSameDay: false }, // daily: only 1 candle per day, use that day's low/high
  ]

  for (const { interval, range, requireSameDay } of attempts) {
    const candles = await fetchCandles(symbol, interval, range)
    if (!candles || candles.timestamps.length === 0) continue

    const entryDateInExchange = formatDateInTimeZone(entryTime, candles.timeZone)
    const result = findPreEntryExtremes(candles, entryMs, entryDateInExchange, requireSameDay)
    if (!result) continue

    return NextResponse.json({
      symbol,
      exchangeTimeZone: candles.timeZone,
      entryDateInExchange,
      interval,
      preEntry: result,
    })
  }

  return NextResponse.json({ error: 'No candles found before entry time' }, { status: 404 })
}
