import type { ExecutionLeg } from '@/types/trade'

const ORDER_BURST_GAP_MS = 2 * 60 * 1000

type LegBucket = {
  time: string
  action: 'BUY' | 'SELL'
  shares: number
  weightedCost: number
  lastTs: number
}

function legTimestamp(leg: ExecutionLeg) {
  const ts = Date.parse(leg.time)
  return Number.isNaN(ts) ? null : ts
}

function shouldMergeIntoBucket(bucket: LegBucket, leg: ExecutionLeg) {
  if (bucket.action !== leg.action) return false

  const ts = legTimestamp(leg)
  if (ts == null) return bucket.time === leg.time
  if (bucket.lastTs === 0) return false

  return ts - bucket.lastTs <= ORDER_BURST_GAP_MS
}

export function mergeExecutionLegs(legs: ExecutionLeg[] | null): ExecutionLeg[] {
  if (!legs || legs.length === 0) return []

  const sorted = [...legs].sort((a, b) => {
    const ta = legTimestamp(a)
    const tb = legTimestamp(b)
    if (ta == null || tb == null) return a.time < b.time ? -1 : a.time > b.time ? 1 : 0
    return ta - tb
  })

  const buckets: LegBucket[] = []
  for (const leg of sorted) {
    const ts = legTimestamp(leg)
    const current = buckets[buckets.length - 1]
    if (current && shouldMergeIntoBucket(current, leg)) {
      current.shares += leg.shares
      current.weightedCost += leg.price * leg.shares
      if (ts != null) current.lastTs = ts
      continue
    }

    buckets.push({
      time: leg.time,
      action: leg.action,
      shares: leg.shares,
      weightedCost: leg.price * leg.shares,
      lastTs: ts ?? 0,
    })
  }

  return buckets.map((bucket) => ({
    time: bucket.time,
    action: bucket.action,
    shares: bucket.shares,
    price: bucket.shares > 0 ? bucket.weightedCost / bucket.shares : 0,
  }))
}

export function countMergedExecutionLegsByAction(
  legs: ExecutionLeg[] | null,
  action: 'BUY' | 'SELL',
) {
  return mergeExecutionLegs(legs).filter((leg) => leg.action === action).length
}
