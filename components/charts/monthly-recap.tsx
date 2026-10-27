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
  return `${n.toFixed(2)}D`
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
  selectedMonthKey?: string | null
  onSelectMonth?: (monthKey: string) => void
}

function StatCell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="bg-card px-2 py-1.5">
      <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={`font-mono text-[13px] ${className ?? ''}`}>{value}</div>
    </div>
  )
}

type StatsLike = MonthlyStatsRow | YearlyAveragesRow

function MobileStatsBlock({
  label,
  row,
  yearly = false,
  selected = false,
  onSelect,
}: {
  label: string
  row: StatsLike
  yearly?: boolean
  selected?: boolean
  onSelect?: () => void
}) {
  return (
    <div className="border-t first:border-t-0">
      <div className={`flex items-center px-3 py-2 ${yearly ? 'bg-muted/30 font-semibold' : ''} ${selected ? 'bg-muted/50' : ''}`}>
        {onSelect ? (
          <button type="button" className="text-sm font-medium underline-offset-4 hover:underline" onClick={onSelect}>
            {label}
          </button>
        ) : (
          <span className="text-sm">{label}</span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-px border-t bg-border">
        <StatCell label="Avg Gain %" value={fmtPct(row.avgGainPct)} className="text-emerald-600" />
        <StatCell label="Avg Loss %" value={fmtPct(row.avgLossPct)} className="text-red-600" />
        <StatCell label="Win %" value={fmtPct(row.winPct)} />
        <StatCell label="Avg Win $" value={fmtMoney(row.avgWin)} className="text-emerald-600" />
        <StatCell label="Avg Loss $" value={fmtMoney(row.avgLoss)} className="text-red-600" />
        {/* No Loss % cell: it is always 1 − Win %, no extra information. */}
        <StatCell label="Wins" value={String(row.wins)} />
        <StatCell label="Losses" value={String(row.losses)} />
        <StatCell label="Trades" value={String(row.trades)} />
        <StatCell label="LG Gain" value={fmtPct(row.largestGainPct)} className="text-emerald-600" />
        <StatCell label="LG Loss" value={fmtPct(row.largestLossPct)} className="text-red-600" />
        <StatCell label="Avg Hold Win" value={fmtDays(row.avgDaysGain)} />
        <StatCell label="Avg Hold Loss" value={fmtDays(row.avgDaysLoss)} />
      </div>
    </div>
  )
}

export function MonthlyRecap({ year, returns, stats, yearly, selectedMonthKey, onSelectMonth }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{year} Recap — Monthly Returns</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Phone layout: NAV and return shown as stacked pairs so every
              figure stays visible without sideways scrolling. */}
          <div className="overflow-x-auto sm:hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Month</th>
                  <th className="px-2 py-2 text-right">NAV End</th>
                  <th className="px-2 py-2 text-right">Mo Return</th>
                  <th className="px-2 py-2 text-right">Cum Return</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((row) => (
                  <tr key={row.monthKey} className={`border-t ${selectedMonthKey === row.monthKey ? 'bg-muted/50' : ''}`}>
                    <td className="px-2 py-2 font-medium">
                      <button
                        type="button"
                        className="underline-offset-4 hover:underline"
                        onClick={() => onSelectMonth?.(row.monthKey)}
                      >
                        {row.monthLabel}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{fmtMoney(row.endingNav)}</td>
                    <td className={`px-2 py-2 text-right font-mono ${returnClass(row.monthReturnPct)}`}>
                      {fmtPct(row.monthReturnPct, true)}
                    </td>
                    <td className={`px-2 py-2 text-right font-mono ${returnClass(row.cumulativeReturnPct)}`}>
                      {fmtPct(row.cumulativeReturnPct, true)}
                    </td>
                  </tr>
                ))}
                {returns.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-muted-foreground">
                      No NAV data yet. Run a sync after enabling Net Asset Value (NAV) in Base in your Flex Query.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 sm:px-3 text-left">Month</th>
                  <th className="px-2 py-2 text-right sm:px-3">Starting NAV</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Ending NAV</th>
                  <th className="px-2 py-2 text-right sm:px-3">Deposits / Withdrawals</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Month Return</th>
                  <th className="px-2 py-2 text-right sm:px-3">Cumulative Return</th>
                </tr>
              </thead>
              <tbody>
                {returns.map((row) => (
                  <tr key={row.monthKey} className={`border-t ${selectedMonthKey === row.monthKey ? 'bg-muted/50' : ''}`}>
                    <td className="px-2 py-2 sm:px-3 font-medium">
                      <button
                        type="button"
                        className="underline-offset-4 hover:underline"
                        onClick={() => onSelectMonth?.(row.monthKey)}
                      >
                        {row.monthLabel}
                      </button>
                    </td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtMoney(row.startingNav)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtMoney(row.endingNav)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{row.depositsWithdrawals != null ? fmtMoney(row.depositsWithdrawals) : '—'}</td>
                    <td className={`px-2 py-2 sm:px-3 text-right font-mono ${returnClass(row.monthReturnPct)}`}>
                      {fmtPct(row.monthReturnPct, true)}
                    </td>
                    <td className={`px-2 py-2 sm:px-3 text-right font-mono ${returnClass(row.cumulativeReturnPct)}`}>
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
          {/* Phone layout: one mini stat grid per month — all 13 figures,
              no sideways scrolling. The wide table below is sm+ only. */}
          <div className="sm:hidden">
            <MobileStatsBlock label={yearly.year} row={yearly} yearly />
            {stats.map((row) => (
              <MobileStatsBlock
                key={row.monthKey}
                label={row.monthLabel}
                row={row}
                selected={selectedMonthKey === row.monthKey}
                onSelect={() => onSelectMonth?.(row.monthKey)}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 sm:px-3 text-left">Month</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Avg Gain %</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Avg Win $</th>
                  <th className="px-2 py-2 text-right sm:px-3">Avg Loss %</th>
                  <th className="px-2 py-2 text-right sm:px-3">Avg Loss $</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Win %</th>
                  <th className="px-2 py-2 text-right sm:px-3">Loss %</th>
                  <th className="px-2 py-2 text-right sm:px-3">Wins</th>
                  <th className="px-2 py-2 text-right sm:px-3">Losses</th>
                  <th className="px-2 py-2 sm:px-3 text-right">Trades</th>
                  <th className="px-2 py-2 text-right sm:px-3">LG Gain</th>
                  <th className="px-2 py-2 text-right sm:px-3">LG Loss</th>
                  <th className="px-2 py-2 text-right sm:px-3">Avg Hold Win</th>
                  <th className="px-2 py-2 text-right sm:px-3">Avg Hold Loss</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-2 py-2 sm:px-3">{yearly.year}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtPct(yearly.avgGainPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtMoney(yearly.avgWin)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtPct(yearly.avgLossPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtMoney(yearly.avgLoss)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtPct(yearly.winPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtPct(yearly.lossPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{yearly.wins}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{yearly.losses}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{yearly.trades}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtPct(yearly.largestGainPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtPct(yearly.largestLossPct)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtDays(yearly.avgDaysGain)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtDays(yearly.avgDaysLoss)}</td>
                </tr>
                {stats.map((row) => (
                  <tr key={row.monthKey} className={`border-t ${selectedMonthKey === row.monthKey ? 'bg-muted/50' : ''}`}>
                    <td className="px-2 py-2 sm:px-3 font-medium">
                      <button
                        type="button"
                        className="underline-offset-4 hover:underline"
                        onClick={() => onSelectMonth?.(row.monthKey)}
                      >
                        {row.monthLabel}
                      </button>
                    </td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtPct(row.avgGainPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtMoney(row.avgWin)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtPct(row.avgLossPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtMoney(row.avgLoss)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtPct(row.winPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtPct(row.lossPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{row.wins}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{row.losses}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{row.trades}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-emerald-600">{fmtPct(row.largestGainPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono text-red-600">{fmtPct(row.largestLossPct)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtDays(row.avgDaysGain)}</td>
                    <td className="px-2 py-2 sm:px-3 text-right font-mono">{fmtDays(row.avgDaysLoss)}</td>
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
