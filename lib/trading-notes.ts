export type TradingNotes = {
  entryRules: string
  sellRules: string
  reviewNotes: string
}

export const EMPTY_TRADING_NOTES: TradingNotes = {
  entryRules: '',
  sellRules: '',
  reviewNotes: '',
}

export function normalizeTradingNotes(value: unknown): TradingNotes {
  if (!value || typeof value !== 'object') return { ...EMPTY_TRADING_NOTES }
  const notes = value as Record<string, unknown>
  return {
    entryRules: typeof notes.entryRules === 'string' ? notes.entryRules : '',
    sellRules: typeof notes.sellRules === 'string' ? notes.sellRules : '',
    reviewNotes: typeof notes.reviewNotes === 'string' ? notes.reviewNotes : '',
  }
}

export function validTradingNotes(value: unknown): value is TradingNotes {
  if (!value || typeof value !== 'object') return false
  const notes = value as Record<string, unknown>
  return ['entryRules', 'sellRules', 'reviewNotes'].every((key) => (
    typeof notes[key] === 'string' && notes[key].length <= 50_000
  ))
}
