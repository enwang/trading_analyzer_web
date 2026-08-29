import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUserId } from '@/lib/auth/user'
import { rowToTrade } from '@/types/trade'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { TradesTable } from '@/components/trades/trades-table'

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tz?: string; symbol?: string; q?: string }>
}) {
  const startedAt = Date.now()
  const { date, tz, symbol } = await searchParams
  const safeDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
  const safeTz = tz && /^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(tz) ? tz : null
  const safeSymbol = symbol && /^[A-Za-z0-9.^-]{1,10}$/.test(symbol) ? symbol.toUpperCase() : null
  const supabase = await createClient()
  const userId = await getAuthenticatedUserId()
  console.log(`[trades/page] auth=${Date.now() - startedAt}ms`)

  const queryStartedAt = Date.now()
  const [{ data: rows }, { data: navRows }] = await Promise.all([
    supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('entry_time', { ascending: false })
      .limit(1000),
    supabase
      .from('account_nav_daily')
      .select('total')
      .eq('user_id', userId)
      .order('report_date', { ascending: false })
      .limit(1),
  ])
  console.log(`[trades/page] queries=${Date.now() - queryStartedAt}ms rows=${rows?.length ?? 0}`)
  const accountEquity = navRows?.[0]?.total ?? null

  const trades = normalizeTradesForDisplay((rows ?? [])
    .map(rowToTrade))
    .filter((t) => {
      if (safeSymbol && t.symbol !== safeSymbol) return false
      if (!safeDate) return true
      const tradeDate = t.exitTime
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: safeTz ?? 'UTC',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(t.exitTime))
        : null
      return tradeDate === safeDate
    })

  return <TradesTable trades={trades} accountEquity={accountEquity} />
}
