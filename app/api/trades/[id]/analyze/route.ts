import { NextResponse } from 'next/server'

import { runLlmText } from '@/lib/ai/llm-analysis'
import { createClient } from '@/lib/supabase/server'
import { rowToTrade } from '@/types/trade'
import { loadLocalRagIndex, queryLocalRag, type RagQueryResult } from '@/lib/rag/local'
import { getCachedAnalysis, setCachedAnalysis, simpleHash } from '@/lib/rag/analysis-cache'

type AnalyzeBody = {
  topK?: number
  refresh?: boolean
  useRag?: boolean
}

type Side = 'long' | 'short' | null

function stopDistancePct(entry: number | null, stop: number | null) {
  if (entry == null || stop == null || entry === 0) return null
  return (Math.abs(entry - stop) / Math.abs(entry)) * 100
}

function buildTradeQuery(trade: ReturnType<typeof rowToTrade>) {
  return [
    trade.symbol,
    trade.setupTag,
    trade.notes,
    trade.side ?? '',
    trade.outcome ?? '',
    'trade setup stop loss risk management entry exit partial sell add winner cut loser',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildFallbackAnalysis(trade: ReturnType<typeof rowToTrade>, sources: RagQueryResult[]) {
  const lines: string[] = []
  const stopPct = stopDistancePct(trade.entryPrice, trade.stopLoss)

  lines.push(`Trade: ${trade.symbol} (${trade.side ?? 'unknown'}), outcome: ${trade.outcome ?? 'unknown'}`)
  lines.push('')
  lines.push('Quick diagnosis:')

  if (trade.outcome === 'open' && trade.stopLoss == null) {
    lines.push('- Missing stop loss on an open position. Define hard stop first, then size risk from it.')
  }

  if (stopPct != null && stopPct < 1) {
    lines.push(`- Stop looks tight (${stopPct.toFixed(2)}% from entry). Consider volatility-based buffer to avoid noise stops.`)
  } else if (stopPct != null && stopPct > 15) {
    lines.push(`- Stop looks wide (${stopPct.toFixed(2)}% from entry). Re-check position size so $ risk stays controlled.`)
  }

  if ((trade.rMultiple ?? 0) < -1.5) {
    lines.push('- Loss exceeds -1.5R. Consider earlier invalidation and faster cut protocol.')
  }

  if (trade.outcome === 'win' && trade.rMultiple != null && trade.rMultiple < 1) {
    lines.push('- Positive P&L but low R capture (<1R). Exit plan may be too early; review partial + runner rules.')
  }

  if (!trade.setupTag || trade.setupTag === 'untagged') {
    lines.push('- Setup tag is missing. Tagging setups improves edge tracking and review quality.')
  }

  if (!trade.notes?.trim()) {
    lines.push('- Notes are empty. Add pre-entry thesis, invalidation, and what changed post-entry.')
  }

  if (lines[lines.length - 1] === 'Quick diagnosis:') {
    lines.push('- Structure looks reasonable. Focus on consistent execution and post-trade review discipline.')
  }

  lines.push('')
  lines.push('Action items:')
  lines.push('- Define/verify setup checklist before entry.')
  lines.push('- Lock stop-loss logic before placing order.')
  lines.push('- Pre-plan partial sell and runner criteria.')
  lines.push('- Log one improvement for next similar setup.')

  if (sources.length > 0) {
    lines.push('')
    lines.push('Relevant source cues:')
    for (const s of sources.slice(0, 3)) {
      lines.push(`- ${s.file}#${s.chunkIndex}: ${s.snippet}`)
    }
  }

  return lines.join('\n')
}

function buildPrompt(trade: ReturnType<typeof rowToTrade>, sources: RagQueryResult[]) {
  const tradeBlock = JSON.stringify(
    {
      symbol: trade.symbol,
      side: trade.side,
      outcome: trade.outcome,
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      shares: trade.shares,
      pnl: trade.pnl,
      pnlPct: trade.pnlPct,
      rMultiple: trade.rMultiple,
      stopLoss: trade.stopLoss,
      setupTag: trade.setupTag,
      notes: trade.notes,
      holdTimeMin: trade.holdTimeMin,
      executionLegs: trade.executionLegs,
    },
    null,
    2
  )

  const sourceBlock = sources
    .map((s, i) => `Source ${i + 1}\nFile: ${s.file}#${s.chunkIndex}\nSnippet: ${s.snippet}`)
    .join('\n\n')

  return [
    'You are an elite trading performance coach.',
    'Analyze one trade and give practical, direct suggestions.',
    'Focus on: setup quality, stop-loss placement, position management, partial sells, and process improvements.',
    'If data is missing, state assumptions clearly.',
    'Output format:',
    '1) Diagnosis (3-5 bullets)',
    '2) What was done well (1-3 bullets)',
    '3) What to improve next time (3-5 bullets)',
    '4) Concrete plan for next trade (numbered 1-5)',
    '',
    'Trade JSON:',
    tradeBlock,
    '',
    'RAG sources:',
    sourceBlock || 'No sources found.',
  ].join('\n')
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const body = (await request.json().catch(() => ({}))) as AnalyzeBody
  const topK = Math.max(3, Math.min(12, Number(body.topK ?? 6) || 6))
  const refresh = body.refresh === true
  const useRag = body.useRag !== false

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: row } = await supabase
    .from('trades')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  }

  const trade = rowToTrade(row)

  let sources: RagQueryResult[] = []
  let query = buildTradeQuery(trade)
  let indexBuiltAt = 'unknown'
  const sourcePreference = useRag
    ? (((process.env.RAG_SOURCE_PREFERENCE ?? 'jlaw').toLowerCase() === 'oliverkell'
        ? 'oliverkell'
        : (process.env.RAG_SOURCE_PREFERENCE ?? 'jlaw').toLowerCase() === 'none'
          ? 'none'
          : 'jlaw') as 'jlaw' | 'oliverkell' | 'none')
    : 'none'
  if (useRag) {
    try {
      const index = await loadLocalRagIndex()
      indexBuiltAt = index.builtAt ?? 'unknown'
      sources = queryLocalRag(index, query, topK, { sourcePreference })
    } catch (e) {
      return NextResponse.json(
        {
          error:
            'RAG index not found. Run `npm run rag:build` first to create data/rag/index.json.',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 503 }
      )
    }
  }

  const cacheKey = [
    id,
    `rag:${useRag ? 'on' : 'off'}`,
    `pref:${sourcePreference}`,
    `topK:${topK}`,
    `provider:${(process.env.RAG_LLM_PROVIDER ?? 'auto').toLowerCase() || 'auto'}`,
    `index:${indexBuiltAt}`,
    `fp:${simpleHash(
      JSON.stringify({
        symbol: trade.symbol,
        side: trade.side,
        outcome: trade.outcome,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        shares: trade.shares,
        pnl: trade.pnl,
        pnlPct: trade.pnlPct,
        stopLoss: trade.stopLoss,
        rMultiple: trade.rMultiple,
        setupTag: trade.setupTag,
        notes: trade.notes,
        executionLegs: trade.executionLegs,
      })
    )}`,
  ].join('|')

  if (!refresh) {
    const cached = await getCachedAnalysis(cacheKey)
    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true,
        useRag,
        sourcePreference,
      })
    }
  }

  try {
    const prompt = buildPrompt(trade, sources)
    const llm = await runLlmText(prompt)
    const analysis = llm?.text || buildFallbackAnalysis(trade, sources)

    const payload = {
      mode: llm ? ('llm' as const) : ('fallback' as const),
      provider: (llm?.provider ?? 'fallback') as 'claude' | 'openai' | 'fallback',
      analysis,
      query,
      sources: sources.map((s) => ({
        file: s.file,
        chunkIndex: s.chunkIndex,
        score: Number(s.score.toFixed(3)),
        snippet: s.snippet,
      })),
    }
    await setCachedAnalysis(cacheKey, payload)

    return NextResponse.json({
      ...payload,
      cached: false,
      useRag,
      sourcePreference,
    })
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    )
  }
}
