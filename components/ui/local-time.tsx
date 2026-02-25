'use client'

interface Props {
  date: string | null
  className?: string
  dateOnly?: boolean
}

export function LocalTime({ date, className, dateOnly = false }: Props) {
  if (!date) return <span className={className}>—</span>
  const formatted = dateOnly
    ? new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    : new Date(date).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
  return <span className={className}>{formatted}</span>
}
