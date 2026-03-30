import { cn } from '@/lib/utils'
import type { TradePattern } from '@/lib/report-metrics'

interface Props {
  patterns: TradePattern[]
}

const statusCfg = {
  strength: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  warning: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  neutral: {
    badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    bar: 'bg-slate-400',
  },
} as const

export function TradingPatterns({ patterns }: Props) {
  if (patterns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No closed trades to analyze yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {patterns.map((p) => {
        const cfg = statusCfg[p.status]
        return (
          <div key={p.name} className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium">{p.name}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                    cfg.badge,
                  )}
                >
                  {p.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-1.5">
                {p.description}
              </p>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', cfg.bar)}
                  style={{ width: `${Math.min(p.percentage, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold tabular-nums">{p.count}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {p.percentage.toFixed(0)}%
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
