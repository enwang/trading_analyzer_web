'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'

async function warmReportCache(refresh: boolean) {
  const response = await fetch('/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  })

  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Failed to prepare report')
  }
}

export function ReportGeneratorPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const goToDeck = (refresh: boolean) => {
    startTransition(async () => {
      try {
        setError(null)
        await warmReportCache(refresh)
        window.location.href = refresh ? '/report-view?refresh=1' : '/report-view'
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-border/60 bg-[linear-gradient(135deg,#f3efe4_0%,#f6f1e8_44%,#ece5d1_100%)] p-8 shadow-sm">
        <div className="max-w-3xl">
          <div className="mb-3 inline-flex rounded-full border border-black/10 bg-black/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-black/60">
            Reports Recap
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            Generate Report
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-700">
            Builds your year-to-date performance recap from closed trades and adds AI key takeaways for each section.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => goToDeck(true)} disabled={isPending}>
              {isPending ? 'Generating...' : 'Generate Report'}
            </Button>
            <Link href="/report-view">
              <Button size="lg" variant="outline" disabled={isPending}>
                Open Last Report
              </Button>
            </Link>
          </div>
          {error ? <div className="mt-4 rounded-2xl border border-rose-300/40 bg-rose-100 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
