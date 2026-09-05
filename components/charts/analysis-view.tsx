'use client'

import type React from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Plus, Settings2 } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { type DateRangeKey, DATE_RANGES, getStartDate } from '@/lib/date-range'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_INITIAL_RISK_AMOUNT } from '@/lib/market/stop-loss'
import { computeCoreStats } from '@/lib/metrics'

type ClosedTrade = {
  id: string
  symbol: string
  entryTime: string | null
  exitTime: string | null
  pnl: number
  outcome: 'win' | 'loss' | 'breakeven' | 'open' | null
  shares: number
  rMultiple: number | null
  holdTimeMin: number | null
}

interface AnalysisData {
  summaryBase: {
    netPnl: number
    winPct: number
    profitFactor: number
    tradeExpectancy: number
    avgNetTradePnl: number
    avgRealizedRMultiple: number
    avgHoldWinMin: number | null
    avgHoldLossMin: number | null
    payoffRatio: number
    avgWin: number
    avgLoss: number
  }
  closedTrades: ClosedTrade[]
  summaryClosedTrades: ClosedTrade[]
}

type TrendPoint = {
  date: string
  label: string
  winPctCum: number
  avgTradeWinLossCum: number
  cumulativeNetPnl: number
  avgDailyNetPnlCum: number
}

type TrendMetricId = 'winPctCum' | 'avgTradeWinLossCum' | 'cumulativeNetPnl' | 'avgDailyNetPnlCum'

type TrendMetricDef = {
  id: TrendMetricId
  label: string
  color: string
  fmt: (n: number) => string
}

const TREND_METRICS: TrendMetricDef[] = [
  {
    id: 'winPctCum',
    label: 'Win % - cumulative',
    color: '#5cb992',
    fmt: (n) => `${n.toFixed(2)}%`,
  },
  {
    id: 'avgTradeWinLossCum',
    label: 'Avg trade win/loss - cumulative',
    color: '#3f5ce2',
    fmt: (n) => n.toFixed(2),
  },
  {
    id: 'cumulativeNetPnl',
    label: 'Net P&L - cumulative',
    color: '#0891b2',
    fmt: (n) => fmtMoney(n),
  },
  {
    id: 'avgDailyNetPnlCum',
    label: 'Avg daily net P&L - cumulative',
    color: '#f97316',
    fmt: (n) => fmtMoney(n),
  },
]

