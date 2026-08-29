'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'

import type {
  ConsistencyMetricCard,
  GraphPoint,
  IntradayBucket,
  ReportRecap,
  ReportSlide,
  SpotlightTrade,
} from '@/lib/report-recap-types'
import type { ExecutionLeg } from '@/types/trade'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

function fmtCurrency(value: number, digits = 0) {
  const abs = Math.abs(value)
  const text = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return `${value < 0 ? '-' : ''}$${text}`
}

function ratingTone(rating: string) {
  switch (rating) {
    case 'great':
      return 'border-emerald-400/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200'
    case 'good':
      return 'border-cyan-400/40 bg-cyan-50 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-100'
    case 'needs-work':
      return 'border-amber-400/40 bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-100'
    default:
      return 'border-rose-400/40 bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-100'
  }
}

function chartColor(value: number) {
  return value >= 0 ? '#41d19b' : '#ff6b6b'
}

function numberValue(value: number | string | readonly (number | string)[] | undefined) {
  if (Array.isArray(value)) return numberValue(value[0])
  return typeof value === 'number' ? value : Number(value ?? 0)
}

function cleanInsightBody(body: string) {
  return body
    .replace(/\*\*/g, '')
    .replace(/^Key Takeaway:\s*/i, '')
    .replace(/^Next Move:\s*/i, '')
    .trim()
}

