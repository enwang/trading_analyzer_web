import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
  href?: string
  hoverTitle?: string
  hoverItems?: string[]
}

export function KpiCard({ label, value, sub, trend, href, hoverTitle, hoverItems }: KpiCardProps) {
  const card = (
    <div className="group relative h-full">
      <Card className={cn('h-full gap-2 py-5', href && 'cursor-pointer transition hover:border-muted-foreground/30')}>
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
      {(hoverTitle || (hoverItems && hoverItems.length > 0)) && (
        <div className="pointer-events-none absolute right-2 top-2 z-20 hidden w-[170px] rounded-md border bg-background/95 p-1.5 text-[11px] shadow-sm group-hover:block">
          {hoverTitle && <div className="font-medium">{hoverTitle}</div>}
          {hoverItems && hoverItems.length > 0 && (
            <div className={`${hoverTitle ? 'mt-0.5' : ''} space-y-0.5 leading-tight`}>
              {hoverItems.map((item, i) => (
                <div key={`${label}-${i}`}>{item}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {card}
      </Link>
    )
  }

  return <div className="block h-full">{card}</div>
}
