'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  computeMonthlyReturns,
  computeBenchmarkMonthlyReturns,
  type NavDailyRow,
  type NavChangeRow,
  type CashTransactionRow,
  type BenchmarkPoint,
} from '@/lib/monthly-recap'

interface Props {
  navData: NavDailyRow[]
  navChanges: NavChangeRow[]
  cashDeposits: CashTransactionRow[]
  spyReturns: BenchmarkPoint[]
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  const s = `${Math.abs(n).toFixed(2)}%`
  return n < 0 ? `-${s}` : `+${s}`
}

function returnClass(n: number | null) {
  if (n == null) return ''
  if (n > 0) return 'text-emerald-600'
  if (n < 0) return 'text-red-600'
  return ''
}

/**
 * Compact "recent months vs SPY" card for the Overview. Uses the full
 * (unfiltered) NAV + SPY series: calendar months, independent of the page's
 * date-range selector. The current month is month-to-date on both sides.
 */
export function MonthlyBenchmarkCard({ navData, navChanges, cashDeposits, spyReturns }: Props) {
  const rows = useMemo(() => {
    const { rows: monthly } = computeMonthlyReturns(navData, navChanges, cashDeposits)
    const spyMonthly = computeBenchmarkMonthlyReturns(spyReturns)
    return monthly
      .slice(-3)
      .reverse()
      .map((r) => {
        const spy = spyMonthly[r.monthKey] ?? null
        const excess = r.monthReturnPct != null && spy != null ? r.monthReturnPct - spy : null
        return { monthKey: r.monthKey, monthLabel: r.monthLabel, you: r.monthReturnPct, spy, excess }
      })
  }, [navData, navChanges, cashDeposits, spyReturns])

  if (rows.length === 0) return null
  const currentMonthKey = new Date().toISOString().slice(0, 7)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Monthly vs SPY</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Month</th>
              <th className="px-3 py-2 text-right">You</th>
              <th className="px-3 py-2 text-right">SPY</th>
              <th className="px-3 py-2 text-right">Excess</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.monthKey} className="border-t">
                <td className="px-3 py-2 font-medium">
                  {r.monthLabel}
                  {r.monthKey === currentMonthKey && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">MTD</span>
                  )}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${returnClass(r.you)}`}>{fmtPct(r.you)}</td>
                <td className={`px-3 py-2 text-right font-mono ${returnClass(r.spy)}`}>{fmtPct(r.spy)}</td>
                <td className={`px-3 py-2 text-right font-mono font-semibold ${returnClass(r.excess)}`}>
                  {fmtPct(r.excess)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-3 py-2 text-right">
          <Link href="/analysis" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
            Full monthly breakdown in Analysis →
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
