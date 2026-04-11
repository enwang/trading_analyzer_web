export interface Candle {
  time: number   // Unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number | null
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
    if (!existing || (c.volume ?? 0) > (existing.volume ?? 0)) byDate.set(date, c)
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
