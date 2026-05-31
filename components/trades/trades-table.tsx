'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Trash2 } from 'lucide-react'

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
import { riskSharesForTrade } from '@/lib/trades'
import {
  DEFAULT_INITIAL_RISK_AMOUNT,
  initialRiskFromStopLoss,
  riskAmountForTrade,
  suggestedStopLossFromRisk,
} from '@/lib/market/stop-loss'
import { createClient } from '@/lib/supabase/client'
import { SpellCheckTextarea } from '@/components/ui/spell-check-textarea'

type OutcomeFilter = 'all' | 'win' | 'loss' | 'open' | 'marked' | 'lastweek'
type SortKey =
  | 'symbol'
  | 'side'
  | 'entryTime'
  | 'exitTime'
  | 'holdDays'
  | 'shares'
  | 'entryPrice'
  | 'pnl'
  | 'pnlPct'
  | 'initialAmount'
  | 'initialRisk'
  | 'initialRiskPct'
  | 'currentPrice'
  | 'currentAmount'
  | 'currentRemainShares'
  | 'rMultiple'
  | 'outcome'
  | 'stopLoss'
  | 'currentRisk'
  | 'currentRiskPct'
type SortDir = 'asc' | 'desc'
type ColumnId =
  | 'symbol'
  | 'side'
  | 'entryTime'
  | 'exitTime'
  | 'holdDays'
  | 'shares'
  | 'entryPrice'
  | 'pnl'
  | 'pnlPct'
  | 'initialAmount'
  | 'initialRisk'
  | 'initialRiskPct'
  | 'currentPrice'
  | 'currentAmount'
  | 'currentRemainShares'
  | 'rMultiple'
  | 'outcome'
  | 'setupTag'
  | 'notes'
  | 'stopLoss'
  | 'currentRisk'
  | 'currentRiskPct'

const COLUMN_ORDER_STORAGE_KEY = 'trades-table-column-order-v1'
const TRADES_LAST_URL_STORAGE_KEY = 'trades-table-last-url'
const TRADES_LAST_SCROLL_STORAGE_KEY = 'trades-table-last-scroll'
const DASHBOARD_SCROLL_CONTAINER_ID = 'dashboard-scroll-container'
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
  // Open-trades "current state" group — hidden in all other views via openOnlyColumns
  'currentPrice',
  'currentRemainShares',
  'stopLoss',
  'currentRisk',
  'currentRiskPct',
  'currentAmount',
  'pnl',
  'pnlPct',
  'initialAmount',
  'initialRisk',
  'rMultiple',
  'outcome',
  'setupTag',
  'notes',
  'holdDays',
  'initialRiskPct',
]
const SORT_KEYS: SortKey[] = [
  'symbol',
  'side',
  'entryTime',
  'exitTime',
  'holdDays',
  'shares',
  'entryPrice',
  'pnl',
  'pnlPct',
  'initialAmount',
  'initialRisk',
  'initialRiskPct',
  'currentPrice',
  'currentAmount',
  'currentRemainShares',
  'rMultiple',
  'outcome',
  'stopLoss',
  'currentRisk',
  'currentRiskPct',
]
const DEFAULT_INITIAL_RISK_INPUT = DEFAULT_INITIAL_RISK_AMOUNT.toFixed(2)
const TRADE_INITIAL_RISK_STORAGE_KEY = 'trades-table-initial-risk-v1'

