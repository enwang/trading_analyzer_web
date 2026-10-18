'use client'

import { useState, useEffect, useMemo } from 'react'
import { computeSummary } from '@/lib/metrics'
import type { Trade } from '@/types/trade'
import { AccountEquityCurve } from '@/components/charts/account-equity-curve'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OverviewKpiGrid, type CardConfig } from '@/components/overview/overview-kpi-grid'
import { type DateRangeKey, DATE_RANGES, getStartDate } from '@/lib/date-range'

type NavRow = { report_date: string; total: number }
type NavChange = { from_date: string; to_date: string; deposits_withdrawals: number | null; twr?: number | null }
type CashDeposit = { transaction_ts: string; amount: number }
type BenchmarkRow = { date: string; pct: number }

const LS_RANGE_KEY = 'overview-date-range'

function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, 1))
  return `${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(y).slice(-2)}`
}

function monthWindow(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start: `${monthKey}-01`, end }
}

function MonthSelect({ value, onChange, options, disabled, ariaLabel }: {
  value: string
  onChange: (v: string) => void
  options: { key: string; label: string }[]
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="appearance-none rounded border border-gray-200 bg-transparent py-1 pl-2 pr-8 text-xs text-foreground dark:border-gray-700 disabled:opacity-50"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.625rem center',
        backgroundSize: '0.75rem',
      }}
      aria-label={ariaLabel}
    >
      {options.map(o => (
        <option key={o.key} value={o.key}>{o.label}</option>
      ))}
    </select>
  )
}

function rebase(data: BenchmarkRow[], startDate: string): BenchmarkRow[] {
  // Use the last point BEFORE startDate as the 0% baseline so the benchmark
  // starts from the same reference point as the NAV baseline row.
  const prior = [...data].filter(r => r.date < startDate).pop()
  const base = prior?.pct ?? data.find(r => r.date >= startDate)?.pct ?? 0
  const baseFactor = 1 + base / 100
  const rebased = data
    .filter(r => r.date >= startDate)
    .map(r => ({ ...r, pct: baseFactor > 0 ? ((1 + r.pct / 100) / baseFactor - 1) * 100 : r.pct - base }))
  return prior ? [{ date: prior.date, pct: 0 }, ...rebased] : rebased
}

