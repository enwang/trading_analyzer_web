import type { Trade, SummaryStats, EquityPoint, GroupRow } from '@/types/trade'

/** Closed trades only (outcome !== 'open') */
export function closedTrades(trades: Trade[]): Trade[] {
  return trades.filter(t => t.outcome !== 'open' && t.pnl != null)
}

export interface CoreStats {
  netPnl: number
  winCount: number
  lossCount: number
  breakevenCount: number
  /** wins + losses + breakevenCount — use this as the denominator for win rate */
  totalCount: number
  /** 0–100 */
  winPct: number
  grossProfit: number
  /** Absolute (positive) gross loss */
  grossLoss: number
  /** Positive dollar average */
  avgWin: number
  /** Positive dollar average (absolute) */
  avgLoss: number
  payoffRatio: number
  profitFactor: number
  avgHoldWinMin: number | null
  avgHoldLossMin: number | null
}

/**
 * Core per-trade stats from any array of trade-like objects.
 * Single source of truth used by computeSummary and the analysis summary tab.
 * avgLoss is always positive (absolute value).
 */
export function computeCoreStats(
  trades: Array<{ pnl: number | null; outcome: string | null; holdTimeMin: number | null }>
): CoreStats {
  let netPnl = 0, grossProfit = 0, grossLoss = 0
  let winCount = 0, lossCount = 0, breakevenCount = 0
  let holdWinSum = 0, holdWinCount = 0, holdLossSum = 0, holdLossCount = 0

  for (const t of trades) {
    const pnl = t.pnl ?? 0
    netPnl += pnl
    if (t.outcome === 'win') {
      grossProfit += pnl; winCount++
      if (t.holdTimeMin != null) { holdWinSum += t.holdTimeMin; holdWinCount++ }
    } else if (t.outcome === 'loss') {
      grossLoss += Math.abs(pnl); lossCount++
      if (t.holdTimeMin != null) { holdLossSum += t.holdTimeMin; holdLossCount++ }
    } else if (t.outcome === 'breakeven') {
      breakevenCount++
    }
  }

  const totalCount = winCount + lossCount + breakevenCount
  const avgWin = winCount > 0 ? grossProfit / winCount : 0
  const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0

  return {
    netPnl,
    winCount, lossCount, breakevenCount, totalCount,
    winPct: totalCount > 0 ? (winCount / totalCount) * 100 : 0,
    grossProfit, grossLoss,
    avgWin, avgLoss,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
    avgHoldWinMin: holdWinCount > 0 ? holdWinSum / holdWinCount : null,
    avgHoldLossMin: holdLossCount > 0 ? holdLossSum / holdLossCount : null,
  }
}

export function computeSummary(trades: Trade[]): SummaryStats {
  const closed = closedTrades(trades)
  if (closed.length === 0) {
    return {
      totalTrades: 0, nWins: 0, nLosses: 0, nBreakevens: 0, winRate: 0,
      netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0,
      avgWin: 0, avgLoss: 0, payoffRatio: 0, expectancy: 0,
      largestWin: 0, largestLoss: 0, maxDrawdown: 0,
      maxConsecWins: 0, maxConsecLosses: 0,
      avgHoldWinMin: null, avgHoldLossMin: null, dateRange: 'N/A',
    }
  }

  const core = computeCoreStats(closed)
  const { winCount: nWins, lossCount: nLosses, breakevenCount: nBreakevens, totalCount: total } = core
  const winRate = total > 0 ? nWins / total : 0
  const lossRate = total > 0 ? nLosses / total : 0

  // SummaryStats convention: avgLoss is negative so expectancy = winRate*avgWin + lossRate*avgLoss
  const avgLossNeg = -core.avgLoss
  const expectancy = winRate * core.avgWin + lossRate * avgLossNeg

  const pnls = closed.map(t => t.pnl ?? 0)
  const largestWin = pnls.length > 0 ? Math.max(...pnls) : 0
  const largestLoss = pnls.length > 0 ? Math.min(...pnls) : 0

  // Max drawdown from equity curve
  const curve = equityCurve(closed)
  let maxDrawdown = 0
  let peak = 0
  for (const p of curve) {
    if (p.cumulativePnl > peak) peak = p.cumulativePnl
    const dd = peak - p.cumulativePnl
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  // Consecutive streaks — sorted by exit date
  const outcomes = [...closed]
    .sort((a, b) => {
      const ta = a.exitTime ?? a.entryTime ?? ''
      const tb = b.exitTime ?? b.entryTime ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })
    .map(t => t.outcome)
  let maxConsecWins = 0, maxConsecLosses = 0, cur = 0
  let prevOutcome: string | null = ''
  for (const o of outcomes) {
    if (o === prevOutcome) { cur++ } else { cur = 1; prevOutcome = o }
    if (o === 'win' && cur > maxConsecWins) maxConsecWins = cur
    if (o === 'loss' && cur > maxConsecLosses) maxConsecLosses = cur
  }

  // Date range
  const times = closed
    .map(t => t.exitTime ?? t.entryTime)
    .filter((v): v is string => v != null)
    .sort()
  const dateRange = times.length >= 2
    ? `${times[0].slice(0, 10)} → ${times[times.length - 1].slice(0, 10)}`
    : times.length === 1 ? times[0].slice(0, 10) : 'N/A'

  return {
    totalTrades: total, nWins, nLosses, nBreakevens, winRate,
    netPnl: core.netPnl, grossProfit: core.grossProfit, grossLoss: core.grossLoss,
    profitFactor: core.profitFactor,
    avgWin: core.avgWin, avgLoss: avgLossNeg, payoffRatio: core.payoffRatio, expectancy,
    largestWin, largestLoss, maxDrawdown,
    maxConsecWins, maxConsecLosses,
    avgHoldWinMin: core.avgHoldWinMin, avgHoldLossMin: core.avgHoldLossMin, dateRange,
  }
}

export function equityCurve(trades: Trade[]): EquityPoint[] {
  const sorted = [...closedTrades(trades)].sort((a, b) => {
    const ta = a.exitTime ?? a.entryTime ?? ''
    const tb = b.exitTime ?? b.entryTime ?? ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })

  let cum = 0
  return sorted.map((t, i) => {
    cum += t.pnl ?? 0
    return {
      tradeNum: i + 1,
      entryTime: t.entryTime,
      symbol: t.symbol,
      pnl: t.pnl ?? 0,
      cumulativePnl: cum,
      outcome: t.outcome ?? '',
    }
  })
}

export function byGroup(trades: Trade[], groupKey: keyof Trade): GroupRow[] {
  const closed = closedTrades(trades)
  const groups = new Map<string, Trade[]>()

  for (const t of closed) {
    const key = String(t[groupKey] ?? '(none)')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(t)
  }

  const rows: GroupRow[] = []
  for (const [group, ts] of groups) {
    const wins = ts.filter(t => t.outcome === 'win')
    const losses = ts.filter(t => t.outcome === 'loss')
    const nWins = wins.length
    const nLosses = losses.length
    const total = ts.length
    const totalPnl = ts.reduce((s, t) => s + (t.pnl ?? 0), 0)
    const avgPnl = totalPnl / total
    const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0))

    const rVals = ts.map(t => t.rMultiple).filter((v): v is number => v != null)
    const avgR = rVals.length > 0 ? rVals.reduce((s, v) => s + v, 0) / rVals.length : null

    rows.push({
      group,
      trades: total,
      wins: nWins,
      losses: nLosses,
      winRate: total > 0 ? nWins / total : 0,
      totalPnl,
      avgPnl,
      avgR,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    })
  }

  return rows.sort((a, b) => b.totalPnl - a.totalPnl)
}

