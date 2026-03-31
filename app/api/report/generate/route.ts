import { NextResponse } from 'next/server'

import { buildReportRecap } from '@/lib/report-recap'
import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'

type GenerateReportBody = {
  refresh?: boolean
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GenerateReportBody
  const refresh = body.refresh === true

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: rows, error } = await supabase
    .from('trades')
    .select('*')
    .eq('user_id', user.id)
    .order('entry_time', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  try {
    const recap = await buildReportRecap((rows ?? []).map(rowToTrade), { refresh })
    return NextResponse.json(recap)
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    )
  }
}