function fmt(n: number) {
  const abs = Math.abs(n)
  const s = `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}
function fmtPct(n: number) { return `${(n * 100).toFixed(1)}%` }
function fmtPf(n: number) { return n === Infinity ? '∞' : n.toFixed(2) }
function fmtSigned(n: number) { return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}` }
function fmtHoverDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function OverviewContent({
  trades,
  navData,
  navChanges,
  cashDeposits,
  spyReturns,
  qqqReturns,
  soxxReturns,
  arkkReturns,
  brkbReturns,
}: {
  trades: Trade[]
  navData: NavRow[]
  navChanges: NavChange[]
  cashDeposits: CashDeposit[]
  spyReturns: BenchmarkRow[]
  qqqReturns: BenchmarkRow[]
  soxxReturns: BenchmarkRow[]
  arkkReturns: BenchmarkRow[]
  brkbReturns: BenchmarkRow[]
}) {
  const [range, setRange] = useState<DateRangeKey>('YTD')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_RANGE_KEY)
      if (saved && (DATE_RANGES as string[]).includes(saved)) setRange(saved as DateRangeKey)
    } catch { /* ignore */ }
  }, [])

  function selectRange(r: DateRangeKey) {
    setRange(r)
    try { localStorage.setItem(LS_RANGE_KEY, r) } catch { /* ignore */ }
  }

  const startDate = useMemo(() => getStartDate(range), [range])

  const filteredTrades = useMemo(() => {
    if (!startDate) return trades
    return trades.filter(t => t.exitTime == null || t.exitTime >= startDate)
  }, [trades, startDate])

  const filteredNavData = useMemo(() => {
    if (!startDate) return navData
    const inRange = navData.filter(r => r.report_date >= startDate)
    // Prepend the last row before startDate so computeDailyTWR starts from that
    // baseline (pct=0), matching the Analysis tab's "starting NAV" for the period.
    const prior = [...navData].filter(r => r.report_date < startDate).pop()
    return prior ? [prior, ...inRange] : inRange
  }, [navData, startDate])

  const filteredNavChanges = useMemo(() => {
    if (!startDate) return navChanges
    return navChanges.filter(r => r.to_date >= startDate)
  }, [navChanges, startDate])

  const filteredSpy = useMemo(() => startDate ? rebase(spyReturns, startDate) : spyReturns, [spyReturns, startDate])
  const filteredQqq = useMemo(() => startDate ? rebase(qqqReturns, startDate) : qqqReturns, [qqqReturns, startDate])
  const filteredSoxx = useMemo(() => startDate ? rebase(soxxReturns, startDate) : soxxReturns, [soxxReturns, startDate])
  const filteredArkk = useMemo(() => startDate ? rebase(arkkReturns, startDate) : arkkReturns, [arkkReturns, startDate])
  const filteredBrkb = useMemo(() => startDate ? rebase(brkbReturns, startDate) : brkbReturns, [brkbReturns, startDate])

  const filteredDeposits = useMemo(() => {
    if (!startDate) return cashDeposits
    return cashDeposits.filter(r => r.transaction_ts.slice(0, 10) >= startDate)
  }, [cashDeposits, startDate])

  // Chart-only month window: pick a From and To month and the equity chart
  // shows just that window (account + benchmarks rebased to the window
  // start), independent of the page date-range that drives the KPI cards.
  // From = "All" follows the page range as before; To = "Now" is open-ended.
  // From Sep / To Sep = a single month; From Jul / To Now = July to today.
  const [chartFrom, setChartFrom] = useState<string | null>(null)
  const [chartTo, setChartTo] = useState<string | null>(null)

  const chartMonths = useMemo(() => {
    const keys = [...new Set(navData.map(r => r.report_date.slice(0, 7)))].sort()
    return keys.reverse().map(key => ({ key, label: monthLabelOf(key) }))
  }, [navData])

  const chartView = useMemo(() => {
    if (!chartFrom) {
      return {
        nav: filteredNavData,
        changes: filteredNavChanges,
        deposits: filteredDeposits,
        spy: filteredSpy,
        qqq: filteredQqq,
        soxx: filteredSoxx,
        arkk: filteredArkk,
        brkb: filteredBrkb,
        disableAnchors: range === 'WTD' || range === 'MTD',
      }
    }
    const start = `${chartFrom}-01`
    const end = chartTo ? monthWindow(chartTo).end : null
    const inWindow = navData.filter(r => r.report_date >= start && (end == null || r.report_date <= end))
    const prior = [...navData].filter(r => r.report_date < start).pop()
    const winBench = (series: BenchmarkRow[]) => {
      const rebased = rebase(series, start)
      return end == null ? rebased : rebased.filter(r => r.date <= end)
    }
    return {
      nav: prior ? [prior, ...inWindow] : inWindow,
      // Window views must reproduce the Analysis monthly returns exactly, so
      // the curve gets (a) the FULL deposit list — its settlement-day matching
      // only ever flags days inside the displayed rows, so out-of-window
      // deposits cannot match — and (b) NO period-level ChangeInNAV rows: their
      // long spans corrupt the deposit-skip fallback and the TWR anchor logic.
      // With anchors on, every month-end inside the window snaps to
      // computeMonthlyReturns over the scoped data — the same numbers the
      // Analysis tab prints. (The shipped version filtered both inputs to the
      // month and disabled the anchors; in Sep 2026 that flattened the curve
      // to +0.26% instead of +10.58%.)
      changes: [] as NavChange[],
      deposits: cashDeposits,
      spy: winBench(spyReturns),
      qqq: winBench(qqqReturns),
      soxx: winBench(soxxReturns),
      arkk: winBench(arkkReturns),
      brkb: winBench(brkbReturns),
      disableAnchors: false,
    }
  }, [chartFrom, chartTo, navData, cashDeposits, spyReturns, qqqReturns, soxxReturns, arkkReturns, brkbReturns, filteredNavData, filteredNavChanges, filteredDeposits, filteredSpy, filteredQqq, filteredSoxx, filteredArkk, filteredBrkb, range])

  const stats = useMemo(() => computeSummary(filteredTrades), [filteredTrades])

  const closedFiltered = useMemo(
    () => filteredTrades.filter(t => t.exitTime && t.pnl != null),
    [filteredTrades]
  )

  const avgWinLossPct = useMemo(() => {
    const average = (values: number[]) => (
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    )
    const winPcts = closedFiltered
      .filter(t => t.outcome === 'win' && t.pnlPct != null)
      .map(t => Math.abs(t.pnlPct!))
    const lossPcts = closedFiltered
      .filter(t => t.outcome === 'loss' && t.pnlPct != null)
      .map(t => Math.abs(t.pnlPct!))

    return { win: average(winPcts), loss: average(lossPcts) }
  }, [closedFiltered])

  // Open trades are always current — not date-filtered
  const openTrades = useMemo(() =>
    trades.filter(t => t.exitTime == null || t.outcome === 'open').map(t => ({
      symbol: t.symbol, side: t.side, shares: t.shares, entryPrice: t.entryPrice, realizedPnl: t.pnl,
    })), [trades])

  const openTradesForRisk = useMemo(() =>
    trades.filter(t => t.exitTime == null || t.outcome === 'open').map(t => ({
      symbol: t.symbol, side: t.side, shares: t.shares, stopLoss: t.currentStopLoss ?? t.stopLoss,
    })), [trades])

  const latestNav = navData[navData.length - 1]?.total ?? null

  const startEquity = useMemo(() => {
    if (!startDate) return navData[0]?.total ?? null
    return navData.find(r => r.report_date >= startDate)?.total ?? null
  }, [navData, startDate])

  const netDeposits = useMemo(() => {
    const effectiveStart = startDate ?? navData[0]?.report_date ?? '2000-01-01'
    return cashDeposits
      .filter(r => r.transaction_ts.slice(0, 10) >= effectiveStart)
      .reduce((sum, r) => sum + r.amount, 0)
  }, [cashDeposits, startDate, navData])

  const largestWinTrade = closedFiltered.length
    ? closedFiltered.reduce((best, t) => (best == null || (t.pnl ?? -Infinity) > (best.pnl ?? -Infinity) ? t : best), null as typeof closedFiltered[number] | null)
    : null
  const largestLossTrade = closedFiltered.length
    ? closedFiltered.reduce((worst, t) => (worst == null || (t.pnl ?? Infinity) < (worst.pnl ?? Infinity) ? t : worst), null as typeof closedFiltered[number] | null)
    : null

  const cards: CardConfig[] = [
    { id: 'account-summary', type: 'account-summary', accountEquity: latestNav, startEquity, netDeposits, trades: openTradesForRisk },
    { id: 'net-pnl', type: 'kpi', label: 'Net P&L', value: fmt(stats.netPnl), trend: stats.netPnl >= 0 ? 'up' : 'down' },
    { id: 'open-pnl', type: 'open-pnl', trades: openTrades },
    { id: 'open-risk', type: 'open-risk', trades: openTradesForRisk, accountEquity: latestNav },
    { id: 'win-rate', type: 'kpi', label: 'Win Rate', value: fmtPct(stats.winRate), sub: stats.nBreakevens > 0 ? `${stats.nWins}W / ${stats.nLosses}L / ${stats.nBreakevens}B` : `${stats.nWins}W / ${stats.nLosses}L` },
    { id: 'avg-win-loss', type: 'kpi', label: 'Avg Win/Loss Rate', value: fmtPf(stats.payoffRatio) },
    { id: 'profit-factor', type: 'kpi', label: 'Profit Factor', value: fmtPf(stats.profitFactor) },
    { id: 'expectancy', type: 'kpi', label: 'Avg net trade P&L', value: fmt(stats.expectancy), trend: stats.expectancy >= 0 ? 'up' : 'down' },
    {
      id: 'trades',
      type: 'kpi',
      label: 'Trades',
      value: (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-base leading-tight sm:text-lg">
          <span className="whitespace-nowrap">
            <span className="text-emerald-600">W</span> {stats.nWins}
          </span>
          <span className="whitespace-nowrap">
            <span className="text-red-600">L</span> {stats.nLosses}
          </span>
          <span className="whitespace-nowrap">
            <span className="text-slate-500">B</span> {stats.nBreakevens}
          </span>
        </div>
      ),
    },
    {
      id: 'avg-win-loss-values',
      type: 'kpi',
      label: (
        <div className="flex items-start justify-between gap-3">
          <span>Avg win / loss</span>
          <span className="text-right">Avg win / loss ratio</span>
        </div>
      ),
      value: (
        <div className="flex min-w-0 flex-col gap-0.5 text-base sm:text-lg lg:text-xl">
          <span className="flex items-baseline justify-between gap-3 whitespace-nowrap text-emerald-600">
            <span>{fmt(stats.avgWin)}</span>
            <span>{fmtPct(avgWinLossPct.win)}</span>
          </span>
          <span className="flex items-baseline justify-between gap-3 whitespace-nowrap text-red-600">
            <span>{fmt(stats.avgLoss)}</span>
            <span>{fmtPct(avgWinLossPct.loss)}</span>
          </span>
        </div>
      ),
    },
    { id: 'largest-win', type: 'kpi', label: 'Largest Win', value: fmt(stats.largestWin), trend: 'up', hideOnMobile: true, href: largestWinTrade ? `/trades/${largestWinTrade.id}?from=overview` : undefined, hoverTitle: largestWinTrade ? `${largestWinTrade.symbol} trade` : undefined, hoverItems: largestWinTrade ? [fmtHoverDate(largestWinTrade.exitTime), fmtSigned(largestWinTrade.pnl ?? 0)] : undefined },
    { id: 'largest-loss', type: 'kpi', label: 'Largest Loss', value: fmt(stats.largestLoss), trend: 'down', hideOnMobile: true, href: largestLossTrade ? `/trades/${largestLossTrade.id}?from=overview` : undefined, hoverTitle: largestLossTrade ? `${largestLossTrade.symbol} trade` : undefined, hoverItems: largestLossTrade ? [fmtHoverDate(largestLossTrade.exitTime), fmtSigned(largestLossTrade.pnl ?? 0)] : undefined },
  ]

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex flex-wrap gap-1">
        {DATE_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => selectRange(r)}
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

      <OverviewKpiGrid cards={cards} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-col gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm font-medium">Account Equity</CardTitle>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>From</span>
              <MonthSelect
                ariaLabel="Chart start month"
                value={chartFrom ?? ''}
                onChange={(v) => {
                  const from = v || null
                  setChartFrom(from)
                  if (from && chartTo && chartTo < from) setChartTo(null)
                }}
                options={[{ key: '', label: 'All' }, ...chartMonths]}
              />
              <span>To</span>
              <MonthSelect
                ariaLabel="Chart end month"
                value={chartTo ?? ''}
                onChange={(v) => setChartTo(v || null)}
                disabled={!chartFrom}
                options={[{ key: '', label: 'Now' }, ...chartMonths.filter(m => !chartFrom || m.key >= chartFrom)]}
              />
            </div>
          </CardHeader>
          <CardContent>
            <AccountEquityCurve
              data={chartView.nav}
              changes={chartView.changes}
              deposits={chartView.deposits}
              spy={chartView.spy}
              qqq={chartView.qqq}
              soxx={chartView.soxx}
              arkk={chartView.arkk}
              brkb={chartView.brkb}
              height={240}
              disableAnchors={chartView.disableAnchors}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
