import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { computeSummary } from '@/lib/metrics'
import {
  computeDayOfWeekDetail,
  detectTradingPatterns,
  computePerformanceScore,
} from '@/lib/report-metrics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConsistencyDashboard } from '@/components/report/consistency-dashboard'
import { DayOfWeekChart } from '@/components/report/day-of-week-chart'
import { TradingPatterns } from '@/components/report/trading-patterns'
import { PerformanceScore } from '@/components/report/performance-score'
import Link from 'next/link'

function fmt$(n: number) {
  const abs = Math.abs(n)
  const s = `$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return n < 0 ? `-${s}` : s
}

export default async function ReportPage() {
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
  const dayOfWeek = computeDayOfWeekDetail(trades)
  const patterns = detectTradingPatterns(trades)
  const score = computePerformanceScore(stats)

  const closed = trades.filter((t) => t.outcome !== 'open' && t.pnl != null)
  const worstTrades = [...closed].sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0)).slice(0, 3)
  const bestTrades = [...closed].sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0)).slice(0, 3)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Performance Report</h1>
        {stats.dateRange !== 'N/A' && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.totalTrades} trades &middot; {stats.dateRange}
          </p>
        )}
      </div>

      {/* ââ Score + Consistency âââââââââââââââââââââââââââââââââââ */}
      <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
        <Card>
          <CardContent className="pt-4">
            <PerformanceScore score={score} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Trading Consistency</CardTitle>
          </CardHeader>
          <CardContent>
            <ConsistencyDashboard stats={stats} score={score} />
          </CardContent>
        </Card>
      </div>

      {/* ââ Day of Week âââââââââââââââââââââââââââââââââââââââââââ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">P&amp;L by Day of Week</CardTitle>
        </CardHeader>
        <CardContent>
          {dayOfWeek.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed trades yet.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
              <DayOfWeekChart data={dayOfWeek} />
              {/* Detail table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Day</th>
                      <th className="pb-2 text-right font-medium">P&amp;L</th>
                      <th className="pb-2 text-right font-medium">W</th>
                      <th className="pb-2 text-right font-medium">L</th>
                      <th className="pb-2 text-right font-medium">Win%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dayOfWeek.map((row) => (
                      <tr key={row.day}>
                        <td className="py-2 pr-4 font-medium">{row.day}</td>
                        <td
                          className={`py-2 text-right tabular-nums font-semibold ${
                            row.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {fmt$(row.totalPnl)}
                        </td>
                        <td className="py-2 text-right text-emerald-600 tabular-nums">
                          {row.wins}
                        </td>
                        <td className="py-2 text-right text-red-600 tabular-nums">
                          {row.losses}
                        </td>
                        <td className="py-2 text-right text-muted-foreground tabular-nums">
                          {(row.winRate * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ââ Trading Patterns ââââââââââââââââââââââââââââââââââââââ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Trading Patterns Detected</CardTitle>
        </CardHeader>
        <CardContent>
          <TradingPatterns patterns={patterns} />
        </CardContent>
      </Card>

      {/* ââ Notable Trades ââââââââââââââââââââââââââââââââââââââââ */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Largest Losses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {worstTrades.length === 0 && (
                <p className="text-sm text-muted-foreground">No closed trades yet.</p>
              )}
              {worstTrades.map((t) => (
                <Link
                  key={t.id}
                  href={`/trades/${t.id}?from=report`}
                  className="flex items-center justify-between rounded-md border border-red-200/60 bg-red-50/40 dark:bg-red-900/10 dark:border-red-900/30 px-3 py-2 hover:bg-red-50/70 dark:hover:bg-red-900/20 transition-colors"
                >
                  <div>
                    <span className="font-semibold text-sm">{t.symbol}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.exitTime?.slice(0, 10) ?? 'â'}
                    </span>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-red-600">
                    {fmt$(t.pnl ?? 0)}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Largest Wins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {bestTrades.length === 0 && (
                <p className="text-sm text-muted-foreground">No closed trades yet.</p>
              )}
              {bestTrades.map((t) => (
                <Link
                  key={t.id}
                  href={`/trades/${t.id}?from=report`}
                  className="flex items-center justify-between rounded-md border border-emerald-200/60 bg-emerald-50/40 dark:bg-emerald-900/10 dark:border-emerald-900/30 px-3 py-2 hover:bg-emerald-50/70 dark:hover:bg-emerald-900/20 transition-colors"
                >
                  <div>
                    <span className="font-semibold text-sm">{t.symbol}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.exitTime?.slice(0, 10) ?? 'â'}
                    </span>
                  </div>
                  <span className="tabular-nums text-sm font-semibold text-emerald-600">
                    {fmt$(t.pnl ?? 0)}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
