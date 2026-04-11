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
