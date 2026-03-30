'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import type { DayOfWeekRow } from '@/lib/report-metrics'

interface Props {
  data: DayOfWeekRow[]
}

function fmtMoney(n: number) {
  const abs = Math.abs(n)
  const s = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toFixed(0)}`
  return n < 0 ? `-${s}` : s
}

// Abbreviated day names for narrow columns
function abbrev(day: string) {
  return day.slice(0, 3)
}

export function DayOfWeekChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No closed trades to display.
      </p>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <XAxis
          dataKey="day"
          tickFormatter={abbrev}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={fmtMoney}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip
          formatter={(val: number) => [fmtMoney(val), 'Total P&L']}
          labelFormatter={(label) => label}
          contentStyle={{ fontSize: 12 }}
        />
        <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
        <Bar dataKey="totalPnl" radius={[4, 4, 0, 0]}>
          {data.map((row) => (
            <Cell
              key={row.day}
              fill={row.totalPnl >= 0 ? 'hsl(142 71% 45%)' : 'hsl(0 72% 51%)'}
              fillOpacity={0.82}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
