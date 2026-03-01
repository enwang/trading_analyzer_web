'use client'

import { useEffect, useState } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type AnalyzeSource = {
  file: string
  chunkIndex: number
  score: number
  snippet: string
}

type AnalyzeResponse = {
  mode: 'llm' | 'fallback'
  provider?: 'claude' | 'openai' | 'fallback'
  cached?: boolean
  useRag?: boolean
  sourcePreference?: 'jlaw' | 'oliverkell' | 'none'
  analysis: string
  query: string
  sources: AnalyzeSource[]
}

export function TradeAiAnalyzer({ tradeId }: { tradeId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultWithRag, setResultWithRag] = useState<AnalyzeResponse | null>(null)
  const [resultWithoutRag, setResultWithoutRag] = useState<AnalyzeResponse | null>(null)
  const [active, setActive] = useState<'rag' | 'no-rag'>('rag')

  const run = async (opts: { refresh?: boolean; useRag: boolean }) => {
    const refresh = opts.refresh === true
    const useRag = opts.useRag
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/trades/${tradeId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topK: 6, refresh, useRag }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? 'Failed to analyze trade')
        return
      }

      if (useRag) setResultWithRag(json as AnalyzeResponse)
      else setResultWithoutRag(json as AnalyzeResponse)
      setActive(useRag ? 'rag' : 'no-rag')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (resultWithRag || loading || error) return
    void run({ refresh: false, useRag: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeId])

  const activeResult = active === 'rag' ? resultWithRag : resultWithoutRag

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">AI Trade Analysis</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void run({ refresh: false, useRag: true })} disabled={loading}>
            {loading ? 'Analyzing...' : 'With RAG'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run({ refresh: false, useRag: false })} disabled={loading}>
            Without RAG
          </Button>
          <Button size="sm" variant="outline" onClick={() => void run({ refresh: true, useRag: active === 'rag' })} disabled={loading}>
            Refresh {active === 'rag' ? 'RAG' : 'No-RAG'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className={`rounded border px-2 py-1 ${active === 'rag' ? 'bg-muted font-medium' : ''}`}
            onClick={() => setActive('rag')}
          >
            RAG Result
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 ${active === 'no-rag' ? 'bg-muted font-medium' : ''}`}
            onClick={() => setActive('no-rag')}
          >
            No-RAG Result
          </button>
        </div>

        {!activeResult && !error && (
          <p className="text-sm text-muted-foreground">
            {active === 'rag'
              ? 'Uses your local RAG sources (SRT/PDF/TXT) to review this trade.'
              : 'Baseline model-only analysis without RAG sources.'}
          </p>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {activeResult && (
          <>
            <div className="text-xs text-muted-foreground">
              Mode: {activeResult.mode === 'llm' ? `${activeResult.provider ?? 'llm'} + ${activeResult.useRag ? 'RAG' : 'No-RAG'}` : 'fallback'}
            </div>
            <div className="text-xs text-muted-foreground">
              Source preference: {activeResult.sourcePreference ?? 'none'} | {activeResult.cached ? 'Loaded from cache' : 'Fresh analysis'}
            </div>
            <div className="whitespace-pre-wrap rounded-md border p-3 text-sm leading-6">
              {activeResult.analysis}
            </div>
            {activeResult.sources?.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Top Sources</div>
                <div className="space-y-2">
                  {activeResult.sources.slice(0, 5).map((s, i) => (
                    <div key={`${s.file}-${s.chunkIndex}-${i}`} className="rounded-md border p-2 text-xs">
                      <div className="font-medium">
                        {s.file}#{s.chunkIndex} <span className="text-muted-foreground">(score {s.score})</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">{s.snippet}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
