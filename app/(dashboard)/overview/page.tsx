import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary, equityCurve, byDay } from '@/lib/metrics'
import { KpiCard } from '@/components/kpi/kpi-card'
import { EquityCurve } from '@/components/charts/equity-curve'
import { PnlBar } from '@/components/charts/pnl-bar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  const closedTrades = trades.filter((t) => t.exitTime && t.pnl != null)
  const largestWinTrade = closedTrades.length
    ? closedTrades.reduce((best, t) => ((best == null || (t.pnl ?? -Infinity) > (best.pnl ?? -Infinity)) ? t : best), null as typeof closedTrades[number] | null)
    : null
  const largestLossTrade = closedTrades.length
    ? closedTrades.reduce((worst, t) => ((worst == null || (t.pnl ?? Infinity) < (worst.pnl ?? Infinity)) ? t : worst), null as typeof closedTrades[number] | null)
    : null
  const closedByDate = new Map<string, typeof trades>()
  for (const t of trades) {
    if (!t.exitTime) continue
    const date = t.exitTime.slice(0, 10)
    const dayTrades = closedByDate.get(date) ?? []
    dayTrades.push(t)
    closedByDate.set(date, dayTrades)
  }
  const daily = byDay(trades).map(d => ({
    label: d.date.slice(5),
    value: d.pnl,
    href: `/trades?date=${d.date}`,
    hoverTitle: `${d.date} (${closedByDate.get(d.date)?.length ?? 0} trades)`,
    hoverItems: (() => {
      const dayTrades = closedByDate.get(d.date) ?? []
      const items = dayTrades
        .slice(0, 6)
        .map((t) => `${t.symbol} ${fmtMoneySigned(t.pnl ?? 0)}`)
      if (dayTrades.length > 6) items.push(`+${dayTrades.length - 6} more`)
      return items
    })(),
  }))

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
