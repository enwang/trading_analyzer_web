import { NextResponse } from 'next/server'
import { fetchPreEntryExtremes } from '@/lib/market/stop-loss'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const entryTime = searchParams.get('entryTime')

  if (!symbol || !entryTime) {
    return NextResponse.json({ error: 'symbol and entryTime are required' }, { status: 400 })
  }

  const entryMs = Date.parse(entryTime)
  if (Number.isNaN(entryMs)) {
    return NextResponse.json({ error: 'Invalid entryTime' }, { status: 400 })
  }

  const result = await fetchPreEntryExtremes(symbol, entryTime)
  if (result) {
    return NextResponse.json({ symbol, preEntry: result })
  }

  return NextResponse.json({ error: 'No candles found before entry time' }, { status: 404 })
}
