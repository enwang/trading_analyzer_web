/**
 * Daily cumulative-% return series for a ticker from Yahoo Finance, used to
 * overlay benchmarks on the account equity curve and to derive benchmark
 * monthly returns. pct is measured from the last close on/before startDate.
 */
export async function fetchTickerReturns(
  symbol: string,
  startDate: string,
  endDate: string
): Promise<{ date: string; pct: number }[]> {
  try {
    const p1 = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000) - 86400 * 7
    const p2 = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000) + 86400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`,
      { next: { revalidate: 3600 }, headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? []
    if (!timestamps.length || !closes.length) return []
    let baseIdx = 0
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
      if (d <= startDate) baseIdx = i
      else break
    }
    const baseClose = closes[baseIdx]
    if (!baseClose) return []
    return timestamps
      .map((ts, i) => {
        const date = new Date(ts * 1000).toISOString().slice(0, 10)
        const close = closes[i]
        if (!close || date < startDate) return null
        return { date, pct: ((close - baseClose) / baseClose) * 100 }
      })
      .filter((r): r is { date: string; pct: number } => r !== null)
  } catch {
    return []
  }
}
