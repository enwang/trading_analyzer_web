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
  entry_price?: number | null
  shares?: number | null
  stop_loss?: number | null
  execution_legs?: { action?: string; shares?: number; price?: number; time?: string }[] | null | unknown
}

export const DEFAULT_INITIAL_RISK_AMOUNT = 2000
export const DEFAULT_ADDON_RISK_AMOUNT = 1000

function round2(n: number) {
  return Math.round(n * 100) / 100
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
  if (side === 'long') return round2(preEntry.low - 0.01)
  if (side === 'short') return round2(preEntry.high + 0.01)
  return null
}

export function suggestedStopLossFromRisk(
  side: string | null,
  entryPrice: number | null | undefined,
  shares: number | null | undefined,
  riskAmount = DEFAULT_INITIAL_RISK_AMOUNT
): number | null {
  if (!side || entryPrice == null || shares == null) return null
  const absShares = Math.abs(shares)
  if (!Number.isFinite(entryPrice) || !Number.isFinite(absShares) || entryPrice <= 0 || absShares <= 0) return null

  const riskPerShare = riskAmount / absShares
  if (side === 'long') {
    const stopLoss = entryPrice - riskPerShare
    return stopLoss > 0 ? round2(stopLoss) : null
  }
  if (side === 'short') return round2(entryPrice + riskPerShare)
  return null
}

export function initialRiskFromStopLoss(
  side: string | null,
  entryPrice: number | null | undefined,
  shares: number | null | undefined,
  stopLoss: number | null | undefined
): number | null {
  if (!side || entryPrice == null || shares == null || stopLoss == null) return null
  const absShares = Math.abs(shares)
  if (!Number.isFinite(entryPrice) || !Number.isFinite(absShares) || !Number.isFinite(stopLoss) || absShares <= 0) return null

  const riskPerShare = side === 'long' ? entryPrice - stopLoss : stopLoss - entryPrice
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
  return round2(Math.abs(riskPerShare * absShares))
}

function openingSharesFromLegs(side: string | null, legs: unknown): number | null {
  if (!Array.isArray(legs) || legs.length === 0 || !side) return null
  const openingAction = side === 'long' ? 'BUY' : 'SELL'
  let total = 0
  for (const leg of legs) {
    if (!leg || typeof leg !== 'object') continue
    const l = leg as { action?: string; shares?: number }
    if (l.action !== openingAction || typeof l.shares !== 'number') continue
    total += l.shares
  }
  return total > 0 ? total : null
}

export async function enrichOpenTradesWithStopLosses<T extends StopLossEnrichmentRow>(
  rows: T[],
  _lookup: (symbol: string, entryTime: string) => Promise<PreEntryExtremes | null> = fetchPreEntryExtremes
): Promise<T[]> {
  // Open trades default to a $2000 initial-risk stop. Add-on lots (a later
  // open entry for the same symbol) use $1000. We always recompute on every
  // sync — IBKR can revise entry_price (CostBasis re-weighting after partial
  // closes), and the user expects Initial Risk to stay at the default.
  const openRows = rows.filter((r) => r.exit_time == null)
  const earliestEntryBySymbol = new Map<string, string>()
  for (const row of openRows) {
    if (!row.symbol || !row.entry_time) continue
    const prev = earliestEntryBySymbol.get(row.symbol)
    if (!prev || row.entry_time < prev) earliestEntryBySymbol.set(row.symbol, row.entry_time)
  }

  return Promise.all(
    rows.map(async (row) => {
      if (row.exit_time != null) return row
      if (!row.side) return row

      const isAddon = !!row.symbol && !!row.entry_time &&
        row.entry_time > (earliestEntryBySymbol.get(row.symbol) ?? '')
      const riskAmount = isAddon ? DEFAULT_ADDON_RISK_AMOUNT : DEFAULT_INITIAL_RISK_AMOUNT
      const sharesForRisk = openingSharesFromLegs(row.side, row.execution_legs) ?? row.shares
      const stopLoss = suggestedStopLossFromRisk(row.side, row.entry_price, sharesForRisk, riskAmount)
      if (stopLoss == null) return row
      return { ...row, stop_loss: stopLoss }
    })
  )
}
