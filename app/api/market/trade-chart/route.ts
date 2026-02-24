import { NextResponse } from 'next/server'

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

function pickQuery(spanMs: number, timeframe: string) {
  if (timeframe === '1m') return { interval: '1m', range: '7d', autoFocus: false }
  if (timeframe === '5m') return { interval: '5m', range: '1mo', autoFocus: false }
  if (timeframe === '15m') return { interval: '15m', range: '1mo', autoFocus: false }
  if (timeframe === '30m') return { interval: '30m', range: '3mo', autoFocus: false }
  if (timeframe === '1h') return { interval: '60m', range: '1y', autoFocus: false }
  if (timeframe === '1d') return { interval: '1d', range: '5y', autoFocus: false }

  const day = 24 * 60 * 60 * 1000
  if (spanMs <= 6 * 60 * 60 * 1000) return { interval: '1m', range: '1d', autoFocus: true }
  if (spanMs <= day) return { interval: '5m', range: '5d', autoFocus: true }
  if (spanMs <= 3 * day) return { interval: '15m', range: '5d', autoFocus: true }
  if (spanMs <= 30 * day) return { interval: '1h', range: '3mo', autoFocus: true }
  return { interval: '1d', range: '1y', autoFocus: true }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const entryTime = searchParams.get('entryTime')
  const exitTime = searchParams.get('exitTime')
  const timeframe = searchParams.get('timeframe') ?? 'auto'

  if (!symbol || !entryTime) {
    return NextResponse.json({ error: 'symbol and entryTime are required' }, { status: 400 })
  }

  const entryMs = Date.parse(entryTime)
  if (Number.isNaN(entryMs)) {
    return NextResponse.json({ error: 'Invalid entryTime' }, { status: 400 })
  }

  const exitMsRaw = exitTime ? Date.parse(exitTime) : Number.NaN
  const exitMs = Number.isNaN(exitMsRaw) ? entryMs : exitMsRaw
  const fromMs = Math.min(entryMs, exitMs)
  const toMs = Math.max(entryMs, exitMs)
  const spanMs = Math.max(toMs - fromMs, 30 * 60 * 1000)

  const { interval, range, autoFocus } = pickQuery(spanMs, timeframe)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market chart data' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Market data source error' }, { status: 502 })
  }

  const payload = (await response.json()) as YahooChartResponse
  const result = payload.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote = result?.indicators?.quote?.[0]
  const opens = quote?.open ?? []
  const highs = quote?.high ?? []
  const lows = quote?.low ?? []
  const closes = quote?.close ?? []
  const volumes = quote?.volume ?? []

  if (timestamps.length === 0) {
    return NextResponse.json({ error: 'No chart candles available' }, { status: 404 })
  }

  const visiblePaddingMs = Math.max(spanMs * 0.4, 2 * 60 * 60 * 1000)
  const visibleFromMs = fromMs - visiblePaddingMs
  const visibleToMs = toMs + visiblePaddingMs

  const candles = timestamps
    .map((tsSec, i) => {
      const open = opens[i]
      const high = highs[i]
      const low = lows[i]
      const close = closes[i]
      if ([open, high, low, close].some((v) => v == null || !Number.isFinite(v))) {
        return null
      }
      return {
        time: tsSec,
        open: open as number,
        high: high as number,
        low: low as number,
        close: close as number,
        volume: volumes[i] ?? null,
      }
    })
    .filter((c): c is { time: number; open: number; high: number; low: number; close: number; volume: number | null } => c != null)

  return NextResponse.json({
    symbol,
    interval,
    timeframe,
    candles,
    entryTimeSec: Math.floor(entryMs / 1000),
    exitTimeSec: Math.floor(exitMs / 1000),
    autoFocus,
    visibleRange: autoFocus
      ? {
          from: Math.floor(visibleFromMs / 1000),
          to: Math.floor(visibleToMs / 1000),
        }
      : null,
  })
}