/** Group trades by hour of day and compute a metric */
export function byHourOfDay(
  trades: Trade[],
  metric: 'count' | 'avg_pnl' | 'total_pnl' | 'win_rate' = 'count'
): { hour: number; value: number }[] {
  const closed = closedTrades(trades)
  const buckets = new Map<number, Trade[]>()
  for (let h = 0; h < 24; h++) buckets.set(h, [])
  for (const t of closed) {
    if (t.hourOfDay != null) {
      buckets.get(t.hourOfDay)!.push(t)
    }
  }

  return Array.from(buckets.entries())
    .filter(([, ts]) => ts.length > 0)
    .map(([hour, ts]) => {
      let value: number
      switch (metric) {
        case 'count':    value = ts.length; break
        case 'total_pnl': value = ts.reduce((s, t) => s + (t.pnl ?? 0), 0); break
        case 'avg_pnl':  value = ts.reduce((s, t) => s + (t.pnl ?? 0), 0) / ts.length; break
        case 'win_rate':
          value = ts.filter(t => t.outcome === 'win').length / ts.length * 100; break
        default: value = ts.length
      }
      return { hour, value }
    })
    .sort((a, b) => a.hour - b.hour)
}

/** Group by day of week */
export function byDayOfWeek(
  trades: Trade[],
  metric: 'win_rate' | 'total_pnl' = 'win_rate'
): { day: string; value: number }[] {
  const ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const closed = closedTrades(trades)
  const buckets = new Map<string, Trade[]>()
  for (const d of ORDER) buckets.set(d, [])
  for (const t of closed) {
    if (t.dayOfWeek && buckets.has(t.dayOfWeek)) {
      buckets.get(t.dayOfWeek)!.push(t)
    }
  }

  return ORDER.filter(d => (buckets.get(d) ?? []).length > 0)
    .map(day => {
      const ts = buckets.get(day)!
      const value = metric === 'win_rate'
        ? ts.filter(t => t.outcome === 'win').length / ts.length * 100
        : ts.reduce((s, t) => s + (t.pnl ?? 0), 0)
      return { day, value }
    })
}

/** Monthly P&L data for heatmap: [{year, month, pnl}] */
export function byMonth(trades: Trade[]): { year: number; month: number; pnl: number }[] {
  const closed = closedTrades(trades)
  const buckets = new Map<string, number>()
  for (const t of closed) {
    const dt = t.entryTime ?? t.exitTime
    if (!dt) continue
    const d = new Date(dt)
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`
    buckets.set(key, (buckets.get(key) ?? 0) + (t.pnl ?? 0))
  }
  return Array.from(buckets.entries()).map(([k, pnl]) => {
    const [y, m] = k.split('-').map(Number)
    return { year: y, month: m, pnl }
  }).sort((a, b) => a.year - b.year || a.month - b.month)
}

/** Daily P&L for bar chart */
export function byDay(trades: Trade[]): { date: string; pnl: number }[] {
  const closed = closedTrades(trades)
  const buckets = new Map<string, number>()
  for (const t of closed) {
    const dt = t.exitTime ?? t.entryTime
    if (!dt) continue
    const date = dt.slice(0, 10)
    buckets.set(date, (buckets.get(date) ?? 0) + (t.pnl ?? 0))
  }
  return Array.from(buckets.entries())
    .map(([date, pnl]) => ({ date, pnl }))
    .sort((a, b) => a.date < b.date ? -1 : 1)
}
