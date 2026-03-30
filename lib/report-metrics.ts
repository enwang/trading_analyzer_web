import type { Trade, SummaryStats } from '@/types/trade'
import { closedTrades } from '@/lib/metrics'

// ---------------------------------------------------------------------------
// Day-of-week detail
// ---------------------------------------------------------------------------

export interface DayOfWeekRow {
  day: string
  wins: number
  losses: number
  trades: number
  totalPnl: number
  winRate: number
}

const DOW_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']

export function computeDayOfWeekDetail(trades: Trade[]): DayOfWeekRow[] {
  const closed = closedTrades(trades)
  const buckets = new Map<string, Trade[]>()
  for (const d of DOW_ORDER) buckets.set(d, [])

  for (const t of closed) {
    if (t.dayOfWeek && buckets.has(t.dayOfWeek)) {
      buckets.get(t.dayOfWeek)!.push(t)
    }
  }

  return DOW_ORDER.filter((d) => (buckets.get(d) ?? []).length > 0).map((day) => {
    const ts = buckets.get(day)!
    const wins = ts.filter((t) => t.outcome === 'win').length
    const losses = ts.filter((t) => t.outcome === 'loss').length
    const totalPnl = ts.reduce((s, t) => s + (t.pnl ?? 0), 0)
    return {
      day,
      wins,
      losses,
      trades: ts.length,
      totalPnl,
      winRate: ts.length > 0 ? wins / ts.length : 0,
    }
  })
}

// ---------------------------------------------------------------------------
// Trading pattern detection
// ---------------------------------------------------------------------------

export interface TradePattern {
  name: string
  description: string
  count: number
  percentage: number
  status: 'strength' | 'warning' | 'neutral'
}

export function detectTradingPatterns(trades: Trade[]): TradePattern[] {
  const closed = closedTrades(trades)
  const total = closed.length
  if (total === 0) return []

  const greenToRed = closed.filter(
    (t) => t.mfe != null && t.mfe > 0 && t.outcome === 'loss',
  )

  const scaleOut = closed.filter(
    (t) =>
      t.executionLegs != null &&
      t.executionLegs.filter((l) => l.action === 'SELL').length > 1,
  )

  const scaleIn = closed.filter(
    (t) =>
      t.executionLegs != null &&
      t.executionLegs.filter((l) => l.action === 'BUY').length > 1,
  )

  const timeInDrawdown = closed.filter(
    (t) => t.mae != null && t.mfe != null && Math.abs(t.mae) > Math.abs(t.mfe),
  )

  const shareCounts = closed.map((t) => t.shares ?? 0).sort((a, b) => a - b)
  const p75 = shareCounts[Math.floor(shareCounts.length * 0.75)] ?? 0
  const highVolume = closed.filter((t) => (t.shares ?? 0) > p75 && p75 > 0)

  const patterns: TradePattern[] = [
    {
      name: 'Scale Out',
      description: 'Closed position in multiple partial exits',
      count: scaleOut.length,
      percentage: (scaleOut.length / total) * 100,
      status: 'neutral',
    },
    {
      name: 'Green to Red',
      description: 'Trade was profitable at some point but closed at a loss',
      count: greenToRed.length,
      percentage: (greenToRed.length / total) * 100,
      status: 'warning',
    },
    {
      name: 'Scale In',
      description: 'Built position across multiple separate entries',
      count: scaleIn.length,
      percentage: (scaleIn.length / total) * 100,
      status: 'neutral',
    },
    {
      name: 'Most Time in Drawdown',
      description: 'Spent more time in a loss than in profit during the trade',
      count: timeInDrawdown.length,
      percentage: (timeInDrawdown.length / total) * 100,
      status: 'warning',
    },
    {
      name: 'High Volume',
      description: 'Share size in the top 25% of all trades',
      count: highVolume.length,
      percentage: (highVolume.length / total) * 100,
      status: 'neutral',
    },
  ]

  return patterns.sort((a, b) => b.percentage - a.percentage)
}

// ---------------------------------------------------------------------------
// Performance score (0 – 100)
// ---------------------------------------------------------------------------

export type MetricRating = 'watch-out' | 'needs-work' | 'good' | 'great'

export interface ScoreBreakdown {
  overall: number
  winRate: { score: number; rating: MetricRating; value: number }
  profitFactor: { score: number; rating: MetricRating; value: number }
  avgWinLoss: { score: number; rating: MetricRating; value: number }
  maxDrawdown: { score: number; rating: MetricRating; value: number }
  expectancy: { score: number; rating: MetricRating; value: number }
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.min(hi, Math.max(lo, n))
}

function rateValue(
  value: number,
  [lo, mid, hi]: [number, number, number],
): MetricRating {
  if (value >= hi) return 'great'
  if (value >= mid) return 'good'
  if (value >= lo) return 'needs-work'
  return 'watch-out'
}

export function computePerformanceScore(stats: SummaryStats): ScoreBreakdown {
  const wrPct = stats.winRate * 100
  const wrScore = clamp((wrPct / 60) * 100)
  const wrRating = rateValue(wrPct, [30, 40, 55])

  const pfCapped = Math.min(stats.profitFactor === Infinity ? 5 : stats.profitFactor, 5)
  const pfScore = clamp((pfCapped / 2.0) * 100)
  const pfRating = rateValue(stats.profitFactor, [0.8, 1.2, 1.8])

  const wlRatio = stats.payoffRatio === Infinity ? 5 : stats.payoffRatio
  const wlScore = clamp((Math.min(wlRatio, 3) / 3) * 100)
  const wlRating = rateValue(wlRatio, [1.0, 1.5, 2.0])

  const ddRatio =
    stats.grossProfit > 0 ? stats.maxDrawdown / stats.grossProfit : 1
  const ddScore = clamp(100 - ddRatio * 60)
  const ddRating = rateValue(100 - ddRatio * 100, [30, 50, 75])

  const expScore = clamp(50 + clamp(stats.expectancy, -50, 50))
  const expRating = rateValue(stats.expectancy, [0, 50, 150])

  const overall =
    wrScore * 0.25 +
    pfScore * 0.30 +
    wlScore * 0.20 +
    ddScore * 0.15 +
    expScore * 0.10

  return {
    overall: Math.round(overall * 10) / 10,
    winRate: { score: wrScore, rating: wrRating, value: wrPct },
    profitFactor: { score: pfScore, rating: pfRating, value: stats.profitFactor },
    avgWinLoss: { score: wlScore, rating: wlRating, value: stats.payoffRatio },
    maxDrawdown: { score: ddScore, rating: ddRating, value: stats.maxDrawdown },
    expectancy: { score: expScore, rating: expRating, value: stats.expectancy },
  }
}    
