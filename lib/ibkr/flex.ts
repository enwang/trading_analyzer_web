/**
 * ibkr/flex.ts — IBKR Flex Web Service client
 *
 * 1. POST SendRequest  → ReferenceCode
 * 2. GET  GetStatement → poll until complete, download content
 * 3. Parse CSV/XML → normalize → return Trade rows
 */

import Papa from 'papaparse'
import { fromZonedTime } from 'date-fns-tz'

// ---------------------------------------------------------------------------
// IBKR API endpoints
// ---------------------------------------------------------------------------
const SEND_REQUEST_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest'
const GET_STATEMENT_URL =
  'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement'
const FLEX_VERSION = '3'
const MAX_WAIT_MS = 60_000
const POLL_INTERVAL_MS = 3_000

// Only include trades opened on or after this date
const QUERY_START = new Date('2026-01-01T00:00:00Z')

// ---------------------------------------------------------------------------
// Normalized trade row (ready to upsert into Supabase)
// ---------------------------------------------------------------------------
export interface NormalizedTrade {
  symbol: string
  entry_time: string | null      // ISO 8601 UTC
  exit_time: string | null       // null for open positions
  side: string | null
  shares: number | null
  entry_price: number | null
  exit_price: number | null
  pnl: number | null
  pnl_pct: number | null
  outcome: string | null         // win | loss | breakeven | open
  hold_days: number | null
  hold_time_min: number | null
  hour_of_day: number | null
  day_of_week: string | null
  r_multiple: number | null
  setup_tag: string
  execution_legs?: { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[] | null
  source: 'ibkr'
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Full end-to-end: request → poll → parse → normalize. */
export async function fetchFlexTrades(
  token: string,
  queryId: string
): Promise<NormalizedTrade[]> {
  const { refCode, dlUrl } = await sendRequest(token, queryId)
  const content = await pollAndDownload(token, refCode, dlUrl)
  const trimmed = content.trimStart()
  if (trimmed.startsWith('<')) {
    return parseXml(content)
  } else {
    return parseCsv(content)
  }
}

// ---------------------------------------------------------------------------
// Step 1: Send request
// ---------------------------------------------------------------------------
async function sendRequest(
  token: string,
  queryId: string,
  retries = 3
): Promise<{ refCode: string; dlUrl: string }> {
  const body = new URLSearchParams({ t: token, q: queryId, v: FLEX_VERSION })

  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(SEND_REQUEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const text = await resp.text()
    const status = extractXmlTag(text, 'Status')
    if (status?.toLowerCase().includes('too many')) {
      await sleep(15_000)
      continue
    }
    if (status?.toLowerCase() !== 'success' && status?.toLowerCase() !== 'processing') {
      const errMsg = extractXmlTag(text, 'ErrorMessage') ?? text.slice(0, 200)
      throw new Error(`IBKR SendRequest failed: ${errMsg}`)
    }
    const refCode = extractXmlTag(text, 'ReferenceCode')
    if (!refCode) throw new Error('IBKR did not return a ReferenceCode')
    const dlUrl = extractXmlTag(text, 'Url') ?? GET_STATEMENT_URL
    return { refCode, dlUrl }
  }
  throw new Error('IBKR SendRequest: too many retries')
}

// ---------------------------------------------------------------------------
// Step 2: Poll + download
// ---------------------------------------------------------------------------
async function pollAndDownload(
  token: string,
  refCode: string,
  dlUrl: string
): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS
  const params = new URLSearchParams({ t: token, q: refCode, v: FLEX_VERSION })
  const url = `${dlUrl}?${params}`

  while (Date.now() < deadline) {
    const resp = await fetch(url)
    const text = await resp.text()
    const trimmed = text.trimStart()

    if (trimmed.startsWith('<FlexStatements') || trimmed.startsWith('<FlexQueryResponse')) {
      return text
    }
    if (!trimmed.startsWith('<')) return text   // CSV content

    const status = extractXmlTag(text, 'Status')
    if (!status || status.toLowerCase() === 'processing') {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    if (status.toLowerCase() === 'success') return text
    if (status.toLowerCase() === 'warn' || status.toLowerCase() === 'warning') {
      // IBKR returns a status envelope; fetch data from the embedded URL
      const warnUrl = extractXmlTag(text, 'Url') ?? dlUrl
      const warnParams = new URLSearchParams({ t: token, q: refCode, v: FLEX_VERSION })
      const warnResp = await fetch(`${warnUrl}?${warnParams}`)
      const warnText = await warnResp.text()
      const warnTrimmed = warnText.trimStart()
      if (
        warnTrimmed.startsWith('<FlexStatements') ||
        warnTrimmed.startsWith('<FlexQueryResponse') ||
        !warnTrimmed.startsWith('<')
      ) {
        return warnText
      }
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    throw new Error(`IBKR polling failed with status: ${status}`)
  }
  throw new Error('IBKR timed out after 60 seconds')
}

// ---------------------------------------------------------------------------
// CSV parsing (primary path)
// ---------------------------------------------------------------------------
function parseCsv(csvStr: string): NormalizedTrade[] {
  const result = Papa.parse<Record<string, string>>(csvStr, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })

  const raw = result.data as Record<string, string>[]
  if (!raw.length) throw new Error('No rows found in Flex CSV')

  // Case-insensitive column lookup
  const keys = Object.keys(raw[0]).map(k => k.toLowerCase())
  function col(row: Record<string, string>, ...names: string[]): string {
    for (const n of names) {
      const k = keys.find(k => k === n.toLowerCase().trim())
      if (k && row[k] !== undefined) return row[k]
    }
    return ''
  }

  const ociKey = keys.find(k =>
    ['open/closeindicator', 'opencloseindicator', 'openclose', 'open/close'].includes(k)
  ) ?? ''

  // Build open-entry maps from O-rows. Entry price is always from O-row fill
  // prices (TradePrice), never from C-row CostBasis.
  const openEntryMap = new Map<string, string>()
  const symOpenEntries = new Map<string, string[]>()
  const openPriceMapByEntry = new Map<string, { totalShares: number; totalCost: number }>()
  const openPriceMapByDate = new Map<string, { totalShares: number; totalCost: number }>()
  const openLegsByEntry = new Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>()
  const closeLegsByEntry = new Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>()
  const openLotsBySymbol = new Map<string, { entryIso: string; avgPrice: number; remainingShares: number }[]>()
  const openGroups = new Map<string, {
    symbol: string
    entryIso: string
    totalShares: number
    totalCost: number
    legs: { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]
  }>()

  const oRaw: Record<string, string>[] = []
  const cRaw: Record<string, string>[] = []
  const oQtyBySym = new Map<string, number>()
  const cQtyBySym = new Map<string, number>()

  for (const row of raw) {
    const oci = ociKey ? (row[ociKey] ?? '').toUpperCase() : ''
    const sym = col(row, 'symbol').toUpperCase().trim()
    const qty = Math.abs(parseNum(col(row, 'quantity')) ?? 0)
    const isO = oci.includes('O') && !oci.includes('C')
    const isC = oci.includes('C')

    if (isO && sym) {
      oRaw.push(row)
      oQtyBySym.set(sym, (oQtyBySym.get(sym) ?? 0) + qty)

      const dtStr = col(row, 'date/time', 'datetime', 'tradedatetime', 'open date/time', 'opendatetime', 'dateandhour', 'date', 'tradedate')
      if (dtStr) {
        const ts = parseIbkrDatetime(dtStr)
        if (ts) {
          const entryIso = toUtcIso(ts)
          if (!entryIso) continue
          const dateKey = entryIso.slice(0, 10)
          const dateMapKey = `${sym}|${dateKey}`

          if (!openEntryMap.has(dateMapKey)) openEntryMap.set(dateMapKey, entryIso)
          if (!symOpenEntries.has(sym)) symOpenEntries.set(sym, [])
          const entries = symOpenEntries.get(sym)!
          if (!entries.includes(entryIso)) entries.push(entryIso)

          const fillPrice = parseNum(col(row, 't. price', 'tradeprice', 'price')) ?? 0
          const byDate = openPriceMapByDate.get(dateMapKey) ?? { totalShares: 0, totalCost: 0 }
          byDate.totalShares += qty
          byDate.totalCost += fillPrice * qty
          openPriceMapByDate.set(dateMapKey, byDate)

          const ibOrderId = col(row, 'iborderid').trim()
          const groupId = ibOrderId && ibOrderId !== '0'
            ? `${sym}|ord:${ibOrderId}`
            : `${sym}|ts:${entryIso}`
          const bs = col(row, 'buy/sell', 'buysell').toUpperCase()
          const action: 'BUY' | 'SELL' = bs.includes('SELL') ? 'SELL' : 'BUY'
          const group = openGroups.get(groupId) ?? {
            symbol: sym,
            entryIso,
            totalShares: 0,
            totalCost: 0,
            legs: [],
          }
          if (entryIso < group.entryIso) group.entryIso = entryIso
          group.totalShares += qty
          group.totalCost += fillPrice * qty
          group.legs.push({ time: entryIso, action, shares: qty, price: fillPrice })
          openGroups.set(groupId, group)
        }
      }
    }

    if (isC && sym) {
      cRaw.push(row)
      cQtyBySym.set(sym, (cQtyBySym.get(sym) ?? 0) + qty)
    }
  }

  for (const [, entries] of symOpenEntries) entries.sort()
  for (const group of openGroups.values()) {
    const entryKey = `${group.symbol}|${group.entryIso}`
    const byEntry = openPriceMapByEntry.get(entryKey) ?? { totalShares: 0, totalCost: 0 }
    byEntry.totalShares += group.totalShares
    byEntry.totalCost += group.totalCost
    openPriceMapByEntry.set(entryKey, byEntry)

    const legs = openLegsByEntry.get(entryKey) ?? []
    legs.push(...group.legs)
    openLegsByEntry.set(entryKey, legs)

    const avgPrice = group.totalShares > 0 ? group.totalCost / group.totalShares : 0
    if (!openLotsBySymbol.has(group.symbol)) openLotsBySymbol.set(group.symbol, [])
    openLotsBySymbol.get(group.symbol)!.push({
      entryIso: group.entryIso,
      avgPrice,
      remainingShares: group.totalShares,
    })
  }
  for (const [, lots] of openLotsBySymbol) {
    lots.sort((a, b) => (a.entryIso < b.entryIso ? -1 : a.entryIso > b.entryIso ? 1 : 0))
  }

  // Use C-rows, or fall back to rows with non-zero realized P/L
  const closeRows = cRaw.length > 0
    ? cRaw
    : raw.filter(row => {
        const pnl = parseNum(col(row, 'realized p/l', 'fifopnlrealized', 'realized p&l'))
        return pnl != null && pnl !== 0
      })

  if (!closeRows.length) throw new Error('No closing trades found in Flex CSV')

  // --- Build a raw trade per C-row ---
  const trades: NormalizedTrade[] = []
  function allocateClose(
    sym: string,
    exitTime: string | null,
    requestedShares: number | null,
    preferredEntryTime: string | null,
    basisEntryPrice: number | null
  ): { entryTime: string; shares: number } | null {
    if (!exitTime || requestedShares == null || requestedShares <= 0) return null
    const lots = openLotsBySymbol.get(sym) ?? []
    const candidates = lots.filter(l => l.entryIso <= exitTime && l.remainingShares > 0)
    if (!candidates.length) return null

    let chosen: { entryIso: string; avgPrice: number; remainingShares: number } | null = null
    if (preferredEntryTime) {
      chosen = candidates.find(c => c.entryIso === preferredEntryTime) ?? null
    }
    if (!chosen) {
      chosen = candidates[candidates.length - 1]
      if (basisEntryPrice != null) {
        chosen = candidates
          .slice()
          .sort((a, b) => {
            const da = Math.abs(a.avgPrice - basisEntryPrice)
            const db = Math.abs(b.avgPrice - basisEntryPrice)
            if (da !== db) return da - db
            return a.entryIso < b.entryIso ? -1 : a.entryIso > b.entryIso ? 1 : 0
          })[0]
      }
    }

    const matched = Math.min(requestedShares, chosen.remainingShares)
    if (matched <= 0) return null
    chosen.remainingShares = Math.max(0, chosen.remainingShares - matched)
    return { entryTime: chosen.entryIso, shares: matched }
  }

  function pushCloseTrade(
    sym: string,
    entryTime: string | null,
    exitTime: string | null,
    buySell: string,
    shares: number,
    basisRaw: number | null,
    requestedShares: number | null,
    exitPrice: number | null
  ) {
    if (!entryTime || !exitTime) return
    const side = parseSide(buySell)
    const entryPrice = basisRaw != null && requestedShares && requestedShares > 0
      ? Math.abs(basisRaw / requestedShares)
      : null
    const pnl = side && entryPrice != null && exitPrice != null
      ? (side === 'long'
          ? (exitPrice - entryPrice) * shares
          : (entryPrice - exitPrice) * shares)
      : null
    const cost = entryPrice != null ? Math.abs(entryPrice * shares) : null
    const pnlPct = pnl != null && cost != null && cost > 0 ? pnl / cost : null

    trades.push({
      symbol: sym,
      entry_time: entryTime,
      exit_time: exitTime,
      side,
      shares,
      entry_price: entryPrice,
      exit_price: exitPrice,
      pnl,
      pnl_pct: pnlPct,
      outcome: null,
      hold_days: null,
      hold_time_min: null,
      hour_of_day: null,
      day_of_week: null,
      r_multiple: null,
      setup_tag: 'untagged',
      source: 'ibkr',
    })

    if (exitPrice != null) {
      const action: 'BUY' | 'SELL' = buySell.includes('SELL') ? 'SELL' : 'BUY'
      const closeKey = `${sym}|${entryTime}`
      const legs = closeLegsByEntry.get(closeKey) ?? []
      legs.push({ time: exitTime, action, shares, price: exitPrice })
      closeLegsByEntry.set(closeKey, legs)
    }
  }

  for (const row of closeRows) {
    const sym = col(row, 'symbol').toUpperCase().trim()
    if (!sym) continue

    const exitDtStr = col(row, 'date/time', 'datetime', 'tradedatetime')
    const entryDtStr = col(row, 'open date/time', 'opendatetime', 'open date', 'opendate')

    const sharesRaw = parseNum(col(row, 'quantity'))
    const requestedShares = sharesRaw != null ? Math.abs(sharesRaw) : null
    const basisRaw = parseNum(col(row, 'basis', 'cost', 'costbasis'))
    const basisEntryPrice = basisRaw != null && requestedShares && requestedShares > 0
      ? Math.abs(basisRaw / requestedShares)
      : null

    const exitTime = exitDtStr ? toUtcIso(parseIbkrDatetime(exitDtStr)) : null
    let entryTime = entryDtStr ? toUtcIso(parseIbkrDatetime(entryDtStr)) : null
    if (entryTime && exitTime && new Date(entryTime).getTime() >= new Date(exitTime).getTime()) {
      entryTime = null
    }

    if (!entryTime && exitTime) {
      const exitDateStr = exitTime.slice(0, 10)
      const entries = symOpenEntries.get(sym) ?? []
      const atOrBeforeExit = entries.filter(e => e <= exitTime)
      if (atOrBeforeExit.length) {
        entryTime = atOrBeforeExit[atOrBeforeExit.length - 1]
      } else {
        const direct = openEntryMap.get(`${sym}|${exitDateStr}`)
        if (direct) entryTime = direct
      }
    }

    const buySell = col(row, 'buy/sell', 'buysell').toUpperCase()
    const exitPrice = parseNum(col(row, 't. price', 'tradeprice', 'price'))

    let remaining = requestedShares ?? 0
    let preferred = entryTime
    const matchedPieces: { entryTime: string; shares: number }[] = []

    while (remaining > 0) {
      const match = allocateClose(sym, exitTime, remaining, preferred, basisEntryPrice)
      if (!match) break
      matchedPieces.push(match)
      remaining -= match.shares
      // First allocation can honor preferred entry; subsequent ones should flow by lot availability.
      preferred = null
    }

    if (matchedPieces.length === 0) continue

    for (const piece of matchedPieces) {
      pushCloseTrade(sym, piece.entryTime, exitTime, buySell, piece.shares, basisRaw, requestedShares, exitPrice)
    }

    // Intentionally drop unmatched remainder to avoid synthesizing carry-in lots.
  }

  const merged = mergePartialFills(trades)

  for (const t of merged) {
    if (!t.entry_time || !t.exit_time) continue
    const exactKey = `${t.symbol}|${t.entry_time}`
    const dateKey = `${t.symbol}|${t.entry_time.slice(0, 10)}`
    const oPrice = openPriceMapByEntry.get(exactKey) ?? openPriceMapByDate.get(dateKey)
    if (oPrice && oPrice.totalShares > 0) {
      t.entry_price = oPrice.totalCost / oPrice.totalShares
    }
    if (t.side && t.entry_price != null && t.exit_price != null && t.shares != null) {
      t.pnl = t.side === 'long'
        ? (t.exit_price - t.entry_price) * t.shares
        : (t.entry_price - t.exit_price) * t.shares
      const cost = Math.abs(t.entry_price * t.shares)
      t.pnl_pct = cost > 0 ? t.pnl / cost : null
    }

    const legs = [
      ...(openLegsByEntry.get(exactKey) ?? []),
      ...(closeLegsByEntry.get(exactKey) ?? []),
    ].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
    t.execution_legs = legs.length > 0 ? legs : null
  }

  appendOpenPositions(merged, openLotsBySymbol, openLegsByEntry, closeLegsByEntry)
  const normalizedOpenRows = mergeOpenPositionsBySymbol(merged)

  const normalized: NormalizedTrade[] = []
  for (const t of normalizedOpenRows) {
    const withDerived = computeDerived(t)
    if (withDerived.outcome !== 'open') {
      if (!withDerived.entry_time) continue
      if (new Date(withDerived.entry_time) < QUERY_START) continue
    }
    if (withDerived.pnl == null && withDerived.outcome !== 'open') continue
    normalized.push(withDerived)
  }

  return dedupByConstraintKey(normalized)
}

// ---------------------------------------------------------------------------
// Merge C-rows for the same position into one row
// ---------------------------------------------------------------------------
function mergePartialFills(trades: NormalizedTrade[]): NormalizedTrade[] {
  const withEntry = trades.filter(t => t.entry_time != null)
  const withoutEntry = trades.filter(t => t.entry_time == null)

  const groups = new Map<string, NormalizedTrade[]>()
  for (const t of withEntry) {
    // Group by symbol + exact entry_time so independent lots stay separate.
    const pk = `${t.symbol}|${t.entry_time}`
    if (!groups.has(pk)) groups.set(pk, [])
    groups.get(pk)!.push(t)
  }

  const merged: NormalizedTrade[] = []
  for (const [, grp] of groups) {
    if (grp.length === 1) {
      merged.push(grp[0])
      continue
    }
    const totalShares = grp.reduce((s, t) => s + (t.shares ?? 0), 0)
    const w = (t: NormalizedTrade) => t.shares ?? 0

    const base = { ...grp[0] }
    base.shares = totalShares
    base.exit_time = grp
      .map(t => t.exit_time)
      .filter((v): v is string => v != null)
      .sort()
      .pop() ?? null
    base.entry_time = grp
      .map(t => t.entry_time)
      .filter((v): v is string => v != null)
      .sort()[0] ?? null
    base.pnl = grp.reduce((s, t) => s + (t.pnl ?? 0), 0)
    if (totalShares > 0) {
      base.exit_price = grp.reduce((s, t) => s + (t.exit_price ?? 0) * w(t), 0) / totalShares
      base.entry_price = grp.reduce((s, t) => s + (t.entry_price ?? 0) * w(t), 0) / totalShares
    }
    const cost = base.entry_price != null && base.shares != null
      ? base.entry_price * base.shares
      : null
    base.pnl_pct = cost && cost > 0 && base.pnl != null ? base.pnl / cost : null
    merged.push(base)
  }

  return [...merged, ...withoutEntry]
}

// ---------------------------------------------------------------------------
// Final dedup — collapse rows sharing the same DB unique key
// ---------------------------------------------------------------------------
function dedupByConstraintKey(trades: NormalizedTrade[]): NormalizedTrade[] {
  const map = new Map<string, NormalizedTrade>()
  for (const t of trades) {
    if (!t.exit_time) {
      const k = `${t.symbol}|open|${t.entry_time}`
      if (!map.has(k)) map.set(k, { ...t })
      continue
    }
    // Key matches the DB unique identity (user_id, symbol, entry_time, exit_time)
    const k = `${t.symbol}|${t.entry_time}|${t.exit_time}`
    if (map.has(k)) {
      const existing = map.get(k)!
      existing.shares = (existing.shares ?? 0) + (t.shares ?? 0)
      if (existing.execution_legs || t.execution_legs) {
        const mergedLegs = [...(existing.execution_legs ?? []), ...(t.execution_legs ?? [])]
          .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))
        existing.execution_legs = mergedLegs.length ? mergedLegs : null
      }
    } else {
      map.set(k, { ...t })
    }
  }
  return [...map.values()]
}

