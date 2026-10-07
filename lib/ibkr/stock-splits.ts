export type KnownStockSplit = {
  symbol: string
  exDate: string
  /** Post-split shares divided by pre-split shares. */
  factor: number
}

// Parser default: store split-affected trades in post-split share/price scale.
export const KNOWN_STOCK_SPLITS: KnownStockSplit[] = [
  { symbol: 'CRWD', exDate: '2026-07-02T04:00:00.000Z', factor: 4 },
  { symbol: 'ETHA', exDate: '2026-10-06T04:00:00.000Z', factor: 1 / 3 },
]

export function preservedPriceScaleForKnownSplit({
  symbol,
  entryTime,
  existingEntryPrice,
  incomingEntryPrice,
}: {
  symbol: string
  entryTime: string | null | undefined
  existingEntryPrice: number | null | undefined
  incomingEntryPrice: number | null | undefined
}): number {
  if (!entryTime || !existingEntryPrice || !incomingEntryPrice) return 1
  if (existingEntryPrice <= 0 || incomingEntryPrice <= 0) return 1

  const applicableSplits = KNOWN_STOCK_SPLITS.filter(split => (
    split.symbol === symbol.toUpperCase()
    && new Date(entryTime).getTime() < new Date(split.exDate).getTime()
  ))
  if (applicableSplits.length === 0) return 1

  const expectedPriceScale = applicableSplits.reduce((scale, split) => scale / split.factor, 1)
  const observedPriceScale = incomingEntryPrice / existingEntryPrice
  const relativeError = Math.abs(observedPriceScale - expectedPriceScale) / expectedPriceScale
  return relativeError <= 0.02 ? expectedPriceScale : 1
}

export function scalePreservedPrice(value: number | null, scale: number): number | null {
  return value == null ? null : value * scale
}
