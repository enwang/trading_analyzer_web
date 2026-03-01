import { NextResponse } from 'next/server'

interface YahooChartQuoteResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number | null
        previousClose?: number | null
      }
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>
        }>
      }
    }>
    error?: { description?: string }
  }
}

async function fetchYahooChartPrice(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true`

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Yahoo chart error for ${symbol}`)
  }

  const payload = (await response.json()) as YahooChartQuoteResponse
  const result = payload.chart?.result?.[0]
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const latestClose = [...closes].reverse().find((value) => value != null && Number.isFinite(value))
  const marketPrice = result?.meta?.regularMarketPrice
  const previousClose = result?.meta?.previousClose

  const price = marketPrice ?? latestClose ?? previousClose ?? null
  return typeof price === 'number' && Number.isFinite(price) ? price : null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const symbolsParam = searchParams.get('symbols')

  if (!symbolsParam) {
    return NextResponse.json({ error: 'symbols is required' }, { status: 400 })
  }

  const symbols = Array.from(
    new Set(
      symbolsParam
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    )
  )

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'No valid symbols provided' }, { status: 400 })
  }

  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const price = await fetchYahooChartPrice(symbol)
        return [symbol, price] as const
      } catch {
        return [symbol, null] as const
      }
    })
  )

  return NextResponse.json({ quotes: Object.fromEntries(entries) })
}
