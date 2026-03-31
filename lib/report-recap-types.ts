import type { DayOfWeekRow, ScoreBreakdown, TradePattern } from '@/lib/report-metrics'
import type { ExecutionLeg, Trade } from '@/types/trade'

export type ReportInsight = {
  title: string
  body: string
  mode: 'llm' | 'fallback'
  provider: 'claude' | 'openai' | 'fallback'
}

export type IntradayBucket = {
  label: string
  totalPnl: number
  wins: number
  losses: number
  trades: number
}

export type ConsistencyMetricCard = {
  label: string
  value: string
  rating: 'watch-out' | 'needs-work' | 'good' | 'great'
  description: string
}

export type GraphPoint = {
  label: string
  value: number
}

export type SpotlightInsight = {
  label: string
  body: string
}

export type SpotlightTrade = {
  id: string
  symbol: string
  date: string
  pnl: number
  side: Trade['side']
  scoreLabel: string
  stats: Array<{ label: string; value: string }>
  highlights: SpotlightInsight[]
  executionLegs: ExecutionLeg[] | null
}

export type ReportSlide =
  | {
      id: 'day-of-week'
      type: 'day-of-week'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: {
        days: DayOfWeekRow[]
        selectedDay: string
        intradayByDay: Record<string, IntradayBucket[]>
      }
    }
  | {
      id: 'consistency'
      type: 'consistency'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: {
        score: ScoreBreakdown
        essential: ConsistencyMetricCard[]
        advanced: ConsistencyMetricCard[]
        graphs: {
          equityCurve: GraphPoint[]
          drawdowns: GraphPoint[]
          monthlyReturns: GraphPoint[]
          sharpeTrend: GraphPoint[]
          sortinoTrend: GraphPoint[]
        }
      }
    }
  | {
      id: 'patterns'
      type: 'patterns'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: {
        patterns: TradePattern[]
      }
    }
  | {
      id: 'score'
      type: 'score'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: {
        overall: number
        score20: number
        breakdown: Array<{ label: string; value: string; rating: string }>
      }
    }
  | {
      id: string
      type: 'spotlight'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: SpotlightTrade
    }
  | {
      id: 'closing'
      type: 'closing'
      eyebrow: string
      title: string
      subtitle?: string
      insight: ReportInsight
      data: {
        message: string
      }
    }

export type ReportRecap = {
  year: number
  tradeCount: number
  rangeStart: string
  rangeEnd: string
  rangeLabel: string
  generatedAt: string
  cached: boolean
  slides: ReportSlide[]
}
