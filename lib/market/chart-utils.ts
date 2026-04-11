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
 * Yahoo Finance occasionally returns corrupt volume values (e.g. 745) for specific
 * dates while OHLC data is correct. Detect outliers by comparing each candle's volume
 * against the median of its neighbours; null out anything below 1% of that median so
 * the chart shows an empty bar instead of a misleading near-zero spike.
 */
export function nullifyCorruptVolume(candles: Candle[]): Candle[] {
  if (candles.length < 5) return candles

  const volumes = candles.map(c => c.volume ?? 0)

  // Compute a rolling median over a ±10 window for context
  return candles.map((c, i) => {
    const vol = c.volume
    if (vol == null || vol === 0) return c

    const lo = Math.max(0, i - 10)
    const hi = Math.min(candles.length - 1, i + 10)
    const window = volumes.slice(lo, hi + 1).filter(v => v > 0)
    if (window.length < 3) return c

    const sorted = [...window].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]

    // If this candle's volume is less than 1% of the local median, it's corrupt
    if (median > 0 && vol < median * 0.01) {
      return { ...c, volume: null }
    }
    return c
  })
}
