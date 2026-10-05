export interface Candle {
  time: number   // Unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

const MARKET_TIME_ZONE = 'America/New_York'
const MARKET_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: MARKET_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function nextUtcDayStartSec(ms: number): number {
  const day = 86_400_000
  return Math.floor(ms / day + 1) * 86400
}

export function dateKeyInMarketTimeZone(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms))

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  if (!year || !month || !day) {
    return new Date(ms).toISOString().slice(0, 10)
  }

  return `${year}-${month}-${day}`
}

function regularSessionMinute(ms: number): number | null {
  const parts = MARKET_CLOCK_FORMATTER.formatToParts(new Date(ms))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const minuteOfDay = hour * 60 + minute
  const marketOpen = 9 * 60 + 30
  const marketClose = 16 * 60
  return minuteOfDay >= marketOpen && minuteOfDay < marketClose
    ? minuteOfDay - marketOpen
    : null
}

/**
 * Match the TradingView Swing Data intraday RVOL calculation: cumulative RTH
 * volume versus the average cumulative volume at the same minute over the
 * previous five regular sessions.
 */
export function calculateIntradayRvol(candles: Candle[], lookbackDays = 5) {
  const cumulativeByDate = new Map<string, Map<number, number>>()
  const completedDates: string[] = []
  let currentDate: string | null = null
  let cumulativeVolume = 0
  let lastRvol: number | null = null

  return candles.flatMap((candle) => {
    const date = dateKeyInMarketTimeZone(candle.time * 1000)
    const minute = regularSessionMinute(candle.time * 1000)

    if (minute != null) {
      if (date !== currentDate) {
        if (currentDate != null) completedDates.push(currentDate)
        currentDate = date
        cumulativeVolume = 0
        cumulativeByDate.set(date, new Map())
      }

      cumulativeVolume += candle.volume ?? 0
      const history = completedDates
        .slice(-lookbackDays)
        .flatMap((priorDate) => {
          const value = cumulativeByDate.get(priorDate)?.get(minute)
          return value != null && value > 0 ? [value] : []
        })

      if (history.length > 0) {
        const average = history.reduce((sum, value) => sum + value, 0) / history.length
        lastRvol = average > 0 ? cumulativeVolume / average : null
      }

      cumulativeByDate.get(date)!.set(minute, cumulativeVolume)
    }

    return lastRvol == null ? [] : [{ time: candle.time, value: lastRvol }]
  })
}

export interface LogicalRange {
  from: number
  to: number
}

function nearestCandleIndex(candles: Candle[], targetTime: number): number {
  if (candles.length === 0) return -1
  let low = 0
  let high = candles.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (candles[middle].time < targetTime) low = middle + 1
    else high = middle
  }

  if (low === 0) return 0
  const previous = low - 1
  return Math.abs(candles[low].time - targetTime) < Math.abs(candles[previous].time - targetTime)
    ? low
    : previous
}

/**
 * TradingView-like initial 5-minute viewport. Keep roughly 110 bars on screen,
 * show both ends of a compact closed trade, and avoid crushing long holds into
 * an unreadable intraday chart by focusing on the exit.
 */
export function calculateTradeChartLogicalRange(
  candles: Candle[],
  entryTimeSec: number | null,
  exitTimeSec: number | null,
): LogicalRange | null {
  if (candles.length === 0 || entryTimeSec == null) return null

  const targetBars = 110
  const entryIndex = nearestCandleIndex(candles, entryTimeSec)
  const maxIndex = candles.length - 1
  let from: number
  let to: number

  if (exitTimeSec == null) {
    // Leave more space to the right so price action after entry remains visible.
    from = entryIndex - 32
    to = entryIndex + 78
  } else {
    const exitIndex = nearestCandleIndex(candles, exitTimeSec)
    const firstIndex = Math.min(entryIndex, exitIndex)
    const lastIndex = Math.max(entryIndex, exitIndex)
    const tradeBars = lastIndex - firstIndex

    if (tradeBars <= 130) {
      const padding = Math.max(14, Math.ceil((targetBars - tradeBars) / 2))
      from = firstIndex - padding
      to = lastIndex + padding
    } else {
      // For long holds, preserve readable 5-minute candles around the exit.
      from = exitIndex - 78
      to = exitIndex + 32
    }
  }

  if (from < 0) {
    to += -from
    from = 0
  }
  const maxTo = maxIndex + 8
  if (to > maxTo) {
    from = Math.max(0, from - (to - maxTo))
    to = maxTo
  }

  return { from, to }
}

