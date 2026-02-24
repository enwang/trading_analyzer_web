/**
 * ibkr/flex.ts — TypeScript port of ibkr_flex.py
 *
 * End-to-end IBKR Flex Web Service client:
 * 1. POST SendRequest  → ReferenceCode
 * 2. GET  GetStatement → poll until complete, download content
 * 3. Parse CSV/XML → normalize → return Trade rows
 */

import Papa from 'papaparse'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'

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

    // Check for complete FlexStatements XML or CSV data
    if (trimmed.startsWith('<FlexStatements') || trimmed.startsWith('<FlexQueryResponse')) {
      return text
    }
    if (!trimmed.startsWith('<')) {
      // CSV content
      return text
    }
    // Check status
    const status = extractXmlTag(text, 'Status')
    if (!status || status.toLowerCase() === 'processing') {
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    if (status.toLowerCase() === 'success') return text
    // 'Warn' = report ready but with data warnings; fetch from the Url in response
    if (status.toLowerCase() === 'warn' || status.toLowerCase() === 'warning') {
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
      // Data not ready yet — keep polling
      await sleep(POLL_INTERVAL_MS)
      continue
    }
    throw new Error(`IBKR polling failed with status: ${status}`)
  }
  throw new Error('IBKR timed out after 60 seconds')
}

