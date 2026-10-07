export function formatShares(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const normalized = Math.abs(value) < 0.005 ? 0 : value
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}
