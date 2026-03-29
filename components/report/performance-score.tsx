'use client'

import { cn } from '@/lib/utils'
import type { ScoreBreakdown } from '@/lib/report-metrics'

interface Props {
  score: ScoreBreakdown
}

function getColor(n: number) {
  if (n >= 70) return '#16a34a'
  if (n >= 45) return '#d97706'
  return '#dc2626'
}

function getTextClass(n: number) {
  if (n >= 70) return 'text-emerald-600'
  if (n >= 45) return 'text-amber-600'
  return 'text-red-600'
}

function getLabel(n: number) {
  if (n >= 80) return 'Excellent'
  if (n >= 65) return 'Good'
  if (n >= 45) return 'Developing'
  if (n >= 25) return 'Needs Work'
  return 'Critical'
}

export function PerformanceScore({ score }: Props) {
  const pct = Math.min(100, Math.max(0, score.overall))
  const R = 45
  const circumference = 2 * Math.PI * R
  const dashOffset = circumference * (1 - pct / 100)
  const color = getColor(pct)

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-2">
      <div className="relative size-40">
        <svg viewBox="0 0 100 100" className="-rotate-90 w-full h-full">
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth="9"
          />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl font-bold tabular-nums', getTextClass(pct))}>
            {pct.toFixed(1)}
          </span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className={cn('text-sm font-semibold', getTextClass(pct))}>{getLabel(pct)}</p>
        <p className="text-xs text-muted-foreground">Performance Score</p>
      </div>
    </div>
  )
}
