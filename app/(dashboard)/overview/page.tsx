import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { normalizeTradesForDisplay } from '@/lib/trades'
import { OverviewSyncButton } from '@/components/overview/overview-sync-button'
import { OverviewContent } from '@/components/overview/overview-content'

async function fetchTickerReturns(symbol: string, startDate: string, endDate: string): Promise<{ date: string; pct: number }[]> {
  try {
    const p1 = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000) - 86400 * 7
    const p2 = Math.floor(new Date(endDate + 'T23:59:59Z').getTime() / 1000) + 86400
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${p1}&period2=${p2}&interval=1d`,
      { next: { revalidate: 3600 }, headers: { 'User-Agent': 'Mozilla/5.0' } }
    )
    if (!res.ok) return []
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []
    const timestamps: number[] = result.timestamp ?? []
    const closes: number[] = result.indicators?.adjclose?.[0]?.adjclose ?? []
    if (!timestamps.length || !closes.length) return []
    let baseIdx = 0
    for (let i = 0; i < timestamps.length; i++) {
      const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10)
      if (d <= startDate) baseIdx = i
      else break
    }
    const baseClose = closes[baseIdx]
    if (!baseClose) return []
    return timestamps
      .map((ts, i) => {
        const date = new Date(ts * 1000).toISOString().slice(0, 10)
        const close = closes[i]
        if (!close || date < startDate) return null
        return { date, pct: ((close - baseClose) / baseClose) * 100 }
      })
      .filter((r): r is { date: string; pct: number } => r !== null)
  } catch {
    return []
  }
}

export default async function OverviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: rows }, { data: navRows }, { data: navChangeRows }, { data: cashTxRows }] = await Promise.all([
    supabase.from('trades').select('*').eq('user_id', user!.id).order('entry_time', { ascending: true }),
    supabase.from('account_nav_daily').select('report_date,total').eq('user_id', user!.id).order('report_date', { ascending: true }),
    supabase.from('account_nav_change').select('from_date,to_date,deposits_withdrawals').eq('user_id', user!.id),
    supabase.from('account_cash_transactions').select('transaction_ts,amount,type').eq('user_id', user!.id),
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
  const [spyReturns, qqqReturns] = await Promise.all([
    fetchTickerReturns('SPY', navStart, navEnd),
    fetchTickerReturns('QQQ', navStart, navEnd),
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
      />
    </div>
  )
}