function fmtMoney(n: number) {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function fmtRatio(n: number) {
  if (n === Infinity) return '∞'
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function fmtHold(min: number | null) {
  if (min == null) return '—'
  const totalMinutes = Math.max(0, Math.round(min))
  if (totalMinutes < 60) return `${totalMinutes}m`

  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    const parts = [`${days}D`]
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0) parts.push(`${minutes}m`)
    return parts.join(' ')
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function dateKeyInTimeZone(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function shortDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
}

function formatDateCell(iso: string | null, timeZone: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function MetricChartCard({
  title,
  points,
  defaultMetric,
}: {
  title: string
  points: TrendPoint[]
  defaultMetric: TrendMetricId
}) {
  const [primaryMetric, setPrimaryMetric] = useState<TrendMetricId>(defaultMetric)
  const [secondaryMetric, setSecondaryMetric] = useState<TrendMetricId | null>(null)

  const primaryDef = TREND_METRICS.find((m) => m.id === primaryMetric) ?? TREND_METRICS[0]
  const secondaryDef = secondaryMetric
    ? TREND_METRICS.find((m) => m.id === secondaryMetric) ?? null
    : null

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={primaryMetric} onValueChange={(v: TrendMetricId) => setPrimaryMetric(v)}>
              <SelectTrigger className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TREND_METRICS.map((metric) => (
                  <SelectItem key={metric.id} value={metric.id}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {secondaryMetric ? (
              <Select
                value={secondaryMetric}
                onValueChange={(v: TrendMetricId) => setSecondaryMetric(v)}
              >
                <SelectTrigger className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TREND_METRICS.filter((m) => m.id !== primaryMetric).map((metric) => (
                    <SelectItem key={metric.id} value={metric.id}>
                      {metric.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = TREND_METRICS.find((m) => m.id !== primaryMetric)
                  setSecondaryMetric(next?.id ?? null)
                }}
              >
                <Plus className="size-4" />
                Add metric
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Select defaultValue="day">
              <SelectTrigger className="w-[92px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon-sm" aria-label={`${title} settings`}>
              <Settings2 className="size-4" />
            </Button>
          </div>
        </div>

        <div className="h-[320px] px-3 py-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 10, right: 14, left: 6, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 12 }}
                width={72}
                tickFormatter={(v: number) => primaryDef.fmt(v)}
              />
              {secondaryDef && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  width={72}
                  tickFormatter={(v: number) => secondaryDef.fmt(v)}
                />
              )}
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
                      <div className="font-medium">{label}</div>
                      {payload.map((item) => {
                        const metric = TREND_METRICS.find((m) => m.id === item.dataKey)
                        const raw = typeof item.value === 'number' ? item.value : 0
                        return (
                          <div key={String(item.dataKey)} className="flex items-center gap-2">
                            <span className="inline-block size-2 rounded-full" style={{ background: item.color }} />
                            <span>
                              {metric?.label ?? item.name}: {metric?.fmt(raw) ?? raw}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey={primaryDef.id}
                name={primaryDef.label}
                stroke={primaryDef.color}
                strokeWidth={2.5}
                dot={{ r: 2.8, fill: primaryDef.color }}
                activeDot={{ r: 4 }}
              />
              {secondaryDef && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey={secondaryDef.id}
                  name={secondaryDef.label}
                  stroke={secondaryDef.color}
                  strokeWidth={2.2}
                  dot={{ r: 2.4, fill: secondaryDef.color }}
                  activeDot={{ r: 4 }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryGrid({
  summary,
}: {
  summary: {
    netPnl: number
    tradeExpectancy: number
    avgNetTradePnl: number
    avgDailyVolume: number
    winPct: number
    avgDailyNetPnl: number
    loggedDays: number
    avgTradeWinLoss: number
    maxDailyNetDrawdown: number
    profitFactor: number
    avgHoldWinMin: number | null
    avgHoldLossMin: number | null
    avgRealizedRMultiple: number
    avgDailyNetDrawdown: number
    avgWin: number
    avgLoss: number
    totalTrades: number
  }
}) {
  const holdValue = (
    <div className="flex flex-col gap-0.5 text-base sm:text-lg lg:text-xl">
      <span className="whitespace-nowrap">
        <span className="text-emerald-600">W</span> {fmtHold(summary.avgHoldWinMin)}
      </span>
      <span className="whitespace-nowrap">
        <span className="text-red-600">L</span> {fmtHold(summary.avgHoldLossMin)}
      </span>
    </div>
  )
  const winLossValue = (
    <div className="flex flex-col gap-0.5 text-base sm:text-lg lg:text-xl">
      <span className="whitespace-nowrap text-emerald-600">{fmtMoney(summary.avgWin)}</span>
      <span className="whitespace-nowrap text-red-600">{fmtMoney(summary.avgLoss)}</span>
    </div>
  )
  const items: { label: string; value: React.ReactNode }[] = [
    { label: 'Net P&L', value: fmtMoney(summary.netPnl) },
    { label: 'Win %', value: `${summary.winPct.toFixed(1)}%` },
    { label: 'Profit Factor', value: fmtRatio(summary.profitFactor) },
    { label: 'Avg win / loss', value: winLossValue },
    { label: 'Avg hold time (win / loss)', value: holdValue },
    { label: 'Avg win/loss rate', value: fmtRatio(summary.avgTradeWinLoss) },
    { label: 'Avg. realized r-multiple', value: `${summary.avgRealizedRMultiple.toFixed(2)}R` },
    { label: 'Avg net trade P&L', value: fmtMoney(summary.tradeExpectancy) },
    { label: 'Trades', value: String(summary.totalTrades) },
  ]

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-2 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="border-b border-r p-4 last:border-b-0 [&:nth-child(3n)]:border-r-0 sm:[&:nth-last-child(-n+3)]:border-b-0">
              <div className="text-muted-foreground text-sm">{item.label}</div>
              <div className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl lg:text-[1.6rem]">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

type DayRow = {
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
  volume: number
  winPnl: number
  lossAbsPnl: number
}

function buildDayTrends(
  trades: ClosedTrade[],
  timeZone: string
): { dayRows: DayRow[]; trends: TrendPoint[] } {
  const dayMap = new Map<string, DayRow>()
  for (const t of trades) {
    if (!t.exitTime) continue
    const key = dateKeyInTimeZone(t.exitTime, timeZone)
    const bucket = dayMap.get(key) ?? { date: key, pnl: 0, trades: 0, wins: 0, losses: 0, volume: 0, winPnl: 0, lossAbsPnl: 0 }
    bucket.pnl += t.pnl
    bucket.trades += 1
    bucket.volume += Math.abs(t.shares)
    if (t.outcome === 'win') { bucket.wins++; bucket.winPnl += t.pnl }
    else if (t.outcome === 'loss') { bucket.losses++; bucket.lossAbsPnl += Math.abs(t.pnl) }
    dayMap.set(key, bucket)
  }
  const dayRows = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1))
  let cumNet = 0, cumWins = 0, cumTrades = 0, cumWinPnl = 0, cumWinCount = 0, cumLossAbs = 0, cumLossCount = 0
  const trends: TrendPoint[] = dayRows.map((row, idx) => {
    cumNet += row.pnl
    cumWins += row.wins
    cumTrades += row.trades
    cumWinPnl += row.winPnl
    cumWinCount += row.wins
    cumLossAbs += row.lossAbsPnl
    cumLossCount += row.losses
    const avgWin = cumWinCount > 0 ? cumWinPnl / cumWinCount : 0
    const avgLoss = cumLossCount > 0 ? cumLossAbs / cumLossCount : 0
    return {
      date: row.date,
      label: shortDateLabel(row.date),
      winPctCum: cumTrades > 0 ? (cumWins / cumTrades) * 100 : 0,
      avgTradeWinLossCum: avgLoss > 0 ? avgWin / avgLoss : 0,
      cumulativeNetPnl: cumNet,
      avgDailyNetPnlCum: cumNet / (idx + 1),
    }
  })
  return { dayRows, trends }
}

export function AnalysisView({ data }: { data: AnalysisData }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [range, setRange] = useState<DateRangeKey>('All')
  const searchParams = useSearchParams()
  const today = new Date().toLocaleDateString('en-CA')
  const startDate = getStartDate(range)
  const dateFrom = startDate ?? ''
  const dateTo = today
  const initialTab = searchParams.get('tab') ?? 'summary'

  // Trades filtered by the summary-tab date range (Days/Trades tabs remain unfiltered)
  // Uses normalized trades (same as overview) so metrics are consistent
  const summaryTrades = useMemo(() => {
    if (!dateFrom && !dateTo) return data.summaryClosedTrades
    return data.summaryClosedTrades.filter((t) => {
      const exitDate = t.exitTime ? dateKeyInTimeZone(t.exitTime, timeZone) : null
      if (!exitDate) return true
      if (dateFrom && exitDate < dateFrom) return false
      if (dateTo && exitDate > dateTo) return false
      return true
    })
  }, [data.summaryClosedTrades, dateFrom, dateTo, timeZone])

  // Recompute summary stats and trend series from the (possibly filtered) trades
  const filteredSummaryData = useMemo(() => {
    const sorted = [...summaryTrades].sort((a, b) => {
      const ta = a.exitTime ?? a.entryTime ?? ''
      const tb = b.exitTime ?? b.entryTime ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })
    const core = computeCoreStats(sorted)
    const { dayRows, trends } = buildDayTrends(sorted, timeZone)
    const tradeExpectancy = core.totalCount > 0 ? core.netPnl / core.totalCount : 0
    const dayPnls = dayRows.map((d) => d.pnl)
    const avgDailyNetPnl = dayPnls.length ? dayPnls.reduce((s, v) => s + v, 0) / dayPnls.length : 0
    const lossDays = dayPnls.filter((v) => v < 0)
    const winDays = dayPnls.filter((v) => v > 0)
    return {
      trends,
      summary: {
        netPnl: core.netPnl,
        winPct: core.winPct,
        profitFactor: core.profitFactor,
        tradeExpectancy,
        avgNetTradePnl: tradeExpectancy,
        avgRealizedRMultiple: tradeExpectancy / DEFAULT_INITIAL_RISK_AMOUNT,
        avgHoldWinMin: core.avgHoldWinMin,
        avgHoldLossMin: core.avgHoldLossMin,
        payoffRatio: core.payoffRatio,
        avgWin: core.avgWin,
        avgLoss: core.avgLoss,
        avgTradeWinLoss: core.payoffRatio,
        avgDailyNetPnl,
        avgDailyVolume: 0,
        loggedDays: dayRows.length,
        maxDailyNetDrawdown: dayPnls.length ? Math.min(...dayPnls) : 0,
        avgDailyNetDrawdown: lossDays.length ? lossDays.reduce((s, v) => s + v, 0) / lossDays.length : 0,
        dayWinCount: winDays.length,
        dayLossCount: lossDays.length,
        dayCount: dayRows.length,
        avgDailyWinPct: dayRows.length ? (winDays.length / dayRows.length) * 100 : 0,
        totalTrades: core.totalCount,
      },
    }
  }, [summaryTrades, timeZone])

  const computed = useMemo(() => {
    const filtered = dateFrom
      ? data.closedTrades.filter(t => {
          const exitDate = t.exitTime ? dateKeyInTimeZone(t.exitTime, timeZone) : null
          if (!exitDate) return true
          return exitDate >= dateFrom && exitDate <= dateTo
        })
      : data.closedTrades
    const sorted = [...filtered].sort((a, b) => {
      const ta = a.exitTime ?? a.entryTime ?? ''
      const tb = b.exitTime ?? b.entryTime ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })
    const { dayRows } = buildDayTrends(sorted, timeZone)
    return {
      dayRows: [...dayRows].reverse(),
      trades: [...sorted].reverse(),
    }
  }, [data.closedTrades, timeZone, dateFrom, dateTo])

  if (!data.closedTrades.length) {
    return <div className="text-muted-foreground text-sm">No closed trades to analyze yet.</div>
  }

  return (
    <Tabs defaultValue={initialTab} className="space-y-4">
      <div className="flex items-center gap-4">
        <TabsList variant="line" className="flex-1 justify-start">
          <TabsTrigger value="summary" className="max-w-fit px-4">Summary</TabsTrigger>
          <TabsTrigger value="days" className="max-w-fit px-4">Days</TabsTrigger>
          <TabsTrigger value="trades" className="max-w-fit px-4">Trades</TabsTrigger>
        </TabsList>
        <div className="flex gap-1 shrink-0">
          {DATE_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                range === r
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <TabsContent value="summary" className="space-y-4">
        <SummaryGrid summary={filteredSummaryData.summary} />

        <div className="grid gap-4 xl:grid-cols-2">
          <MetricChartCard
            title="Win %"
            points={filteredSummaryData.trends}
            defaultMetric="winPctCum"
          />
          <MetricChartCard
            title="Avg trade win/loss"
            points={filteredSummaryData.trends}
            defaultMetric="avgTradeWinLossCum"
          />
        </div>
      </TabsContent>

      <TabsContent value="days">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                  <TableHead className="text-right">Net P&L</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computed.dayRows.map((row) => {
                  const winPct = row.trades > 0 ? (row.wins / row.trades) * 100 : 0
                  const isExpanded = expandedDay === row.date
                  const dayTrades = computed.trades.filter((t) =>
                    t.exitTime ? dateKeyInTimeZone(t.exitTime, timeZone) === row.date : false
                  )
                  return (
                    <>
                      <TableRow
                        key={row.date}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedDay(isExpanded ? null : row.date)}
                      >
                        <TableCell className="font-medium">{row.date}</TableCell>
                        <TableCell className="text-right">{row.trades}</TableCell>
                        <TableCell className="text-right">{winPct.toFixed(1)}%</TableCell>
                        <TableCell className={`text-right font-medium ${row.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {fmtMoney(row.pnl)}
                        </TableCell>
                        <TableCell className="text-right">{row.volume.toFixed(0)}</TableCell>
                      </TableRow>
                      {isExpanded && dayTrades.map((t) => (
                        <TableRow key={t.id} className="bg-muted/30">
                          <TableCell className="pl-8">
                            <Link
                              href={`/trades?symbol=${encodeURIComponent(t.symbol)}&date=${row.date}&tz=${encodeURIComponent(timeZone)}`}
                              className="font-medium hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t.symbol}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right">{Math.abs(t.shares).toFixed(0)}</TableCell>
                          <TableCell className="text-right">
                            {`${(t.pnl / 2000).toFixed(2)}R`}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {fmtMoney(t.pnl)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="trades">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Exit</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  <TableHead className="text-right">R Multiple</TableHead>
                  <TableHead className="text-right">Net P&L</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {computed.trades.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">
                      <Link href={`/trades?symbol=${encodeURIComponent(t.symbol)}`} className="hover:underline">
                        {t.symbol}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDateCell(t.entryTime, timeZone)}</TableCell>
                    <TableCell>{formatDateCell(t.exitTime, timeZone)}</TableCell>
                    <TableCell className="text-right">{Math.abs(t.shares).toFixed(0)}</TableCell>
                    <TableCell className={`text-right ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {`${(t.pnl / 2000).toFixed(2)}R`}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${t.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmtMoney(t.pnl)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