// ---------------------------------------------------------------------------
// CSV parsing (primary path for CSV Flex Queries)
// ---------------------------------------------------------------------------
function parseCsv(csvStr: string): NormalizedTrade[] {
  // IBKR CSVs sometimes have a second header row or blank lines — skip them
  const result = Papa.parse<Record<string, string>>(csvStr, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })

  const raw = result.data as Record<string, string>[]
  if (!raw.length) throw new Error('No rows found in Flex CSV')

  // Case-insensitive column lookup helper
  const keys = Object.keys(raw[0]).map(k => k.toLowerCase())
  function col(raw: Record<string, string>, ...names: string[]): string {
    for (const n of names) {
      const k = keys.find(k => k === n.toLowerCase().trim())
      if (k && raw[k] !== undefined) return raw[k]
    }
    return ''
  }

  // Identify Open/CloseIndicator column
  const ociKey = keys.find(k =>
    ['open/closeindicator', 'opencloseindicator', 'openclose', 'open/close'].includes(k)
  ) ?? ''

  // Build open-entry map from O-rows for entry_time fallback
  const openEntryMap = new Map<string, string>()  // "(SYMBOL|YYYY-MM-DD)" → datetime string
  const symOpenDates = new Map<string, string[]>() // symbol → sorted date strings
  const oRaw: Record<string, string>[] = []
  const cRaw: Record<string, string>[] = []

  // Accumulate O-qty and C-qty per symbol for open-position detection
  const oQtyBySym = new Map<string, number>()
  const cQtyBySym = new Map<string, number>()

  for (const row of raw) {
    const oci = ociKey ? (row[ociKey] ?? '').toUpperCase() : ''
    const sym = col(row, 'symbol').toUpperCase().trim()
    const qty = Math.abs(parseNum(col(row, 'quantity')) ?? 0)

    const isO = oci.includes('O') && !oci.includes('C')  // pure open
    const isC = oci.includes('C')                         // any close

    if (isO && sym) {
      oRaw.push(row)
      oQtyBySym.set(sym, (oQtyBySym.get(sym) ?? 0) + qty)

      const dtStr = col(row,
        'date/time', 'datetime', 'tradedatetime',
        'dateandhour', 'date', 'tradedate'
      )
      if (dtStr) {
        const ts = parseIbkrDatetime(dtStr)
        if (ts) {
          const dateKey = ts.toISOString().slice(0, 10)
          const mapKey = `${sym}|${dateKey}`
          if (!openEntryMap.has(mapKey)) openEntryMap.set(mapKey, dtStr)
          if (!symOpenDates.has(sym)) symOpenDates.set(sym, [])
          const dates = symOpenDates.get(sym)!
          if (!dates.includes(dateKey)) dates.push(dateKey)
        }
      }
    }
    if (isC && sym) {
      cRaw.push(row)
      cQtyBySym.set(sym, (cQtyBySym.get(sym) ?? 0) + qty)
    }
  }

  // Sort open dates for fallback scan
  for (const [, dates] of symOpenDates) dates.sort()

  // Filter to C-rows only (or fallback to non-zero pnl rows)
  let closeRows: Record<string, string>[]
  if (cRaw.length > 0) {
    closeRows = cRaw
  } else {
    // Fallback: keep rows with non-zero Realized P/L
    closeRows = raw.filter(row => {
      const pnl = parseNum(col(row, 'realized p/l', 'fifopnlrealized', 'realized p&l'))
      return pnl != null && pnl !== 0
    })
  }

  if (!closeRows.length) throw new Error('No closing trades found in Flex CSV')

  // Parse each closing row
  const trades: NormalizedTrade[] = []
  for (const row of closeRows) {
    const sym = col(row, 'symbol').toUpperCase().trim()
    if (!sym) continue

    const exitDtStr = col(row, 'date/time', 'datetime', 'tradedatetime')
    const entryDtStr = col(row, 'open date/time', 'opendatetime', 'open date', 'opendate')

    const exitTime = exitDtStr ? toUtcIso(parseIbkrDatetime(exitDtStr)) : null
    let entryTime = entryDtStr ? toUtcIso(parseIbkrDatetime(entryDtStr)) : null

    // Fallback: fill entry_time from O-row map
    if (!entryTime && exitTime) {
      const exitDateStr = exitTime.slice(0, 10)
      const direct = openEntryMap.get(`${sym}|${exitDateStr}`)
      if (direct) {
        entryTime = toUtcIso(parseIbkrDatetime(direct))
      } else {
        // Scan for most-recent O-row date ≤ exitDate
        const dates = symOpenDates.get(sym) ?? []
        const valid = dates.filter(d => d <= exitDateStr)
        if (valid.length) {
          const best = valid[valid.length - 1]
          const fallback = openEntryMap.get(`${sym}|${best}`)
          if (fallback) entryTime = toUtcIso(parseIbkrDatetime(fallback))
        }
      }
    }

    const buySell = col(row, 'buy/sell', 'buysell').toUpperCase()
    const side = parseSide(buySell)

    const sharesRaw = parseNum(col(row, 'quantity'))
    const shares = sharesRaw != null ? Math.abs(sharesRaw) : null

    const exitPrice = parseNum(col(row, 't. price', 'tradeprice', 'price'))
    const basisRaw = parseNum(col(row, 'basis', 'cost', 'costbasis'))
    const entryPrice = basisRaw != null && shares && shares > 0
      ? Math.abs(basisRaw / shares)
      : null

    const pnlGross = parseNum(col(row, 'realized p/l', 'fifopnlrealized', 'realized p&l'))
    const commission = parseNum(col(row, 'comm/fee', 'ibcommission', 'commission', 'comm in usd')) ?? 0
    const pnl = pnlGross != null ? pnlGross + commission : null

    const pnlPct = pnl != null && basisRaw != null && basisRaw !== 0
      ? pnl / Math.abs(basisRaw)
      : null

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
  }

  // Merge partial fills: group by (symbol + entry_time)
  const merged = mergePartialFills(trades)

  // Append open positions
  appendOpenPositions(merged, oRaw, oQtyBySym, cQtyBySym, raw)

  // Compute derived fields
  const normalized: NormalizedTrade[] = []
  for (const t of merged) {
    const withDerived = computeDerived(t)
    // Filter: drop closed trades opened before QUERY_START with no/bad entry_time
    if (withDerived.outcome !== 'open') {
      if (!withDerived.entry_time) continue
      if (new Date(withDerived.entry_time) < QUERY_START) continue
    }
    if (withDerived.pnl == null && withDerived.outcome !== 'open') continue
    normalized.push(withDerived)
  }

  // Final dedup: collapse rows sharing the same DB constraint key (symbol, exit_time, pnl)
  // This prevents batch-level duplicate key errors when partial fills have mismatched entry_times.
  return dedupByConstraintKey(normalized)
}

