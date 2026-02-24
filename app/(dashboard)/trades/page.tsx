import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { TradesTable } from '@/components/trades/trades-table'

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date } = await searchParams
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
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

  const trades = (rows ?? [])
    .map(rowToTrade)
    .filter((t) => {
      if (!safeDate) return true
      const tradeDate = t.exitTime?.slice(0, 10)
      return tradeDate === safeDate
    })

  return <TradesTable trades={trades} />
}
