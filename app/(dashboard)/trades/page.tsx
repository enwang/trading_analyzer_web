import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { Badge } from '@/components/ui/badge'
import { LocalTime } from '@/components/ui/local-time'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function pnlClass(outcome: string | null) {
  if (outcome === 'win') return 'text-emerald-600'
  if (outcome === 'loss') return 'text-red-600'
  return ''
}

function fmtPrice(n: number | null) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (outcome === 'win')
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
        Win
      </Badge>
    )
  if (outcome === 'loss')
    return (
      <Badge className="bg-red-100 text-red-700 border border-red-200">Loss</Badge>
    )
  if (outcome === 'breakeven') return <Badge variant="outline">Breakeven</Badge>
  if (outcome === 'open') return <Badge variant="secondary">Open</Badge>
  return <Badge variant="outline">{outcome ?? '—'}</Badge>
}

export default async function TradesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user!.id)
    .order('entry_time', { ascending: false })
    .limit(1000)

  const trades = (rows ?? []).map(rowToTrade)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">All Trades ({trades.length})</h1>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Exit</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Entry $</TableHead>
              <TableHead className="text-right">Exit $</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="text-right">P&L %</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Setup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="text-center text-muted-foreground py-10"
                >
                  No trades yet. Go to{' '}
                  <a href="/import" className="text-blue-600 hover:underline">
                    Import
                  </a>{' '}
                  to add trades.
                </TableCell>
              </TableRow>
            )}
            {trades.map(t => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.symbol}</TableCell>
                <TableCell className="capitalize">{t.side ?? '—'}</TableCell>
                <TableCell>
                  <LocalTime date={t.entryTime} className="text-muted-foreground text-xs font-mono" />
                </TableCell>
                <TableCell>
                  <LocalTime date={t.exitTime} className="text-muted-foreground text-xs font-mono" />
                </TableCell>
                <TableCell className="text-right">{t.shares ?? '—'}</TableCell>
                <TableCell className="text-right">{fmtPrice(t.entryPrice)}</TableCell>
                <TableCell className="text-right">{fmtPrice(t.exitPrice)}</TableCell>
                <TableCell
                  className={`text-right font-medium ${pnlClass(t.outcome)}`}
                >
                  {t.pnl != null
                    ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`
                    : '—'}
                </TableCell>
                <TableCell className={`text-right ${pnlClass(t.outcome)}`}>
                  {t.pnlPct != null
                    ? `${(t.pnlPct * 100).toFixed(2)}%`
                    : '—'}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={t.outcome} />
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {t.setupTag}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