function loadStoredInitialRisks(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  const raw = window.localStorage.getItem(TRADE_INITIAL_RISK_STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function saveStoredInitialRisk(id: string, value: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    TRADE_INITIAL_RISK_STORAGE_KEY,
    JSON.stringify({ ...loadStoredInitialRisks(), [id]: value })
  )
}

function normalizeColumnOrder(value: unknown): ColumnId[] {
  if (!Array.isArray(value)) return DEFAULT_COLUMN_ORDER
  const normalized = value.map((c) => LEGACY_COLUMN_MAP[String(c)] ?? String(c))
  const valid = normalized.filter((c): c is ColumnId => DEFAULT_COLUMN_ORDER.includes(c as ColumnId))
  const deduped: ColumnId[] = []
  for (const c of valid) {
    if (!deduped.includes(c)) deduped.push(c)
  }
  const missing = DEFAULT_COLUMN_ORDER.filter((c) => !deduped.includes(c))
  return deduped.length > 0 ? [...deduped, ...missing] : DEFAULT_COLUMN_ORDER
}

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

function getDashboardScrollContainer() {
  return document.getElementById(DASHBOARD_SCROLL_CONTAINER_ID)
}

export function TradesTable({ trades, accountEquity }: { trades: Trade[]; accountEquity?: number | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const supabase = useMemo(() => createClient(), [])
  const viewParam = searchParams.get('view')
  const sortParam = searchParams.get('sort')
  const dirParam = searchParams.get('dir')
  const initialFilter: OutcomeFilter =
    viewParam === 'win' || viewParam === 'loss' || viewParam === 'open' || viewParam === 'all' || viewParam === 'marked' || viewParam === 'lastweek'
      ? viewParam
      : 'all'
  const defaultSortKey: SortKey = initialFilter === 'open' ? 'currentRiskPct' : 'exitTime'
  const defaultSortDir: SortDir = initialFilter === 'open' ? 'desc' : 'desc'
  const initialSortKey: SortKey = sortParam && SORT_KEYS.includes(sortParam as SortKey)
    ? (sortParam as SortKey)
    : defaultSortKey
  const initialSortDir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : defaultSortDir
  const [isPending, startTransition] = useTransition()
  const [filter, setFilter] = useState<OutcomeFilter>(initialFilter)
  const addonTradeIds = useMemo(() => {
    const openTrades = trades.filter((t) => t.exitTime == null || t.outcome === 'open')
    const earliest = new Map<string, string>()
    for (const t of openTrades) {
      if (!t.symbol || !t.entryTime) continue
      const prev = earliest.get(t.symbol)
      if (!prev || t.entryTime < prev) earliest.set(t.symbol, t.entryTime)
    }

    // Most recent closed trade per symbol — if it was a loss, later entries are not add-ons
    const mostRecentClosed = new Map<string, { exitTime: string; pnl: number | null }>()
    for (const t of trades) {
      if (t.exitTime == null || t.outcome === 'open' || !t.symbol) continue
      const prev = mostRecentClosed.get(t.symbol)
      if (!prev || t.exitTime > prev.exitTime) {
        mostRecentClosed.set(t.symbol, { exitTime: t.exitTime, pnl: t.pnl ?? null })
      }
    }

    return new Set(
      openTrades
        .filter((t) => {
          if (!t.symbol || !t.entryTime) return false
          const earliestOpen = earliest.get(t.symbol) ?? ''
          if (t.entryTime <= earliestOpen) return false
          const lastClosed = mostRecentClosed.get(t.symbol)
          // Only block add-on if the loss closed AFTER the earliest open entry
          if (lastClosed?.pnl != null && lastClosed.pnl < 0 && lastClosed.exitTime > earliestOpen) return false
          return true
        })
        .map((t) => t.id)
    )
  }, [trades])

  const initialDrafts = useMemo(
    () =>
      Object.fromEntries(
        trades.map((t) => [
          t.id,
          {
            setupTag: t.setupTag ?? 'untagged',
            notes: t.notes ?? '',
            initialRisk: t.initialRiskAmount != null
              ? t.initialRiskAmount.toFixed(2)
              : riskAmountForTrade(addonTradeIds.has(t.id)).toFixed(2),
          },
        ])
      ),
    [trades, addonTradeIds]
  )
  const [drafts, setDrafts] = useState<Record<string, { setupTag: string; notes: string; initialRisk: string }>>(
    () => initialDrafts
  )
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(DEFAULT_COLUMN_ORDER)
  const [columnOrderHydrated, setColumnOrderHydrated] = useState(false)
  const [columnOrderUserReady, setColumnOrderUserReady] = useState(false)
  const [draggingColumn, setDraggingColumn] = useState<ColumnId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [liveQuotes, setLiveQuotes] = useState<Record<string, number | null>>({})
  const [stopLossDrafts, setStopLossDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(trades.map((t) => [t.id, t.stopLoss?.toFixed(2) ?? '']))
  )
  const [populating, setPopulating] = useState(false)
  const [populateProgress, setPopulateProgress] = useState<{ done: number; total: number } | null>(null)
  const savedRef = useRef<Record<string, { setupTag: string; notes: string; initialRisk: string }>>(initialDrafts)
  const draftsRef = useRef<Record<string, { setupTag: string; notes: string; initialRisk: string }>>({})
  const columnOrderDbLoadedRef = useRef(false)
  const columnOrderDbSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const savedStopLossRef = useRef<Record<string, string>>(
    Object.fromEntries(trades.map((t) => [t.id, t.stopLoss?.toFixed(2) ?? '']))
  )
  const stopLossTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const stopLossDraftsRef = useRef<Record<string, string>>({})
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const tradeById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades])
  const currentListUrl = useMemo(
    () => `${pathname}${searchParamsString ? `?${searchParamsString}` : ''}`,
    [pathname, searchParamsString]
  )

  const filtered = useMemo(() => {
    const visible = trades.filter((t) => !deletedIds.has(t.id))
    if (filter === 'all') return visible
    if (filter === 'marked') return visible.filter((t) => t.needsReview)
    if (filter === 'lastweek') {
      const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000
      return visible.filter((t) => {
        const entryMs = t.entryTime ? Date.parse(t.entryTime) : NaN
        const exitMs = t.exitTime ? Date.parse(t.exitTime) : NaN
        return (Number.isFinite(entryMs) && entryMs >= cutoffMs) || (Number.isFinite(exitMs) && exitMs >= cutoffMs)
      })
    }
    return visible.filter((t) => t.outcome === filter)
  }, [trades, filter, deletedIds])

  const visibleColumnOrder = useMemo(() => {
    const openOnlyColumns: ColumnId[] = ['currentPrice', 'currentAmount', 'currentRemainShares', 'stopLoss', 'currentRisk', 'currentRiskPct']
    const openHideColumns: ColumnId[] = ['outcome', 'setupTag', 'notes', 'initialRisk']
    if (filter === 'open') {
      const next: ColumnId[] = columnOrder.filter((col) => col !== 'exitTime' && !openHideColumns.includes(col))
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
    const restoreUrl = window.sessionStorage.getItem(TRADES_LAST_URL_STORAGE_KEY)
    if (restoreUrl !== currentListUrl) return

    const raw = window.sessionStorage.getItem(TRADES_LAST_SCROLL_STORAGE_KEY)
    if (!raw) return

    const scrollY = Number(raw)
    if (!Number.isFinite(scrollY)) return

    const restore = () => {
      const container = getDashboardScrollContainer()
      if (!container) return false
      container.scrollTop = scrollY
      return true
    }

    const timers: Array<ReturnType<typeof setTimeout>> = []
    const attemptDelays = [0, 50, 150, 300, 600]

    for (const delay of attemptDelays) {
      timers.push(setTimeout(() => {
        restore()
      }, delay))
    }

    timers.push(setTimeout(() => {
      if (restore()) {
        window.sessionStorage.removeItem(TRADES_LAST_SCROLL_STORAGE_KEY)
      }
    }, 900))

    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [currentListUrl, filtered.length])

  useEffect(() => {
    const raw = window.localStorage.getItem(COLUMN_ORDER_STORAGE_KEY)
    if (raw) {
      try {
        setColumnOrder(normalizeColumnOrder(JSON.parse(raw)))
      } catch {
        // Ignore invalid saved layout.
      }
    }
    setColumnOrderHydrated(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadDbColumnOrder() {
      if (!columnOrderHydrated || columnOrderDbLoadedRef.current) return
      columnOrderDbLoadedRef.current = true
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (cancelled) return

        if (!user) {
          setColumnOrderUserReady(true)
          return
        }

        const { data, error: loadError } = await supabase
          .from('user_settings')
          .select('trades_column_order')
          .eq('user_id', user.id)
          .maybeSingle()

        if (cancelled) return

        if (loadError) {
          const message = String(loadError.message ?? '')
          if (!message.includes('trades_column_order')) {
            console.error('Failed to load trades column order', loadError)
          }
          setColumnOrderUserReady(true)
          return
        }

        if (data?.trades_column_order) {
          setColumnOrder(normalizeColumnOrder(data.trades_column_order))
        }
        setColumnOrderUserReady(true)
      } catch (loadError) {
        if (!cancelled) {
          console.error('Failed to hydrate trades column order', loadError)
          setColumnOrderUserReady(true)
        }
      }
    }

    loadDbColumnOrder()

    return () => {
      cancelled = true
    }
  }, [columnOrderHydrated, supabase])

  useEffect(() => {
    if (!columnOrderHydrated) return
    window.localStorage.setItem(COLUMN_ORDER_STORAGE_KEY, JSON.stringify(columnOrder))
  }, [columnOrder, columnOrderHydrated])

  useEffect(() => {
    if (!columnOrderHydrated || !columnOrderUserReady) return

    if (columnOrderDbSaveTimerRef.current) {
      clearTimeout(columnOrderDbSaveTimerRef.current)
    }

    columnOrderDbSaveTimerRef.current = setTimeout(async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) return

        const { error: saveError } = await supabase.from('user_settings').upsert(
          {
            user_id: user.id,
            trades_column_order: columnOrder,
          },
          { onConflict: 'user_id' }
        )

        if (saveError) {
          const message = String(saveError.message ?? '')
          if (!message.includes('trades_column_order')) {
            console.error('Failed to save trades column order', saveError)
          }
        }
      } catch (saveError) {
        console.error('Failed to persist trades column order', saveError)
      }
    }, 300)

    return () => {
      if (columnOrderDbSaveTimerRef.current) {
        clearTimeout(columnOrderDbSaveTimerRef.current)
      }
    }
  }, [columnOrder, columnOrderHydrated, columnOrderUserReady, supabase])

  useEffect(() => {
    const openSymbols = Array.from(
      new Set(
        trades
          .filter((t) => t.exitTime == null || t.outcome === 'open')
          .map((t) => t.symbol?.trim().toUpperCase())
          .filter((symbol): symbol is string => Boolean(symbol))
      )
    )

    if (openSymbols.length === 0) {
      setLiveQuotes({})
      return
    }

    let cancelled = false

    async function loadQuotes() {
      try {
        const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(openSymbols.join(','))}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = await res.json() as { quotes?: Record<string, number | null> }
        if (!cancelled) {
          setLiveQuotes(json.quotes ?? {})
        }
      } catch {
        if (!cancelled) {
          setLiveQuotes({})
        }
      }
    }

    void loadQuotes()

    return () => {
      cancelled = true
    }
  }, [trades])

  const title = filter === 'all'
    ? 'All Trades'
    : filter === 'win'
      ? 'Winning Trades'
      : filter === 'loss'
        ? 'Losing Trades'
        : filter === 'lastweek'
          ? 'Last Week'
          : filter === 'marked'
            ? 'Marked to Revisit'
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
    if (t.exitTime != null && t.outcome !== 'open') return null
    return liveQuotes[t.symbol.trim().toUpperCase()] ?? null
  }

  function currentAmount(t: Trade) {
    const remain = currentRemainShares(t)
    const price = currentPrice(t)
    if (remain == null || price == null) return null
    return Math.abs(remain * price)
  }

  function computeCurrentRisk(t: Trade, stopLoss: number | null | undefined): number | null {
    const price = currentPrice(t)
    const remain = currentRemainShares(t)
    if (price == null || remain == null || stopLoss == null || !t.side) return null
    const riskPerShare = t.side === 'long' ? price - stopLoss : stopLoss - price
    return Math.max(0, riskPerShare * Math.abs(remain))
  }

  function computeCurrentRiskPct(t: Trade, stopLoss: number | null | undefined): number | null {
    const risk = computeCurrentRisk(t, stopLoss)
    if (risk == null || accountEquity == null || accountEquity <= 0) return null
    return (risk / accountEquity) * 100
  }

  function currentWin(t: Trade) {
    const price = currentPrice(t)
    const remain = currentRemainShares(t)
    if (!t.side || t.entryPrice == null || price == null || remain == null) return null
    const unrealized =
      t.side === 'long'
        ? (price - t.entryPrice) * remain
        : (t.entryPrice - price) * remain
    const realized = t.pnl ?? 0
    return realized + unrealized
  }

  function riskShares(t: Trade): number | null {
    return riskSharesForTrade(t)
  }

  function initialRisk(t: Trade, stopLossOverride?: number | null) {
    if (stopLossOverride != null) {
      return initialRiskFromStopLoss(t.side, t.entryPrice, riskShares(t), stopLossOverride)
    }
    return riskAmountForTrade(addonTradeIds.has(t.id))
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
    const totalRisk = initialRisk(t, stopLoss)
    if (totalRisk == null || totalRisk <= 0) return null
    const totalReward =
      t.exitTime == null || t.outcome === 'open'
        ? currentWin(t)
        : t.pnl
    if (totalReward == null) return null
    const r = totalReward / totalRisk
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
    const draftInitialRisk = drafts[t.id]?.initialRisk
    const parsedDraftInitialRisk =
      draftInitialRisk != null && draftInitialRisk.trim() !== '' ? Number(draftInitialRisk) : null
    const effectiveStopLoss =
      parsedDraftInitialRisk != null && Number.isFinite(parsedDraftInitialRisk)
        ? suggestedStopLossFromRisk(t.side, t.entryPrice, riskShares(t), parsedDraftInitialRisk)
        : t.stopLoss

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
      case 'currentPrice':
        return currentPrice(t)
      case 'currentAmount':
        return currentAmount(t)
      case 'currentRemainShares':
        return currentRemainShares(t)
      case 'rMultiple':
        return computedR(t, effectiveStopLoss) ?? t.rMultiple ?? null
      case 'outcome':
        return t.outcome ?? null
      case 'stopLoss': {
        const dv = stopLossDrafts[t.id] ?? ''
        const pv = dv !== '' ? Number(dv) : null
        return pv != null && Number.isFinite(pv) && pv > 0 ? pv : t.stopLoss
      }
      case 'currentRisk': {
        const dv = stopLossDrafts[t.id] ?? ''
        const pv = dv !== '' ? Number(dv) : null
        const sl = pv != null && Number.isFinite(pv) && pv > 0 ? pv : t.stopLoss
        return computeCurrentRisk(t, sl)
      }
      case 'currentRiskPct': {
        const dv = stopLossDrafts[t.id] ?? ''
        const pv = dv !== '' ? Number(dv) : null
        const sl = pv != null && Number.isFinite(pv) && pv > 0 ? pv : t.stopLoss
        return computeCurrentRiskPct(t, sl)
      }
      default:
        return null
    }
  }

  function compareTrades(a: Trade, b: Trade): number {
    if (sortKey === 'exitTime') {
      const aIsOpen = a.exitTime == null || a.outcome === 'open'
      const bIsOpen = b.exitTime == null || b.outcome === 'open'

      if (aIsOpen && !bIsOpen) return -1
      if (!aIsOpen && bIsOpen) return 1

      if (aIsOpen && bIsOpen) {
        const entryA = a.entryTime ? new Date(a.entryTime).getTime() : null
        const entryB = b.entryTime ? new Date(b.entryTime).getTime() : null
        const openDir = sortDir === 'asc' ? 1 : -1
        if (entryA == null && entryB == null) return 0
        if (entryA == null) return 1
        if (entryB == null) return -1
        return (entryA - entryB) * openDir
      }
    }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, drafts, liveQuotes])

  async function deleteTrade(id: string) {
    if (!window.confirm('Delete this trade? This cannot be undone.')) return
    const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setDeletedIds((prev) => new Set([...prev, id]))
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to delete trade')
    }
  }

  function updateDraft(
    id: string,
    key: 'setupTag' | 'notes' | 'initialRisk',
    value: string
  ) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        setupTag: prev[id]?.setupTag ?? 'untagged',
        notes: prev[id]?.notes ?? '',
        initialRisk: prev[id]?.initialRisk ?? DEFAULT_INITIAL_RISK_INPUT,
        [key]: value,
      },
    }))
  }

  function setFilterAndUrl(next: OutcomeFilter) {
    getDashboardScrollContainer()?.scrollTo({ top: 0 })
    startTransition(() => {
      setFilter(next)
    })
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
        const suggested = suggestedStopLossFromRisk(t.side, t.entryPrice, displayShares(t))
        if (suggested == null) {
          setPopulateProgress({ done: i + 1, total: needsStop.length })
          continue
        }

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

  async function saveTradeFields(id: string, draft: { setupTag: string; notes: string; initialRisk: string }) {
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

      const parsedInitialRisk = draft.initialRisk.trim() === '' ? null : Number(draft.initialRisk)
      if (parsedInitialRisk != null && (!Number.isFinite(parsedInitialRisk) || parsedInitialRisk <= 0)) {
        return
      }
      const systemDefaultRisk = riskAmountForTrade(addonTradeIds.has(id))
      const isCustomRisk = parsedInitialRisk == null || parsedInitialRisk !== systemDefaultRisk
      const trade = tradeById.get(id)
      const parsedStopLoss = trade && parsedInitialRisk != null
        ? suggestedStopLossFromRisk(trade.side, trade.entryPrice, riskShares(trade), parsedInitialRisk)
        : null
      const nextR = trade ? computedR(trade, parsedStopLoss) : null
      const riskRes = await fetch(`/api/trades/${id}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stopLoss: parsedStopLoss,
          rMultiple: nextR,
          // Only persist custom risk amounts and lock stop_loss when user explicitly changed it
          ...(isCustomRisk ? {
            initialRiskAmount: parsedInitialRisk,
            stopLossLocked: parsedInitialRisk != null,
          } : {}),
        }),
      })
      const riskJson = await riskRes.json()
      if (!riskRes.ok) {
        setError(riskJson.error ?? 'Failed to save risk values')
        return
      }

      saveStoredInitialRisk(id, draft.initialRisk)
      savedRef.current[id] = draft
    } catch {
      setError('Failed to save trade values')
    }
  }

  async function saveStopLoss(id: string, value: string) {
    const stopLoss = value.trim() === '' ? null : Number(value)
    if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) return
    const trade = tradeById.get(id)
    if (!trade) return
    const nextR = stopLoss != null ? computedR(trade, stopLoss) : null
    try {
      await fetch(`/api/trades/${id}/risk`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stopLoss,
          rMultiple: nextR,
          stopLossLocked: stopLoss != null,
          initialRiskAmount: null,
        }),
      })
    } catch {
      // silently ignore
    }
  }

  useEffect(() => {
    stopLossDraftsRef.current = stopLossDrafts
    for (const [id, value] of Object.entries(stopLossDrafts)) {
      if (savedStopLossRef.current[id] === value) continue
      if (stopLossTimersRef.current[id]) clearTimeout(stopLossTimersRef.current[id])
      stopLossTimersRef.current[id] = setTimeout(() => {
        savedStopLossRef.current[id] = value
        void saveStopLoss(id, value)
      }, 700)
    }
  }, [stopLossDrafts])

  useEffect(() => {
    draftsRef.current = drafts
    for (const [id, draft] of Object.entries(drafts)) {
      const saved = savedRef.current[id]
      if (
        saved &&
        saved.setupTag === draft.setupTag &&
        saved.notes === draft.notes &&
        saved.initialRisk === draft.initialRisk
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
    // No cleanup here — clearing all timers on every drafts change would cancel
    // the user's in-flight save when any other draft (e.g. auto-stop) updates.
  }, [drafts])

  // Flush any pending draft saves before unmount (e.g. client-side navigation away)
  const saveTradeFieldsRef = useRef(saveTradeFields)
  useEffect(() => { saveTradeFieldsRef.current = saveTradeFields })
  const saveStopLossRef = useRef(saveStopLoss)
  useEffect(() => { saveStopLossRef.current = saveStopLoss })

  useEffect(() => {
    function flushPending() {
      for (const [id, timer] of Object.entries(timersRef.current)) {
        clearTimeout(timer)
        const draft = draftsRef.current[id]
        const saved = savedRef.current[id]
        if (!draft || !saved) continue
        if (draft.setupTag === saved.setupTag && draft.notes === saved.notes && draft.initialRisk === saved.initialRisk) continue
        void saveTradeFieldsRef.current(id, draft)
      }
      timersRef.current = {}
      for (const [id, timer] of Object.entries(stopLossTimersRef.current)) {
        clearTimeout(timer)
        const value = stopLossDraftsRef.current[id]
        if (value == null || savedStopLossRef.current[id] === value) continue
        savedStopLossRef.current[id] = value
        void saveStopLossRef.current(id, value)
      }
      stopLossTimersRef.current = {}
    }
    window.addEventListener('pagehide', flushPending)
    return () => {
      window.removeEventListener('pagehide', flushPending)
      flushPending()
    }
  }, [])

  // On mount: backfill any trades that are missing a stop loss in the DB.
  // This is a one-time server-side calculation — stop losses are stored permanently
  // and never recalculated once set. After backfill, refresh to show the new values.
  useEffect(() => {
    const hasMissing = trades.some((t) => t.stopLoss == null && t.side && t.entryTime)
    if (!hasMissing) return

    fetch('/api/trades/backfill-stop-losses', { method: 'POST' })
      .then((res) => res.json())
      .then((json: { backfilled?: number }) => {
        if ((json.backfilled ?? 0) > 0) {
          router.refresh()
        }
      })
      .catch(() => {/* silently ignore backfill errors */})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {(searchParams.get('symbol') || searchParams.get('date')) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(searchParams.get('date') ? '/analysis?tab=days' : '/analysis?tab=trades')}
              className="gap-1 px-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          <h1 className="text-xl font-semibold">
            {title} ({filtered.length})
          </h1>
        </div>
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
                : 'Populate Initial Risk'}
            </Button>
          )}
          <span className="text-sm text-muted-foreground">View</span>
          <Select value={filter} onValueChange={(v) => setFilterAndUrl(v as OutcomeFilter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select view" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="all">All Trades</SelectItem>
              <SelectItem value="open">Open Trades</SelectItem>
              <SelectItem value="lastweek">Last Week</SelectItem>
              <SelectItem value="marked">Marked to Revisit</SelectItem>
              <SelectItem value="win">Winners</SelectItem>
              <SelectItem value="loss">Losers</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {error && <div className="text-sm text-red-700">{error}</div>}

      <div className={`rounded-lg border overflow-x-auto transition-opacity duration-150 ${isPending ? 'opacity-50' : 'opacity-100'}`}>
        <Table className="min-w-full w-max">
          <TableHeader>
            <TableRow>
              {visibleColumnOrder.map((col) => {
                const rightAligned =
                  col === 'holdDays' ||
                  col === 'shares' ||
                  col === 'entryPrice' ||
                  col === 'pnl' ||
                  col === 'pnlPct' ||
                  col === 'initialAmount' ||
                  col === 'initialRisk' ||
                  col === 'initialRiskPct' ||
                  col === 'currentPrice' ||
                  col === 'currentAmount' ||
                  col === 'currentRemainShares' ||
                  col === 'rMultiple' ||
                  col === 'stopLoss' ||
                  col === 'currentRisk' ||
                  col === 'currentRiskPct'
                const headerContent: Record<ColumnId, React.ReactNode> = {
                  symbol: sortableHeader('Symbol', 'symbol'),
                  side: sortableHeader('Side', 'side'),
                  entryTime: sortableHeader('Entry', 'entryTime'),
                  exitTime: sortableHeader('Exit', 'exitTime'),
                  holdDays: sortableHeader('Hold Days', 'holdDays'),
                  shares: sortableHeader('Shares', 'shares'),
                  entryPrice: sortableHeader('Entry $', 'entryPrice'),
                  pnl: sortableHeader('P&L', 'pnl'),
                  pnlPct: sortableHeader('P&L %', 'pnlPct'),
                  initialAmount: sortableHeader('Initial Amount', 'initialAmount'),
                  initialRisk: sortableHeader('Initial Risk', 'initialRisk'),
                  initialRiskPct: sortableHeader('Initial Risk %', 'initialRiskPct'),
                  currentPrice: sortableHeader('Current Price', 'currentPrice'),
                  currentAmount: sortableHeader('Current Amount', 'currentAmount'),
                  currentRemainShares: sortableHeader('Current Shares', 'currentRemainShares'),
                  rMultiple: sortableHeader('R Multiple', 'rMultiple'),
                  outcome: sortableHeader('Outcome', 'outcome'),
                  setupTag: 'Setup',
                  notes: 'Notes',
                  stopLoss: sortableHeader('Stop Loss', 'stopLoss'),
                  currentRisk: sortableHeader('Current Risk $', 'currentRisk'),
                  currentRiskPct: sortableHeader('Acct Risk %', 'currentRiskPct'),
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
              const draftInitialRisk =
                drafts[t.id]?.initialRisk
                ?? DEFAULT_INITIAL_RISK_INPUT
              const parsedDraftInitialRisk = draftInitialRisk.trim() === '' ? null : Number(draftInitialRisk)
              const effectiveStopLoss =
                parsedDraftInitialRisk != null && Number.isFinite(parsedDraftInitialRisk)
                  ? suggestedStopLossFromRisk(t.side, t.entryPrice, riskShares(t), parsedDraftInitialRisk)
                  : t.stopLoss
              const stopLossDraftValue = stopLossDrafts[t.id] ?? ''
              const parsedStopLossDraft = stopLossDraftValue !== '' ? Number(stopLossDraftValue) : null
              const stopLossForCurrentRisk =
                parsedStopLossDraft != null && Number.isFinite(parsedStopLossDraft) && parsedStopLossDraft > 0
                  ? parsedStopLossDraft
                  : t.stopLoss
              const isMarkedForReview = t.needsReview

              return (
              <TableRow
                key={t.id}
                className={isMarkedForReview ? 'bg-amber-50/80 hover:bg-amber-100/80' : 'hover:bg-muted/40'}
              >
                {visibleColumnOrder.map((col) => {
                  const tableR = computedR(t, effectiveStopLoss) ?? t.rMultiple
                  const detailsHref = `/trades/${t.id}?${(() => {
                    const params = new URLSearchParams(searchParamsString)
                    params.set('view', filter)
                    if (tableR != null) params.set('r', tableR.toFixed(4))
                    return params.toString()
                  })()}`
                  if (col === 'symbol') {
                    return (
                      <TableCell key={col} className="font-medium">
                        <div className="group/sym flex items-center gap-2">
                          <Link
                            href={detailsHref}
                            scroll={false}
                            className="underline-offset-4 hover:underline"
                            onClick={() => {
                              const container = getDashboardScrollContainer()
                              window.sessionStorage.setItem(TRADES_LAST_URL_STORAGE_KEY, currentListUrl)
                              window.sessionStorage.setItem(TRADES_LAST_SCROLL_STORAGE_KEY, String(container?.scrollTop ?? 0))
                            }}
                          >
                            {t.symbol}
                          </Link>
                          {isMarkedForReview && (
                            <Badge className="border border-amber-200 bg-amber-100 text-amber-800">Revisit</Badge>
                          )}
                          <button
                            onClick={() => deleteTrade(t.id)}
                            className="invisible ml-auto text-muted-foreground hover:text-destructive group-hover/sym:visible"
                            title="Delete trade"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    )
                  }
                  if (col === 'side') return <TableCell key={col} className="capitalize">{t.side ?? '—'}</TableCell>
                  if (col === 'entryTime') return <TableCell key={col}><LocalTime date={t.entryTime} dateOnly className="font-mono text-xs text-muted-foreground" /></TableCell>
                  if (col === 'exitTime') return <TableCell key={col}><LocalTime date={t.exitTime} dateOnly className="font-mono text-xs text-muted-foreground" /></TableCell>
                  if (col === 'holdDays') return <TableCell key={col} className="text-right">{fmtHoldDuration(effectiveHoldTimeMin(t), t.holdDays)}</TableCell>
                  if (col === 'shares') return <TableCell key={col} className="text-right">{displayShares(t) ?? '—'}</TableCell>
                  if (col === 'entryPrice') return <TableCell key={col} className="text-right">{fmtPrice(t.entryPrice)}</TableCell>
                  if (col === 'pnl') {
                    const isOpen = t.exitTime == null || t.outcome === 'open'
                    let displayPnl: number | null = t.pnl
                    if (isOpen) {
                      const win = currentWin(t)
                      if (win != null) displayPnl = win
                    }
                    return <TableCell key={col} className={`text-right font-medium ${signedValueClass(displayPnl) || pnlClass(t.outcome)}`}>{displayPnl != null ? `${displayPnl >= 0 ? '+' : ''}$${displayPnl.toFixed(2)}` : '—'}</TableCell>
                  }
                  if (col === 'pnlPct') {
                    const isOpen = t.exitTime == null || t.outcome === 'open'
                    let displayPct: number | null = isOpen ? null : t.pnlPct
                    if (isOpen) {
                      const price = currentPrice(t)
                      if (t.entryPrice != null && price != null && t.entryPrice > 0) {
                        displayPct = t.side === 'long' ? (price - t.entryPrice) / t.entryPrice : (t.entryPrice - price) / t.entryPrice
                      }
                    }
                    return <TableCell key={col} className={`text-right ${signedValueClass(displayPct) || pnlClass(t.outcome)}`}>{displayPct != null ? `${(displayPct * 100).toFixed(2)}%` : '—'}</TableCell>
                  }
                  if (col === 'initialAmount') return <TableCell key={col} className="text-right">{initialAmount(t) != null ? fmtMoney(initialAmount(t) as number) : '—'}</TableCell>
                  if (col === 'initialRisk') {
                    return (
                      <TableCell key={col} className="text-right">
                        <input
                          className="h-8 w-[92px] rounded-md border px-2 text-right text-xs"
                          value={draftInitialRisk}
                          onChange={(e) => updateDraft(t.id, 'initialRisk', e.target.value)}
                          placeholder="2000.00"
                          inputMode="decimal"
                        />
                      </TableCell>
                    )
                  }
                  if (col === 'initialRiskPct') return <TableCell key={col} className="text-right">{initialRiskPct(t, effectiveStopLoss) != null ? `${initialRiskPct(t, effectiveStopLoss)?.toFixed(2)}%` : '—'}</TableCell>
                  if (col === 'currentPrice') return <TableCell key={col} className="text-right">{currentPrice(t) != null ? fmtPrice(currentPrice(t) as number) : '—'}</TableCell>
                  if (col === 'currentAmount') return <TableCell key={col} className="text-right">{currentAmount(t) != null ? fmtMoney(currentAmount(t) as number) : '—'}</TableCell>
                  if (col === 'currentRemainShares') return <TableCell key={col} className="text-right">{currentRemainShares(t) != null ? currentRemainShares(t) : '—'}</TableCell>
                  if (col === 'stopLoss') {
                    return (
                      <TableCell key={col} className="text-right">
                        <input
                          className="h-8 w-[92px] rounded-md border px-2 text-right text-xs"
                          value={stopLossDraftValue}
                          onChange={(e) => setStopLossDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                          placeholder="0.00"
                          inputMode="decimal"
                        />
                      </TableCell>
                    )
                  }
                  if (col === 'currentRisk') {
                    const risk = computeCurrentRisk(t, stopLossForCurrentRisk)
                    return (
                      <TableCell key={col} className={`text-right font-medium ${risk != null && risk > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {risk != null ? `$${risk.toFixed(2)}` : '—'}
                      </TableCell>
                    )
                  }
                  if (col === 'currentRiskPct') {
                    const pct = computeCurrentRiskPct(t, stopLossForCurrentRisk)
                    return (
                      <TableCell key={col} className={`text-right font-medium ${pct != null && pct > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {pct != null ? `${pct.toFixed(2)}%` : '—'}
                      </TableCell>
                    )
                  }
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
                        <select
                          className="h-8 w-[110px] rounded-md border px-2 text-xs bg-background"
                          value={drafts[t.id]?.setupTag ?? t.setupTag}
                          onChange={(e) => updateDraft(t.id, 'setupTag', e.target.value)}
                        >
                          <option value="untagged">None</option>
                          <option value="pullback">Pullback</option>
                          <option value="breakout">Breakout</option>
                        </select>
                      </TableCell>
                    )
                  }
                  return (
                    <TableCell key={col}>
                      <div className="group relative">
                        <SpellCheckTextarea
                          className="h-8 w-[160px] resize-none overflow-hidden rounded-md border px-2 py-1 text-xs leading-tight focus:h-20 focus:overflow-y-auto"
                          value={drafts[t.id]?.notes ?? t.notes ?? ''}
                          onChange={(v) => updateDraft(t.id, 'notes', v)}
                          placeholder="Add notes"
                          title={drafts[t.id]?.notes ?? t.notes ?? ''}
                          rows={1}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.shiftKey || e.altKey)) {
                              e.preventDefault()
                              const el = e.currentTarget
                              const start = el.selectionStart ?? el.value.length
                              const end = el.selectionEnd ?? el.value.length
                              const next = el.value.slice(0, start) + '\n' + el.value.slice(end)
                              updateDraft(t.id, 'notes', next)
                              requestAnimationFrame(() => {
                                el.selectionStart = start + 1
                                el.selectionEnd = start + 1
                              })
                            } else if (e.key === 'Enter') {
                              e.preventDefault()
                              e.currentTarget.blur()
                            }
                          }}
                        />
                        {(drafts[t.id]?.notes ?? t.notes ?? '').trim() && (
                          <div className="pointer-events-none absolute right-0 top-full z-30 mt-1 hidden w-72 max-w-[calc(100vw-2rem)] whitespace-pre-wrap rounded-md border bg-background p-2 text-xs leading-relaxed shadow-md group-hover:block group-focus-within:block">
                            {drafts[t.id]?.notes ?? t.notes}
                          </div>
                        )}
                      </div>
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
