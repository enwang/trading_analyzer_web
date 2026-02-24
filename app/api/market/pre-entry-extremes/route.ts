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

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=5d&includePrePost=false`

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch intraday market data' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Market data source error' }, { status: 502 })
  }

  const data = (await response.json()) as YahooChartResponse
  const result = data.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const highs = result?.indicators?.quote?.[0]?.high ?? []
  const lows = result?.indicators?.quote?.[0]?.low ?? []

  if (timestamps.length === 0 || highs.length === 0 || lows.length === 0) {
    return NextResponse.json({ error: 'No intraday candles available' }, { status: 404 })
  }

  const timeZone = result?.meta?.exchangeTimezoneName ?? 'America/New_York'
  const entryDateInExchange = formatDateInTimeZone(entryTime, timeZone)

  let minLowBeforeEntry = Number.POSITIVE_INFINITY
  let maxHighBeforeEntry = Number.NEGATIVE_INFINITY

  for (let i = 0; i < timestamps.length; i++) {
    const tsSec = timestamps[i]
    const tsMs = tsSec * 1000
    if (tsMs >= entryMs) continue

    const iso = new Date(tsMs).toISOString()
    const candleDateInExchange = formatDateInTimeZone(iso, timeZone)
    if (candleDateInExchange !== entryDateInExchange) continue

    const low = lows[i]
    const high = highs[i]

    if (low != null && Number.isFinite(low) && low < minLowBeforeEntry) {
      minLowBeforeEntry = low
    }
    if (high != null && Number.isFinite(high) && high > maxHighBeforeEntry) {
      maxHighBeforeEntry = high
    }
  }

  if (!Number.isFinite(minLowBeforeEntry) || !Number.isFinite(maxHighBeforeEntry)) {
    return NextResponse.json({ error: 'No same-day candles found before entry time' }, { status: 404 })
  }

  return NextResponse.json({
    symbol,
    exchangeTimeZone: timeZone,
    entryDateInExchange,
    preEntry: {
      low: minLowBeforeEntry,
      high: maxHighBeforeEntry,
    },
  })
}
