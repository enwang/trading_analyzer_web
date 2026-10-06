'use client'

const LOCAL_STOP_SYNC_URL = 'http://127.0.0.1:4317/sync-stops'

export type LocalStopSyncResult = {
  available: boolean
  updated: number
  unchanged: number
  initialSlInitialized: number
  skipped: Array<{ symbol: string; reason: string }>
  warning?: string
  message?: string
}

export async function syncLocalOpenStopOrders(userId: string): Promise<LocalStopSyncResult> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch(LOCAL_STOP_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => ({}))

    if (!response.ok) {
      return {
        available: false,
        updated: 0,
        unchanged: 0,
        initialSlInitialized: 0,
        skipped: [],
        message: body?.error ?? `Local IBKR stop sync failed (${response.status})`,
      }
    }

    return {
      available: true,
      updated: body.updated ?? 0,
      unchanged: body.unchanged ?? 0,
      initialSlInitialized: body.initialSlInitialized ?? 0,
      skipped: body.skipped ?? [],
      warning: body.warning,
    }
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Local IBKR stop sync timed out'
      : 'Local IBKR Desktop bridge is not running'
    return { available: false, updated: 0, unchanged: 0, initialSlInitialized: 0, skipped: [], message }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function formatLocalStopSync(result: LocalStopSyncResult) {
  if (!result.available) return `Open stops not synced: ${result.message}`

  const skippedSymbols = [...new Set(result.skipped.map(item => item.symbol))]
  const skipped = skippedSymbols.length > 0
    ? `, skipped ${skippedSymbols.join(', ')}`
    : ''
  const initialized = result.initialSlInitialized > 0
    ? `, ${result.initialSlInitialized} Initial SL initialized`
    : ''
  const warning = result.warning ? `. ${result.warning}` : ''
  return `${result.updated} Current SL updated${initialized}${skipped}${warning}`
}
