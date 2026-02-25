import { NextResponse } from 'next/server'
import Papa from 'papaparse'

type SheetRow = {
  symbol: string
  openDate: string | null
  closeDate: string | null
  initialStop: number | null
}

const SHEET_ID = '1qqZDoMGlf6nD_SWYsWOT6kEALC107EajN_RKY5kqdDM'
const SHEET_GID = '1004997235'

function parseNum(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(String(value).replace(/[$,%\s,]/g, ''))
  return Number.isFinite(n) ? n : null
}

function toIsoDate(value: string | undefined, fallbackYear?: number): string | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null
  const parts = raw.split('/')
  if (parts.length < 2 || parts.length > 3) return null
  const month = Number(parts[0])
  const day = Number(parts[1])
  if (!Number.isFinite(month) || !Number.isFinite(day) || month < 1 || month > 12 || day < 1 || day > 31) return null

  let year = fallbackYear ?? new Date().getUTCFullYear()
  if (parts.length === 3) {
    const y = Number(parts[2])
    if (Number.isFinite(y)) year = y < 100 ? 2000 + y : y
  }

  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export async function GET() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) {
      return NextResponse.json({ error: 'Failed to fetch sheet' }, { status: 502 })
    }

    const csv = await resp.text()
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    })

    const rows: SheetRow[] = []
    for (const r of parsed.data) {
      const symbol = (r['Ticker'] ?? '').trim().toUpperCase()
      if (!symbol) continue

      const closeWithYear = toIsoDate(r['Close Date'])
      const fallbackYear = closeWithYear ? Number(closeWithYear.slice(0, 4)) : undefined
      const openDate = toIsoDate(r['Open Date'], fallbackYear)
      const closeDate = closeWithYear ?? toIsoDate(r['Close Date'], fallbackYear)
      const initialStop = parseNum(r['Initial Stop'])

      rows.push({
        symbol,
        openDate,
        closeDate,
        initialStop,
      })
    }

    return NextResponse.json({ rows })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
