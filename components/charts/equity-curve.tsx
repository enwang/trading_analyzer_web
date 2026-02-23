'use client'

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
import type { EquityPoint } from '@/types/trade'

interface Props {
  data: EquityPoint[]
}

export function EquityCurve({ data }: Props) {
  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        No trades yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 20, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="tradeNum"
          tick={{ fontSize: 11 }}
          label={{ value: 'Trade #', position: 'insideBottom', offset: -12, fontSize: 11 }}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `$${v >= 0 ? '' : '-'}${Math.abs(v).toFixed(0)}`}
          width={72}
        />
        <Tooltip
          formatter={(val) => {
            const n = typeof val === 'number' ? val : 0
            return [`$${n.toFixed(2)}`, 'Cumulative P&L']
          }}
          labelFormatter={(label) => `Trade #${label}`}
        />
        <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="4 2" />
        <Line
          type="monotone"
          dataKey="cumulativePnl"
          stroke="#3b82f6"
          dot={false}
          strokeWidth={2}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
