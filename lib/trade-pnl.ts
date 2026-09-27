type OpenTradePnlInput = {
  side: 'long' | 'short' | null
  entryPrice: number | null
  remainingShares: number | null
  currentPrice: number | null
  realizedPnl: number | null
}

export function totalOpenTradePnl({
  side,
  entryPrice,
  remainingShares,
  currentPrice,
  realizedPnl,
}: OpenTradePnlInput): number | null {
  if (!side || entryPrice == null || remainingShares == null || currentPrice == null) return null
  const shares = Math.abs(remainingShares)
  const unrealized = side === 'long'
    ? (currentPrice - entryPrice) * shares
    : (entryPrice - currentPrice) * shares
  return (realizedPnl ?? 0) + unrealized
}
