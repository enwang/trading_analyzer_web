'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts'

export interface PnlPoint {
  label: string
  value: number
}

interface Props {
  data: PnlPoint[]
  height?: number
  valuePrefix?: string
  valueSuffix?: string
  tooltipLabel?: string
}

export function PnlBar({
  data,
  height = 200,
  valuePrefix = '$',
  valueSuffix = '',
  tooltipLabel = 'P&L',
}: Props) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) =>
            `${valuePrefix}${Math.abs(v).toFixed(0)}${valueSuffix}`
          }
          width={64}
        />
        <Tooltip
          formatter={(val) => {
            const n = typeof val === 'number' ? val : 0
            return [`${valuePrefix}${n.toFixed(2)}${valueSuffix}`, tooltipLabel]
          }}
        />
        <ReferenceLine y={0} stroke="#9ca3af" />
        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.value >= 0 ? '#10b981' : '#ef4444'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