export function synthesizeDailyCandle(candles: Candle[]): Candle | null {
  if (candles.length === 0) return null

  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  let volume = 0
  let hasVolume = false

  for (const candle of candles) {
    high = Math.max(high, candle.high)
    low = Math.min(low, candle.low)
    if (candle.volume != null) {
      volume += candle.volume
      hasVolume = true
    }
  }

  const first = candles[0]
  const last = candles[candles.length - 1]

  return {
    time: first.time,
    open: first.open,
    high,
    low,
    close: last.close,
    volume: hasVolume ? volume : null,
  }
}

/**
 * Yahoo Finance sometimes returns two entries for the same calendar day on 1D charts
 * (e.g. one at midnight UTC and one at market open UTC). Keep the candle with higher
 * volume — the full-session candle always has more volume than a partial snapshot.
 */
export function deduplicateDailyCandles(candles: Candle[]): Candle[] {
  const byDate = new Map<string, Candle>()
  for (const c of candles) {
    const date = new Date(c.time * 1000).toISOString().slice(0, 10)
    const existing = byDate.get(date)
    if (
      !existing ||
      (c.volume ?? 0) > (existing.volume ?? 0) ||
      ((c.volume ?? 0) === (existing.volume ?? 0) && c.time > existing.time)
    ) {
      byDate.set(date, c)
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.time - b.time)
}

/**
 * Detect candles with corrupt volume (Yahoo Finance sometimes returns placeholder
 * values like 745). A candle is corrupt if its volume is < 1% of the local median
 * (±10 candle window). Returns the indices of corrupt candles.
 */
export function findCorruptVolumeIndices(candles: Candle[]): Set<number> {
  const corrupt = new Set<number>()
  if (candles.length < 5) return corrupt

  const volumes = candles.map(c => c.volume ?? 0)

  for (let i = 0; i < candles.length; i++) {
    const vol = candles[i].volume
    if (vol == null || vol === 0) continue

    const lo = Math.max(0, i - 10)
    const hi = Math.min(candles.length - 1, i + 10)
    const window = volumes.slice(lo, hi + 1).filter(v => v > 0)
    if (window.length < 3) continue

    const sorted = [...window].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    if (median > 0 && vol < median * 0.01) {
      corrupt.add(i)
    }
  }

  return corrupt
}

/**
 * For candles with corrupt volume, fetch 1h data from Yahoo Finance and sum
 * the hourly volumes to reconstruct the true daily volume. 1h data is available
 * for up to 730 days so covers all historical 1D candles we'd show.
 * Falls back to null if the hourly fetch fails.
 */
export async function repairCorruptVolume(symbol: string, candles: Candle[]): Promise<Candle[]> {
  const corruptIdx = findCorruptVolumeIndices(candles)
  if (corruptIdx.size === 0) return candles

  // Collect the corrupt dates (YYYY-MM-DD in UTC)
  const corruptDates = new Set(
    [...corruptIdx].map(i => new Date(candles[i].time * 1000).toISOString().slice(0, 10))
  )

  // Fetch 1h data spanning all corrupt dates in one request
  const times = [...corruptIdx].map(i => candles[i].time)
  const period1 = Math.min(...times) - 86400       // 1 day before first corrupt candle
  const period2 = Math.max(...times) + 2 * 86400   // 2 days after last corrupt candle

  let hourlyVolByDate: Map<string, number> | null = null
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1h&period1=${period1}&period2=${period2}&includePrePost=false`
    const res = await fetch(url, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json() as {
        chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ volume?: (number | null)[] }> } }> }
      }
      const result = data.chart?.result?.[0]
      const timestamps = result?.timestamp ?? []
      const volumes = result?.indicators?.quote?.[0]?.volume ?? []

      hourlyVolByDate = new Map<string, number>()
      for (let i = 0; i < timestamps.length; i++) {
        const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
        if (!corruptDates.has(date)) continue
        const v = volumes[i]
        if (v != null && v > 0) {
          hourlyVolByDate.set(date, (hourlyVolByDate.get(date) ?? 0) + v)
        }
      }
    }
  } catch {
    // fall through — corrupt candles will be nulled out
  }

  return candles.map((c, i) => {
    if (!corruptIdx.has(i)) return c
    const date = new Date(c.time * 1000).toISOString().slice(0, 10)
    const repairedVol = hourlyVolByDate?.get(date) ?? null
    return { ...c, volume: repairedVol }
  })
}
