import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary, equityCurve } from '@/lib/metrics'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { KpiCard } from '@/components/kpi/kpi-card'
import { EquityCurve } from '@/components/charts/equity-curve'
import { AccountEquityCurve } from '@/components/charts/account-equity-curve'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { OverviewSyncButton } from '@/components/overview/overview-sync-button'
import { OpenPnlCard } from '@/components/overview/open-pnl-card'

function fmtMoney(n: number) {
  const abs = Math.abs(n)
  const s = `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}

function fmtMoney2(n: number) {
  const abs = Math.abs(n)
  const s = `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function fmtPf(n: number) {
  return n === Infinity ? '∞' : n.toFixed(2)
}

function fmtMoneySigned(n: number) {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`
}

function fmtHoverDate(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

async function fetchTickerReturns(symbol: string, startDate: string, endDate: string): Promise<{ date: string; pct: number }[]> {
  try {
    const p1 = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000) - 86400 * 7
    const p2 = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000) + 86400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`,
      { next: { revalidate: 3600 }, headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? []
    if (!timestamps.length || !closes.length) return []
    // Find last close on or before startDate to use as baseline (pct = 0 on first NAV day)
    let baseIdx = 0
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
      if (d <= startDate) baseIdx = i
      else break
    }
    const baseClose = closes[baseIdx]
    if (!baseClose) return []
    return timestamps
      .map((ts, i) => {
        const date = new Date(ts * 1000).toISOString().slice(0, 10)
        const close = closes[i]
        if (!close || date < startDate) return null
        return { date, pct: ((close - baseClose) / baseClose) * 100 }
      })
      .filter((r): r is { date: string; pct: number } => r !== null)
  } catch {
    return []
  }
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: rows }, { data: navRows }, { data: navChangeRows }, { data: cashTxRows }] = await Promise.all([
    supabase
      .from('trades')
      .select('*')
      .eq('user_id', user!.id)
      .order('entry_time', { ascending: true }),
    supabase
      .from('account_nav_daily')
      .select('report_date,total')
      .eq('user_id', user!.id)
      .order('report_date', { ascending: true }),
    supabase
      .from('account_nav_change')
      .select('from_date,to_date,deposits_withdrawals')
      .eq('user_id', user!.id),
    supabase
      .from('account_cash_transactions')
      .select('transaction_ts,amount,type')
      .eq('user_id', user!.id),
  ])

  const trades = normalizeTradesForDisplay((rows ?? []).map(rowToTrade))
  const stats = computeSummary(trades)
  const equity = equityCurve(trades)
  const closedTrades = trades.filter((t) => t.exitTime && t.pnl != null)
  const openTrades = trades
    .filter((t) => t.exitTime == null || t.outcome === 'open')
    .map((t) => ({
      symbol: t.symbol,
      side: t.side,
      shares: t.shares,
      entryPrice: t.entryPrice,
      realizedPnl: t.pnl,
    }))
  const largestWinTrade = closedTrades.length
    ? closedTrades.reduce((best, t) => ((best == null || (t.pnl ?? -Infinity) > (best.pnl ?? -Infinity)) ? t : best), null as typeof closedTrades[number] | null)
    : null
  const largestLossTrade = closedTrades.length
    ? closedTrades.reduce((worst, t) => ((worst == null || (t.pnl ?? Infinity) < (worst.pnl ?? Infinity)) ? t : worst), null as typeof closedTrades[number] | null)
    : null
  const navData = navRows ?? []
  const navChanges = navChangeRows ?? []

  // Fetch SPY/QQQ benchmark returns for the same date range as the NAV data
  const navStart = navData.find(r => r.report_date >= '2026-01-01')?.report_date ?? navData[0]?.report_date ?? '2026-01-01'
  const navEnd = navData[navData.length - 1]?.report_date ?? new Date().toISOString().slice(0, 10)
  const [spyReturns, qqqReturns] = await Promise.all([
    fetchTickerReturns('SPY', navStart, navEnd),
    fetchTickerReturns('QQQ', navStart, navEnd),
  ])

  // Only pass capital deposits/withdrawals to the equity curve — exclude dividends, interest, fees
  const cashDeposits = (cashTxRows ?? [])
    .filter((r) => {
      const t = (r.type as string | null)?.toLowerCase() ?? ''
      // If type info is present, require it to be a deposit or withdrawal
      if (t) return t.includes('deposit') || t.includes('withdrawal') || t.includes('transfer')
      // If no type, include everything above $500 (heuristic fallback)
      return Math.abs(r.amount as number) >= 500
    })
    .map((r) => ({
      transaction_ts: r.transaction_ts as string,
      amount: r.amount as number,
    }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        <OverviewSyncButton />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Net P&L"
          value={fmtMoney(stats.netPnl)}
          trend={stats.netPnl >= 0 ? 'up' : 'down'}
          sub={stats.dateRange}
        />
        <OpenPnlCard trades={openTrades} />
        <KpiCard
          label="Win Rate"
          value={fmtPct(stats.winRate)}
          sub={stats.nBreakevens > 0 ? `${stats.nWins}W / ${stats.nLosses}L / ${stats.nBreakevens}B` : `${stats.nWins}W / ${stats.nLosses}L`}
        />
        <KpiCard label="Avg Win/Loss" value={fmtPf(stats.payoffRatio)} />
        <KpiCard label="Profit Factor" value={fmtPf(stats.profitFactor)} />
        <KpiCard
          label="Avg net trade P&L"
          value={fmtMoney(stats.expectancy)}
          trend={stats.expectancy >= 0 ? 'up' : 'down'}
        />
        <KpiCard label="Trades" value={String(stats.totalTrades)} />
        <KpiCard label="Avg Win" value={fmtMoney2(stats.avgWin)} trend="up" />
        <KpiCard label="Avg Loss" value={fmtMoney2(stats.avgLoss)} trend="down" />
        <KpiCard
          label="Largest Win"
          value={fmtMoney(stats.largestWin)}
          trend="up"
          href={largestWinTrade ? `/trades/${largestWinTrade.id}?from=overview` : undefined}
          hoverTitle={largestWinTrade ? `${largestWinTrade.symbol} trade` : undefined}
          hoverItems={
            largestWinTrade
              ? [
                  fmtHoverDate(largestWinTrade.exitTime),
                  fmtMoneySigned(largestWinTrade.pnl ?? 0),
                ]
              : undefined
          }
        />
        <KpiCard
          label="Largest Loss"
          value={fmtMoney(stats.largestLoss)}
          trend="down"
          href={largestLossTrade ? `/trades/${largestLossTrade.id}?from=overview` : undefined}
          hoverTitle={largestLossTrade ? `${largestLossTrade.symbol} trade` : undefined}
          hoverItems={
            largestLossTrade
              ? [
                  fmtHoverDate(largestLossTrade.exitTime),
                  fmtMoneySigned(largestLossTrade.pnl ?? 0),
                ]
              : undefined
          }
        />
<KpiCard
          label="Consec Wins"
          value={String(stats.maxConsecWins)}
          sub="max streak"
        />
        <KpiCard
          label="Consec Losses"
          value={String(stats.maxConsecLosses)}
          sub="max streak"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Account Equity</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountEquityCurve data={navData} changes={navChanges} deposits={cashDeposits} spy={spyReturns} qqq={qqqReturns} height={240} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Cumulative P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <EquityCurve data={equity} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
