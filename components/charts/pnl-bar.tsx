'use client'

import { useRouter } from 'next/navigation'
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
  href?: string
  hoverTitle?: string
  hoverItems?: string[]
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
  const router = useRouter()

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
      <BarChart
        data={data}
        margin={{ top: 4, right: 8, bottom: 4, left: 0 }}
        onClick={(state) => {
          const rawIdx = state?.activeTooltipIndex
          const idx = typeof rawIdx === 'number' ? rawIdx : Number(rawIdx)
          if (!Number.isFinite(idx)) return
          const href = data[idx]?.href
          if (href) router.push(href)
        }}
      >
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
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const point = payload[0]?.payload as PnlPoint | undefined
            if (!point) return null
            return (
              <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
                <div className="font-medium">{point.hoverTitle ?? point.label}</div>
                <div className="text-muted-foreground">
                  {tooltipLabel}: {`${valuePrefix}${point.value.toFixed(2)}${valueSuffix}`}
                </div>
                {point.hoverItems && point.hoverItems.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {point.hoverItems.map((item, idx) => (
                      <div key={`${point.label}-${idx}`}>{item}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          }}
        />
        <ReferenceLine y={0} stroke="#9ca3af" />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} cursor={data.some((d) => !!d.href) ? 'pointer' : 'default'}>
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
