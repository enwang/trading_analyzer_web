import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedUserId } from '@/lib/auth/user'
import { rowToTrade } from '@/types/trade'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { OverviewSyncButton } from '@/components/overview/overview-sync-button'
import { OverviewContent } from '@/components/overview/overview-content'
import { fetchTickerReturns } from '@/lib/market/benchmarks'

export default async function OverviewPage() {
  const supabase = await createClient()
  const userId = await getAuthenticatedUserId()

  const [{ data: rows }, { data: navRows }, { data: navChangeRows }, { data: cashTxRows }] = await Promise.all([
    supabase.from('trades').select('*').eq('user_id', userId).order('entry_time', { ascending: true }),
    supabase.from('account_nav_daily').select('report_date,total').eq('user_id', userId).order('report_date', { ascending: true }),
    supabase.from('account_nav_change').select('*').eq('user_id', userId),
    supabase.from('account_cash_transactions').select('transaction_ts,amount,type').eq('user_id', userId),
  ])

  const trades = normalizeTradesForDisplay((rows ?? []).map(rowToTrade))
  const navData = navRows ?? []
  const navChanges = navChangeRows ?? []

  const cashDeposits = (cashTxRows ?? [])
    .filter((r) => {
      const t = (r.type as string | null)?.toLowerCase() ?? ''
      if (t) return t.includes('deposit') || t.includes('withdrawal') || t.includes('transfer')
      return Math.abs(r.amount as number) >= 500
    })
    .map((r) => ({ transaction_ts: r.transaction_ts as string, amount: r.amount as number }))

  const navStart = navData.find(r => r.report_date >= '2026-01-01')?.report_date ?? navData[0]?.report_date ?? '2026-01-01'
  const navEnd = navData[navData.length - 1]?.report_date ?? new Date().toISOString().slice(0, 10)
  const [spyReturns, qqqReturns, soxxReturns, arkkReturns, brkbReturns] = await Promise.all([
    fetchTickerReturns('SPY', navStart, navEnd),
    fetchTickerReturns('QQQ', navStart, navEnd),
    fetchTickerReturns('SOXX', navStart, navEnd),
    fetchTickerReturns('ARKK', navStart, navEnd),
    fetchTickerReturns('BRK-B', navStart, navEnd),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl font-semibold">Overview</h1>
        <OverviewSyncButton />
      </div>
      <OverviewContent
        trades={trades}
        navData={navData}
        navChanges={navChanges}
        cashDeposits={cashDeposits}
        spyReturns={spyReturns}
        qqqReturns={qqqReturns}
        soxxReturns={soxxReturns}
        arkkReturns={arkkReturns}
        brkbReturns={brkbReturns}
      />
    </div>
  )
}
