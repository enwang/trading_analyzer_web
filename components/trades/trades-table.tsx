'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { Trade } from '@/types/trade'
import { Badge } from '@/components/ui/badge'
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
  | 'shares'
  | 'entryPrice'
  | 'exitPrice'
  | 'pnl'
  | 'pnlPct'
  | 'initialAmount'
  | 'initialRisk'
  | 'rMultiple'
  | 'outcome'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = [
  'symbol',
  'side',
  'entryTime',
  'exitTime',
  'shares',
  'entryPrice',
  'exitPrice',
  'pnl',
  'pnlPct',
  'initialAmount',
  'initialRisk',
  'rMultiple',
  'outcome',
]

function pnlClass(outcome: string | null) {
  if (outcome === 'win') return 'text-emerald-600'
  if (outcome === 'loss') return 'text-red-600'
  return ''
}

function fmtPrice(n: number | null) {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function fmtMoney(n: number) {
  return `$${n.toFixed(2)}`
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
        trades.map((t) => [t.id, { setupTag: t.setupTag ?? 'untagged', notes: t.notes ?? '' }])
      ),
    [trades]
  )
  const [drafts, setDrafts] = useState<Record<string, { setupTag: string; notes: string }>>(
    () => initialDrafts
  )
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey)
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)
  const [error, setError] = useState<string | null>(null)
  const savedRef = useRef<Record<string, { setupTag: string; notes: string }>>(initialDrafts)
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const filtered = useMemo(() => {
    if (filter === 'all') return trades
    return trades.filter((t) => t.outcome === filter)
  }, [trades, filter])

  useEffect(() => {
    setFilter(initialFilter)
  }, [initialFilter])

  useEffect(() => {
    setSortKey(initialSortKey)
    setSortDir(initialSortDir)
  }, [initialSortKey, initialSortDir])

  const title = filter === 'all'
    ? 'All Trades'
    : filter === 'win'
      ? 'Winning Trades'
      : filter === 'loss'
        ? 'Losing Trades'
        : 'Open Trades'

  function initialAmount(t: Trade) {
    if (t.entryPrice == null || t.shares == null) return null
    return Math.abs(t.entryPrice * t.shares)
  }

  function initialRisk(t: Trade) {
    if (!t.side || t.entryPrice == null || t.stopLoss == null || t.shares == null) return null
    const riskPerShare = t.side === 'long' ? t.entryPrice - t.stopLoss : t.stopLoss - t.entryPrice
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
    return Math.abs(riskPerShare * t.shares)
  }

  function computedR(t: Trade) {
    if (!t.side || t.entryPrice == null || t.exitPrice == null || t.stopLoss == null) return null
    const riskPerShare = t.side === 'long' ? t.entryPrice - t.stopLoss : t.stopLoss - t.entryPrice
    if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) return null
    const rewardPerShare = t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
    const r = rewardPerShare / riskPerShare
    return Number.isFinite(r) ? r : null
  }

  function valueForSort(t: Trade, key: SortKey): string | number | null {
    switch (key) {
      case 'symbol':
        return t.symbol ?? null
      case 'side':
        return t.side ?? null
      case 'entryTime':
        return t.entryTime ? new Date(t.entryTime).getTime() : null
      case 'exitTime':
        return t.exitTime ? new Date(t.exitTime).getTime() : null
      case 'shares':
        return t.shares ?? null
      case 'entryPrice':
        return t.entryPrice ?? null
      case 'exitPrice':
        return t.exitPrice ?? null
      case 'pnl':
        return t.pnl ?? null
      case 'pnlPct':
        return t.pnlPct ?? null
      case 'initialAmount':
        return initialAmount(t)
      case 'initialRisk':
        return initialRisk(t)
      case 'rMultiple':
        return computedR(t) ?? t.rMultiple ?? null
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

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort(compareTrades)
  }, [filtered, sortKey, sortDir])

  function updateDraft(id: string, key: 'setupTag' | 'notes', value: string) {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        setupTag: prev[id]?.setupTag ?? 'untagged',
        notes: prev[id]?.notes ?? '',
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

  async function saveJournal(id: string, draft: { setupTag: string; notes: string }) {
    setError(null)
    try {
      const res = await fetch(`/api/trades/${id}/journal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupTag: draft.setupTag,
          notes: draft.notes,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to save journal')
        return
      }
      savedRef.current[id] = draft
    } catch {
      setError('Failed to save journal')
    }
  }

  useEffect(() => {
    for (const [id, draft] of Object.entries(drafts)) {
      const saved = savedRef.current[id]
      if (saved && saved.setupTag === draft.setupTag && saved.notes === draft.notes) {
        continue
      }

      if (timersRef.current[id]) {
        clearTimeout(timersRef.current[id])
      }
      timersRef.current[id] = setTimeout(() => {
        void saveJournal(id, draft)
      }, 700)
    }

    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearTimeout(timer)
      }
      timersRef.current = {}
    }
  }, [drafts])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">
          {title} ({filtered.length})
        </h1>
        <div className="flex items-center gap-2">
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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button type="button" className="font-medium" onClick={() => toggleSort('symbol')}>
                  Symbol{sortMarker('symbol')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="font-medium" onClick={() => toggleSort('side')}>
                  Side{sortMarker('side')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="font-medium" onClick={() => toggleSort('entryTime')}>
                  Entry{sortMarker('entryTime')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="font-medium" onClick={() => toggleSort('exitTime')}>
                  Exit{sortMarker('exitTime')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('shares')}>
                  Shares{sortMarker('shares')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('entryPrice')}>
                  Entry ${sortMarker('entryPrice')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('exitPrice')}>
                  Exit ${sortMarker('exitPrice')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('pnl')}>
                  P&L{sortMarker('pnl')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('pnlPct')}>
                  P&L %{sortMarker('pnlPct')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('initialAmount')}>
                  Initial Amount{sortMarker('initialAmount')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('initialRisk')}>
                  Initial Risk{sortMarker('initialRisk')}
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button type="button" className="font-medium" onClick={() => toggleSort('rMultiple')}>
                  R Multiple{sortMarker('rMultiple')}
                </button>
              </TableHead>
              <TableHead>
                <button type="button" className="font-medium" onClick={() => toggleSort('outcome')}>
                  Outcome{sortMarker('outcome')}
                </button>
              </TableHead>
              <TableHead>Setup</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={15} className="py-10 text-center text-muted-foreground">
                  No trades for this filter.
                </TableCell>
              </TableRow>
            )}
            {sortedFiltered.map((t) => (
              <TableRow key={t.id} className="hover:bg-muted/40">
                <TableCell className="font-medium">
                  <Link
                    href={`/trades/${t.id}?${(() => {
                      const params = new URLSearchParams(searchParams.toString())
                      params.set('view', filter)
                      return params.toString()
                    })()}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {t.symbol}
                  </Link>
                </TableCell>
                <TableCell className="capitalize">{t.side ?? '—'}</TableCell>
                <TableCell>
                  <LocalTime date={t.entryTime} className="font-mono text-xs text-muted-foreground" />
                </TableCell>
                <TableCell>
                  <LocalTime date={t.exitTime} className="font-mono text-xs text-muted-foreground" />
                </TableCell>
                <TableCell className="text-right">{t.shares ?? '—'}</TableCell>
                <TableCell className="text-right">{fmtPrice(t.entryPrice)}</TableCell>
                <TableCell className="text-right">{fmtPrice(t.exitPrice)}</TableCell>
                <TableCell className={`text-right font-medium ${pnlClass(t.outcome)}`}>
                  {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '—'}
                </TableCell>
                <TableCell className={`text-right ${pnlClass(t.outcome)}`}>
                  {t.pnlPct != null ? `${(t.pnlPct * 100).toFixed(2)}%` : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {initialAmount(t) != null ? fmtMoney(initialAmount(t) as number) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {initialRisk(t) != null ? fmtMoney(initialRisk(t) as number) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {(computedR(t) ?? t.rMultiple) != null ? (computedR(t) ?? t.rMultiple)?.toFixed(2) : '—'}
                </TableCell>
                <TableCell>
                  <OutcomeBadge outcome={t.outcome} />
                </TableCell>
                <TableCell>
                  <input
                    className="h-8 w-[120px] rounded-md border px-2 text-xs"
                    value={drafts[t.id]?.setupTag ?? t.setupTag}
                    onChange={(e) => updateDraft(t.id, 'setupTag', e.target.value)}
                  />
                </TableCell>
                <TableCell>
                  <input
                    className="h-8 w-[220px] rounded-md border px-2 text-xs"
                    value={drafts[t.id]?.notes ?? t.notes}
                    onChange={(e) => updateDraft(t.id, 'notes', e.target.value)}
                    placeholder="Add notes"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
