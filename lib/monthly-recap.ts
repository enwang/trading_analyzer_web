import type { Trade } from '@/types/trade'

export interface NavDailyRow {
  report_date: string  // YYYY-MM-DD
  total: number | null
}

export interface NavChangeRow {
  from_date: string
  to_date: string
  deposits_withdrawals: number | null
}

export interface MonthlyReturnRow {
  monthKey: string       // YYYY-MM
  monthLabel: string     // "Jan 26"
  startingNav: number | null
  endingNav: number | null
  depositsWithdrawals: number | null // net cash deposits/withdrawals attributed to the month
  monthReturnPct: number | null      // ((end - start - deposits) / start) * 100
  cumulativeReturnPct: number | null
}

export interface MonthlyReturnsResult {
  rows: MonthlyReturnRow[]
  totalDepositsInPeriod: number | null
  hasPerMonthDeposits: boolean
}

export interface MonthlyStatsRow {
  monthKey: string
  monthLabel: string
  avgGainPct: number | null
  avgLossPct: number | null
  avgWin: number | null
  avgLoss: number | null
  winPct: number
  lossPct: number
  wins: number
  losses: number
  trades: number
  largestGainPct: number | null
  largestLossPct: number | null
  avgDaysGain: number | null
  avgDaysLoss: number | null
}

export interface YearlyAveragesRow {
  year: string
  avgGainPct: number | null
  avgLossPct: number | null
  avgWin: number | null
  avgLoss: number | null
  winPct: number
  lossPct: number
  wins: number
  losses: number
  trades: number
  largestGainPct: number | null
  largestLossPct: number | null
  avgDaysGain: number | null
  avgDaysLoss: number | null
}

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7)
}

function shortMonthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${monthName} ${String(y).slice(-2)}`
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function depositsForMonth(
  monthKey: string,
  isFirstMonth: boolean,
  changes: NavChangeRow[]
): number | null {
  // First preference: a ChangeInNAV row fully contained within this month
  // (user has Period=Monthly in their Flex Query). Returns the exact deposits.
  let total = 0
  let matched = false
  for (const r of changes) {
    if (!r.from_date.startsWith(monthKey) || !r.to_date.startsWith(monthKey)) continue
    if (r.deposits_withdrawals == null) continue
    total += r.deposits_withdrawals
    matched = true
  }
  if (matched) return total

  // Fallback: a single full-period ChangeInNAV row covers multiple months.
  // Attribute all deposits/withdrawals to the first month in the period — the
  // typical pattern is one initial funding event at the start.
  if (!isFirstMonth) return null
  for (const r of changes) {
    if (r.deposits_withdrawals != null && r.deposits_withdrawals !== 0) {
      return r.deposits_withdrawals
    }
  }
  return null
}

export function computeMonthlyReturns(
  nav: NavDailyRow[],
  changes: NavChangeRow[] = []
): MonthlyReturnsResult {
  if (nav.length === 0) {
    return { rows: [], totalDepositsInPeriod: null, hasPerMonthDeposits: false }
  }

  const sorted = [...nav].sort((a, b) => (a.report_date < b.report_date ? -1 : 1))

  const byMonth = new Map<string, { first: NavDailyRow; last: NavDailyRow }>()
  for (const row of sorted) {
    if (row.total == null) continue
    const key = monthKeyOf(row.report_date)
    const existing = byMonth.get(key)
    if (!existing) byMonth.set(key, { first: row, last: row })
    else existing.last = row
  }

  const monthKeys = [...byMonth.keys()].sort()
  const rows: MonthlyReturnRow[] = []
  let cumulativeFactor = 1
  let hasPerMonthDeposits = false

  for (let i = 0; i < monthKeys.length; i++) {
    const key = monthKeys[i]
    const bucket = byMonth.get(key)!
    const priorKey = i > 0 ? monthKeys[i - 1] : null
    const priorLast = priorKey ? byMonth.get(priorKey)!.last.total : null
    const startingNav = priorLast ?? bucket.first.total
    const endingNav = bucket.last.total
    const deposits = depositsForMonth(key, i === 0, changes)
    if (deposits != null) hasPerMonthDeposits = true
    let monthReturnPct: number | null = null
    if (startingNav != null && endingNav != null && startingNav !== 0) {
      const tradingPnl = endingNav - startingNav - (deposits ?? 0)
      monthReturnPct = (tradingPnl / startingNav) * 100
      cumulativeFactor *= 1 + tradingPnl / startingNav
    }
    rows.push({
      monthKey: key,
      monthLabel: shortMonthLabel(key),
      startingNav,
      endingNav,
      depositsWithdrawals: deposits,
      monthReturnPct,
      cumulativeReturnPct: monthReturnPct == null ? null : (cumulativeFactor - 1) * 100,
    })
  }

  // Total deposits in the queried period — useful when per-month attribution is
  // missing so the user can at least see an aggregate adjustment.
  let totalDepositsInPeriod: number | null = null
  if (changes.length > 0) {
    totalDepositsInPeriod = changes.reduce(
      (s, r) => s + (r.deposits_withdrawals ?? 0),
      0
    )
  }

  return { rows, totalDepositsInPeriod, hasPerMonthDeposits }
}

function tradeMonthKey(t: Trade): string | null {
  const iso = t.exitTime ?? t.entryTime
  if (!iso) return null
  return iso.slice(0, 7)
}

function tradePctReturn(t: Trade): number | null {
  // Prefer stored pnl_pct (already a fraction). Fall back to pnl / cost.
  if (t.pnlPct != null) return t.pnlPct * 100
  if (t.pnl != null && t.entryPrice != null && t.shares != null && t.shares > 0 && t.entryPrice > 0) {
    const cost = t.entryPrice * t.shares
    return cost > 0 ? (t.pnl / cost) * 100 : null
  }
  return null
}

function statsForTrades(trades: Trade[]): Omit<MonthlyStatsRow, 'monthKey' | 'monthLabel'> {
  const wins = trades.filter((t) => t.outcome === 'win')
  const losses = trades.filter((t) => t.outcome === 'loss')
  const total = wins.length + losses.length

  const winPcts = wins.map(tradePctReturn).filter((v): v is number => v != null)
  const lossPcts = losses.map(tradePctReturn).filter((v): v is number => v != null)
  const winHolds = wins.map((t) => t.holdTimeMin).filter((v): v is number => v != null)
  const lossHolds = losses.map((t) => t.holdTimeMin).filter((v): v is number => v != null)

  const avgGainPct = mean(winPcts)
  const avgLossPct = mean(lossPcts.map((v) => Math.abs(v)))
  const winPnls = wins.map((t) => t.pnl ?? 0)
  const lossPnls = losses.map((t) => Math.abs(t.pnl ?? 0))

  return {
    avgGainPct,
    avgLossPct: avgLossPct != null ? avgLossPct : null,
    avgWin: winPnls.length > 0 ? mean(winPnls) : null,
    avgLoss: lossPnls.length > 0 ? mean(lossPnls) : null,
    winPct: total > 0 ? (wins.length / total) * 100 : 0,
    lossPct: total > 0 ? (losses.length / total) * 100 : 0,
    wins: wins.length,
    losses: losses.length,
    trades: total,
    largestGainPct: winPcts.length > 0 ? Math.max(...winPcts) : null,
    largestLossPct: lossPcts.length > 0 ? Math.abs(Math.min(...lossPcts)) : null,
    avgDaysGain: winHolds.length > 0 ? mean(winHolds.map((m) => m / 1440)) : null,
    avgDaysLoss: lossHolds.length > 0 ? mean(lossHolds.map((m) => m / 1440)) : null,
  }
}

export function computeMonthlyStats(trades: Trade[]): MonthlyStatsRow[] {
  const byMonth = new Map<string, Trade[]>()
  for (const t of trades) {
    if (t.outcome !== 'win' && t.outcome !== 'loss') continue
    const key = tradeMonthKey(t)
    if (!key) continue
    const list = byMonth.get(key) ?? []
    list.push(t)
    byMonth.set(key, list)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, group]) => ({
      monthKey: key,
      monthLabel: shortMonthLabel(key),
      ...statsForTrades(group),
    }))
}

export function computeYearlyAverages(trades: Trade[], year: string): YearlyAveragesRow {
  const filtered = trades.filter((t) => {
    const iso = t.exitTime ?? t.entryTime
    return iso && iso.startsWith(year)
  })
  return {
    year,
    ...statsForTrades(filtered),
  }
}
