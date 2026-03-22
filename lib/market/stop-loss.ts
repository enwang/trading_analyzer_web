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

interface CandleData {
  timestamps: number[]
  highs: (number | null)[]
  lows: (number | null)[]
  timeZone: string
}

export interface PreEntryExtremes {
  low: number
  high: number
}

export interface StopLossEnrichmentRow {
  symbol: string
  entry_time: string | null
  exit_time: string | null
  side: string | null
  stop_loss?: number | null
}

function formatDateInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
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
): PreEntryExtremes | null {
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

export async function fetchPreEntryExtremes(symbol: string, entryTime: string): Promise<PreEntryExtremes | null> {
  const entryMs = Date.parse(entryTime)
  if (Number.isNaN(entryMs)) return null

  const attempts: { interval: string; range: string; requireSameDay: boolean }[] = [
    { interval: '1m', range: '5d', requireSameDay: true },
    { interval: '1h', range: '3mo', requireSameDay: true },
    { interval: '1d', range: '1y', requireSameDay: false },
  ]

  for (const { interval, range, requireSameDay } of attempts) {
    const candles = await fetchCandles(symbol, interval, range)
    if (!candles || candles.timestamps.length === 0) continue

    const entryDateInExchange = formatDateInTimeZone(entryTime, candles.timeZone)
    const result = findPreEntryExtremes(candles, entryMs, entryDateInExchange, requireSameDay)
    if (result) return result
  }

  return null
}

export function suggestedStopLoss(side: string | null, preEntry: PreEntryExtremes): number | null {
  if (side === 'long') return Math.round((preEntry.low - 0.01) * 100) / 100
  if (side === 'short') return Math.round((preEntry.high + 0.01) * 100) / 100
  return null
}

export async function enrichOpenTradesWithStopLosses<T extends StopLossEnrichmentRow>(
  rows: T[],
  lookup: (symbol: string, entryTime: string) => Promise<PreEntryExtremes | null> = fetchPreEntryExtremes
): Promise<T[]> {
  const cache = new Map<string, PreEntryExtremes | null>()

  return Promise.all(
    rows.map(async (row) => {
      if (row.exit_time != null) return row
      if (row.stop_loss != null) return row
      if (!row.entry_time || !row.side) return row

      const key = `${row.symbol}|${row.entry_time}`
      let preEntry = cache.get(key)
      if (preEntry === undefined) {
        preEntry = await lookup(row.symbol, row.entry_time)
        cache.set(key, preEntry)
      }
      if (!preEntry) return row

      const stopLoss = suggestedStopLoss(row.side, preEntry)
      if (stopLoss == null) return row
      return { ...row, stop_loss: stopLoss }
    })
  )
}
