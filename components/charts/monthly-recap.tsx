'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MonthlyReturnRow, MonthlyStatsRow, YearlyAveragesRow } from '@/lib/monthly-recap'

function fmtPct(n: number | null, sign = false): string {
  if (n == null) return '—'
  const s = `${Math.abs(n).toFixed(2)}%`
  if (!sign) return n < 0 ? `-${s}` : s
  return n < 0 ? `-${s}` : `+${s}`
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  const abs = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
  return n < 0 ? `-$${abs}` : `$${abs}`
}

function fmtDays(n: number | null): string {
  if (n == null) return '—'
  return n.toFixed(2)
}

function returnClass(n: number | null) {
  if (n == null) return ''
  if (n > 0) return 'text-emerald-600'
  if (n < 0) return 'text-red-600'
  return ''
}

interface Props {
  year: string
  returns: MonthlyReturnRow[]
  stats: MonthlyStatsRow[]
  yearly: YearlyAveragesRow
}

export function MonthlyRecap({ year, returns, stats, yearly }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{year} Recap — Monthly Returns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-right">Starting NAV</th>
                  <th className="px-3 py-2 text-right">Ending NAV</th>
                  <th className="px-3 py-2 text-right">Deposits / Withdrawals</th>
                  <th className="px-3 py-2 text-right">Month Return</th>
                  <th className="px-3 py-2 text-right">Cumulative Return</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((row) => (
                  <tr key={row.monthKey} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.monthLabel}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(row.startingNav)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtMoney(row.endingNav)}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.depositsWithdrawals != null ? fmtMoney(row.depositsWithdrawals) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-mono ${returnClass(row.monthReturnPct)}`}>
                      {fmtPct(row.monthReturnPct, true)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${returnClass(row.cumulativeReturnPct)}`}>
                      {fmtPct(row.cumulativeReturnPct, true)}
                    </td>
                  </tr>
                ))}
                {returns.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      No NAV data yet. Run a sync after enabling Net Asset Value (NAV) in Base in your Flex Query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{year} Recap — Monthly Trade Stats</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Month</th>
                  <th className="px-3 py-2 text-right">Avg Gain %</th>
                  <th className="px-3 py-2 text-right">Avg Loss %</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">Loss %</th>
                  <th className="px-3 py-2 text-right">Wins</th>
                  <th className="px-3 py-2 text-right">Losses</th>
                  <th className="px-3 py-2 text-right">Trades</th>
                  <th className="px-3 py-2 text-right">LG Gain</th>
                  <th className="px-3 py-2 text-right">LG Loss</th>
                  <th className="px-3 py-2 text-right">Avg Days Gain</th>
                  <th className="px-3 py-2 text-right">Avg Days Loss</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2">{yearly.year}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtPct(yearly.avgGainPct)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{fmtPct(yearly.avgLossPct)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(yearly.winPct)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtPct(yearly.lossPct)}</td>
                  <td className="px-3 py-2 text-right font-mono">{yearly.wins}</td>
                  <td className="px-3 py-2 text-right font-mono">{yearly.losses}</td>
                  <td className="px-3 py-2 text-right font-mono">{yearly.trades}</td>
                  <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtPct(yearly.largestGainPct)}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{fmtPct(yearly.largestLossPct)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDays(yearly.avgDaysGain)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtDays(yearly.avgDaysLoss)}</td>
                </tr>
                {stats.map((row) => (
                  <tr key={row.monthKey} className="border-t">
                    <td className="px-3 py-2 font-medium">{row.monthLabel}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtPct(row.avgGainPct)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">{fmtPct(row.avgLossPct)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPct(row.winPct)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtPct(row.lossPct)}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.wins}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.losses}</td>
                    <td className="px-3 py-2 text-right font-mono">{row.trades}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-600">{fmtPct(row.largestGainPct)}</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">{fmtPct(row.largestLossPct)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtDays(row.avgDaysGain)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtDays(row.avgDaysLoss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
