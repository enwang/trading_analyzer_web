import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
}

export function KpiCard({ label, value, sub, trend }: KpiCardProps) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="pb-0">
        <CardTitle className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            'text-2xl font-bold tabular-nums',
            trend === 'up' && 'text-emerald-600',
            trend === 'down' && 'text-red-600'
          )}
        >
          {value}
        </p>
        {sub && <p className="text-muted-foreground text-xs mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}
