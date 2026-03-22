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
  const closed = trades.filter((trade) => trade.exitTime != null || trade.outcome !== 'open')
  const open = trades.filter((trade) => trade.exitTime == null && trade.outcome === 'open')

  const groups = new Map<string, Trade[]>()
  for (const trade of open) {
    const key = `${trade.symbol}|${trade.side ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(trade)
  }

  const mergedOpen: Trade[] = []
  for (const [, group] of groups) {
    if (group.length === 1) {
      mergedOpen.push(group[0])
      continue
    }

    const base = { ...group[0] }
    const totalShares = group.reduce((sum, trade) => sum + Math.abs(trade.shares ?? 0), 0)
    const weightedEntryCost = group.reduce(
      (sum, trade) => sum + Math.abs(trade.shares ?? 0) * (trade.entryPrice ?? 0),
      0
    )
    const executionLegs = sortLegs(group.flatMap((trade) => trade.executionLegs ?? []))

    base.entryTime = group
      .map((trade) => trade.entryTime)
      .filter((value): value is string => value != null)
      .sort()[0] ?? null
    base.shares = totalShares > 0 ? totalShares : null
    base.entryPrice = totalShares > 0 ? weightedEntryCost / totalShares : base.entryPrice
    base.pnl = group.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)
    base.executionLegs = executionLegs.length > 0 ? executionLegs : null
    mergedOpen.push(base)
  }

  return [...closed, ...mergedOpen]
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
  return collapseClosedTradeFragmentsForDisplay(mergeOpenTradesForDisplay(trades))
}

export function dedupeTradeRowsForCleanup(trades: Trade[]) {
  const openGroups = new Map<string, Trade[]>()
  const closedGroups = new Map<string, Trade[]>()

  for (const trade of trades) {
    if (trade.exitTime == null || trade.outcome === 'open') {
      const key = `${trade.symbol}|${trade.side ?? ''}|open`
      if (!openGroups.has(key)) openGroups.set(key, [])
      openGroups.get(key)!.push(trade)
      continue
    }

    const fingerprint = executionFingerprint(trade.executionLegs)
    if (!fingerprint) continue
    const key = `${trade.symbol}|${trade.side ?? ''}|${fingerprint}`
    if (!closedGroups.has(key)) closedGroups.set(key, [])
    closedGroups.get(key)!.push(trade)
  }

  const cleanupGroups: Array<{ keep: Trade; removeIds: string[]; merged: Trade }> = []

  for (const [, group] of openGroups) {
    if (group.length <= 1) continue
    const merged = mergeOpenTradesForDisplay(group)[0]
    const keep = group[0]
    cleanupGroups.push({
      keep,
      removeIds: group.slice(1).map((trade) => trade.id),
      merged,
    })
  }

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
    setupTag: firstNonEmpty(group.map((trade) => trade.setupTag), (value) => value === 'untagged') ?? fallback.setupTag,
    notes: firstNonEmpty(group.map((trade) => trade.notes), (value) => value.trim() === '') ?? fallback.notes,
    stopLoss: firstNonEmpty(group.map((trade) => trade.stopLoss)) ?? fallback.stopLoss,
    rMultiple: firstNonEmpty(group.map((trade) => trade.rMultiple)) ?? fallback.rMultiple,
  }
}
