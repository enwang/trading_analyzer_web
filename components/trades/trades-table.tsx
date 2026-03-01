'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Trade } from '@/types/trade'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LocalTime } from '@/components/ui/local-time'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type OutcomeFilter = 'all' | 'win' | 'loss' | 'open'
type SortKey =
  | 'symbol'
  | 'side'
  | 'entryTime'
  | 'exitTime'
  | 'holdDays'
  | 'shares'
  | 'entryPrice'
  | 'exitPrice'
  | 'stopLoss'
  | 'pnl'
  | 'pnlPct'
  | 'initialAmount'
  | 'initialRisk'
  | 'initialRiskPct'
  | 'currentAmount'
  | 'currentRemainShares'
  | 'rMultiple'
  | 'outcome'
type SortDir = 'asc' | 'desc'
type ColumnId =
  | 'symbol'
  | 'side'
  | 'entryTime'
  | 'exitTime'
  | 'holdDays'
  | 'shares'
  | 'entryPrice'
  | 'exitPrice'
  | 'stopLoss'
  | 'pnl'
  | 'pnlPct'
  | 'initialAmount'
  | 'initialRisk'
  | 'initialRiskPct'
  | 'currentAmount'
  | 'currentRemainShares'
  | 'rMultiple'
  | 'outcome'
  | 'setupTag'
  | 'notes'

const COLUMN_ORDER_STORAGE_KEY = 'trades-table-column-order-v1'
const LEGACY_COLUMN_MAP: Record<string, ColumnId> = {
  initialStopPct: 'notes',
}
const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  'symbol',
  'side',
  'entryTime',
  'exitTime',
  'shares',
  'entryPrice',
  'exitPrice',
  'stopLoss',
  'pnl',
  'pnlPct',
  'initialAmount',
  'initialRisk',
  'rMultiple',
  'outcome',
  'setupTag',
  'notes',
  // New columns are appended so existing/default order stays intact.
  'holdDays',
  'initialRiskPct',
  'currentAmount',
  'currentRemainShares',
]
const SORT_KEYS: SortKey[] = [
  'symbol',
  'side',
  'entryTime',
  'exitTime',
  'holdDays',
  'shares',
  'entryPrice',
  'exitPrice',
  'stopLoss',
  'pnl',
  'pnlPct',
  'initialAmount',
  'initialRisk',
  'initialRiskPct',
  'currentAmount',
  'currentRemainShares',
  'rMultiple',
  'outcome',
]

function pnlClass(outcome: string | null) {
  if (outcome === 'win') return 'text-emerald-600'
  if (outcome === 'loss') return 'text-red-600'
  return ''
}

function signedValueClass(value: number | null | undefined) {
  if (value == null) return ''
  if (value > 0) return 'text-emerald-600'
  if (value < 0) return 'text-red-600'
  return ''
}

