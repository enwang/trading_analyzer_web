'use client'

import { useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import type { NavDailyRow, NavChangeRow } from '@/lib/monthly-recap'
import { computeMonthlyReturns } from '@/lib/monthly-recap'

interface DepositRow {
  transaction_ts: string  // ISO 8601 UTC
  amount: number
}

interface BenchmarkRow {
  date: string
  pct: number
}

interface ChartPoint {
  date: string
  total: number
  pct: number
  spyPct?: number
  qqqPct?: number
  soxxPct?: number
}

interface Props {
  data: NavDailyRow[]
  changes?: NavChangeRow[]
  deposits?: DepositRow[]
  spy?: BenchmarkRow[]
  qqq?: BenchmarkRow[]
  soxx?: BenchmarkRow[]
  height?: number
  disableAnchors?: boolean
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/**
 * Compute daily TWR.
 *
 * Path 1 — exact deposit data available (`deposits` non-empty):
 *   For each deposit, find the NAV day within ±1..+3 days where the change
 *   most closely matches the deposit amount (IBKR settles deposits next trading day).
 *
 * Path 2 — no exact deposits, only period-level `changes`:
 *   Find the single day within each deposit period where NAV jumped the most
 *   in the deposit direction (>4%).
 */
function computeDailyTWR(
  navRows: NavDailyRow[],
  deposits: DepositRow[],
  changes: NavChangeRow[],
  disableAnchors = false,
): ChartPoint[] {
  const validRows = navRows
    .filter((r): r is NavDailyRow & { total: number } => r.total != null)
    .sort((a, b) => a.report_date.localeCompare(b.report_date))

  if (validRows.length === 0) return []

  // Build deposit skip-dates (Path 1: exact timestamps available)
  const skipDates = new Set<string>()
  if (deposits.length > 0) {
    for (const d of deposits) {
      if (Math.abs(d.amount) < 500) continue
      const txDate = d.transaction_ts.slice(0, 10)
      // IBKR timestamps deposits at initiation but NAV reflects them on the settlement day
      // (often the next trading day). Find the day within a ±1..+3 day window where the
      // NAV change most closely matches the deposit amount.
      const windowStart = (() => { const dt = new Date(txDate + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() - 1); return dt.toISOString().slice(0, 10) })()
      const windowEnd = (() => { const dt = new Date(txDate + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + 3); return dt.toISOString().slice(0, 10) })()
      const inWindow = validRows.filter(r => r.report_date >= windowStart && r.report_date <= windowEnd)
      let bestDate = txDate
      let bestDiff = Infinity
      for (let i = 1; i < inWindow.length; i++) {
        const prev = inWindow[i - 1]
        const curr = inWindow[i]
        const diff = Math.abs((curr.total - prev.total) - d.amount)
        if (diff < bestDiff) { bestDiff = diff; bestDate = curr.report_date }
      }
      skipDates.add(bestDate)
    }
  } else if (changes.length > 0) {
    // Path 2: find largest NAV jump day (>4%) within each deposit period
    const depositPeriods = changes.filter(
      (c) => c.deposits_withdrawals != null && Math.abs(c.deposits_withdrawals) >= 500
    )
    for (const change of depositPeriods) {
      const dep = change.deposits_withdrawals!
      const inPeriod = validRows.filter(
        (r) => r.report_date >= change.from_date && r.report_date <= change.to_date
      )
      if (inPeriod.length < 2) continue
      let bestDate: string | null = null
      let bestJumpPct = 0.04
      for (let i = 1; i < inPeriod.length; i++) {
        const prev = inPeriod[i - 1]
        const curr = inPeriod[i]
        if (prev.total <= 0) continue
        const jumpPct = (curr.total - prev.total) / prev.total
        if (dep > 0 && jumpPct > bestJumpPct) { bestJumpPct = jumpPct; bestDate = curr.report_date }
        if (dep < 0 && jumpPct < -bestJumpPct) { bestJumpPct = Math.abs(jumpPct); bestDate = curr.report_date }
      }
      if (bestDate) skipDates.add(bestDate)
    }
  }

  // Build month-end anchors from computeMonthlyReturns (authoritative deposit-adjusted TWR).
  // At the last trading day of each month, snap the running factor to this value so the
  // chart's month-end cumulative % matches the Analysis tab exactly.
  const monthlyAnchors = new Map<string, number>()
  // Match the Analysis tab: scope monthly anchors to the latest year with data so
  // the deposit "first-month" fallback lands on the correct month (e.g. Jan 2026,
  // not Dec 2025 if a year-end NAV snapshot exists).
  const navYears = [...new Set(navRows.map(r => r.report_date.slice(0, 4)))].sort()
  const recapYear = navYears[navYears.length - 1] ?? ''
  const navForAnchors = recapYear ? navRows.filter(r => r.report_date.startsWith(recapYear)) : navRows
  const monthlyResult = computeMonthlyReturns(navForAnchors, changes)
  for (const row of monthlyResult.rows) {
    if (row.cumulativeReturnPct != null) {
      monthlyAnchors.set(row.monthKey, 1 + row.cumulativeReturnPct / 100)
    }
  }
  // Determine the last observed date for each month
  const monthEndDate = new Map<string, string>()
  for (const row of validRows) {
    monthEndDate.set(row.report_date.slice(0, 7), row.report_date)
  }

  // Chain daily returns; snap factor to monthly TWR anchor at each month-end
  let factor = 1
  const points: ChartPoint[] = []
  points.push({ date: validRows[0].report_date, total: validRows[0].total, pct: 0 })

  for (let i = 1; i < validRows.length; i++) {
    const prev = validRows[i - 1]
    const curr = validRows[i]
    if (!skipDates.has(curr.report_date) && prev.total > 0) {
      factor *= curr.total / prev.total
    }
    // At month-end, override with the authoritative monthly TWR value
    // (disabled for sub-month views where anchors are relative to a different start)
    if (!disableAnchors) {
      const monthKey = curr.report_date.slice(0, 7)
      if (monthEndDate.get(monthKey) === curr.report_date) {
        const anchor = monthlyAnchors.get(monthKey)
        if (anchor != null) factor = anchor
      }
    }
    points.push({ date: curr.report_date, total: curr.total, pct: (factor - 1) * 100 })
  }

  return points
}

export function AccountEquityCurve({ data, changes = [], deposits = [], spy = [], qqq = [], soxx = [], height = 240, disableAnchors = false }: Props) {
  const [showSpy, setShowSpy] = useState(false)
  const [showQqq, setShowQqq] = useState(false)
  const [showSoxx, setShowSoxx] = useState(false)

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        No account data yet — sync from IBKR to populate
      </div>
    )
  }

  const rawPoints = computeDailyTWR(data, deposits, changes, disableAnchors)

  if (!rawPoints.length) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        Insufficient data to compute return
      </div>
    )
  }

  // Merge benchmark data by date (forward-fill missing dates)
  const spyMap = new Map(spy.map(r => [r.date, r.pct]))
  const qqqMap = new Map(qqq.map(r => [r.date, r.pct]))
  const soxxMap = new Map(soxx.map(r => [r.date, r.pct]))
  let lastSpyPct: number | undefined
  let lastQqqPct: number | undefined
  let lastSoxxPct: number | undefined
  const points: ChartPoint[] = rawPoints.map(p => {
    const spyVal = spyMap.has(p.date) ? spyMap.get(p.date)! : lastSpyPct
    const qqqVal = qqqMap.has(p.date) ? qqqMap.get(p.date)! : lastQqqPct
    const soxxVal = soxxMap.has(p.date) ? soxxMap.get(p.date)! : lastSoxxPct
    if (spyVal !== undefined) lastSpyPct = spyVal
    if (qqqVal !== undefined) lastQqqPct = qqqVal
    if (soxxVal !== undefined) lastSoxxPct = soxxVal
    return { ...p, spyPct: spyVal, qqqPct: qqqVal, soxxPct: soxxVal }
  })

  const allPcts = points.map(p => p.pct)
  if (showSpy) points.forEach(p => p.spyPct !== undefined && allPcts.push(p.spyPct))
  if (showQqq) points.forEach(p => p.qqqPct !== undefined && allPcts.push(p.qqqPct))
  if (showSoxx) points.forEach(p => p.soxxPct !== undefined && allPcts.push(p.soxxPct))
  const minPct = Math.min(...allPcts)
  const maxPct = Math.max(...allPcts)
  const lastPct = points[points.length - 1].pct
  const color = lastPct >= 0 ? '#22c55e' : '#ef4444'

  return (
    <div>
      {(spy.length > 0 || qqq.length > 0 || soxx.length > 0) && (
        <div className="mb-2 flex gap-2">
          {spy.length > 0 && (
            <button
              onClick={() => setShowSpy(v => !v)}
              className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${showSpy ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400' : 'border-gray-200 text-gray-400 dark:border-gray-700'}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#3b82f6' }} />
              SPY
            </button>
          )}
          {qqq.length > 0 && (
            <button
              onClick={() => setShowQqq(v => !v)}
              className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${showQqq ? 'border-purple-400 bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400' : 'border-gray-200 text-gray-400 dark:border-gray-700'}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#a855f7' }} />
              QQQ
            </button>
          )}
          {soxx.length > 0 && (
            <button
              onClick={() => setShowSoxx(v => !v)}
              className={`flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium border transition-colors ${showSoxx ? 'border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400' : 'border-gray-200 text-gray-400 dark:border-gray-700'}`}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: '#f59e0b' }} />
              SOXX
            </button>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickFormatter={formatDate}
            minTickGap={40}
            label={{ value: 'Date', position: 'insideBottom', offset: -12, fontSize: 11 }}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
            width={64}
            domain={[Math.floor(minPct - 1), Math.ceil(maxPct + 1)]}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as ChartPoint
              const d = new Date(String(label) + 'T00:00:00')
              const dateStr = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              return (
                <div className="rounded border bg-white px-3 py-2 text-xs shadow-md dark:bg-gray-900 dark:border-gray-700">
                  <div className="mb-1 font-medium text-gray-500 dark:text-gray-400">{dateStr}</div>
                  <div className="font-semibold">{fmtMoney(p.total)}</div>
                  <div style={{ color }}>{fmtPct(p.pct)}</div>
                  {showSpy && p.spyPct !== undefined && (
                    <div style={{ color: '#3b82f6' }}>SPY {fmtPct(p.spyPct)}</div>
                  )}
                  {showQqq && p.qqqPct !== undefined && (
                    <div style={{ color: '#a855f7' }}>QQQ {fmtPct(p.qqqPct)}</div>
                  )}
                  {showSoxx && p.soxxPct !== undefined && (
                    <div style={{ color: '#f59e0b' }}>SOXX {fmtPct(p.soxxPct)}</div>
                  )}
                </div>
              )
            }}
          />
          <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="pct"
            stroke={color}
            dot={false}
            strokeWidth={2}
            activeDot={{ r: 4 }}
          />
          {showSpy && (
            <Line
              type="monotone"
              dataKey="spyPct"
              stroke="#3b82f6"
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              activeDot={{ r: 3 }}
              connectNulls
            />
          )}
          {showQqq && (
            <Line
              type="monotone"
              dataKey="qqqPct"
              stroke="#a855f7"
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              activeDot={{ r: 3 }}
              connectNulls
            />
          )}
          {showSoxx && (
            <Line
              type="monotone"
              dataKey="soxxPct"
              stroke="#f59e0b"
              dot={false}
              strokeWidth={1.5}
              strokeDasharray="4 2"
              activeDot={{ r: 3 }}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