// ---------------------------------------------------------------------------
// Final dedup pass — collapse rows that share the DB unique key to prevent batch conflicts
// ---------------------------------------------------------------------------
function dedupByConstraintKey(trades: NormalizedTrade[]): NormalizedTrade[] {
  const map = new Map<string, NormalizedTrade>()
  for (const t of trades) {
    // Open positions: key by entry_time
    if (!t.exit_time) {
      const k = `${t.symbol}|open|${t.entry_time}`
      if (!map.has(k)) map.set(k, { ...t })
      continue
    }
    // Closed positions: key matches the DB partial unique index
    const pnlKey = Math.round((t.pnl ?? 0) * 1000)
    const k = `${t.symbol}|${t.exit_time}|${pnlKey}`
    if (map.has(k)) {
      // Merge shares into the first occurrence
      const existing = map.get(k)!
      existing.shares = (existing.shares ?? 0) + (t.shares ?? 0)
    } else {
      map.set(k, { ...t })
    }
  }
  return [...map.values()]
}

// ---------------------------------------------------------------------------
// Merge partial fills (same symbol + entry_time → one row)
// ---------------------------------------------------------------------------
function mergePartialFills(trades: NormalizedTrade[]): NormalizedTrade[] {
  const withEntry = trades.filter(t => t.entry_time != null)
  const withoutEntry = trades.filter(t => t.entry_time == null)

  const groups = new Map<string, NormalizedTrade[]>()
  for (const t of withEntry) {
    // Group by symbol + entry DATE (not full timestamp, not exit date).
    // All C-rows from the same original position share the same entry date via
    // the O-row fallback (OpenDateTime is empty in this broker's export), even
    // when sells span multiple exit dates.  Using exit date instead would split
    // a multi-day unwind of one position into N separate rows.
    // Verified against mytrade.csv: MRNA (1 buy → 2 exit days → 1 row),
    // TTMI (1 buy → 4 exit days → 1 row), GOOG (2 entry groups → 2 rows).
    const entryDate = t.entry_time?.slice(0, 10) ?? 'unknown'
    const pk = `${t.symbol}|${entryDate}`
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
    // Recalculate pnl_pct
    const cost = base.entry_price != null && base.shares != null
      ? base.entry_price * base.shares : null
    base.pnl_pct = cost && cost > 0 && base.pnl != null ? base.pnl / cost : null
    merged.push(base)
  }

  return [...merged, ...withoutEntry]
}

