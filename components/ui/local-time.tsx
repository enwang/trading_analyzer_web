'use client'

interface Props {
  date: string | null
  className?: string
}

export function LocalTime({ date, className }: Props) {
  if (!date) return <span className={className}>—</span>
  const formatted = new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return <span className={className}>{formatted}</span>
}
