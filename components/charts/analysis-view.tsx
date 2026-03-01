'use client'

import { useMemo, useState } from 'react'
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
    avgHoldTimeMin: number | null
  }
  closedTrades: ClosedTrade[]
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
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

function fmtHold(min: number | null) {
  if (min == null) return '—'
  const total = Math.max(0, Math.round(min))
  const d = Math.floor(total / 1440)
  const h = Math.floor((total % 1440) / 60)
  const m = total % 60
  return `${d}d ${h}h ${m}m`
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
    avgDailyWinLoss: number
    avgDailyNetPnl: number
    loggedDays: number
    avgDailyWinPct: number
    dayWinCount: number
    dayLossCount: number
    dayCount: number
    avgTradeWinLoss: number
    avgPlannedRMultiple: number
    maxDailyNetDrawdown: number
    profitFactor: number
    avgHoldTimeMin: number | null
    avgRealizedRMultiple: number
    avgDailyNetDrawdown: number
  }
}) {
  const columns = [
    [
      { label: 'Net P&L', value: fmtMoney(summary.netPnl) },
      { label: 'Win %', value: `${summary.winPct.toFixed(2)}%` },
      {
        label: 'Avg daily win %',
        value: `${summary.avgDailyWinPct.toFixed(2)}% (${summary.dayWinCount}/${summary.dayLossCount}/${summary.dayCount})`,
      },
      { label: 'Profit factor', value: fmtRatio(summary.profitFactor) },
    ],
    [
      { label: 'Trade expectancy', value: fmtMoney(summary.tradeExpectancy) },
      { label: 'Avg daily win/loss', value: fmtRatio(summary.avgDailyWinLoss) },
      { label: 'Avg trade win/loss', value: fmtRatio(summary.avgTradeWinLoss) },
      { label: 'Avg hold time', value: fmtHold(summary.avgHoldTimeMin) },
    ],
    [
      { label: 'Avg net trade P&L', value: fmtMoney(summary.avgNetTradePnl) },
      { label: 'Avg daily net P&L', value: fmtMoney(summary.avgDailyNetPnl) },
      { label: 'Avg. planned r-multiple', value: `${summary.avgPlannedRMultiple.toFixed(0)}R` },
      { label: 'Avg. realized r-multiple', value: `${summary.avgRealizedRMultiple.toFixed(2)}R` },
    ],
    [
      { label: 'Avg daily volume', value: summary.avgDailyVolume.toFixed(2) },
      { label: 'Logged days', value: String(summary.loggedDays) },
      { label: 'Max daily net drawdown', value: fmtMoney(summary.maxDailyNetDrawdown) },
      { label: 'Avg daily net drawdown', value: fmtMoney(summary.avgDailyNetDrawdown) },
    ],
  ]

  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
          {columns.map((col, i) => (
            <div key={i} className="space-y-10 p-4">
              {col.map((item) => (
                <div key={item.label}>
                  <div className="text-muted-foreground text-sm">{item.label}</div>
                  <div className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl lg:text-[1.6rem]">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function AnalysisView({ data }: { data: AnalysisData }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const computed = useMemo(() => {
    const sorted = [...data.closedTrades].sort((a, b) => {
      const ta = a.exitTime ?? a.entryTime ?? ''
      const tb = b.exitTime ?? b.entryTime ?? ''
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    const dayMap = new Map<
      string,
      {
        date: string
        pnl: number
        trades: number
        wins: number
        losses: number
        volume: number
        winPnl: number
        lossAbsPnl: number
      }
    >()

    let winPnl = 0
    let winCount = 0
    let lossAbsPnl = 0
    let lossCount = 0

    for (const t of sorted) {
      const time = t.exitTime ?? t.entryTime
      if (!time) continue
      const key = dateKeyInTimeZone(time, timeZone)
      const bucket = dayMap.get(key) ?? {
        date: key,
        pnl: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        volume: 0,
        winPnl: 0,
        lossAbsPnl: 0,
      }

      bucket.pnl += t.pnl
      bucket.trades += 1
      bucket.volume += Math.abs(t.shares)
      if (t.outcome === 'win') {
        bucket.wins += 1
        bucket.winPnl += t.pnl
        winPnl += t.pnl
        winCount += 1
      } else if (t.outcome === 'loss') {
        bucket.losses += 1
        bucket.lossAbsPnl += Math.abs(t.pnl)
        lossAbsPnl += Math.abs(t.pnl)
        lossCount += 1
      }

      dayMap.set(key, bucket)
    }

    const dayRows = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

    let cumNet = 0
    let cumWins = 0
    let cumTrades = 0
    let cumWinPnl = 0
    let cumWinCount = 0
    let cumLossAbs = 0
    let cumLossCount = 0

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

    const dayPnls = dayRows.map((d) => d.pnl)
    const avgDailyNetPnl = dayPnls.length ? dayPnls.reduce((s, v) => s + v, 0) / dayPnls.length : 0
    const avgDailyVolume = dayRows.length
      ? dayRows.reduce((s, d) => s + d.volume, 0) / dayRows.length
      : 0
    const winDays = dayPnls.filter((v) => v > 0)
    const lossDaysAbs = dayPnls.filter((v) => v < 0).map((v) => Math.abs(v))
    const avgDailyWinLoss = winDays.length && lossDaysAbs.length
      ? (winDays.reduce((s, v) => s + v, 0) / winDays.length) /
        (lossDaysAbs.reduce((s, v) => s + v, 0) / lossDaysAbs.length)
      : 0

    const avgTradeWinLoss = winCount && lossCount ? (winPnl / winCount) / (lossAbsPnl / lossCount) : 0
    const maxDailyNetDrawdown = dayPnls.length ? Math.min(...dayPnls) : 0
    const lossDays = dayPnls.filter((v) => v < 0)
    const avgDailyNetDrawdown = lossDays.length
      ? lossDays.reduce((s, v) => s + v, 0) / lossDays.length
      : 0

    return {
      dayRows,
      trends,
      summary: {
        ...data.summaryBase,
        avgDailyNetPnl,
        avgDailyVolume,
        avgDailyWinLoss,
        avgTradeWinLoss,
        avgPlannedRMultiple: 0,
        loggedDays: dayRows.length,
        maxDailyNetDrawdown,
        avgDailyNetDrawdown,
        dayWinCount: winDays.length,
        dayLossCount: lossDays.length,
        dayCount: dayRows.length,
        avgDailyWinPct: dayRows.length ? (winDays.length / dayRows.length) * 100 : 0,
      },
      trades: sorted,
    }
  }, [data.closedTrades, data.summaryBase, timeZone])

  if (!data.closedTrades.length) {
    return <div className="text-muted-foreground text-sm">No closed trades to analyze yet.</div>
  }

  return (
    <Tabs defaultValue="summary" className="space-y-4">
      <TabsList variant="line" className="w-full justify-start">
        <TabsTrigger value="summary" className="max-w-fit px-4">Summary</TabsTrigger>
        <TabsTrigger value="days" className="max-w-fit px-4">Days</TabsTrigger>
        <TabsTrigger value="trades" className="max-w-fit px-4">Trades</TabsTrigger>
      </TabsList>

      <TabsContent value="summary" className="space-y-4">
        <SummaryGrid summary={computed.summary} />

        <div className="grid gap-4 xl:grid-cols-2">
          <MetricChartCard
            title="Win %"
            points={computed.trends}
            defaultMetric="winPctCum"
          />
          <MetricChartCard
            title="Avg trade win/loss"
            points={computed.trends}
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
                  return (
                    <TableRow key={row.date}>
                      <TableCell className="font-medium">{row.date}</TableCell>
                      <TableCell className="text-right">{row.trades}</TableCell>
                      <TableCell className="text-right">{winPct.toFixed(1)}%</TableCell>
                      <TableCell className={`text-right font-medium ${row.pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtMoney(row.pnl)}
                      </TableCell>
                      <TableCell className="text-right">{row.volume.toFixed(0)}</TableCell>
                    </TableRow>
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
                    <TableCell className="font-medium">{t.symbol}</TableCell>
                    <TableCell>{formatDateCell(t.entryTime, timeZone)}</TableCell>
                    <TableCell>{formatDateCell(t.exitTime, timeZone)}</TableCell>
                    <TableCell className="text-right">{Math.abs(t.shares).toFixed(0)}</TableCell>
                    <TableCell className={`text-right ${t.rMultiple == null ? '' : t.rMultiple >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {t.rMultiple == null ? '—' : `${t.rMultiple.toFixed(2)}R`}
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
