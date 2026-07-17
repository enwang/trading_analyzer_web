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

export async function fetchFlexAll(
  token: string,
  queryId: string
): Promise<FlexExtract> {
  const { refCode, dlUrl } = await sendRequest(token, queryId)
  const raw = await pollAndDownload(token, refCode, dlUrl)
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('<')) {
    return { trades: parseXml(raw), navDaily: [], navChange: [], cashTransactions: [] }
  }
  return extractFlexCsv(raw)
}

export async function fetchFlexRaw(token: string, queryId: string): Promise<string> {
  const { refCode, dlUrl } = await sendRequest(token, queryId)
  return pollAndDownload(token, refCode, dlUrl)
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
// Multi-section CSV splitter
// ---------------------------------------------------------------------------
// IBKR Flex returns a single CSV body that concatenates one block per enabled
// section. Each block starts with its own column header row. We detect section
// boundaries by looking for "header-shaped" rows (those that begin with a
// recognizable identifier column like ClientAccountID) and then identify each
// section by its column signature.

export interface NavDailyRow {
  account_id: string
  currency: string | null
  report_date: string  // YYYY-MM-DD
  total: number | null
  total_long: number | null
  total_short: number | null
}

export interface NavChangeRow {
  account_id: string
  currency: string | null
  from_date: string
  to_date: string
  starting_value: number | null
  ending_value: number | null
  mtm: number | null
  deposits_withdrawals: number | null
  dividends: number | null
  interest: number | null
  other_fees: number | null
  commissions: number | null
}

export interface CashTransactionRow {
  account_id: string
  currency: string | null
  transaction_ts: string   // ISO 8601 UTC
  type: string | null      // 'Deposits', 'Withdrawals', etc.
  amount: number
  description: string | null
}

export interface FlexExtract {
  trades: NormalizedTrade[]
  navDaily: NavDailyRow[]
  navChange: NavChangeRow[]
  cashTransactions: CashTransactionRow[]
}

const SECTION_HEADER_HINTS = [
  '"ClientAccountID"', '"AccountId"', 'ClientAccountID,', 'AccountId,',
  // Cash Transactions section omits ClientAccountID and starts with CurrencyPrimary
  '"CurrencyPrimary","Description"',
]

export function splitFlexCsvSections(csvStr: string): { header: string; body: string }[] {
  const lines = csvStr.split(/\r?\n/)
  const sections: { header: string; body: string }[] = []
  let curHeader: string | null = null
  let curBody: string[] = []

  function flush() {
    if (curHeader != null) sections.push({ header: curHeader, body: curBody.join('\n') })
    curHeader = null
    curBody = []
  }

  for (const line of lines) {
    if (!line.trim()) continue
    const looksLikeHeader = SECTION_HEADER_HINTS.some((h) => line.startsWith(h))
    if (looksLikeHeader) {
      flush()
      curHeader = line
    } else if (curHeader != null) {
      curBody.push(line)
    }
  }
  flush()
  return sections
}

type FlexSectionKind = 'trades' | 'open_positions' | 'nav_daily' | 'nav_change' | 'cash_transactions' | 'unknown'

type OpenPositionSnapshot = {
  symbol: string
  shares: number
  avgPrice: number | null
}

const KNOWN_STOCK_SPLITS = [
  // Parser default: store split-affected trades in post-split share/price scale.
  // Add future stock splits here as { symbol, exDate, factor }.
  { symbol: 'CRWD', exDate: '2026-07-02T04:00:00.000Z', factor: 4 },
]

function classifySection(header: string): FlexSectionKind {
  const h = header.toLowerCase()
  const hasSymbol = h.includes('"symbol"') || h.includes(',symbol,') || h.includes(',symbol"')
  // Trades section is wide and includes Symbol + TradeID + OpenIndicator/OpenCloseIndicator
  if (hasSymbol && (h.includes('tradeid') || h.includes('"buysell"') || h.includes(',buysell,') || h.includes('buy/sell'))) return 'trades'
  if (hasSymbol && h.includes('position') && !h.includes('tradeid')) return 'open_positions'
  if (h.includes('"reportdate"') && h.includes('"total"')) return 'nav_daily'
  if (h.includes('"fromdate"') && h.includes('"todate"') && h.includes('startingvalue')) return 'nav_change'
  // Cash Transactions section: has Amount + Date/Time but NOT Symbol or TradeID
  // Handle both quoted ("Amount") and unquoted (Amount,) column headers
  const hasAmount = h.includes('"amount"') || h.includes(',amount,') || h.includes(',amount"') || h.endsWith(',amount')
  const hasDate = h.includes('date/time') || h.includes('datetime') || h.includes('settledate')
  const noSymbol = !h.includes('"symbol"') && !h.includes(',symbol,') && !h.includes(',symbol"')
  const noTradeId = !h.includes('tradeid')
  if (hasAmount && hasDate && noSymbol && noTradeId) return 'cash_transactions'
  return 'unknown'
}

function num(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dateOnly(v: string | undefined): string | null {
  if (!v) return null
  // Accept "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" or "YYYYMMDD"
  const trimmed = v.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10)
  if (/^\d{8}$/.test(trimmed)) return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`
  return null
}

function parseNavDailyCsv(csv: string): NavDailyRow[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })
  const rows: NavDailyRow[] = []
  for (const row of (result.data ?? []) as Record<string, string>[]) {
    const accountId = (row['clientaccountid'] ?? row['accountid'] ?? '').trim()
    const reportDate = dateOnly(row['reportdate'])
    if (!accountId || !reportDate) continue
    rows.push({
      account_id: accountId,
      currency: row['currencyprimary']?.trim() || null,
      report_date: reportDate,
      total: num(row['total']),
      total_long: num(row['totallong']),
      total_short: num(row['totalshort']),
    })
  }
  return rows
}

function parseNavChangeCsv(csv: string): NavChangeRow[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })
  const rows: NavChangeRow[] = []
  for (const row of (result.data ?? []) as Record<string, string>[]) {
    const accountId = (row['clientaccountid'] ?? row['accountid'] ?? '').trim()
    const fromDate = dateOnly(row['fromdate'])
    const toDate = dateOnly(row['todate'])
    if (!accountId || !fromDate || !toDate) continue
    rows.push({
      account_id: accountId,
      currency: row['currencyprimary']?.trim() || null,
      from_date: fromDate,
      to_date: toDate,
      starting_value: num(row['startingvalue']),
      ending_value: num(row['endingvalue']),
      mtm: num(row['mtm']),
      deposits_withdrawals: num(row['depositswithdrawals']),
      dividends: num(row['dividends']),
      interest: num(row['interest']),
      other_fees: num(row['otherfees']),
      commissions: num(row['commissions']),
    })
  }
  return rows
}

function parseCashTransactionsCsv(csv: string): CashTransactionRow[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })
  const rows: CashTransactionRow[] = []
  for (const row of (result.data ?? []) as Record<string, string>[]) {
    const accountId = (row['clientaccountid'] ?? row['accountid'] ?? '').trim()
    const rawAmount = num(row['amount'])
    if (rawAmount == null || rawAmount === 0) continue

    // Date/Time may appear as "Date/Time" or "Settle Date" depending on query config
    const rawDt =
      row['date/time'] ?? row['datetime'] ?? row['settledate'] ?? row['date'] ?? ''
    if (!rawDt?.trim()) continue

    // Parse to UTC timestamp. IBKR formats: "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
    const iso = rawDt.trim().length === 10
      ? `${rawDt.trim()}T20:00:00Z`  // date-only: use 4pm ET as conservative same-day stamp
      : rawDt.trim().replace(' ', 'T') + 'Z'

    const type = (row['type'] ?? row['transactiontype'] ?? '').trim() || null
    rows.push({
      account_id: accountId,
      currency: row['currencyprimary']?.trim() || row['currency']?.trim() || null,
      transaction_ts: iso,
      type,
      amount: rawAmount,
      description: (row['description'] ?? row['trnstype'] ?? '').trim() || null,
    })
  }
  return rows
}

function parseOpenPositionsCsv(csv: string): OpenPositionSnapshot[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })

  const rows: OpenPositionSnapshot[] = []
  for (const row of (result.data ?? []) as Record<string, string>[]) {
    const symbol = (row['symbol'] ?? '').toUpperCase().trim()
    if (!symbol) continue
    const sharesRaw = num(row['position'] ?? row['quantity'])
    if (sharesRaw == null || sharesRaw === 0) continue
    const avgPrice = num(
      row['costbasisprice'] ??
      row['averagecost'] ??
      row['avgprice'] ??
      row['openprice'] ??
      row['markprice']
    )
    rows.push({
      symbol,
      shares: Math.abs(sharesRaw),
      avgPrice,
    })
  }
  return rows
}

function extractFlexCsv(csvStr: string): FlexExtract {
  const sections = splitFlexCsvSections(csvStr)
  // Fallback: when no recognizable section headers are present (e.g. older
  // single-section trades exports that don't start with ClientAccountID), treat
  // the whole CSV as a trades section so backwards-compat callers still work.
  if (sections.length === 0) {
    return { trades: parseTradesCsv(csvStr), navDaily: [], navChange: [], cashTransactions: [] }
  }

  const tradeSections: string[] = []
  const openPositions: OpenPositionSnapshot[] = []
  let trades: NormalizedTrade[] = []
  const navDaily: NavDailyRow[] = []
  const navChange: NavChangeRow[] = []
  const cashTransactions: CashTransactionRow[] = []

  for (const sec of sections) {
    const kind = classifySection(sec.header)
    const csv = `${sec.header}\n${sec.body}`
    if (kind === 'trades') {
      tradeSections.push(csv)
    } else if (kind === 'open_positions') {
      openPositions.push(...parseOpenPositionsCsv(csv))
    } else if (kind === 'nav_daily') {
      navDaily.push(...parseNavDailyCsv(csv))
    } else if (kind === 'nav_change') {
      navChange.push(...parseNavChangeCsv(csv))
    } else if (kind === 'cash_transactions') {
      cashTransactions.push(...parseCashTransactionsCsv(csv))
    }
  }

  if (tradeSections.length > 0) {
    trades = parseTradesCsv(tradeSections.join('\n'), openPositions)
  }

  return { trades, navDaily, navChange, cashTransactions }
}

// ---------------------------------------------------------------------------
// CSV parsing (primary path)
// ---------------------------------------------------------------------------
function parseCsv(csvStr: string): NormalizedTrade[] {
  // Backwards-compat wrapper: pull just the trades from a possibly-multi-section CSV.
  return extractFlexCsv(csvStr).trades
}

function parseTradesCsv(csvStr: string, openPositionSnapshots: OpenPositionSnapshot[] = []): NormalizedTrade[] {
  const result = Papa.parse<Record<string, string>>(csvStr, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  })

  const raw = result.data as Record<string, string>[]
  if (!raw.length) return []

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
  const appliedKnownSplitKeys = new Set<string>()
  const openGroups = new Map<string, {
    symbol: string
    entryIso: string
    totalShares: number
    totalCost: number
    legs: { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]
  }>()
  const openGroupIdsByRow = new Map<Record<string, string>, string>()

  type SegmentState = { id: number; hasClose: boolean }
  const segmentStateBySymbol = new Map<string, SegmentState>()
  const chronologicalRows = raw
    .map((row, index) => {
      const sym = col(row, 'symbol').toUpperCase().trim()
      const oci = ociKey ? (row[ociKey] ?? '').toUpperCase() : ''
      const isO = oci.includes('O') && !oci.includes('C')
      const isC = oci.includes('C')
      const dtStr = col(row, 'date/time', 'datetime', 'tradedatetime', 'open date/time', 'opendatetime', 'dateandhour', 'date', 'tradedate')
      const iso = dtStr ? toUtcIso(parseIbkrDatetime(dtStr)) : null
      return { row, index, sym, isO, isC, iso }
    })
    .filter((event) => event.sym && event.iso && (event.isO || event.isC))
    .sort((a, b) => {
      if (a.iso! !== b.iso!) return a.iso! < b.iso! ? -1 : 1
      return a.index - b.index
    })

  for (const event of chronologicalRows) {
    const state = segmentStateBySymbol.get(event.sym)
    if (event.isO) {
      let nextState = state
      if (!nextState || nextState.hasClose) {
        nextState = {
          id: (state?.id ?? 0) + 1,
          hasClose: false,
        }
        segmentStateBySymbol.set(event.sym, nextState)
      }
      openGroupIdsByRow.set(event.row, `${event.sym}|seg:${nextState.id}`)
    } else if (event.isC && state) {
      state.hasClose = true
    }
  }

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

          const groupId = openGroupIdsByRow.get(row) ?? `${sym}|ts:${entryIso}`
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
    lots.sort((a, b) => {
      const priceDiff = b.avgPrice - a.avgPrice
      if (priceDiff !== 0) return priceDiff
      return a.entryIso < b.entryIso ? -1 : a.entryIso > b.entryIso ? 1 : 0
    })
  }

  // Use C-rows, or fall back to rows with non-zero realized P/L.
  // Sort chronologically so earlier closes deplete earlier lots first — prevents
  // a future close from consuming a lot that a prior close should have taken.
  const closeRows = (cRaw.length > 0
    ? cRaw
    : raw.filter(row => {
        const pnl = parseNum(col(row, 'realized p/l', 'fifopnlrealized', 'realized p&l'))
        return pnl != null && pnl !== 0
      })
  ).sort((a, b) => {
    const ta = col(a, 'date/time', 'datetime', 'tradedatetime') || ''
    const tb = col(b, 'date/time', 'datetime', 'tradedatetime') || ''
    return ta < tb ? -1 : ta > tb ? 1 : 0
  })

  if (!closeRows.length) throw new Error('No closing trades found in Flex CSV')

  // --- Build a raw trade per C-row ---
  const trades: NormalizedTrade[] = []
  function allocateClose(
    sym: string,
    exitTime: string | null,
    requestedShares: number | null,
    _preferredEntryTime: string | null,
    _basisEntryPrice: number | null
  ): { entryTime: string; shares: number } | null {
    if (!exitTime || requestedShares == null || requestedShares <= 0) return null
    const lots = openLotsBySymbol.get(sym) ?? []
    const candidates = lots.filter(l => l.entryIso <= exitTime && l.remainingShares > 0)
    if (!candidates.length) return null

    const chosen = candidates
      .slice()
      .sort((a, b) => {
        const priceDiff = b.avgPrice - a.avgPrice
        if (priceDiff !== 0) return priceDiff
        return a.entryIso < b.entryIso ? -1 : a.entryIso > b.entryIso ? 1 : 0
      })[0]

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

    if (exitTime) {
      reconcileOpenLotsWithKnownSplits(
        openLotsBySymbol,
        openLegsByEntry,
        closeLegsByEntry,
        openPriceMapByEntry,
        trades,
        openPositionSnapshots,
        appliedKnownSplitKeys,
        exitTime,
      )
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
      // Allocations use highest entry price first among lots that existed at the sell time.
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

  reconcileOpenLotsWithPositionSnapshots(openLotsBySymbol, openLegsByEntry, openPositionSnapshots)
  reconcileOpenLotsWithKnownSplits(
    openLotsBySymbol,
    openLegsByEntry,
    closeLegsByEntry,
    openPriceMapByEntry,
    merged,
    openPositionSnapshots,
    appliedKnownSplitKeys,
  )
  appendOpenPositions(merged, openLotsBySymbol, openLegsByEntry, closeLegsByEntry)

  const normalized: NormalizedTrade[] = []
  for (const t of merged) {
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
// Merge closed trades that share the same symbol + exit_time.
// When a position built from multiple entry lots is closed in one order,
// IBKR emits one C-row per lot with the same exit_time but different
// entry_times. Combine those into a single trade record.
// ---------------------------------------------------------------------------
function mergeSameExitTrades(trades: NormalizedTrade[]): NormalizedTrade[] {
  const open = trades.filter(t => t.exit_time == null)
  const closed = trades.filter(t => t.exit_time != null)

  const groups = new Map<string, NormalizedTrade[]>()
  for (const t of closed) {
    const pk = `${t.symbol}|${t.exit_time}`
    if (!groups.has(pk)) groups.set(pk, [])
    groups.get(pk)!.push(t)
  }

  const merged: NormalizedTrade[] = []
  for (const [, grp] of groups) {
    if (grp.length === 1) { merged.push(grp[0]); continue }
    const totalShares = grp.reduce((s, t) => s + (t.shares ?? 0), 0)
    const w = (t: NormalizedTrade) => t.shares ?? 0
    const base = { ...grp[0] }
    base.shares = totalShares
    // Earliest entry time across all lots
    base.entry_time = grp.map(t => t.entry_time).filter((v): v is string => v != null).sort()[0] ?? null
    base.pnl = grp.reduce((s, t) => s + (t.pnl ?? 0), 0)
    if (totalShares > 0) {
      base.entry_price = grp.reduce((s, t) => s + (t.entry_price ?? 0) * w(t), 0) / totalShares
      base.exit_price  = grp.reduce((s, t) => s + (t.exit_price  ?? 0) * w(t), 0) / totalShares
    }
    const cost = base.entry_price != null && base.shares != null ? base.entry_price * base.shares : null
    base.pnl_pct = cost && cost > 0 && base.pnl != null ? base.pnl / cost : null
    base.execution_legs = grp.flatMap(t => t.execution_legs ?? [])
    merged.push(base)
  }

  return [...merged, ...open]
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
  return trades
}

function reconcileOpenLotsWithPositionSnapshots(
  openLotsBySymbol: Map<string, { entryIso: string; avgPrice: number; remainingShares: number }[]>,
  openLegsByEntry: Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>,
  snapshots: OpenPositionSnapshot[],
): void {
  const snapshotBySymbol = new Map<string, OpenPositionSnapshot>()
  for (const snapshot of snapshots) {
    const existing = snapshotBySymbol.get(snapshot.symbol)
    if (existing) {
      existing.shares += snapshot.shares
      if (existing.avgPrice == null && snapshot.avgPrice != null) existing.avgPrice = snapshot.avgPrice
    } else {
      snapshotBySymbol.set(snapshot.symbol, { ...snapshot })
    }
  }

  for (const [sym, lots] of openLotsBySymbol) {
    const snapshot = snapshotBySymbol.get(sym)
    if (!snapshot || snapshot.shares <= 0) continue

    const openLots = lots.filter((lot) => lot.remainingShares > 0)
    const currentShares = openLots.reduce((sum, lot) => sum + lot.remainingShares, 0)
    if (currentShares <= 0) continue

    const factor = snapshot.shares / currentShares
    if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) continue

    for (const lot of openLots) {
      const lotKey = `${sym}|${lot.entryIso}`
      lot.remainingShares *= factor
      lot.avgPrice = openLots.length === 1 && snapshot.avgPrice != null
        ? snapshot.avgPrice
        : lot.avgPrice / factor

      const legs = openLegsByEntry.get(lotKey)
      if (!legs?.length) continue
      for (const leg of legs) {
        leg.shares *= factor
        leg.price /= factor
      }
    }
  }
}

function scaleTradeForSplit(t: NormalizedTrade, factor: number): void {
  if (t.shares != null) t.shares *= factor
  if (t.entry_price != null) t.entry_price /= factor
  if (t.exit_price != null) t.exit_price /= factor
  const cost = t.entry_price != null && t.shares != null ? Math.abs(t.entry_price * t.shares) : null
  if (cost && cost > 0 && t.pnl != null) t.pnl_pct = t.pnl / cost
}

function reconcileOpenLotsWithKnownSplits(
  openLotsBySymbol: Map<string, { entryIso: string; avgPrice: number; remainingShares: number }[]>,
  openLegsByEntry: Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>,
  closeLegsByEntry: Map<string, { time: string; action: 'BUY' | 'SELL'; shares: number; price: number }[]>,
  openPriceMapByEntry: Map<string, { totalShares: number; totalCost: number }>,
  trades: NormalizedTrade[],
  snapshots: OpenPositionSnapshot[],
  appliedSplitKeys: Set<string>,
  upToTime: string | null = null,
): void {
  const snapshotSymbols = new Set(snapshots.map((snapshot) => snapshot.symbol))
  const upToMs = upToTime ? new Date(upToTime).getTime() : Number.POSITIVE_INFINITY

  for (const split of KNOWN_STOCK_SPLITS) {
    if (snapshotSymbols.has(split.symbol)) continue
    const splitKey = `${split.symbol}|${split.exDate}`
    if (appliedSplitKeys.has(splitKey)) continue
    const lots = openLotsBySymbol.get(split.symbol) ?? []
    const splitTime = new Date(split.exDate).getTime()
    if (splitTime > upToMs) continue
    const adjustedOpenKeys = new Set<string>()

    for (const lot of lots) {
      if (lot.remainingShares <= 0) continue
      if (new Date(lot.entryIso).getTime() >= splitTime) continue

      const lotKey = `${split.symbol}|${lot.entryIso}`
      adjustedOpenKeys.add(lotKey)
      lot.remainingShares *= split.factor
      lot.avgPrice /= split.factor

      const openPrice = openPriceMapByEntry.get(lotKey)
      if (openPrice) {
        openPrice.totalShares *= split.factor
      }

      for (const legs of [openLegsByEntry.get(lotKey), closeLegsByEntry.get(lotKey)]) {
        if (!legs) continue
        for (const leg of legs) {
          if (new Date(leg.time).getTime() >= splitTime) continue
          leg.shares *= split.factor
          leg.price /= split.factor
        }
      }
    }

    if (adjustedOpenKeys.size === 0) continue
    appliedSplitKeys.add(splitKey)
    for (const trade of trades) {
      if (!trade.entry_time || !adjustedOpenKeys.has(`${trade.symbol}|${trade.entry_time}`)) continue
      if (trade.exit_time && new Date(trade.exit_time).getTime() >= splitTime) continue
      scaleTradeForSplit(trade, split.factor)
    }
  }
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
    // Absorb partial-exit closed rows back into the open lot so that each open
    // position shows as a single row with cumulative realized P&L.
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
          pnl: realizedPnl || null,
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
  const attrRegex = /(\w+)="([^"]*)"/g
  const trades: NormalizedTrade[] = []

  function parseAttrs(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    attrRegex.lastIndex = 0
    let am: RegExpExecArray | null
    while ((am = attrRegex.exec(attrStr)) !== null) {
      attrs[am[1].toLowerCase()] = am[2]
    }
    return attrs
  }

  // Parse closed trades from <Trade> elements
  const tradeRegex = /<Trade\s([^/]+)\/>/gi
  let match: RegExpExecArray | null
  while ((match = tradeRegex.exec(xml)) !== null) {
    const attrs = parseAttrs(match[1])

    const oci = (attrs['openindicator'] ?? attrs['opencloseindicator'] ?? '').toUpperCase()
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

  // Parse open positions from <OpenPosition> elements
  const openPosRegex = /<OpenPosition\s([^/]+)\/>/gi
  while ((match = openPosRegex.exec(xml)) !== null) {
    const attrs = parseAttrs(match[1])

    const sym = (attrs['symbol'] ?? '').toUpperCase().trim()
    if (!sym) continue

    const entryDt = attrs['opendatetime'] ?? attrs['opendate'] ?? ''
    const entryTime = entryDt ? toUtcIso(parseIbkrDatetime(entryDt)) : null

    const sharesRaw = parseNum(attrs['position'])
    const shares = sharesRaw != null ? Math.abs(sharesRaw) : null
    const entryPrice = parseNum(
      attrs['averagecost'] ?? attrs['costbasisprice'] ?? attrs['openprice'] ?? ''
    )

    const sideStr = (attrs['side'] ?? '').toLowerCase()
    const side: 'long' | 'short' | null = sideStr.includes('short')
      ? 'short'
      : sideStr.includes('long')
        ? 'long'
        : null

    const t = computeDerived({
      symbol: sym, entry_time: entryTime, exit_time: null,
      side, shares, entry_price: entryPrice, exit_price: null,
      pnl: null, pnl_pct: null, outcome: 'open',
      hold_days: null, hold_time_min: null, hour_of_day: null, day_of_week: null,
      r_multiple: null, setup_tag: 'untagged', source: 'ibkr',
    })

    trades.push(t)
  }

  return dedupByConstraintKey(mergeSameExitTrades(mergePartialFills(trades)))
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
