import type { ExecutionLeg, Trade } from '@/types/trade'

function sortLegs(legs: ExecutionLeg[]): ExecutionLeg[] {
  return [...legs].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
}

function executionFingerprint(legs: ExecutionLeg[] | null): string | null {
  if (!legs || legs.length === 0) return null
  return sortLegs(legs)
    .map((leg) => `${leg.time}|${leg.action}|${leg.shares}|${leg.price.toFixed(6)}`)
    .join(';')
}

function firstNonEmpty<T>(values: Array<T | null | undefined>, isEmpty?: (value: T) => boolean): T | null {
  for (const value of values) {
    if (value == null) continue
    if (isEmpty?.(value)) continue
    return value
  }
  return null
}

function deriveTradeFromExecutionLegs(base: Trade, executionLegs: ExecutionLeg[]): Trade {
  const legs = sortLegs(executionLegs)
  const side = base.side ?? (legs[0]?.action === 'SELL' ? 'short' : 'long')
  const openAction = side === 'short' ? 'SELL' : 'BUY'
  const closeAction = side === 'short' ? 'BUY' : 'SELL'
  const openLegs = legs.filter((leg) => leg.action === openAction)
  const closeLegs = legs.filter((leg) => leg.action === closeAction)

  const openingShares = openLegs.reduce((sum, leg) => sum + leg.shares, 0)
  const closingShares = closeLegs.reduce((sum, leg) => sum + leg.shares, 0)
  const totalOpenCost = openLegs.reduce((sum, leg) => sum + leg.shares * leg.price, 0)
  const totalCloseValue = closeLegs.reduce((sum, leg) => sum + leg.shares * leg.price, 0)
  const shares = openingShares > 0 ? openingShares : closingShares > 0 ? closingShares : base.shares
  const entryPrice = openingShares > 0 ? totalOpenCost / openingShares : base.entryPrice
  const exitPrice = closingShares > 0 ? totalCloseValue / closingShares : base.exitPrice
  const pnl = side === 'short' ? totalOpenCost - totalCloseValue : totalCloseValue - totalOpenCost
  const pnlPct = totalOpenCost > 0 ? pnl / totalOpenCost : null
  const entryTime = openLegs[0]?.time ?? base.entryTime
  const exitTime = closeLegs.at(-1)?.time ?? base.exitTime

  let holdTimeMin: number | null = null
  let holdDays: number | null = null
  if (entryTime && exitTime) {
    const diffMs = new Date(exitTime).getTime() - new Date(entryTime).getTime()
    if (Number.isFinite(diffMs) && diffMs >= 0) {
      holdTimeMin = diffMs / 60_000
      holdDays = diffMs / 86_400_000
    }
  }

  let hourOfDay: number | null = null
  let dayOfWeek: string | null = null
  if (entryTime) {
    const d = new Date(entryTime)
    if (!Number.isNaN(d.getTime())) {
      hourOfDay = d.getUTCHours()
      dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]
    }
  }

  let outcome: Trade['outcome'] = null
  if (exitTime == null) {
    outcome = 'open'
  } else if (pnl > 0) {
    outcome = 'win'
  } else if (pnl < 0) {
    outcome = 'loss'
  } else {
    outcome = 'breakeven'
  }

  let rMultiple: number | null = base.rMultiple
  if (base.stopLoss != null && entryPrice != null && shares != null && side) {
    const riskPerShare = side === 'long' ? entryPrice - base.stopLoss : base.stopLoss - entryPrice
    const initialRisk = riskPerShare > 0 ? riskPerShare * shares : null
    rMultiple = initialRisk && initialRisk > 0 ? pnl / initialRisk : null
  }

  return {
    ...base,
    side,
    entryTime,
    exitTime,
    shares,
    entryPrice,
    exitPrice,
    pnl,
    pnlPct,
    outcome,
    holdTimeMin,
    holdDays,
    hourOfDay,
    dayOfWeek,
    rMultiple,
    executionLegs: legs,
  }
}

export function mergeOpenTradesForDisplay(trades: Trade[]): Trade[] {
  return trades
}

function legKey(leg: ExecutionLeg): string {
  return `${leg.time}|${leg.action}|${leg.shares}|${leg.price}`
}

function containsAllLegs(container: Map<string, number>, legs: ExecutionLeg[]): boolean {
  const remaining = new Map(container)
  for (const leg of legs) {
    const key = legKey(leg)
    const count = remaining.get(key) ?? 0
    if (count <= 0) return false
    if (count === 1) remaining.delete(key)
    else remaining.set(key, count - 1)
  }
  return true
}

