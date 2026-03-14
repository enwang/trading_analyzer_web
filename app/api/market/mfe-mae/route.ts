import { NextResponse } from 'next/server'

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          high?: Array<number | null>
          low?: Array<number | null>
        }>
      }
    }>
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol     = searchParams.get('symbol')
  const entryTime  = searchParams.get('entryTime')
  const exitTime   = searchParams.get('exitTime')
  const side       = searchParams.get('side') as 'long' | 'short' | null
  const entryPrice = Number(searchParams.get('entryPrice'))
  const shares     = Number(searchParams.get('shares'))

  if (!symbol || !entryTime || !exitTime || !side || !Number.isFinite(entryPrice) || !Number.isFinite(shares)) {
    return NextResponse.json({ error: 'symbol, entryTime, exitTime, side, entryPrice, shares are required' }, { status: 400 })
  }

  const entryMs = Date.parse(entryTime)
  const exitMs  = Date.parse(exitTime)
  if (Number.isNaN(entryMs) || Number.isNaN(exitMs)) {
    return NextResponse.json({ error: 'Invalid entryTime or exitTime' }, { status: 400 })
  }

  // Choose interval by age only — never by duration.
  // Daily bars capture the full session range including before-entry / after-exit time,
  // which gives wrong MFE/MAE for multi-day trades that enter/exit mid-session.
  // Use the finest available resolution so the candle-overlap filter is precise.
  const ageMs = Date.now() - entryMs
  const DAY = 86_400_000

  let interval: string
  if (ageMs <= 7 * DAY)  interval = '1m'
  else if (ageMs <= 60 * DAY) interval = '5m'
  else interval = '1d'

  // Fetch slightly wider than the trade to ensure the boundary candles are included
  const period1 = Math.floor((entryMs - 60_000) / 1000)   // pull back so entry candle is fetched
  const period2 = Math.ceil((exitMs  + 60_000) / 1000)

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${period1}&period2=${period2}&includePrePost=false`

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Market data source error' }, { status: 502 })
  }

  const payload    = (await response.json()) as YahooChartResponse
  const result     = payload.chart?.result?.[0]
  const timestamps = result?.timestamp ?? []
  const quote      = result?.indicators?.quote?.[0]
  const highs      = quote?.high ?? []
  const lows       = quote?.low  ?? []

  if (!timestamps.length) {
    return NextResponse.json({ error: 'No market data available for this symbol/timeframe' }, { status: 404 })
  }

  // Map interval string to its duration so we can test candle overlap with the trade window.
  // A candle [candleMs, candleMs+intervalMs) is valid if it overlaps [entryMs, exitMs]:
  //   candleMs + intervalMs > entryMs  →  candle hasn't fully ended before entry
  //   candleMs <= exitMs               →  candle started at or before exit
  const intervalDurationMs: Record<string, number> = {
    '1m': 60_000, '2m': 120_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '60m': 3_600_000, '1h': 3_600_000, '1d': 86_400_000,
  }
  const candleDurationMs = intervalDurationMs[interval] ?? 60_000

  let maxHigh    = -Infinity
  let minLow     = +Infinity
  let maxHighMs  = 0
  let minLowMs   = 0
  let hasData    = false

  for (let i = 0; i < timestamps.length; i++) {
    const candleMs = timestamps[i] * 1000
    // Exclude candles that ended before entry or started after exit
    if (candleMs + candleDurationMs <= entryMs) continue
    if (candleMs > exitMs) continue
    const h = highs[i]
    const l = lows[i]
    if (h == null || !Number.isFinite(h) || l == null || !Number.isFinite(l)) continue
    if (h > maxHigh) { maxHigh = h; maxHighMs = candleMs }
    if (l < minLow)  { minLow  = l; minLowMs  = candleMs }
    hasData = true
  }

  if (!hasData) {
    return NextResponse.json({ error: 'No candles found within trade window' }, { status: 404 })
  }

  const absShares = Math.abs(shares)

  let mfe: number
  let mae: number

  if (side === 'long') {
    mfe = Math.max(0, maxHigh - entryPrice) * absShares
    mae = Math.max(0, entryPrice - minLow)  * absShares
  } else {
    mfe = Math.max(0, entryPrice - minLow)  * absShares
    mae = Math.max(0, maxHigh - entryPrice) * absShares
  }

  const cost = entryPrice * absShares
  const mfePct = cost > 0 ? mfe / cost : 0
  const maePct = cost > 0 ? mae / cost : 0

  return NextResponse.json({ mfe, mae, mfePct, maePct, interval, maxHigh, minLow, maxHighTime: new Date(maxHighMs).toISOString(), minLowTime: new Date(minLowMs).toISOString() })
}
