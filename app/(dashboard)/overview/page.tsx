import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary, equityCurve, byDay } from '@/lib/metrics'
import { KpiCard } from '@/components/kpi/kpi-card'
import { EquityCurve } from '@/components/charts/equity-curve'
import { PnlBar } from '@/components/charts/pnl-bar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function fmtMoney(n: number) {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(2)}`
  return n < 0 ? `-${s}` : s
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function fmtPf(n: number) {
  return n === Infinity ? '∞' : n.toFixed(2)
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user!.id)
    .order('entry_time', { ascending: true })

  const trades = (rows ?? []).map(rowToTrade)
  const stats = computeSummary(trades)
  const equity = equityCurve(trades)
  const daily = byDay(trades).map(d => ({ label: d.date.slice(5), value: d.pnl }))

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Overview</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Net P&L"
          value={fmtMoney(stats.netPnl)}
          trend={stats.netPnl >= 0 ? 'up' : 'down'}
          sub={stats.dateRange}
        />
        <KpiCard
          label="Win Rate"
          value={fmtPct(stats.winRate)}
          sub={`${stats.nWins}W / ${stats.nLosses}L`}
        />
        <KpiCard label="Profit Factor" value={fmtPf(stats.profitFactor)} />
        <KpiCard
          label="Expectancy"
          value={fmtMoney(stats.expectancy)}
          trend={stats.expectancy >= 0 ? 'up' : 'down'}
        />
        <KpiCard label="Trades" value={String(stats.totalTrades)} />
        <KpiCard label="Avg Win" value={fmtMoney(stats.avgWin)} trend="up" />
        <KpiCard label="Avg Loss" value={fmtMoney(stats.avgLoss)} trend="down" />
        <KpiCard label="Largest Win" value={fmtMoney(stats.largestWin)} trend="up" />
        <KpiCard label="Largest Loss" value={fmtMoney(stats.largestLoss)} trend="down" />
        <KpiCard label="Max Drawdown" value={fmtMoney(stats.maxDrawdown)} trend="down" />
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
            <CardTitle className="text-sm font-medium">Cumulative P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <EquityCurve data={equity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Daily P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <PnlBar data={daily} height={240} tooltipLabel="Daily P&L" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