function dropCompositeDuplicateClosedTrades(trades: Trade[]): Trade[] {
  return trades.filter((trade, index) => {
    if (trade.exitTime == null || !trade.executionLegs?.length) return true
    const tradeLegs = trade.executionLegs

    const tradeLegCounts = new Map<string, number>()
    for (const leg of tradeLegs) {
      const key = legKey(leg)
      tradeLegCounts.set(key, (tradeLegCounts.get(key) ?? 0) + 1)
    }

    const componentRows = trades.filter((candidate, candidateIndex) => {
      if (candidateIndex === index) return false
      if (candidate.symbol !== trade.symbol) return false
      if (candidate.exitTime == null || !candidate.executionLegs?.length) return false
      if (candidate.executionLegs.length >= tradeLegs.length) return false
      return containsAllLegs(tradeLegCounts, candidate.executionLegs)
    })

    return componentRows.length < 2
  })
}

export function collapseClosedTradeFragmentsForDisplay(trades: Trade[]): Trade[] {
  const groups = new Map<string, Trade[]>()
  const passthrough: Trade[] = []

  for (const trade of trades) {
    if (trade.exitTime == null || trade.outcome === 'open') {
      passthrough.push(trade)
      continue
    }

    const fingerprint = executionFingerprint(trade.executionLegs)
    if (!fingerprint) {
      passthrough.push(trade)
      continue
    }

    const key = `${trade.symbol}|${trade.side ?? ''}|${fingerprint}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(trade)
  }

  const collapsed: Trade[] = []
  for (const [, group] of groups) {
    if (group.length === 1) {
      collapsed.push(group[0])
      continue
    }

    const base = [...group].sort((a, b) => {
      const shareDiff = (b.shares ?? 0) - (a.shares ?? 0)
      if (shareDiff !== 0) return shareDiff
      const exitA = a.exitTime ?? ''
      const exitB = b.exitTime ?? ''
      return exitB.localeCompare(exitA)
    })[0]

    collapsed.push(deriveTradeFromExecutionLegs(base, base.executionLegs ?? []))
  }

  return [...passthrough, ...collapsed]
}

export function normalizeTradesForDisplay(trades: Trade[]): Trade[] {
  return collapseClosedTradeFragmentsForDisplay(dropCompositeDuplicateClosedTrades(mergeOpenTradesForDisplay(trades)))
}

export function dedupeTradeRowsForCleanup(trades: Trade[]) {
  const closedGroups = new Map<string, Trade[]>()

  for (const trade of trades) {
    if (trade.exitTime == null || trade.outcome === 'open') {
      continue
    }

    const fingerprint = executionFingerprint(trade.executionLegs)
    if (!fingerprint) continue
    const key = `${trade.symbol}|${trade.side ?? ''}|${fingerprint}`
    if (!closedGroups.has(key)) closedGroups.set(key, [])
    closedGroups.get(key)!.push(trade)
  }

  const cleanupGroups: Array<{ keep: Trade; removeIds: string[]; merged: Trade }> = []

  for (const [, group] of closedGroups) {
    if (group.length <= 1) continue
    const keep = [...group].sort((a, b) => {
      const shareDiff = (b.shares ?? 0) - (a.shares ?? 0)
      if (shareDiff !== 0) return shareDiff
      return (b.exitTime ?? '').localeCompare(a.exitTime ?? '')
    })[0]
    cleanupGroups.push({
      keep,
      removeIds: group.filter((trade) => trade.id !== keep.id).map((trade) => trade.id),
      merged: deriveTradeFromExecutionLegs(keep, keep.executionLegs ?? []),
    })
  }

  return cleanupGroups
}

export function pickTradeMetadata(group: Trade[], fallback: Trade) {
  return {
    needsReview: firstNonEmpty(group.map((trade) => trade.needsReview)) ?? fallback.needsReview,
    setupTag: firstNonEmpty(group.map((trade) => trade.setupTag), (value) => value === 'untagged') ?? fallback.setupTag,
    notes: firstNonEmpty(group.map((trade) => trade.notes), (value) => value.trim() === '') ?? fallback.notes,
    stopLoss: firstNonEmpty(group.map((trade) => trade.stopLoss)) ?? fallback.stopLoss,
    rMultiple: firstNonEmpty(group.map((trade) => trade.rMultiple)) ?? fallback.rMultiple,
  }
}
