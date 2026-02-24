import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { LocalTime } from '@/components/ui/local-time'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default async function LosersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user!.id)
    .eq('outcome', 'loss')
    .order('pnl', { ascending: true })
    .limit(200)

  const trades = (rows ?? []).map(rowToTrade)
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Losers ({trades.length})</h1>
        <span className="text-red-600 font-medium">
          ${totalPnl.toFixed(2)} gross
        </span>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Exit</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Entry $</TableHead>
              <TableHead className="text-right">Exit $</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              <TableHead className="text-right">P&L %</TableHead>
              <TableHead className="text-right">Hold (min)</TableHead>
              <TableHead>Setup</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={12}
                  className="text-center text-muted-foreground py-10"
                >
                  No losing trades yet.
                </TableCell>
              </TableRow>
            )}
            {trades.map((t, i) => (
              <TableRow key={t.id}>
                <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="font-medium">{t.symbol}</TableCell>
                <TableCell className="capitalize">{t.side ?? '—'}</TableCell>
                <TableCell>
                  <LocalTime date={t.entryTime} className="text-muted-foreground text-xs font-mono" />
                </TableCell>
                <TableCell>
                  <LocalTime date={t.exitTime} className="text-muted-foreground text-xs font-mono" />
                </TableCell>
                <TableCell className="text-right">{t.shares ?? '—'}</TableCell>
                <TableCell className="text-right">
                  {t.entryPrice != null ? `$${t.entryPrice.toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {t.exitPrice != null ? `$${t.exitPrice.toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className="text-right font-medium text-red-600">
                  {t.pnl != null ? `$${t.pnl.toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className="text-right text-red-600">
                  {t.pnlPct != null ? `${(t.pnlPct * 100).toFixed(2)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {t.holdTimeMin != null ? t.holdTimeMin.toFixed(0) : '—'}
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