async function postGenerate(refresh: boolean) {
  const response = await fetch('/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })

  const json = (await response.json()) as ReportRecap | { error?: string }
  if (!response.ok) {
    throw new Error('error' in json ? json.error || 'Failed to generate report' : 'Failed to generate report')
  }

  return json as ReportRecap
}

interface ChartColors {
  grid: string
  tick: string
  tooltipBg: string
  tooltipBorder: string
  tooltipColor: string
  refLine: string
}

const ChartTheme = createContext<ChartColors>({
  grid: 'rgba(255,255,255,0.08)',
  tick: 'rgba(255,255,255,0.55)',
  tooltipBg: '#130f1d',
  tooltipBorder: 'rgba(255,255,255,0.12)',
  tooltipColor: '#fff',
  refLine: 'rgba(255,255,255,0.18)',
})

function InsightCard({
  title,
  body,
  provider,
}: {
  title: string
  body: string
  provider: string
}) {
  return (
    <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-[0_20px_80px_rgba(245,158,11,0.06)] dark:border-[#7b6422]/55 dark:bg-[linear-gradient(180deg,rgba(73,55,16,0.36),rgba(56,43,13,0.2))] dark:text-amber-50">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-200/85">
        <Sparkles className="size-3.5" />
        {title}
        <span className="ml-auto normal-case tracking-normal text-[10px] text-amber-600 dark:text-amber-100/60">
          {provider === 'fallback' ? 'Rule-based' : `AI • ${provider}`}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-sm leading-6 text-amber-800 dark:text-amber-50/90">{cleanInsightBody(body)}</div>
    </div>
  )
}

function buildRunningPnl(legs: ExecutionLeg[]): { label: string; value: number }[] {
  const sorted = [...legs].sort((a, b) => a.time.localeCompare(b.time))
  let cumulative = 0
  let sharesHeld = 0
  let avgEntry = 0
  const points: { label: string; value: number }[] = []
  for (const leg of sorted) {
    const t = new Date(leg.time)
    const label = `${t.getMonth() + 1}/${t.getDate()}`
    if (leg.action === 'BUY') {
      const totalCost = avgEntry * sharesHeld + leg.price * leg.shares
      sharesHeld += leg.shares
      avgEntry = sharesHeld > 0 ? totalCost / sharesHeld : 0
    } else {
      cumulative += (leg.price - avgEntry) * leg.shares
      sharesHeld = Math.max(0, sharesHeld - leg.shares)
    }
    points.push({ label, value: cumulative })
  }
  return points
}

function SlideScaffold({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="rounded-[22px] border border-stone-200 bg-white px-5 py-5 shadow-[0_32px_120px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-[rgba(24,24,28,0.98)] dark:shadow-[0_32px_120px_rgba(0,0,0,0.5)] lg:px-6 lg:py-6">
      <div className="mb-3">
        <div className="mb-2 inline-flex rounded-lg border border-stone-200 bg-stone-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:border-white/10 dark:bg-white/8 dark:text-white/60">
          {eyebrow}
        </div>
        <h3 className="text-[22px] font-medium tracking-[-0.02em] text-stone-900 dark:text-white lg:text-[26px]">{title}</h3>
        {subtitle ? <p className="mt-1 max-w-3xl text-xs leading-5 text-stone-500 dark:text-white/56">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  )
}

function DayOfWeekSlide({ slide }: { slide: Extract<ReportSlide, { type: 'day-of-week' }> }) {
  const [activeDay, setActiveDay] = useState(slide.data.selectedDay)
  const activeRows: IntradayBucket[] = slide.data.intradayByDay[activeDay] ?? []
  const orderedDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const rowsByDay = new Map(slide.data.days.map((row) => [row.day, row]))
  const displayRows = orderedDays.map((day) => rowsByDay.get(day) ?? { day, wins: 0, losses: 0, trades: 0, totalPnl: 0, winRate: 0 })
  const ct = useContext(ChartTheme)

  return (
    <SlideScaffold eyebrow={slide.eyebrow} title={slide.title} subtitle={slide.subtitle}>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-1">
          <div className="mb-1.5 text-xs text-amber-700 dark:text-amber-200">P&amp;L by Day of Week <span className="text-amber-600 dark:text-amber-300">- Click on each day</span></div>
          {displayRows.map((row) => (
            <button
              key={row.day}
              type="button"
              onClick={() => setActiveDay(row.day)}
              className={cn(
                'flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition-colors',
                activeDay === row.day
                  ? 'border-amber-300 bg-amber-50 dark:border-[#8f7230] dark:bg-[#2f2922]'
                  : 'border-transparent bg-transparent hover:bg-stone-50 dark:hover:bg-white/[0.04]',
              )}
            >
              <div className="flex items-center gap-2">
                {activeDay === row.day ? <ChevronRight className="size-3.5 text-[#c8a73c]" /> : <span className="w-3.5" />}
                <div className="text-sm font-medium text-stone-900 dark:text-white">{row.day}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className={cn('text-sm font-semibold tabular-nums', row.totalPnl >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
                  {fmtCurrency(row.totalPnl)}
                </div>
                <div className="min-w-10 text-right text-xs">
                  <div className="text-emerald-600 dark:text-emerald-300">{row.wins}W</div>
                  <div className="text-rose-600 dark:text-rose-300">{row.losses}L</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="rounded-[18px] border border-stone-200 bg-stone-50 p-3 dark:border-white/6 dark:bg-white/[0.04] lg:p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="text-xs text-stone-400 dark:text-white/52">Entry Time on {activeDay}</div>
              <div className="text-sm font-medium text-stone-900 dark:text-white">Intraday P&amp;L distribution</div>
            </div>
            <div className="text-xs text-stone-400 dark:text-white/45">{activeRows.length} buckets</div>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activeRows} margin={{ top: 12, right: 8, left: 6, bottom: 14 }}>
                <CartesianGrid strokeDasharray="4 4" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: ct.tick, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value: number) => fmtCurrency(value)} tick={{ fill: ct.tick, fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
                <Tooltip
                  cursor={{ fill: 'rgba(128,128,128,0.08)' }}
                  contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 16, color: ct.tooltipColor }}
                  formatter={(value) => [fmtCurrency(numberValue(value), 2), 'Total P&L']}
                />
                <ReferenceLine y={0} stroke={ct.refLine} />
                <Bar dataKey="totalPnl" radius={[8, 8, 0, 0]}>
                  {activeRows.map((row) => (
                    <Cell key={row.label} fill={chartColor(row.totalPnl)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!activeRows.length ? <p className="mt-3 text-sm text-stone-400 dark:text-white/50">No intraday buckets available for this day yet.</p> : null}
        </div>
      </div>
      <div className="mt-4">
        <InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} />
      </div>
    </SlideScaffold>
  )
}

function MetricGrid({ cards }: { cards: ConsistencyMetricCard[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className={cn('rounded-[16px] border p-3', ratingTone(card.rating))}>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-60">{card.label}</div>
            <div className="rounded-full border border-current/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.15em]">
              {card.rating}
            </div>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{card.value}</div>
          <p className="mt-1 text-xs leading-5 opacity-70">{card.description}</p>
        </div>
      ))}
    </div>
  )
}

function GraphPanel({
  title,
  data,
  type,
}: {
  title: string
  data: GraphPoint[]
  type: 'area' | 'bar' | 'line'
}) {
  const ct = useContext(ChartTheme)
  return (
    <div className="rounded-[16px] border border-stone-200 bg-stone-50 p-3 dark:border-white/8 dark:bg-white/[0.04]">
      <div className="mb-2 text-xs font-medium text-stone-600 dark:text-white/75">{title}</div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'area' ? (
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke={ct.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: ct.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: ct.tick, fontSize: 11 }} tickFormatter={(value: number) => fmtCurrency(value)} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 16, color: ct.tooltipColor }}
                formatter={(value) => [fmtCurrency(numberValue(value), 2), title]}
              />
              <Area type="monotone" dataKey="value" stroke="#6ee7b7" fill="rgba(110,231,183,0.2)" strokeWidth={2} />
            </AreaChart>
          ) : type === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke={ct.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: ct.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: ct.tick, fontSize: 11 }} tickFormatter={(value: number) => fmtCurrency(value)} axisLine={false} tickLine={false} width={70} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 16, color: ct.tooltipColor }}
                formatter={(value) => [fmtCurrency(numberValue(value), 2), title]}
              />
              <ReferenceLine y={0} stroke={ct.refLine} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {data.map((point) => (
                  <Cell key={point.label} fill={chartColor(point.value)} />
                ))}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="4 4" stroke={ct.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: ct.tick, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: ct.tick, fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 16, color: ct.tooltipColor }}
                formatter={(value) => [numberValue(value).toFixed(2), title]}
              />
              <ReferenceLine y={0} stroke={ct.refLine} />
              <Line type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2.25} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function ConsistencySlide({ slide }: { slide: Extract<ReportSlide, { type: 'consistency' }> }) {
  return (
    <SlideScaffold eyebrow={slide.eyebrow} title={slide.title} subtitle={slide.subtitle}>
      <Tabs defaultValue="essential" className="gap-3">
        <TabsList variant="line" className="justify-start gap-2 text-stone-500 dark:text-white/50">
          <TabsTrigger value="essential" className="max-w-fit px-3 text-stone-600 dark:text-white/70 data-[state=active]:text-stone-900 dark:data-[state=active]:text-white">Essential Stats</TabsTrigger>
          <TabsTrigger value="advanced" className="max-w-fit px-3 text-stone-600 dark:text-white/70 data-[state=active]:text-stone-900 dark:data-[state=active]:text-white">Advanced Stats</TabsTrigger>
          <TabsTrigger value="graphs" className="max-w-fit px-3 text-stone-600 dark:text-white/70 data-[state=active]:text-stone-900 dark:data-[state=active]:text-white">Graphs</TabsTrigger>
        </TabsList>
        <TabsContent value="essential"><MetricGrid cards={slide.data.essential} /></TabsContent>
        <TabsContent value="advanced"><MetricGrid cards={slide.data.advanced} /></TabsContent>
        <TabsContent value="graphs">
          <div className="grid gap-3 xl:grid-cols-2">
            <GraphPanel title="P&L Curve" data={slide.data.graphs.equityCurve} type="area" />
            <GraphPanel title="Drawdowns" data={slide.data.graphs.drawdowns} type="bar" />
            <GraphPanel title="Monthly Returns" data={slide.data.graphs.monthlyReturns} type="bar" />
            <GraphPanel title="Sharpe Ratio Trend" data={slide.data.graphs.sharpeTrend} type="line" />
            <GraphPanel title="Sortino Ratio Trend" data={slide.data.graphs.sortinoTrend} type="line" />
          </div>
        </TabsContent>
      </Tabs>
      <div className="mt-3"><InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} /></div>
    </SlideScaffold>
  )
}

