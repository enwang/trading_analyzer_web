import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { byHourOfDay, byDayOfWeek, byGroup } from '@/lib/metrics'
import { AnalysisView } from '@/components/charts/analysis-view'

export default async function AnalysisPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user!.id)
    .order('entry_time', { ascending: true })

  const trades = (rows ?? []).map(rowToTrade)

  const data = {
    byHour: byHourOfDay(trades, 'avg_pnl'),
    byDay: byDayOfWeek(trades, 'total_pnl'),
    bySymbol: byGroup(trades, 'symbol'),
    bySetup: byGroup(trades, 'setupTag'),
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Analysis</h1>
      <AnalysisView data={data} />
    </div>
  )
}