function mergeOpenPositionsBySymbol(trades: NormalizedTrade[]): NormalizedTrade[] {
  const closed = trades.filter((t) => t.exit_time != null || t.outcome !== 'open')
  const open = trades.filter((t) => t.exit_time == null && t.outcome === 'open')

  const groups = new Map<string, NormalizedTrade[]>()
  for (const trade of open) {
    const key = `${trade.symbol}|${trade.side ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(trade)
  }

  const mergedOpen: NormalizedTrade[] = []
  for (const [, group] of groups) {
    if (group.length === 1) {
      mergedOpen.push(group[0])
      continue
    }

    const base = { ...group[0] }
    const totalShares = group.reduce((sum, trade) => sum + Math.abs(trade.shares ?? 0), 0)
    const weightedEntryCost = group.reduce(
      (sum, trade) => sum + Math.abs(trade.shares ?? 0) * (trade.entry_price ?? 0),
      0
    )
    const executionLegs = group
      .flatMap((trade) => trade.execution_legs ?? [])
      .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))

    base.entry_time = group
      .map((trade) => trade.entry_time)
      .filter((value): value is string => value != null)
      .sort()[0] ?? null
    base.shares = totalShares > 0 ? totalShares : null
    base.entry_price = totalShares > 0 ? weightedEntryCost / totalShares : base.entry_price
    base.pnl = group.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)
    base.execution_legs = executionLegs.length > 0 ? executionLegs : null
    mergedOpen.push(base)
  }

  return [...closed, ...mergedOpen]
}

// ---------------------------------------------------------------------------
// Open position detection — appends open rows; hides partial-close C-rows
// ---------------------------------------------------------------------------
function appendOpenPositions(
  trades: NormalizedTrade[],
  openLotsBySymbol: Map<string, { entryIso: string; avgPrice: number; remainingShares: number }[]>,
  openLegsByEntry: Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>,
  closeLegsByEntry: Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>,
): void {
  try {
    const openKeys = new Set<string>()
    const realizedByOpenLot = new Map<string, number>()
    const closedSharesByOpenLot = new Map<string, number>()
    for (const [sym, lots] of openLotsBySymbol) {
      for (const lot of lots) {
        if (lot.remainingShares > 0) {
          openKeys.add(`${sym}|${lot.entryIso}`)
        }
      }
    }
    // Hide partial-close rows only when that exact lot is still open.
    for (let i = trades.length - 1; i >= 0; i--) {
      const t = trades[i]
      if (!t.exit_time || !t.entry_time) continue
      const lotKey = `${t.symbol}|${t.entry_time}`
        if (openKeys.has(lotKey)) {
          realizedByOpenLot.set(lotKey, (realizedByOpenLot.get(lotKey) ?? 0) + (t.pnl ?? 0))
          closedSharesByOpenLot.set(lotKey, (closedSharesByOpenLot.get(lotKey) ?? 0) + Math.abs(t.shares ?? 0))
          trades.splice(i, 1)
        }
      }

    for (const [sym, lots] of openLotsBySymbol) {
      for (const lot of lots) {
        if (lot.remainingShares <= 0) continue
        const lotKey = `${sym}|${lot.entryIso}`
        const realizedPnl = realizedByOpenLot.get(lotKey) ?? 0
        const inferredOriginalShares = lot.remainingShares + (closedSharesByOpenLot.get(lotKey) ?? 0)
        let executionLegs = [
          ...(openLegsByEntry.get(lotKey) ?? []),
          ...(closeLegsByEntry.get(lotKey) ?? []),
        ]
        const inferredSide: 'long' | 'short' =
          executionLegs[0]?.action === 'SELL' ? 'short' : 'long'
        const openingAction: 'BUY' | 'SELL' = inferredSide === 'long' ? 'BUY' : 'SELL'
        const knownOpeningShares = executionLegs
          .filter((leg) => leg.action === openingAction)
          .reduce((sum, leg) => sum + leg.shares, 0)

        if (executionLegs.length === 0 && inferredOriginalShares > 0) {
          executionLegs = [{
            time: lot.entryIso,
            action: openingAction,
            shares: inferredOriginalShares,
            price: lot.avgPrice,
          }]
        } else if (knownOpeningShares > 0 && inferredOriginalShares > knownOpeningShares) {
          executionLegs.push({
            time: lot.entryIso,
            action: openingAction,
            shares: inferredOriginalShares - knownOpeningShares,
            price: lot.avgPrice,
          })
        }
        executionLegs.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))

        trades.push({
          symbol: sym,
          entry_time: lot.entryIso,
          exit_time: null,
          side: inferredSide,
          shares: lot.remainingShares,
          entry_price: lot.avgPrice,
          exit_price: null,
          // Show realized P&L from partial closes on this still-open lot.
          pnl: realizedPnl,
          pnl_pct: null,
          outcome: 'open',
          hold_days: null,
          hold_time_min: null,
          hour_of_day: null,
          day_of_week: null,
          r_multiple: null,
          setup_tag: 'untagged',
          execution_legs: executionLegs.length > 0 ? executionLegs : null,
          source: 'ibkr',
        })
      }
    }
  } catch {
    // Open position detection is a bonus; never break closed trade loading
  }
}

// ---------------------------------------------------------------------------
// Compute derived fields (outcome, hold times, hour/day of entry)
// ---------------------------------------------------------------------------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function computeDerived(t: NormalizedTrade): NormalizedTrade {
  let outcome: string | null
  if (t.outcome === 'open' || !t.exit_time) {
    outcome = 'open'
  } else if (t.pnl == null) {
    outcome = null
  } else if (t.pnl > 0) {
    outcome = 'win'
  } else if (t.pnl < 0) {
    outcome = 'loss'
  } else {
    outcome = 'breakeven'
  }

  let holdDays: number | null = null
  let holdTimeMin: number | null = null
  if (t.entry_time && t.exit_time) {
    const diffMs = new Date(t.exit_time).getTime() - new Date(t.entry_time).getTime()
    if (diffMs >= 0) {
      holdDays = diffMs / 86_400_000
      holdTimeMin = diffMs / 60_000
    }
  }

  let hourOfDay: number | null = null
  let dayOfWeek: string | null = null
  if (t.entry_time) {
    const d = new Date(t.entry_time)
    hourOfDay = d.getUTCHours()    // timestamps are stored as UTC (converted from Eastern)
    dayOfWeek = DAYS[d.getUTCDay()]
  }

  return { ...t, outcome, hold_days: holdDays, hold_time_min: holdTimeMin, hour_of_day: hourOfDay, day_of_week: dayOfWeek }
}

// ---------------------------------------------------------------------------
// XML parsing (secondary path)
// ---------------------------------------------------------------------------
function parseXml(xml: string): NormalizedTrade[] {
  const tradeRegex = /<Trade\s([^/]+)\/>/gi
  const attrRegex = /(\w+)="([^"]*)"/g
  const trades: NormalizedTrade[] = []

  let match: RegExpExecArray | null
  while ((match = tradeRegex.exec(xml)) !== null) {
    const attrStr = match[1]
    const attrs: Record<string, string> = {}
    let am: RegExpExecArray | null
    while ((am = attrRegex.exec(attrStr)) !== null) {
      attrs[am[1].toLowerCase()] = am[2]
    }

    const oci = (attrs['openindicator'] ?? attrs['opencloseIndicator'] ?? attrs['opencloseindicator'] ?? '').toUpperCase()
    if (!oci.includes('C')) continue

    const sym = (attrs['symbol'] ?? '').toUpperCase().trim()
    if (!sym) continue

    const exitDt = attrs['tradedatetime'] ?? `${attrs['tradedate']} ${attrs['tradetime']}`
    const entryDt = attrs['opendatetime'] ?? ''
    const exitTime = exitDt ? toUtcIso(parseIbkrDatetime(exitDt)) : null
    const entryTime = entryDt ? toUtcIso(parseIbkrDatetime(entryDt)) : null

    const sharesRaw = parseNum(attrs['quantity'])
    const shares = sharesRaw != null ? Math.abs(sharesRaw) : null
    const exitPrice = parseNum(attrs['tradeprice'])
    const basis = parseNum(attrs['cost'] ?? attrs['costbasis'] ?? '')
    const entryPrice = basis != null && shares && shares > 0 ? Math.abs(basis / shares) : null

    const buySell = (attrs['buysell'] ?? '').toUpperCase()
    const side = parseSide(buySell)
    const pnl = side && entryPrice != null && exitPrice != null && shares != null
      ? (side === 'long'
          ? (exitPrice - entryPrice) * shares
          : (entryPrice - exitPrice) * shares)
      : null
    const cost = entryPrice != null && shares != null ? Math.abs(entryPrice * shares) : null
    const pnlPct = pnl != null && cost != null && cost > 0 ? pnl / cost : null

    const t = computeDerived({
      symbol: sym, entry_time: entryTime, exit_time: exitTime,
      side, shares, entry_price: entryPrice, exit_price: exitPrice,
      pnl, pnl_pct: pnlPct, outcome: null,
      hold_days: null, hold_time_min: null, hour_of_day: null, day_of_week: null,
      r_multiple: null, setup_tag: 'untagged', source: 'ibkr',
    })

    if (t.outcome !== 'open') {
      if (!t.entry_time) continue
      if (new Date(t.entry_time) < QUERY_START) continue
    }
    if (t.pnl == null && t.outcome !== 'open') continue
    trades.push(t)
  }

  return dedupByConstraintKey(mergePartialFills(trades))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse IBKR datetime strings: "2024-01-15 09:31:25", "20240115;093125", etc. */
function parseIbkrDatetime(s: string): Date | null {
  if (!s || ['', '0', 'n/a', 'null', 'undefined'].includes(s.toLowerCase().trim())) return null
  const norm = s.trim().replace(';', ' ').replace(/\s+/, ' ')

  const d = new Date(norm)
  if (!isNaN(d.getTime())) {
    try {
      return fromZonedTime(d, 'America/New_York')
    } catch {
      return d
    }
  }

  // YYYYMMDD[ HHMMSS]
  const m8 = norm.match(/^(\d{4})(\d{2})(\d{2})(?:\s(\d{2})(\d{2})(\d{2}))?$/)
  if (m8) {
    const iso = `${m8[1]}-${m8[2]}-${m8[3]}T${m8[4] ?? '00'}:${m8[5] ?? '00'}:${m8[6] ?? '00'}`
    try {
      return fromZonedTime(new Date(iso), 'America/New_York')
    } catch {
      return new Date(iso)
    }
  }

  return null
}

function toUtcIso(d: Date | null): string | null {
  if (!d || isNaN(d.getTime())) return null
  return d.toISOString()
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function parseSide(buySell: string): 'long' | 'short' {
  // For closing trades: SELL closes a long; BUY covers a short
  if (['sell', 'sshrt'].includes(buySell.toLowerCase())) return 'long'
  return 'short'
}

function extractXmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
    ?? xml.match(new RegExp(`${tag}="([^"]*)"`, 'i'))
  return m?.[1]?.trim() ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Public wrapper — parse a raw IBKR Flex CSV string into normalized trades */
export function parseFlexCsv(csvStr: string): NormalizedTrade[] {
  return parseCsv(csvStr)
}