function PatternsSlide({ slide }: { slide: Extract<ReportSlide, { type: 'patterns' }> }) {
  return (
    <SlideScaffold eyebrow={slide.eyebrow} title={slide.title} subtitle={slide.subtitle}>
      <div className="grid gap-3 xl:grid-cols-2">
        {slide.data.patterns.map((pattern) => (
          <div key={pattern.name} className="rounded-[16px] border border-stone-200 bg-stone-50 p-3 dark:border-white/8 dark:bg-white/[0.04]">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-stone-900 dark:text-white">{pattern.name}</div>
              <div className={cn('rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em]', ratingTone(pattern.status === 'strength' ? 'great' : pattern.status === 'warning' ? 'watch-out' : 'needs-work'))}>
                {pattern.status}
              </div>
            </div>
            <p className="text-xs leading-5 text-stone-500 dark:text-white/60">{pattern.description}</p>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-white/8">
              <div className={cn('h-full rounded-full', pattern.status === 'strength' ? 'bg-emerald-400' : pattern.status === 'warning' ? 'bg-rose-400' : 'bg-amber-300')} style={{ width: `${Math.min(pattern.percentage, 100)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-stone-400 dark:text-white/55">
              <span>{pattern.count} trades</span>
              <span className="tabular-nums">{pattern.percentage.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3"><InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} /></div>
    </SlideScaffold>
  )
}

function ScoreSlide({ slide }: { slide: Extract<ReportSlide, { type: 'score' }> }) {
  const ct = useContext(ChartTheme)
  const pct = Math.max(0, Math.min(100, slide.data.overall))
  const radius = 86
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct / 100)

  return (
    <SlideScaffold eyebrow={slide.eyebrow} title={slide.title} subtitle={slide.subtitle}>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-[18px] border border-stone-200 bg-stone-50 p-4 dark:border-white/8 dark:bg-white/[0.04]">
          <div className="relative flex h-40 w-40 items-center justify-center">
            <svg viewBox="0 0 220 220" className="w-full h-full -rotate-90">
              <circle cx="110" cy="110" r={radius} fill="none" stroke={ct.grid} strokeWidth="18" />
              <circle cx="110" cy="110" r={radius} fill="none" stroke="#fbbf24" strokeWidth="18" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-3xl font-semibold text-stone-900 dark:text-white">{slide.data.score20.toFixed(2)}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-stone-400 dark:text-white/45">out of 20</div>
            </div>
          </div>
          <div className="mt-2 text-center">
            <div className="text-[10px] uppercase tracking-[0.25em] text-stone-400 dark:text-white/45">System Score</div>
            <div className="mt-1 text-base font-medium text-stone-900 dark:text-white">{slide.data.overall.toFixed(1)} / 100</div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {slide.data.breakdown.map((item) => (
            <div key={item.label} className={cn('rounded-[16px] border p-3', ratingTone(item.rating))}>
              <div className="text-[10px] uppercase tracking-[0.2em] opacity-60">{item.label}</div>
              <div className="mt-2 text-xl font-semibold">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3"><InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} /></div>
    </SlideScaffold>
  )
}

function SpotlightSlide({ slide }: { slide: Extract<ReportSlide, { type: 'spotlight' }> }) {
  const ct = useContext(ChartTheme)
  const trade: SpotlightTrade = slide.data
  const runningPnl = trade.executionLegs?.length ? buildRunningPnl(trade.executionLegs) : []
  const finalValue = runningPnl.at(-1)?.value ?? trade.pnl
  const lineColor = finalValue >= 0 ? '#41d19b' : '#ff6b6b'
  const fillColor = finalValue >= 0 ? 'rgba(65,209,155,0.15)' : 'rgba(255,107,107,0.15)'

  return (
    <SlideScaffold eyebrow={trade.symbol} title={slide.title} subtitle={slide.subtitle}>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[18px] border border-stone-200 bg-stone-50 p-4 dark:border-white/8 dark:bg-white/[0.04]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-semibold text-stone-900 dark:text-white">{trade.symbol}</div>
              <div className="mt-1 text-xs text-stone-400 dark:text-white/55">{trade.date}</div>
            </div>
            <div className={cn('rounded-xl px-3 py-2 text-right', trade.pnl >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200')}>
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">Net P&amp;L</div>
              <div className="mt-0.5 text-xl font-semibold">{fmtCurrency(trade.pnl, 2)}</div>
            </div>
          </div>
          {runningPnl.length > 1 && (
            <div className="mb-3 h-28">
              <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-stone-400 dark:text-white/45">Running P&amp;L</div>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={runningPnl} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="4 4" stroke={ct.grid} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: ct.tick, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => fmtCurrency(numberValue(v))} tick={{ fill: ct.tick, fontSize: 10 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip
                    contentStyle={{ background: ct.tooltipBg, border: `1px solid ${ct.tooltipBorder}`, borderRadius: 10, color: ct.tooltipColor, fontSize: 11 }}
                    formatter={(v) => [fmtCurrency(numberValue(v), 2), 'P&L']}
                  />
                  <ReferenceLine y={0} stroke={ct.refLine} />
                  <Area type="monotone" dataKey="value" stroke={lineColor} fill={fillColor} strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="grid gap-2 md:grid-cols-2">
            {trade.stats.map((stat) => (
              <div key={stat.label} className="rounded-[12px] border border-stone-200 bg-stone-100 px-3 py-2 dark:border-white/8 dark:bg-black/15">
                <div className="text-[10px] uppercase tracking-[0.15em] text-stone-400 dark:text-white/45">{stat.label}</div>
                <div className="mt-1 text-sm font-medium text-stone-900 dark:text-white">{stat.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Link href={`/trades/${trade.id}?from=report`} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-600 dark:text-amber-200 dark:hover:text-amber-100">
              Open trade details
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-[18px] border border-stone-200 bg-stone-50 p-4 dark:border-white/8 dark:bg-white/[0.04]">
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400 dark:text-white/50">Insights</div>
            <div className="space-y-2">
              {trade.highlights.map((highlight) => (
                <div key={highlight.label} className="rounded-[12px] border border-stone-200 bg-stone-100 px-3 py-2 dark:border-white/8 dark:bg-black/15">
                  <div className="text-xs font-medium text-stone-900 dark:text-white">{highlight.label}</div>
                  <div className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-white/65">{highlight.body}</div>
                </div>
              ))}
            </div>
          </div>
          <InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} />
        </div>
      </div>
    </SlideScaffold>
  )
}

function ClosingSlide({ slide }: { slide: Extract<ReportSlide, { type: 'closing' }> }) {
  return (
    <SlideScaffold eyebrow={slide.eyebrow} title={slide.title} subtitle={slide.subtitle}>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[18px] border border-stone-200 bg-stone-50 p-4 dark:border-white/8 dark:bg-white/[0.04]">
          <div className="max-w-2xl text-sm leading-7 text-stone-600 dark:text-white/75">{slide.data.message}</div>
        </div>
        <InsightCard title={slide.insight.title} body={slide.insight.body} provider={slide.insight.provider} />
      </div>
    </SlideScaffold>
  )
}

function SlideRenderer({ slide }: { slide: ReportSlide }) {
  switch (slide.type) {
    case 'day-of-week': return <DayOfWeekSlide slide={slide} />
    case 'consistency': return <ConsistencySlide slide={slide} />
    case 'patterns': return <PatternsSlide slide={slide} />
    case 'score': return <ScoreSlide slide={slide} />
    case 'spotlight': return <SpotlightSlide slide={slide} />
    case 'closing': return <ClosingSlide slide={slide} />
    default: return null
  }
}

export function ReportDeckScreen({ initialRefresh = false }: { initialRefresh?: boolean }) {
  const [recap, setRecap] = useState<ReportRecap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  const chartColors: ChartColors = isDark
    ? {
        grid: 'rgba(255,255,255,0.08)',
        tick: 'rgba(255,255,255,0.55)',
        tooltipBg: '#130f1d',
        tooltipBorder: 'rgba(255,255,255,0.12)',
        tooltipColor: '#fff',
        refLine: 'rgba(255,255,255,0.18)',
      }
    : {
        grid: 'rgba(0,0,0,0.07)',
        tick: 'rgba(0,0,0,0.45)',
        tooltipBg: '#ffffff',
        tooltipBorder: 'rgba(0,0,0,0.12)',
        tooltipColor: '#111',
        refLine: 'rgba(0,0,0,0.12)',
      }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        const next = await postGenerate(initialRefresh)
        if (cancelled) return
        setRecap(next)
        setActiveIndex(0)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialRefresh])

  const activeSlide = recap?.slides[activeIndex] ?? null

  const refresh = async () => {
    try {
      setLoading(true)
      setError(null)
      const next = await postGenerate(true)
      setRecap(next)
      setActiveIndex(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <ChartTheme.Provider value={chartColors}>
      <div className="fixed inset-0 z-[200] bg-gray-50 text-stone-900 dark:bg-[#0f0f11] dark:text-white">
        {loading && !recap ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <RefreshCw className="size-8 animate-spin text-amber-500/80 dark:text-amber-300/80" />
            <p className="text-sm text-stone-400 dark:text-white/55">Generating your report…</p>
          </div>
        ) : error && !recap ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-lg text-rose-600 dark:text-rose-200">{error}</div>
            <Link href="/report"><Button variant="outline">Back to Report</Button></Link>
          </div>
        ) : recap && activeSlide ? (
          <div className="flex h-full min-h-0 flex-col">
            <div className="shrink-0 px-6 pb-3 pt-5 lg:px-10 lg:pt-7">
              <div className="relative text-center">
                <h1 className="text-[22px] font-medium tracking-[-0.02em] text-stone-900 dark:text-white lg:text-[30px]">What your trade data reveals</h1>
                <p className="mt-1.5 text-sm text-stone-500 dark:text-white/50">{recap.tradeCount} trades • {recap.rangeLabel}</p>
                <div className="mt-5 flex items-center justify-center gap-2">
                  {recap.slides.map((slide, index) => (
                    <button
                      key={slide.id}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      className={cn('h-2.5 rounded-full transition-all', index === activeIndex ? 'w-7 bg-[#dbb43c]' : 'w-2.5 bg-[#57c15d] hover:bg-[#7edb83]')}
                      aria-label={`Go to slide ${index + 1}`}
                    />
                  ))}
                </div>
                <div className="absolute right-0 top-0 flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-white/85 dark:hover:bg-white/10 dark:hover:text-white" onClick={() => void refresh()} disabled={loading}>
                    <RefreshCw className={cn('size-5', loading && 'animate-spin')} />
                  </Button>
                  <Link href="/report">
                    <Button variant="ghost" size="icon" className="text-stone-400 hover:bg-stone-100 hover:text-stone-900 dark:text-[#9a91c6] dark:hover:bg-white/10 dark:hover:text-white">
                      <X className="size-6" />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-y-0 left-0 right-0 hidden items-center justify-between px-5 pointer-events-none lg:flex">
                <div className="w-16">
                  {activeIndex > 0 ? (
                    <button
                      type="button"
                      onClick={() => setActiveIndex((value) => Math.max(0, value - 1))}
                      className="pointer-events-auto rounded-[18px] border border-stone-200 bg-white/80 p-3 text-stone-600 backdrop-blur-sm transition hover:bg-stone-50 dark:border-white/15 dark:bg-white/6 dark:text-white/85 dark:hover:bg-white/12"
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="size-8" />
                    </button>
                  ) : null}
                </div>
                <div className="w-16 text-right">
                  {activeIndex < recap.slides.length - 1 ? (
                    <button
                      type="button"
                      onClick={() => setActiveIndex((value) => Math.min(recap.slides.length - 1, value + 1))}
                      className="pointer-events-auto rounded-[18px] border border-stone-200 bg-white/80 p-3 text-stone-600 backdrop-blur-sm transition hover:bg-stone-50 dark:border-white/15 dark:bg-white/6 dark:text-white/85 dark:hover:bg-white/12"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="size-8" />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="h-full overflow-y-auto px-6 pb-6 lg:px-10 lg:pb-10">
                <div className="mx-auto max-w-[min(1500px,calc(100vw-5rem))]">
                  <SlideRenderer slide={activeSlide} />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-center gap-4 px-6 py-2 text-xs text-stone-400 dark:text-white/40 lg:px-10">
              <div className="inline-flex items-center gap-1.5">
                {activeSlide.type === 'spotlight'
                  ? activeSlide.data.pnl >= 0
                    ? <TrendingUp className="size-3.5 text-emerald-500/70 dark:text-emerald-400/70" />
                    : <TrendingDown className="size-3.5 text-rose-500/70 dark:text-rose-400/70" />
                  : <Sparkles className="size-3.5 text-amber-500/70 dark:text-amber-300/70" />}
                <span>{activeIndex + 1} of {recap.slides.length}</span>
              </div>
              <span>•</span>
              <span>{recap.cached ? 'Cached' : 'Generated fresh'}</span>
            </div>
          </div>
        ) : null}
      </div>
    </ChartTheme.Provider>
  )
}
