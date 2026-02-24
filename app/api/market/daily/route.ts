import { NextResponse } from 'next/server'

function normalizeStooqSymbol(symbol: string) {
  const s = symbol.trim().toLowerCase()
  if (s.includes('.')) return s
  return `${s}.us`
}

function parseDailyCsv(csv: string, date: string) {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  for (let i = 1; i < lines.length; i++) {
    const [d, open, high, low, close, volume] = lines[i].split(',')
    if (d !== date) continue
    const o = Number(open)
    const h = Number(high)
    const l = Number(low)
    const c = Number(close)
    const v = Number(volume)
    if ([o, h, l, c].some((n) => Number.isNaN(n))) return null
    return {
      date: d,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isNaN(v) ? null : v,
    }
  }

  return null
}

function parsePreviousDailyCsv(csv: string, date: string) {
  const lines = csv.trim().split(/\r?\n/)
  if (lines.length < 2) return null

  let found: {
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number | null
  } | null = null

  for (let i = 1; i < lines.length; i++) {
    const [d, open, high, low, close, volume] = lines[i].split(',')
    if (!d || d >= date) continue

    const o = Number(open)
    const h = Number(high)
    const l = Number(low)
    const c = Number(close)
    const v = Number(volume)
    if ([o, h, l, c].some((n) => Number.isNaN(n))) continue

    found = {
      date: d,
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Number.isNaN(v) ? null : v,
    }
  }

  return found
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')
  const date = searchParams.get('date')
  const mode = searchParams.get('mode') ?? 'exact'

  if (!symbol || !date) {
    return NextResponse.json({ error: 'symbol and date are required' }, { status: 400 })
  }

  const normalized = normalizeStooqSymbol(symbol)
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(normalized)}&i=d`

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store' })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch market data' }, { status: 502 })
  }

  if (!response.ok) {
    return NextResponse.json({ error: 'Market data source error' }, { status: 502 })
  }

  const text = await response.text()
  const candle = mode === 'prev'
    ? parsePreviousDailyCsv(text, date)
    : parseDailyCsv(text, date)

  if (!candle) {
    return NextResponse.json({ error: 'No daily candle found for date' }, { status: 404 })
  }

  return NextResponse.json({ symbol, normalized, candle })
}