// ---------------------------------------------------------------------------
// Open position detection
// ---------------------------------------------------------------------------
function appendOpenPositions(
  trades: NormalizedTrade[],
  oRaw: Record<string, string>[],
  oQtyBySym: Map<string, number>,
  cQtyBySym: Map<string, number>,
  allRaw: Record<string, string>[]
): void {
  try {
    // Build o_temp: entry_time + price + shares per O-row
    const oTemp: { symbol: string; entry_time: string; price: number; shares: number }[] = []
    for (const row of oRaw) {
      const sym = (row['symbol'] ?? '').toUpperCase().trim()
      const dtStr = Object.entries(row).find(([k]) =>
        ['date/time', 'datetime', 'tradedatetime'].includes(k)
      )?.[1] ?? ''
      const price = Math.abs(parseNum(
        Object.entries(row).find(([k]) =>
          ['t. price', 'tradeprice', 'price'].includes(k)
        )?.[1] ?? ''
      ) ?? 0)
      const qty = Math.abs(parseNum(
        Object.entries(row).find(([k]) => k === 'quantity')?.[1] ?? ''
      ) ?? 0)
      const ts = dtStr ? parseIbkrDatetime(dtStr) : null
      const entryIso = ts ? toUtcIso(ts) : null
      if (sym && entryIso) {
        oTemp.push({ symbol: sym, entry_time: entryIso, price, shares: qty })
      }
    }

    for (const [sym, totalOpened] of oQtyBySym) {
      const totalClosed = cQtyBySym.get(sym) ?? 0
      const remaining = totalOpened - totalClosed
      if (remaining <= 0) continue

      if (totalClosed > 0) {
        // Position is partially closed but still open.
        // Remove the partial-sell closed rows — don't surface them as separate
        // trades until the position is fully closed.
        for (let i = trades.length - 1; i >= 0; i--) {
          if (trades[i].symbol === sym && trades[i].exit_time != null) {
            trades.splice(i, 1)
          }
        }
        // Add one open row for the remaining shares.
        const symO = oTemp.filter(o => o.symbol === sym)
        if (!symO.length) continue
        const totalW = symO.reduce((s, o) => s + o.shares, 0)
        const wtPrice = totalW > 0
          ? symO.reduce((s, o) => s + o.price * o.shares, 0) / totalW
          : 0
        const earliest = symO.map(o => o.entry_time).sort()[0]
        trades.push({
          symbol: sym,
          entry_time: earliest,
          exit_time: null,
          side: 'long',
          shares: remaining,
          entry_price: wtPrice,
          exit_price: null,
          pnl: null,
          pnl_pct: null,
          outcome: 'open',
          hold_days: null,
          hold_time_min: null,
          hour_of_day: null,
          day_of_week: null,
          r_multiple: null,
          setup_tag: 'untagged',
          source: 'ibkr',
        })
      } else {
        // Fully open: no C-rows at all → add new row
        const symO = oTemp.filter(o => o.symbol === sym)
        if (!symO.length) continue
        const totalW = symO.reduce((s, o) => s + o.shares, 0)
        const wtPrice = totalW > 0
          ? symO.reduce((s, o) => s + o.price * o.shares, 0) / totalW
          : 0
        const earliest = symO.map(o => o.entry_time).sort()[0]
        trades.push({
          symbol: sym,
          entry_time: earliest,
          exit_time: null,
          side: 'long',
          shares: totalOpened,
          entry_price: wtPrice,
          exit_price: null,
          pnl: 0,
          pnl_pct: null,
          outcome: 'open',
          hold_days: null,
          hold_time_min: null,
          hour_of_day: null,
          day_of_week: null,
          r_multiple: null,
          setup_tag: 'untagged',
          source: 'ibkr',
        })
      }
    }
  } catch {
    // Open position detection is a bonus; never break closed trade loading
  }
}

// ---------------------------------------------------------------------------
// Compute derived fields
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
    hourOfDay = d.getUTCHours()    // already converted to Pacific in parseIbkrDatetime
    dayOfWeek = DAYS[d.getUTCDay()]
  }

  return { ...t, outcome, hold_days: holdDays, hold_time_min: holdTimeMin, hour_of_day: hourOfDay, day_of_week: dayOfWeek }
}

// ---------------------------------------------------------------------------
// XML parsing (secondary path)
// ---------------------------------------------------------------------------
function parseXml(xml: string): NormalizedTrade[] {
  // Very basic XML attribute extraction — IBKR Trade elements are self-closing
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
    if (!oci.includes('C')) continue  // only closing trades

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

    const pnlGross = parseNum(attrs['fifopnlrealized'] ?? attrs['realizedpnl'] ?? '')
    const commission = parseNum(attrs['ibcommission'] ?? attrs['commission'] ?? '') ?? 0
    const pnl = pnlGross != null ? pnlGross + commission : null

    const buySell = (attrs['buysell'] ?? '').toUpperCase()
    const side = parseSide(buySell)

    const t = computeDerived({
      symbol: sym, entry_time: entryTime, exit_time: exitTime,
      side, shares, entry_price: entryPrice, exit_price: exitPrice,
      pnl, pnl_pct: null, outcome: null,
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

  // Try standard ISO-ish format first
  const d = new Date(norm)
  if (!isNaN(d.getTime())) {
    // Convert Eastern → UTC (IBKR reports in Eastern)
    try {
      const eastern = fromZonedTime(d, 'America/New_York')
      return eastern
    } catch {
      return d
    }
  }

  // YYYYMMDD HH:MM:SS or YYYYMMDD
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
  // For closing trades: SELL closes a long; BUY closes a short
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
