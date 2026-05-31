export type DateRangeKey = 'WTD' | 'MTD' | 'YTD' | 'All'
export const DATE_RANGES: DateRangeKey[] = ['WTD', 'MTD', 'YTD', 'All']

export function getStartDate(range: DateRangeKey): string | null {
  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = today.getFullYear()
  const m = pad(today.getMonth() + 1)
  switch (range) {
    case 'WTD': {
      const day = today.getDay()
      const diff = day === 0 ? 6 : day - 1
      const mon = new Date(today)
      mon.setDate(today.getDate() - diff)
      return `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`
    }
    case 'MTD': return `${y}-${m}-01`
    case 'YTD': return `${y}-01-01`
    case 'All': return null
  }
}
