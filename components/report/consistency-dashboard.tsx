import { cn } from '@/lib/utils'
import type { ScoreBreakdown, MetricRating } from '@/lib/report-metrics'
import type { SummaryStats } from '@/types/trade'

// ---------------------------------------------------------------------------
// Rating badge
// ---------------------------------------------------------------------------

const ratingCfg: Record<
  MetricRating,
  { label: string; badge: string; value: string; border: string }
> = {
  'watch-out': {
    label: 'Watch Out',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    value: 'text-red-600',
    border: 'border-red-200 dark:border-red-900/40',
  },
  'needs-work': {
    label: 'Needs Work',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    value: 'text-amber-600',
    border: 'border-amber-200 dark:border-amber-900/40',
  },
  good: {
    label: 'Good',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    value: 'text-emerald-600',
    border: 'border-emerald-200 dark:border-emerald-900/40',
  },
  great: {
    label: 'Great',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    value: 'text-blue-600',
    border: 'border-blue-200 dark:border-blue-900/40',
  },
}

function RatingBadge({ rating }: { rating: MetricRating }) {
  const cfg = ratingCfg[rating]
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cfg.badge)}>
      {cfg.label}
    </span>
  )
}

interface MetricCardProps {
  label: string
  value: string
  sub: string
  rating: MetricRating
}

function MetricCard({ label, value, sub, rating }: MetricCardProps) {
  const cfg = ratingCfg[rating]
  return (
    <div className={cn('rounded-lg border p-4', cfg.border)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <RatingBadge rating={rating} />
      </div>
      <p className={cn('text-2xl font-bold tabular-nums', cfg.value)}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1 leading-tight">{sub}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  stats: SummaryStats
  score: ScoreBreakdown
}

export function ConsistencyDashboard({ stats, score }: Props) {
  const pfDisplay =
    stats.profitFactor === Infinity ? 'â' : stats.profitFactor.toFixed(2)
  const wlDisplay =
    stats.payoffRatio === Infinity ? 'â' : `${stats.payoffRatio.toFixed(2)}x`
  const ddDisplay = `$${stats.maxDrawdown.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <MetricCard
        label="Win Rate"
        value={`${(stats.winRate * 100).toFixed(1)}%`}
        sub={`${stats.nWins}W / ${stats.nLosses}L â ${stats.totalTrades} trades total`}
        rating={score.winRate.rating}
      />
      <MetricCard
        label="Profit Factor"
        value={pfDisplay}
        sub="Gross profit Ã· gross loss. Above 1.0 = net profitable system."
        rating={score.profitFactor.rating}
      />
      <MetricCard
        label="Avg Win / Loss"
        value={wlDisplay}
        sub={`Avg win $${stats.avgWin.toFixed(0)} vs avg loss $${Math.abs(stats.avgLoss).toFixed(0)}`}
        rating={score.avgWinLoss.rating}
      />
      <MetricCard
        label="Max Drawdown"
        value={ddDisplay}
        sub="Largest peak-to-trough equity drop in your account"
        rating={score.maxDrawdown.rating}
      />
    </div>
  )
}
