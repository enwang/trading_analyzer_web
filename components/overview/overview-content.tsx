'use client'

import { useState, useEffect, useMemo } from 'react'
import { computeSummary } from '@/lib/metrics'
import type { Trade } from '@/types/trade'
import { AccountEquityCurve } from '@/components/charts/account-equity-curve'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OverviewKpiGrid, type CardConfig } from '@/components/overview/overview-kpi-grid'
import { type DateRangeKey, DATE_RANGES, getStartDate } from '@/lib/date-range'

type NavRow = { report_date: string; total: number }
type NavChange = { from_date: string; to_date: string; deposits_withdrawals: number | null }
type CashDeposit = { transaction_ts: string; amount: number }
type BenchmarkRow = { date: string; pct: number }

const LS_RANGE_KEY = 'overview-date-range'

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
}: {
  trades: Trade[]
  navData: NavRow[]
  navChanges: NavChange[]
  cashDeposits: CashDeposit[]
  spyReturns: BenchmarkRow[]
  qqqReturns: BenchmarkRow[]
  soxxReturns: BenchmarkRow[]
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

  const filteredDeposits = useMemo(() => {
    if (!startDate) return cashDeposits
    return cashDeposits.filter(r => r.transaction_ts.slice(0, 10) >= startDate)
  }, [cashDeposits, startDate])

  const stats = useMemo(() => computeSummary(filteredTrades), [filteredTrades])

  const closedFiltered = useMemo(
    () => filteredTrades.filter(t => t.exitTime && t.pnl != null),
    [filteredTrades]
  )

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
    { id: 'avg-win-loss', type: 'kpi', label: 'Avg Win/Loss', value: fmtPf(stats.payoffRatio) },
    { id: 'profit-factor', type: 'kpi', label: 'Profit Factor', value: fmtPf(stats.profitFactor) },
    { id: 'expectancy', type: 'kpi', label: 'Avg net trade P&L', value: fmt(stats.expectancy), trend: stats.expectancy >= 0 ? 'up' : 'down' },
    { id: 'trades', type: 'kpi', label: 'Trades', value: String(stats.totalTrades) },
    { id: 'avg-win', type: 'kpi', label: 'Avg Win', value: fmt(stats.avgWin), trend: 'up' },
    { id: 'avg-loss', type: 'kpi', label: 'Avg Loss', value: fmt(stats.avgLoss), trend: 'down' },
    { id: 'largest-win', type: 'kpi', label: 'Largest Win', value: fmt(stats.largestWin), trend: 'up', href: largestWinTrade ? `/trades/${largestWinTrade.id}?from=overview` : undefined, hoverTitle: largestWinTrade ? `${largestWinTrade.symbol} trade` : undefined, hoverItems: largestWinTrade ? [fmtHoverDate(largestWinTrade.exitTime), fmtSigned(largestWinTrade.pnl ?? 0)] : undefined },
    { id: 'largest-loss', type: 'kpi', label: 'Largest Loss', value: fmt(stats.largestLoss), trend: 'down', href: largestLossTrade ? `/trades/${largestLossTrade.id}?from=overview` : undefined, hoverTitle: largestLossTrade ? `${largestLossTrade.symbol} trade` : undefined, hoverItems: largestLossTrade ? [fmtHoverDate(largestLossTrade.exitTime), fmtSigned(largestLossTrade.pnl ?? 0)] : undefined },
    { id: 'consec-wins', type: 'kpi', label: 'Consec Wins', value: String(stats.maxConsecWins), sub: 'max streak' },
    { id: 'consec-losses', type: 'kpi', label: 'Consec Losses', value: String(stats.maxConsecLosses), sub: 'max streak' },
  ]

  return (
    <div className="space-y-6">
      {/* Date range selector */}
      <div className="flex gap-1">
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
          <CardHeader>
            <CardTitle className="text-sm font-medium">Account Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountEquityCurve
              data={filteredNavData}
              changes={navChanges}
              deposits={cashDeposits}
              spy={filteredSpy}
              qqq={filteredQqq}
              soxx={filteredSoxx}
              height={240}
              disableAnchors={range === 'WTD' || range === 'MTD'}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
