export type DateRangeKey = 'WTD' | 'MTD' | 'YTD' | 'All'
export const DATE_RANGES: DateRangeKey[] = ['WTD', 'MTD', 'YTD', 'All']
export const MARKET_TIME_ZONE = 'America/New_York'

type DateRangeOptions = {
  timeZone?: string
  now?: Date
  marketWeekOpen?: boolean
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function datePartsInTimeZone(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
  }
}

export function dateKeyInTimeZone(date: Date | string, timeZone?: string) {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return null
  const parts = datePartsInTimeZone(d, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

function dayOfWeekFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1, day))
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function getTodayDateKey(options: DateRangeOptions = {}) {
  return dateKeyInTimeZone(options.now ?? new Date(), options.timeZone)!
}

function getEffectiveMarketDateKey(options: DateRangeOptions = {}) {
  const now = options.now ?? new Date()
  const timeZone = options.timeZone ?? MARKET_TIME_ZONE
  const todayKey = dateKeyInTimeZone(now, timeZone)!
  const parts = datePartsInTimeZone(now, timeZone)
  const day = dayOfWeekFromDateKey(todayKey)
  const minutes = parts.hour * 60 + parts.minute

  // Before regular U.S. market open on Monday, the trading week is still the
  // prior week for "last week" / WTD trade views.
  if (day === 1 && minutes < 9 * 60 + 30) return addDaysToDateKey(todayKey, -1)
  return todayKey
}

export function getStartDate(range: DateRangeKey, options: DateRangeOptions = {}): string | null {
  const todayKey = options.marketWeekOpen ? getEffectiveMarketDateKey(options) : getTodayDateKey(options)
  const [y, month] = todayKey.split('-')
  switch (range) {
    case 'WTD': {
      const day = dayOfWeekFromDateKey(todayKey)
      const diff = day === 0 ? 6 : day - 1
      return addDaysToDateKey(todayKey, -diff)
    }
    case 'MTD': return `${y}-${month}-01`
    case 'YTD': return `${y}-01-01`
    case 'All': return null
  }
}
