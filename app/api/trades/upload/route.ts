import { createClient } from '@/lib/supabase/server'
import { parseFlexCsv } from '@/lib/ibkr/flex'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const csvText = await file.text()
    const trades = parseFlexCsv(csvText)

    if (!trades.length) {
      return NextResponse.json({ upserted: 0, skipped: 0 })
    }

    const rows = trades.map(t => ({ ...t, user_id: user.id }))

    const { error, data } = await supabase
      .from('trades')
      .upsert(rows, { ignoreDuplicates: true })
      .select('id')

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const upserted = data?.length ?? 0
    const skipped = trades.length - upserted

    return NextResponse.json({ upserted, skipped })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
