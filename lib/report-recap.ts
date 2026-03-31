import type { SupabaseClient } from '@supabase/supabase-js'
import { computeSummary, closedTrades, equityCurve, byDay } from '@/lib/metrics'
import {
  computeDayOfWeekDetail,
  computePerformanceScore,
  detectTradingPatterns,
  type DayOfWeekRow,
  type ScoreBreakdown,
  type TradePattern,
} from '@/lib/report-metrics'
import { runLlmText } from '@/lib/ai/llm-analysis'
import { getCachedAnalysis, setCachedAnalysis, simpleHash } from '@/lib/rag/analysis-cache'
import type {
  ConsistencyMetricCard,
  GraphPoint,
  IntradayBucket,
  ReportInsight,
  ReportRecap,
  ReportSlide,
  SpotlightInsight,
  SpotlightTrade,
} from '@/lib/report-recap-types'
import type { Trade } from '@/types/trade'

type InsightInput = {
  key: string
  title: string
  prompt: string
  fallback: string
}

type ExtendedMetrics = {
  sharpe: number | null
  sortino: number | null
  monthlyWinRate: number | null
  avgDailyPnl: number | null
}

function fmtCurrency(value: number, digits = 0) {
  const abs = Math.abs(value)
  const text = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${value < 0 ? '-' : ''}$${text}`
}

function fmtPct(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function fmtRatio(value: number) {
  if (!Number.isFinite(value)) return '∞'
  return value.toFixed(2)
}

function isoDay(dt: Date) {
  return dt.toISOString().slice(0, 10)
}

function prettyDate(dateLike: string) {
  const date = new Date(dateLike)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function average(values: number[]) {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stddev(values: number[]) {
  if (values.length < 2) return null
  const mean = average(values)
  if (mean == null) return null
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function clampRating(value: number, thresholds: [number, number, number]) {
  const [lo, mid, hi] = thresholds
  if (value >= hi) return 'great' as const
  if (value >= mid) return 'good' as const
  if (value >= lo) return 'needs-work' as const
  return 'watch-out' as const
}

function computeDailyReturns(trades: Trade[]) {
  return byDay(trades).map((row) => row.pnl)
}

function computeExtendedMetrics(trades: Trade[]) {
  const dailyReturns = computeDailyReturns(trades)
  const mean = average(dailyReturns)
  const deviation = stddev(dailyReturns)
  const downside = stddev(dailyReturns.filter((value) => value < 0))
  const sharpe = mean != null && deviation != null && deviation > 0 ? mean / deviation : null
  const sortino = mean != null && downside != null && downside > 0 ? mean / downside : null

  const monthly = new Map<string, number>()
  for (const trade of closedTrades(trades)) {
    const dt = trade.exitTime ?? trade.entryTime
    if (!dt) continue
    const bucket = dt.slice(0, 7)
    monthly.set(bucket, (monthly.get(bucket) ?? 0) + (trade.pnl ?? 0))
  }
  const monthlyValues = Array.from(monthly.values())
  const monthlyWinRate =
    monthlyValues.length > 0
      ? (monthlyValues.filter((value) => value > 0).length / monthlyValues.length) * 100
      : null

  return {
    sharpe,
    sortino,
    monthlyWinRate,
    avgDailyPnl: mean,
  } satisfies ExtendedMetrics
}

function computeDrawdownSeries(trades: Trade[]): GraphPoint[] {
  const curve = equityCurve(trades)
  let peak = 0
  return curve.map((point, index) => {
    peak = Math.max(peak, point.cumulativePnl)
    return {
      label: `${index + 1}`,
      value: peak - point.cumulativePnl,
    }
  })
}

function computeMonthlyReturns(trades: Trade[]): GraphPoint[] {
  const monthly = new Map<string, number>()
  for (const trade of closedTrades(trades)) {
    const dt = trade.exitTime ?? trade.entryTime
    if (!dt) continue
    const bucket = dt.slice(0, 7)
    monthly.set(bucket, (monthly.get(bucket) ?? 0) + (trade.pnl ?? 0))
  }
  return Array.from(monthly.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([label, value]) => ({ label, value }))
}

function computeRiskTrend(series: GraphPoint[]) {
  const points: GraphPoint[] = []
  const values: number[] = []
  for (const point of series) {
    values.push(point.value)
    const mean = average(values)
    const deviation = stddev(values)
    const downside = stddev(values.filter((value) => value < 0))
    points.push({
      label: point.label,
      value: mean != null && deviation != null && deviation > 0 ? mean / deviation : 0,
    })
    points.push({
      label: `${point.label}-sortino`,
      value: mean != null && downside != null && downside > 0 ? mean / downside : 0,
    })
  }
  const sharpeTrend: GraphPoint[] = []
  const sortinoTrend: GraphPoint[] = []
  for (let index = 0; index < points.length; index += 2) {
    sharpeTrend.push(points[index])
    sortinoTrend.push(points[index + 1])
  }
  return { sharpeTrend, sortinoTrend }
}

function computeIntradayBuckets(trades: Trade[], day: string): IntradayBucket[] {
  const bucketMap = new Map<string, IntradayBucket>()
  for (const trade of closedTrades(trades)) {
    if (trade.dayOfWeek !== day) continue
    const dt = trade.entryTime ?? trade.exitTime
    if (!dt) continue
    const date = new Date(dt)
    const label = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(date)
    const bucket = bucketMap.get(label) ?? {
      label,
      totalPnl: 0,
      wins: 0,
      losses: 0,
      trades: 0,
    }
    bucket.totalPnl += trade.pnl ?? 0
    bucket.trades += 1
    if (trade.outcome === 'win') bucket.wins += 1
    if (trade.outcome === 'loss') bucket.losses += 1
    bucketMap.set(label, bucket)
  }
  return Array.from(bucketMap.values()).sort((a, b) => (a.label < b.label ? -1 : 1))
}

function selectedDay(days: DayOfWeekRow[]) {
  if (!days.length) return 'Monday'
  return [...days].sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))[0].day
}

function essentialCards(score: ScoreBreakdown, summary: ReturnType<typeof computeSummary>) {
  return [
    {
      label: 'Win Rate',
      value: fmtPct(score.winRate.value),
      rating: score.winRate.rating,
      description: `${summary.nWins}W / ${summary.nLosses}L across ${summary.totalTrades} trades`,
    },
    {
      label: 'Profit Factor',
      value: fmtRatio(score.profitFactor.value),
      rating: score.profitFactor.rating,
      description: 'Gross profits divided by gross losses',
    },
    {
      label: 'Avg Win/Loss',
      value: `${fmtRatio(score.avgWinLoss.value)}x`,
      rating: score.avgWinLoss.rating,
      description: `${fmtCurrency(summary.avgWin)} avg win vs ${fmtCurrency(Math.abs(summary.avgLoss))} avg loss`,
    },
    {
      label: 'Max Drawdown',
      value: fmtCurrency(summary.maxDrawdown),
      rating: score.maxDrawdown.rating,
      description: 'Largest peak-to-trough equity decline',
    },
  ] satisfies ConsistencyMetricCard[]
}

function advancedCards(metrics: ExtendedMetrics, summary: ReturnType<typeof computeSummary>) {
  const sharpe = metrics.sharpe ?? 0
  const sortino = metrics.sortino ?? 0
  const monthlyWinRate = metrics.monthlyWinRate ?? 0
  const avgLossAbs = Math.abs(summary.avgLoss)

  return [
    {
      label: 'Sharpe Ratio',
      value: metrics.sharpe == null ? 'N/A' : sharpe.toFixed(2),
      rating: clampRating(sharpe, [0.2, 0.7, 1.2]),
      description: 'Return per unit of total volatility',
    },
    {
      label: 'Sortino Ratio',
      value: metrics.sortino == null ? 'N/A' : sortino.toFixed(2),
      rating: clampRating(sortino, [0.3, 0.9, 1.5]),
      description: 'Return per unit of downside volatility',
    },
    {
      label: 'Monthly Win %',
      value: metrics.monthlyWinRate == null ? 'N/A' : fmtPct(monthlyWinRate),
      rating: clampRating(monthlyWinRate, [40, 55, 70]),
      description: 'Share of positive P&L months in the YTD range',
    },
    {
      label: 'Average Win',
      value: fmtCurrency(summary.avgWin, 2),
      rating: clampRating(summary.avgWin, [100, 500, 1500]),
      description: 'Average realized gain on winning trades',
    },
    {
      label: 'Average Loss',
      value: fmtCurrency(-avgLossAbs, 2),
      rating: clampRating(-avgLossAbs, [-2000, -800, -300]),
      description: 'Average realized loss on losing trades',
    },
    {
      label: 'Expectancy',
      value: fmtCurrency(summary.expectancy, 2),
      rating: clampRating(summary.expectancy, [0, 200, 600]),
      description: 'Average expected P&L per trade',
    },
  ] satisfies ConsistencyMetricCard[]
}

function countMergedLegs(legs: Trade['executionLegs'], action: 'BUY' | 'SELL'): number {
  if (!legs) return 0
  const buckets = new Set<string>()
  for (const leg of legs) {
    if (leg.action !== action) continue
    const ts = Date.parse(leg.time)
    buckets.add(Number.isNaN(ts) ? leg.time : String(Math.floor(ts / 60000)))
  }
  return buckets.size
}

function buildSpotlightHighlights(trade: Trade, summary: ReturnType<typeof computeSummary>) {
  const entryAction = trade.side === 'short' ? 'SELL' : 'BUY'
  const exitAction = trade.side === 'short' ? 'BUY' : 'SELL'
  const buys = countMergedLegs(trade.executionLegs, entryAction)
  const sells = countMergedLegs(trade.executionLegs, exitAction)
  const peakGap = trade.mfe != null && trade.pnl != null ? trade.mfe - trade.pnl : null
  const drawdown = trade.mae != null ? Math.abs(trade.mae) : null

  const highlights: SpotlightInsight[] = []

  if (sells > 1) {
    highlights.push({
      label: 'Scale Out',
      body: `Closed in ${sells} separate exits, showing active position management.`,
    })
  }

  if (buys > 1) {
    highlights.push({
      label: 'Scale In',
      body: `Built the trade through ${buys} entries instead of one full-size opening fill.`,
    })
  }

  if ((trade.mae ?? 0) < 0 && (trade.pnl ?? 0) > 0) {
    highlights.push({
      label: 'Red To Green',
      body: `Recovered from ${fmtCurrency(drawdown ?? 0, 2)} drawdown and still closed green.`,
    })
  }

  if (peakGap != null && peakGap > Math.abs(trade.pnl ?? 0) * 0.35) {
    highlights.push({
      label: 'Left Money On Table',
      body: `Peak unrealized profit exceeded the close by ${fmtCurrency(peakGap, 2)}.`,
    })
  }

  if ((trade.holdTimeMin ?? 0) > (summary.avgHoldWinMin ?? 0) && (trade.pnl ?? 0) > 0) {
    highlights.push({
      label: 'Extended Hold',
      body: `Held longer than your average winning trade, which amplified the outcome.`,
    })
  }

  if (!highlights.length) {
    highlights.push({
      label: 'Execution Review',
      body: 'This trade stands out on outcome alone and should be reviewed for repeatable process cues.',
    })
  }

  return highlights.slice(0, 6)
}

function toSpotlightTrade(trade: Trade, summary: ReturnType<typeof computeSummary>): SpotlightTrade {
  const date = trade.exitTime ?? trade.entryTime ?? trade.createdAt
  return {
    id: trade.id,
    symbol: trade.symbol,
    date: prettyDate(date),
    pnl: trade.pnl ?? 0,
    side: trade.side,
    scoreLabel: trade.source === 'ibkr' ? 'Imported' : 'CSV',
    stats: [
      { label: 'Side', value: trade.side ?? '—' },
      { label: 'Quantity', value: trade.shares?.toLocaleString('en-US') ?? '—' },
      { label: 'Entry Price', value: trade.entryPrice != null ? fmtCurrency(trade.entryPrice, 2) : '—' },
      { label: 'Exit Price', value: trade.exitPrice != null ? fmtCurrency(trade.exitPrice, 2) : '—' },
      { label: 'Hold Time', value: trade.holdTimeMin != null ? `${Math.round(trade.holdTimeMin)} min` : '—' },
      { label: 'Net ROI', value: trade.pnlPct != null ? fmtPct(trade.pnlPct, 2) : '—' },
      {
        label: 'Price MAE / MFE',
        value:
          trade.mae != null || trade.mfe != null
            ? `${trade.mae != null ? fmtCurrency(trade.mae, 2) : '—'} / ${trade.mfe != null ? fmtCurrency(trade.mfe, 2) : '—'}`
            : '—',
      },
      { label: 'R Multiple', value: trade.rMultiple != null ? trade.rMultiple.toFixed(2) : '—' },
    ],
    highlights: buildSpotlightHighlights(trade, summary),
    executionLegs: trade.executionLegs ?? null,
  }
}

function uniqueTrades(trades: Array<Trade | null | undefined>) {
  const seen = new Set<string>()
  return trades.filter((trade): trade is Trade => {
    if (!trade || seen.has(trade.id)) return false
    seen.add(trade.id)
    return true
  })
}

function selectSpotlightTrades(trades: Trade[]) {
  const closed = closedTrades(trades)
  const worst = [...closed].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))
  const best = [...closed].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
  const managed = [...closed]
    .filter((trade) => (trade.pnl ?? 0) > 0)
    .sort((a, b) => {
      const aScore =
        (a.executionLegs?.length ?? 0) * 100 +
        (a.mfe ?? 0) * 0.1 +
        (a.pnl ?? 0)
      const bScore =
        (b.executionLegs?.length ?? 0) * 100 +
        (b.mfe ?? 0) * 0.1 +
        (b.pnl ?? 0)
      return bScore - aScore
    })

  return uniqueTrades([worst[0], worst[1], best[0], managed[0]])
}

async function generateInsight(
  input: InsightInput,
  supabase: SupabaseClient,
  userId: string,
) {
  const cacheKey = ['report-insight', input.key].join('|')
  const cached = await getCachedAnalysis<ReportInsight>(supabase, userId, cacheKey)
  if (cached) return cached

  const llm = await runLlmText(input.prompt)
  const insight: ReportInsight = llm
    ? {
        title: input.title,
        body: llm.text,
        mode: 'llm',
        provider: llm.provider,
      }
    : {
        title: input.title,
        body: input.fallback,
        mode: 'fallback',
        provider: 'fallback',
      }

  await setCachedAnalysis(supabase, userId, cacheKey, insight)
  return insight
}

function buildInsightInputs(args: {
  year: number
  summary: ReturnType<typeof computeSummary>
  dayRows: DayOfWeekRow[]
  selectedDay: string
  intradayByDay: Record<string, IntradayBucket[]>
  score: ScoreBreakdown
  patterns: TradePattern[]
  extended: ExtendedMetrics
  spotlights: SpotlightTrade[]
}) {
  const {
    year,
    summary,
    dayRows,
    selectedDay,
    intradayByDay,
    score,
    patterns,
    extended,
    spotlights,
  } = args

  const topDay = [...dayRows].sort((a, b) => b.totalPnl - a.totalPnl)[0]
  const weakDay = [...dayRows].sort((a, b) => a.totalPnl - b.totalPnl)[0]
  const intraday = intradayByDay[selectedDay] ?? []
  const biggestBucket = [...intraday].sort((a, b) => Math.abs(b.totalPnl) - Math.abs(a.totalPnl))[0]

  const inputs: InsightInput[] = [
    {
      key: `${year}|day-of-week|${simpleHash(JSON.stringify({ dayRows, selectedDay, intraday }))}`,
      title: 'Key Takeaway',
      prompt: [
        'You are analyzing a trading performance recap slide.',
        'Write one concise key takeaway in 2 sentences max.',
        'Focus on the strongest pattern, the biggest risk, and one direct action.',
        '',
        `Top day: ${topDay?.day ?? 'N/A'} ${topDay ? fmtCurrency(topDay.totalPnl) : 'N/A'}`,
        `Weakest day: ${weakDay?.day ?? 'N/A'} ${weakDay ? fmtCurrency(weakDay.totalPnl) : 'N/A'}`,
        `Selected day for intraday view: ${selectedDay}`,
        `Most meaningful intraday bucket: ${biggestBucket?.label ?? 'N/A'} ${biggestBucket ? fmtCurrency(biggestBucket.totalPnl) : 'N/A'}`,
        `Trade count: ${summary.totalTrades}`,
      ].join('\n'),
      fallback:
        topDay && weakDay
          ? `Your P&L is concentrated around ${topDay.day} strength and ${weakDay.day} weakness, with ${selectedDay} showing the clearest intraday swings. Lean into the day/time combinations that already pay you and cut size or tighten rules on the sessions that repeatedly drag the year down.`
          : 'Your weekday performance is still sparse, so the main priority is building more clean samples before locking in any schedule-based edge.',
    },
    {
      key: `${year}|consistency|${simpleHash(JSON.stringify({ score, summary, extended }))}`,
      title: 'Key Takeaway',
      prompt: [
        'You are analyzing a trading consistency dashboard.',
        'Write one concise key takeaway in 2 sentences max.',
        'Use direct language and mention the most important fix first.',
        '',
        `Win rate: ${fmtPct(score.winRate.value)}`,
        `Profit factor: ${fmtRatio(score.profitFactor.value)}`,
        `Avg win/loss ratio: ${fmtRatio(score.avgWinLoss.value)}x`,
        `Max drawdown: ${fmtCurrency(summary.maxDrawdown)}`,
        `Expectancy: ${fmtCurrency(summary.expectancy, 2)}`,
        `Sharpe: ${extended.sharpe?.toFixed(2) ?? 'N/A'}`,
        `Sortino: ${extended.sortino?.toFixed(2) ?? 'N/A'}`,
      ].join('\n'),
      fallback:
        summary.expectancy >= 0
          ? 'The system is viable, but the main lever now is smoothing the equity curve by protecting drawdowns and repeating the setups that already produce your positive expectancy.'
          : 'The account is losing through a combination of weak expectancy and poor drawdown control. Fix loss containment first, then narrow trade selection until profit factor and expectancy move back above the line.',
    },
    {
      key: `${year}|patterns|${simpleHash(JSON.stringify(patterns))}`,
      title: 'Key Takeaway',
      prompt: [
        'You are analyzing recurring trading patterns from a recap deck.',
        'Write one concise key takeaway in 2 sentences max.',
        'Call out one strength, one warning, and one process adjustment.',
        '',
        JSON.stringify(patterns.slice(0, 5), null, 2),
      ].join('\n'),
      fallback:
        patterns.length > 0
          ? `The year is being shaped by ${patterns[0].name.toLowerCase()} behavior more than anything else, so that pattern deserves explicit review rules. Keep the helpful patterns repeatable and write a hard guardrail for the warning pattern that shows up most often.`
          : 'There are not enough closed trades yet to identify a stable pattern set, so the priority is logging more consistent executions.',
    },
    {
      key: `${year}|score|${simpleHash(JSON.stringify(score))}`,
      title: 'Key Takeaway',
      prompt: [
        'You are summarizing an overall trading score slide.',
        'Write one concise key takeaway in 2 sentences max.',
        'Interpret the score as a system-health snapshot and give the next priority.',
        '',
        `Overall score: ${score.overall.toFixed(1)} / 100`,
        JSON.stringify(score, null, 2),
      ].join('\n'),
      fallback:
        `Your current score reflects a system that ${score.overall >= 65 ? 'has a workable edge but needs cleaner execution' : 'still needs structural work before it can compound reliably'}. The next gain will come from improving the weakest two metrics instead of trying to optimize everything at once.`,
    },
    ...spotlights.map((spotlight, index) => ({
      key: `${year}|spotlight|${spotlight.id}|${simpleHash(JSON.stringify(spotlight))}`,
      title: 'Key Takeaway',
      prompt: [
        'You are reviewing one standout trade from a yearly recap.',
        'Write exactly two short paragraphs.',
        'Paragraph 1: what this trade says about the trader.',
        'Paragraph 2: what to repeat or fix next time.',
        '',
        JSON.stringify(spotlight, null, 2),
      ].join('\n'),
      fallback:
        index < 2
          ? `${spotlight.symbol} is a high-impact loser that deserves a rule-level postmortem because one trade like this can distort the whole year.\n\nIdentify the sizing, timing, or exit failure that made the downside oversized, then turn that into a hard pre-trade or intraday stop rule.`
          : `${spotlight.symbol} shows the kind of trade management that can lift the whole year when executed consistently.\n\nKeep the repeatable parts of the entry and management process, but tighten the exit plan so strong trades keep more of their peak opportunity.`,
    })),
    {
      key: `${year}|closing|${simpleHash(JSON.stringify({ tradeCount: summary.totalTrades, expectancy: summary.expectancy }))}`,
      title: 'Next Move',
      prompt: [
        'You are writing the closing note for a trading recap deck.',
        'Write one concise motivational-but-practical paragraph.',
        'No fluff. Focus on the next review cycle.',
        '',
        `Trade count: ${summary.totalTrades}`,
        `Expectancy: ${fmtCurrency(summary.expectancy, 2)}`,
      ].join('\n'),
      fallback:
        'This report is a starting point, not a verdict. Regenerate it after your next review cycle and judge progress by whether the same weak spots stop repeating.',
    },
  ]

  return inputs
}

export async function buildReportRecap(
  trades: Trade[],
  opts: { now?: Date; refresh?: boolean; supabase: SupabaseClient; userId: string },
): Promise<ReportRecap> {
  const now = opts?.now ?? new Date()
  const year = now.getFullYear()
  const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0))
  const endIso = now.toISOString()
  const ytdTrades = closedTrades(trades).filter((trade) => {
    const dt = trade.exitTime ?? trade.entryTime
    if (!dt) return false
    return dt >= start.toISOString() && dt <= endIso
  })

  const datasetFingerprint = simpleHash(
    JSON.stringify(
      ytdTrades.map((trade) => ({
        id: trade.id,
        updated: trade.createdAt,
        pnl: trade.pnl,
        outcome: trade.outcome,
        exitTime: trade.exitTime,
        entryTime: trade.entryTime,
        mfe: trade.mfe,
        mae: trade.mae,
        executionLegs: trade.executionLegs,
      })),
    ),
  )
  const cacheKey = `report-recap|${year}|${datasetFingerprint}`
  const cached = !opts?.refresh ? await getCachedAnalysis<ReportRecap>(opts.supabase, opts.userId, cacheKey) : null
  if (cached) {
    return {
      ...cached,
      cached: true,
    }
  }

  const summary = computeSummary(ytdTrades)
  const score = computePerformanceScore(summary)
  const patterns = detectTradingPatterns(ytdTrades).slice(0, 5)
  const dayRows = computeDayOfWeekDetail(ytdTrades)
  const chosenDay = selectedDay(dayRows)
  const intradayByDay = Object.fromEntries(
    dayRows.map((row) => [row.day, computeIntradayBuckets(ytdTrades, row.day)]),
  )
  const extended = computeExtendedMetrics(ytdTrades)
  const monthlyReturns = computeMonthlyReturns(ytdTrades)
  const riskTrend = computeRiskTrend(monthlyReturns)
  const spotlightTrades = selectSpotlightTrades(ytdTrades).map((trade) => toSpotlightTrade(trade, summary))
  const insightInputs = buildInsightInputs({
    year,
    summary,
    dayRows,
    selectedDay: chosenDay,
    intradayByDay,
    score,
    patterns,
    extended,
    spotlights: spotlightTrades,
  })
  const insights = await Promise.all(insightInputs.map((input) => generateInsight(input, opts.supabase, opts.userId)))
  const insightByIndex = (index: number) => insights[index]
  let insightOffset = 0

  const slides: ReportSlide[] = [
    {
      id: 'day-of-week',
      type: 'day-of-week',
      eyebrow: 'Pattern Detected',
      title: 'Your day of week performance',
      subtitle: 'P&L by weekday with intraday context for the biggest outlier session.',
      insight: insightByIndex(insightOffset++),
      data: {
        days: dayRows,
        selectedDay: chosenDay,
        intradayByDay,
      },
    },
    {
      id: 'consistency',
      type: 'consistency',
      eyebrow: 'Trading Consistency',
      title: 'Your Trading Consistency Dashboard',
      subtitle: 'Essential stats, advanced risk measures, and trend graphs for the YTD system.',
      insight: insightByIndex(insightOffset++),
      data: {
        score,
        essential: essentialCards(score, summary),
        advanced: advancedCards(extended, summary),
        graphs: {
          equityCurve: equityCurve(ytdTrades).map((point) => ({
            label: `${point.tradeNum}`,
            value: point.cumulativePnl,
          })),
          drawdowns: computeDrawdownSeries(ytdTrades),
          monthlyReturns,
          sharpeTrend: riskTrend.sharpeTrend,
          sortinoTrend: riskTrend.sortinoTrend,
        },
      },
    },
    {
      id: 'patterns',
      type: 'patterns',
      eyebrow: 'Trading Patterns',
      title: `Top ${Math.max(patterns.length, 1)} patterns detected across ${summary.totalTrades} trades`,
      subtitle: 'Behavioral patterns ranked by how often they show up in closed trades.',
      insight: insightByIndex(insightOffset++),
      data: {
        patterns,
      },
    },
    {
      id: 'score',
      type: 'score',
      eyebrow: 'Performance Metrics',
      title: 'Your performance score',
      subtitle: 'A compact system-health snapshot built from win rate, expectancy, drawdown, and payoff quality.',
      insight: insightByIndex(insightOffset++),
      data: {
        overall: score.overall,
        score20: Number((score.overall / 5).toFixed(2)),
        breakdown: [
          { label: 'Win Rate', value: fmtPct(score.winRate.value), rating: score.winRate.rating },
          { label: 'Profit Factor', value: fmtRatio(score.profitFactor.value), rating: score.profitFactor.rating },
          { label: 'Avg Win/Loss', value: `${fmtRatio(score.avgWinLoss.value)}x`, rating: score.avgWinLoss.rating },
          { label: 'Max Drawdown', value: fmtCurrency(summary.maxDrawdown), rating: score.maxDrawdown.rating },
          { label: 'Expectancy', value: fmtCurrency(summary.expectancy, 2), rating: score.expectancy.rating },
        ],
      },
    },
    ...spotlightTrades.map((trade, index) => ({
      id: `spotlight-${trade.id}`,
      type: 'spotlight' as const,
      eyebrow: trade.symbol,
      title: trade.date,
      subtitle: `${fmtCurrency(trade.pnl, 2)} • ${trade.scoreLabel}`,
      insight: insightByIndex(insightOffset + index),
      data: trade,
    })),
  ]
  insightOffset += spotlightTrades.length

  slides.push({
    id: 'closing',
    type: 'closing',
    eyebrow: 'Recap Complete',
    title: 'This report is your current YTD snapshot',
    subtitle: 'Regenerate after your next review cycle to see whether the same strengths and failures still dominate.',
    insight: insightByIndex(insightOffset),
    data: {
      message:
        'Keep iterating on the same process, then rerun the report to confirm that the equity curve, expectancy, and risk behavior are actually changing.',
    },
  })

  const recap: ReportRecap = {
    year,
    tradeCount: summary.totalTrades,
    rangeStart: isoDay(start),
    rangeEnd: isoDay(now),
    rangeLabel: `${prettyDate(start.toISOString())} - ${prettyDate(now.toISOString())}`,
    generatedAt: now.toISOString(),
    cached: false,
    slides,
  }

  await setCachedAnalysis(opts.supabase, opts.userId, cacheKey, recap)
  return recap
}