function fmtPrice(n: number | null) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`
}

function fmtHoldDuration(holdTimeMin: number | null, holdDays: number | null) {
  if (holdTimeMin != null) {
    if (holdTimeMin < 60) return `${Math.round(holdTimeMin)} min`
    const totalMinutes = Math.round(holdTimeMin)
    const days = Math.floor(totalMinutes / 1440)
    if (days >= 1) return `${days}d`
    return `${(totalMinutes / 60).toFixed(1)}h`
  }
  if (holdDays != null) return `${holdDays}d`
  return '—'
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (outcome === 'win') {
    return <Badge className="border border-emerald-200 bg-emerald-100 text-emerald-700">Win</Badge>
  }
  if (outcome === 'loss') {
    return <Badge className="border border-red-200 bg-red-100 text-red-700">Loss</Badge>
  }
  if (outcome === 'breakeven') return <Badge variant="outline">Breakeven</Badge>
  if (outcome === 'open') return <Badge variant="secondary">Open</Badge>
  return <Badge variant="outline">{outcome ?? '—'}</Badge>
}

export function TradesTable({ trades }: { trades: Trade[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const viewParam = searchParams.get('view')
  const sortParam = searchParams.get('sort')
  const dirParam = searchParams.get('dir')
  const initialFilter: OutcomeFilter =
    viewParam === 'win' || viewParam === 'loss' || viewParam === 'open' || viewParam === 'all'
      ? viewParam
      : 'all'
  const initialSortKey: SortKey = sortParam && SORT_KEYS.includes(sortParam as SortKey)
    ? (sortParam as SortKey)
    : 'entryTime'
  const initialSortDir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : 'desc'
  const [filter, setFilter] = useState<OutcomeFilter>(initialFilter)
  const initialDrafts = useMemo(
    () =>
      Object.fromEntries(
        trades.map((t) => [
          t.id,
          {
            setupTag: t.setupTag ?? 'untagged',
            notes: t.notes ?? '',
            stopLoss: t.stopLoss != null ? t.stopLoss.toFixed(2) : '',
          },
        ])
      ),
    [trades]
  )
  const [drafts, setDrafts] = useState<Record<string, { setupTag: string; notes: string; stopLoss: string }>>(
    () => initialDrafts
  )
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMN_ORDER)
  const [columnOrderHydrated, setColumnOrderHydrated] = useState(false)
  const [draggingColumn, setDraggingColumn] = useState<ColumnId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [populating, setPopulating] = useState(false)
  const [populateProgress, setPopulateProgress] = useState<{ done: number; total: number } | null>(null)
  const savedRef = useRef<Record<string, { setupTag: string; notes: string; stopLoss: string }>>(initialDrafts)
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const autoStopFetchedRef = useRef<Set<string>>(new Set())
  const sheetAppliedRef = useRef(false)
  const tradeById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades])

  const filtered = useMemo(() => {
    if (filter === 'all') return trades
    return trades.filter((t) => t.outcome === filter)
  }, [trades, filter])

  const visibleColumnOrder = useMemo(() => {
    const openOnlyColumns: ColumnId[] = ['currentAmount', 'currentRemainShares']
    if (filter === 'open') {
      const next = [...columnOrder]
      for (const col of openOnlyColumns) {
        if (!next.includes(col)) next.push(col)
      }
      return next
    }
    return columnOrder.filter((col) => !openOnlyColumns.includes(col))
  }, [columnOrder, filter])

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])

  useEffect(() => {
    setSortKey(initialSortKey)
    setSortDir(initialSortDir)
  }, [initialSortKey, initialSortDir])

  useEffect(() => {
    const raw = window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as string[]
        const normalized = parsed.map((c) => LEGACY_COLUMN_MAP[c] ?? c)
        const valid = normalized.filter((c): c is ColumnId => DEFAULT_COLUMN_ORDER.includes(c as ColumnId))
        const deduped: ColumnId[] = []
        for (const c of valid) {
          if (!deduped.includes(c)) deduped.push(c)
        }
        const missing = DEFAULT_COLUMN_ORDER.filter((c) => !deduped.includes(c))
        if (deduped.length > 0) {
          setColumnOrder([...deduped, ...missing])
        }
      } catch {
        // Ignore invalid saved layout.
      }
    }
    setColumnOrderHydrated(true)
  }, [])

  useEffect(() => {
    if (!columnOrderHydrated) return
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder))
  }, [columnOrder, columnOrderHydrated])

  const title = filter === 'all'
    ? 'All Trades'
    : filter === 'win'
      ? 'Winning Trades'
      : filter === 'loss'
        ? 'Losing Trades'
        : 'Open Trades'

  function initialAmount(t: Trade) {
    const shares = displayShares(t)
    if (t.entryPrice == null || shares == null) return null
    return Math.abs(t.entryPrice * shares)
  }

  function displayShares(t: Trade) {
    const openingShares = riskShares(t)
    return openingShares ?? t.shares ?? null
  }

  function currentRemainShares(t: Trade) {
    if (t.exitTime != null && t.outcome !== 'open') return null
    return t.shares != null ? Math.abs(t.shares) : null
  }

  function currentPrice(t: Trade) {
    const remain = currentRemainShares(t)
    if (!t.side || t.entryPrice == null || t.pnl == null || !remain || remain <= 0) return null
    return t.side === 'long'
      ? t.entryPrice + (t.pnl / remain)
      : t.entryPrice - (t.pnl / remain)
  }

  function currentAmount(t: Trade) {
    const remain = currentRemainShares(t)
    const price = currentPrice(t)
    if (remain == null || price == null) return null
    return Math.abs(remain * price)
  }

  function riskShares(t: Trade): number | null {
    const isOpenTrade = t.exitTime == null || t.outcome === 'open'
    if (!isOpenTrade) return t.shares
    if (!t.side || !t.executionLegs || t.executionLegs.length === 0) return null
    const openingAction = t.side === 'long' ? 'BUY' : 'SELL'
    const openingShares = t.executionLegs
      .filter((leg) => leg.action === openingAction)
      .reduce((sum, leg) => sum + leg.shares, 0)
    return openingShares > 0 ? openingShares : null
  }

  function initialRisk(t: Trade, stopLossOverride?: number | null) {
    const sharesForRisk = riskShares(t)
    const stopLoss = stopLossOverride ?? t.stopLoss
    if (!t.side || t.entryPrice == null || stopLoss == null || sharesForRisk == null) return null
    const riskPerShare = t.side === 'long' ? t.entryPrice - stopLoss : stopLoss - t.entryPrice
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
    return Math.abs(riskPerShare * sharesForRisk)
  }

  function initialRiskPct(t: Trade, stopLossOverride?: number | null) {
    const stopLoss = stopLossOverride ?? t.stopLoss
    if (!t.side || t.entryPrice == null || stopLoss == null || t.entryPrice === 0) return null
    const riskPerShare = t.side === 'long' ? t.entryPrice - stopLoss : stopLoss - t.entryPrice
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
    return Math.abs((riskPerShare / t.entryPrice) * 100)
  }

  function computedR(t: Trade, stopLossOverride?: number | null) {
    const stopLoss = stopLossOverride ?? t.stopLoss
    const effectiveExitPrice =
      t.exitTime == null || t.outcome === 'open'
        ? currentPrice(t)
        : t.exitPrice
    if (!t.side || t.entryPrice == null || effectiveExitPrice == null || stopLoss == null) return null
    const riskPerShare = t.side === 'long' ? t.entryPrice - stopLoss : stopLoss - t.entryPrice
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
    const rewardPerShare = t.side === 'long' ? effectiveExitPrice - t.entryPrice : t.entryPrice - effectiveExitPrice
    const r = rewardPerShare / riskPerShare
    return Number.isFinite(r) ? r : null
  }

  function effectiveHoldTimeMin(t: Trade) {
    if (t.holdTimeMin != null) return t.holdTimeMin
    if ((t.exitTime == null || t.outcome === 'open') && t.entryTime) {
      const entryMs = Date.parse(t.entryTime)
      if (!Number.isNaN(entryMs)) {
        return Math.max(0, (Date.now() - entryMs) / 60000)
      }
    }
    return null
  }

  function valueForSort(t: Trade, key: SortKey): string | number | null {
    const draftStopLoss = drafts[t.id]?.stopLoss
    const parsedDraftStopLoss =
      draftStopLoss != null && draftStopLoss.trim() !== '' ? Number(draftStopLoss) : null
    const effectiveStopLoss =
      parsedDraftStopLoss != null && Number.isFinite(parsedDraftStopLoss) ? parsedDraftStopLoss : t.stopLoss

    switch (key) {
      case 'symbol':
        return t.symbol ?? null
      case 'side':
        return t.side ?? null
      case 'entryTime':
        return t.entryTime ? new Date(t.entryTime).getTime() : null
      case 'exitTime':
        return t.exitTime ? new Date(t.exitTime).getTime() : null
      case 'holdDays':
        return effectiveHoldTimeMin(t) ?? t.holdDays ?? null
      case 'shares':
        return displayShares(t)
      case 'entryPrice':
        return t.entryPrice ?? null
      case 'exitPrice':
        return t.exitPrice ?? null
      case 'stopLoss':
        return effectiveStopLoss ?? null
      case 'pnl':
        return t.pnl ?? null
      case 'pnlPct':
        return t.pnlPct ?? null
      case 'initialAmount':
        return initialAmount(t)
      case 'initialRisk':
        return initialRisk(t, effectiveStopLoss)
      case 'initialRiskPct':
        return initialRiskPct(t, effectiveStopLoss)
      case 'currentAmount':
        return currentAmount(t)
      case 'currentRemainShares':
        return currentRemainShares(t)
      case 'rMultiple':
        return computedR(t, effectiveStopLoss) ?? t.rMultiple ?? null
      case 'outcome':
        return t.outcome ?? null
      default:
        return null
    }
  }

  function compareTrades(a: Trade, b: Trade): number {
    const va = valueForSort(a, sortKey)
    const vb = valueForSort(b, sortKey)
    const dir = sortDir === 'asc' ? 1 : -1
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb)) * dir
  }

  function toggleSort(nextKey: SortKey) {
    const nextDir: SortDir = sortKey === nextKey ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc'
    setSortKey(nextKey)
    setSortDir(nextDir)
    const params = new URLSearchParams(searchParams.toString())
    params.set('sort', nextKey)
    params.set('dir', nextDir)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  function sortMarker(key: SortKey) {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  function moveColumn(source: ColumnId, target: ColumnId) {
    if (source === target) return
    setColumnOrder((prev) => {
      const from = prev.indexOf(source)
      const to = prev.indexOf(target)
      if (from < 0 || to < 0) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  function sortableHeader(label: string, key?: SortKey) {
    if (!key) return label
    return (
      <button type="button" className="font-medium" onClick={() => toggleSort(key)}>
        {label}{sortMarker(key)}
      </button>
    )
  }

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort(compareTrades)
  }, [filtered, sortKey, sortDir, drafts])

  function updateDraft(id: string, key: 'setupTag' | 'notes' | 'stopLoss', value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        setupTag: prev[id]?.setupTag ?? 'untagged',
        notes: prev[id]?.notes ?? '',
        stopLoss: prev[id]?.stopLoss ?? '',
        [key]: value,
      },
    }))
  }

  function setFilterAndUrl(next: OutcomeFilter) {
    setFilter(next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', next)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  async function populateAllStopLosses() {
    const needsStop = trades.filter(
      (t) => t.stopLoss == null && t.entryTime != null && t.side != null
    )
    if (needsStop.length === 0) return

    setPopulating(true)
    setPopulateProgress({ done: 0, total: needsStop.length })
    setError(null)

    for (let i = 0; i < needsStop.length; i++) {
      const t = needsStop[i]
      try {
        const res = await fetch(
          `/api/market/pre-entry-extremes?symbol=${encodeURIComponent(t.symbol)}&entryTime=${encodeURIComponent(t.entryTime!)}`
        )
        if (!res.ok) {
          setPopulateProgress({ done: i + 1, total: needsStop.length })
          continue
        }
        const json = await res.json() as { preEntry: { low: number; high: number } }
        const suggested = t.side === 'long'
          ? Math.round((json.preEntry.low - 0.01) * 100) / 100
          : Math.round((json.preEntry.high + 0.01) * 100) / 100

        let rMultiple: number | null = null
        if (t.entryPrice != null && t.exitPrice != null) {
          const risk = t.side === 'long' ? t.entryPrice - suggested : suggested - t.entryPrice
          if (risk > 0) {
            const reward = t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
            rMultiple = reward / risk
          }
        }

        await fetch(`/api/trades/${t.id}/risk`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stopLoss: suggested, rMultiple }),
        })
      } catch {
        // skip failures silently
      }
      setPopulateProgress({ done: i + 1, total: needsStop.length })
    }

    setPopulating(false)
    setPopulateProgress(null)
    router.refresh()
  }

  async function saveTradeFields(id: string, draft: { setupTag: string; notes: string; stopLoss: string }) {
    setError(null)
    try {
      const journalRes = await fetch(`/api/trades/${id}/journal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupTag: draft.setupTag,
          notes: draft.notes,
        }),
      })
      const journalJson = await journalRes.json()
      if (!journalRes.ok) {
        setError(journalJson.error ?? 'Failed to save journal')
        return
      }

      const parsedStopLoss = draft.stopLoss.trim() === '' ? null : Number(draft.stopLoss)
      if (parsedStopLoss != null && !Number.isFinite(parsedStopLoss)) {
        return
      }
      const trade = tradeById.get(id)
      const nextR = trade ? computedR(trade, parsedStopLoss) : null
      const riskRes = await fetch(`/api/trades/${id}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stopLoss: parsedStopLoss, rMultiple: nextR }),
      })
      const riskJson = await riskRes.json()
      if (!riskRes.ok) {
        setError(riskJson.error ?? 'Failed to save risk values')
        return
      }

      savedRef.current[id] = draft
    } catch {
      setError('Failed to save trade values')
    }
  }

  useEffect(() => {
    for (const [id, draft] of Object.entries(drafts)) {
      const saved = savedRef.current[id]
      if (
        saved &&
        saved.setupTag === draft.setupTag &&
        saved.notes === draft.notes &&
        saved.stopLoss === draft.stopLoss
      ) {
        continue
      }

      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id])
      }
      timersRef.current[id] = setTimeout(() => {
        void saveTradeFields(id, draft)
      }, 700)
    }

    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer)
      }
      timersRef.current = {}
    }
  }, [drafts])

  useEffect(() => {
    const candidates = trades.filter((t) => {
      if (!t.side || !t.entryTime) return false
      if (autoStopFetchedRef.current.has(t.id)) return false
      const currentDraft = drafts[t.id]?.stopLoss ?? (t.stopLoss != null ? t.stopLoss.toFixed(2) : '')
      return currentDraft.trim() === ''
    })

    if (candidates.length === 0) return

    let cancelled = false

    async function loadDefaults() {
      for (const t of candidates) {
        autoStopFetchedRef.current.add(t.id)
        try {
          const res = await fetch(
            `/api/market/pre-entry-extremes?symbol=${encodeURIComponent(t.symbol)}&entryTime=${encodeURIComponent(t.entryTime!)}`
          )
          if (!res.ok) continue
          const json = await res.json() as { preEntry: { low: number; high: number } }
          const suggested = t.side === 'long'
            ? Math.round((json.preEntry.low - 0.01) * 100) / 100
            : Math.round((json.preEntry.high + 0.01) * 100) / 100

          if (cancelled) return

          setDrafts((prev) => {
            const existing = prev[t.id]
            const existingStopLoss = existing?.stopLoss ?? (t.stopLoss != null ? t.stopLoss.toFixed(2) : '')
            if (existingStopLoss.trim() !== '') return prev
            return {
              ...prev,
              [t.id]: {
                setupTag: existing?.setupTag ?? t.setupTag ?? 'untagged',
                notes: existing?.notes ?? t.notes ?? '',
                stopLoss: suggested.toFixed(2),
              },
            }
          })
        } catch {
          // Skip failed suggestions for this row.
        }
      }
    }

    void loadDefaults()

    return () => {
      cancelled = true
    }
  }, [trades, drafts])

  useEffect(() => {
    if (sheetAppliedRef.current || trades.length === 0) return
    let cancelled = false

    function keyFor(symbol: string, openDate: string | null, closeDate: string | null) {
      return `${symbol}|${openDate ?? ''}|${closeDate ?? ''}`
    }

    async function applyStopsFromSheet() {
      try {
        const res = await fetch('/api/trades/sheet', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as {
          rows: Array<{ symbol: string; openDate: string | null; closeDate: string | null; initialStop: number | null }>
        }
        if (cancelled || !json.rows?.length) return

        const exactMap = new Map<string, number>()
        const openOnlyMap = new Map<string, number>()
        for (const r of json.rows) {
          if (r.initialStop == null) continue
          exactMap.set(keyFor(r.symbol, r.openDate, r.closeDate), r.initialStop)
          const openKey = `${r.symbol}|${r.openDate ?? ''}`
          if (!openOnlyMap.has(openKey)) openOnlyMap.set(openKey, r.initialStop)
        }

        setDrafts((prev) => {
          const next = { ...prev }
          let changed = false

          for (const t of trades) {
            const openDate = t.entryTime?.slice(0, 10) ?? null
            const closeDate = t.exitTime?.slice(0, 10) ?? null
            const exact = exactMap.get(keyFor(t.symbol, openDate, closeDate))
            const fallback = openOnlyMap.get(`${t.symbol}|${openDate ?? ''}`)
            const sheetStop = exact ?? fallback
            if (sheetStop == null) continue

            const current = next[t.id] ?? {
              setupTag: t.setupTag ?? 'untagged',
              notes: t.notes ?? '',
              stopLoss: t.stopLoss != null ? t.stopLoss.toFixed(2) : '',
            }
            const nextStop = sheetStop.toFixed(2)
            if (current.stopLoss === nextStop) continue
            next[t.id] = { ...current, stopLoss: nextStop }
            changed = true
          }

          return changed ? next : prev
        })
      } catch {
        // Ignore sheet sync errors.
      } finally {
        sheetAppliedRef.current = true
      }
    }

    void applyStopsFromSheet()

    return () => {
      cancelled = true
    }
  }, [trades])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">
          {title} ({filtered.length})
        </h1>
        <div className="flex items-center gap-2">
          {trades.some((t) => t.stopLoss == null && t.entryTime != null && t.side != null) && (
            <Button
              variant="outline"
              size="sm"
              disabled={populating}
              onClick={() => void populateAllStopLosses()}
            >
              {populating && populateProgress
                ? `Populating ${populateProgress.done}/${populateProgress.total}…`
                : 'Populate Stop Losses'}
            </Button>
          )}
          <span className="text-sm text-muted-foreground">View</span>
          <Select value={filter} onValueChange={(v) => setFilterAndUrl(v as OutcomeFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Trades</SelectItem>
              <SelectItem value="win">Winners</SelectItem>
              <SelectItem value="loss">Losers</SelectItem>
              <SelectItem value="open">Open Trades</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}

      <div className="rounded-lg border overflow-x-auto">
        <Table className="min-w-full w-max">
          <TableHeader>
            <TableRow>
              {visibleColumnOrder.map((col) => {
                const rightAligned =
                  col === 'holdDays' ||
                  col === 'shares' ||
                  col === 'entryPrice' ||
                  col === 'exitPrice' ||
                  col === 'stopLoss' ||
                  col === 'pnl' ||
                  col === 'pnlPct' ||
                  col === 'initialAmount' ||
                  col === 'initialRisk' ||
                  col === 'initialRiskPct' ||
                  col === 'currentAmount' ||
                  col === 'currentRemainShares' ||
                  col === 'rMultiple'
                const headerContent: Record<ColumnId, React.ReactNode> = {
                  symbol: sortableHeader('Symbol', 'symbol'),
                  side: sortableHeader('Side', 'side'),
                  entryTime: sortableHeader('Entry', 'entryTime'),
                  exitTime: sortableHeader('Exit', 'exitTime'),
                  holdDays: sortableHeader('Hold Days', 'holdDays'),
                  shares: sortableHeader('Shares', 'shares'),
                  entryPrice: sortableHeader('Entry $', 'entryPrice'),
                  exitPrice: sortableHeader('Exit $', 'exitPrice'),
                  stopLoss: sortableHeader('Stop Loss $', 'stopLoss'),
                  pnl: sortableHeader('P&L', 'pnl'),
                  pnlPct: sortableHeader('P&L %', 'pnlPct'),
                  initialAmount: sortableHeader('Initial Amount', 'initialAmount'),
                  initialRisk: sortableHeader('Initial Risk', 'initialRisk'),
                  initialRiskPct: sortableHeader('Initial Risk %', 'initialRiskPct'),
                  currentAmount: sortableHeader('Current Amount', 'currentAmount'),
                  currentRemainShares: sortableHeader('Current Shares', 'currentRemainShares'),
                  rMultiple: sortableHeader('R Multiple', 'rMultiple'),
                  outcome: sortableHeader('Outcome', 'outcome'),
                  setupTag: 'Setup',
                  notes: 'Notes',
                }
                const safeHeaderContent = headerContent[col] ?? (
                  <span className="font-medium">{String(col)}</span>
                )
                return (
                  <TableHead
                    key={col}
                    draggable
                    onDragStart={() => setDraggingColumn(col)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (draggingColumn) moveColumn(draggingColumn, col)
                      setDraggingColumn(null)
                    }}
                    onDragEnd={() => setDraggingColumn(null)}
                    className={`${rightAligned ? 'text-right' : ''} ${draggingColumn === col ? 'opacity-60' : ''}`}
                  >
                    {safeHeaderContent}
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={visibleColumnOrder.length} className="py-10 text-center text-muted-foreground">
                  No trades for this filter.
                </TableCell>
              </TableRow>
            )}
            {sortedFiltered.map((t) => {
              const draftStopLoss = drafts[t.id]?.stopLoss ?? (t.stopLoss != null ? t.stopLoss.toFixed(2) : '')
              const parsedDraftStopLoss = draftStopLoss.trim() === '' ? null : Number(draftStopLoss)
              const effectiveStopLoss =
                parsedDraftStopLoss != null && Number.isFinite(parsedDraftStopLoss)
                  ? parsedDraftStopLoss
                  : t.stopLoss

              return (
              <TableRow key={t.id} className="hover:bg-muted/40">
                {visibleColumnOrder.map((col) => {
                  const detailsHref = `/trades/${t.id}?${(() => {
                    const params = new URLSearchParams(searchParams.toString())
                    params.set('view', filter)
                    return params.toString()
                  })()}`

                  if (col === 'symbol') {
                    return (
                      <TableCell key={col} className="font-medium">
                        <Link href={detailsHref} className="underline-offset-4 hover:underline">
                          {t.symbol}
                        </Link>
                      </TableCell>
                    )
                  }
                  if (col === 'side') return <TableCell key={col} className="capitalize">{t.side ?? '—'}</TableCell>
                  if (col === 'entryTime') return <TableCell key={col}><LocalTime date={t.entryTime} dateOnly className="font-mono text-xs text-muted-foreground" /></TableCell>
                  if (col === 'exitTime') return <TableCell key={col}><LocalTime date={t.exitTime} dateOnly className="font-mono text-xs text-muted-foreground" /></TableCell>
                  if (col === 'holdDays') return <TableCell key={col} className="text-right">{fmtHoldDuration(effectiveHoldTimeMin(t), t.holdDays)}</TableCell>
                  if (col === 'shares') return <TableCell key={col} className="text-right">{displayShares(t) ?? '—'}</TableCell>
                  if (col === 'entryPrice') return <TableCell key={col} className="text-right">{fmtPrice(t.entryPrice)}</TableCell>
                  if (col === 'exitPrice') return <TableCell key={col} className="text-right">{fmtPrice(t.exitPrice)}</TableCell>
                  if (col === 'stopLoss') {
                    return (
                      <TableCell key={col} className="text-right">
                        <input
                          className="h-8 w-[92px] rounded-md border px-2 text-right text-xs"
                          value={draftStopLoss}
                          onChange={(e) => updateDraft(t.id, 'stopLoss', e.target.value)}
                          placeholder="0.00"
                          inputMode="decimal"
                        />
                      </TableCell>
                    )
                  }
                  if (col === 'pnl') return <TableCell key={col} className={`text-right font-medium ${signedValueClass(t.pnl) || pnlClass(t.outcome)}`}>{t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}</TableCell>
                  if (col === 'pnlPct') return <TableCell key={col} className={`text-right ${signedValueClass(t.pnlPct) || pnlClass(t.outcome)}`}>{t.pnlPct != null ? `${(t.pnlPct * 100).toFixed(2)}%` : '—'}</TableCell>
                  if (col === 'initialAmount') return <TableCell key={col} className="text-right">{initialAmount(t) != null ? fmtMoney(initialAmount(t) as number) : '—'}</TableCell>
                  if (col === 'initialRisk') return <TableCell key={col} className="text-right">{initialRisk(t, effectiveStopLoss) != null ? fmtMoney(initialRisk(t, effectiveStopLoss) as number) : '—'}</TableCell>
                  if (col === 'initialRiskPct') return <TableCell key={col} className="text-right">{initialRiskPct(t, effectiveStopLoss) != null ? `${initialRiskPct(t, effectiveStopLoss)?.toFixed(2)}%` : '—'}</TableCell>
                  if (col === 'currentAmount') return <TableCell key={col} className="text-right">{currentAmount(t) != null ? fmtMoney(currentAmount(t) as number) : '—'}</TableCell>
                  if (col === 'currentRemainShares') return <TableCell key={col} className="text-right">{currentRemainShares(t) != null ? currentRemainShares(t) : '—'}</TableCell>
                  if (col === 'rMultiple') {
                    const r = computedR(t, effectiveStopLoss) ?? t.rMultiple
                    const rClass = signedValueClass(r)
                    return (
                      <TableCell key={col} className={`text-right font-medium ${rClass}`}>
                        {r != null ? r.toFixed(2) : '—'}
                      </TableCell>
                    )
                  }
                  if (col === 'outcome') return <TableCell key={col}><OutcomeBadge outcome={t.outcome} /></TableCell>
                  if (col === 'setupTag') {
                    return (
                      <TableCell key={col}>
                        <input
                          className="h-8 w-[140px] rounded-md border px-2 text-xs"
                          value={drafts[t.id]?.setupTag ?? t.setupTag}
                          onChange={(e) => updateDraft(t.id, 'setupTag', e.target.value)}
                        />
                      </TableCell>
                    )
                  }
                  return (
                    <TableCell key={col}>
                      <input
                        className="h-8 w-[320px] rounded-md border px-2 text-xs"
                        value={drafts[t.id]?.notes ?? t.notes}
                        onChange={(e) => updateDraft(t.id, 'notes', e.target.value)}
                        placeholder="Add notes"
                      />
                    </TableCell>
                  )
                })}
              </TableRow>
            )})}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
