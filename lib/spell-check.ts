export type SpellChecker = {
  correct(word: string): boolean
  suggest(word: string): string[]
}

export type Misspelling = {
  word: string
  start: number
  end: number
  suggestions: string[]
}

const TRADING_TERMS = [
  'trendline', 'trendlines',
  'breakout', 'breakouts',
  'pullback', 'pullbacks',
  'overextended',
  'premarket', 'afterhours',
  'oversold', 'overbought',
  'fomo', 'vwap',
  'ema', 'sma', 'rsi', 'macd',
  'divergence', 'divergences',
  'consolidation', 'consolidating',
  'scalp', 'scalping',
  'multiday', 'multi-day',
  'stoploss', 'stopout',
  'neckline',
  'fibonaccis', 'retracement', 'retracements',
  'parabolic',
]

let instance: SpellChecker | null = null
const waiters: Array<(c: SpellChecker) => void> = []

export function getSpellChecker(): Promise<SpellChecker> {
  if (instance) return Promise.resolve(instance)
  return new Promise((resolve) => {
    waiters.push(resolve)
    if (waiters.length > 1) return // already loading
    Promise.all([
      import('nspell'),
      fetch('/spell/en.aff').then((r) => r.text()),
      fetch('/spell/en.dic').then((r) => r.text()),
    ]).then(([nspellMod, affText, dicText]) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const checker = nspellMod.default({
        aff: affText,
        dic: dicText,
      }) as SpellChecker & { add(word: string): void }
      // Add common trading / finance terms not in the standard dictionary
      TRADING_TERMS.forEach((w) => checker.add(w))
      instance = checker
      waiters.forEach((fn) => fn(instance!))
      waiters.length = 0
    })
  })
}

const WORD_RE = /\b[a-zA-Z']{2,}\b/g

export function findMisspellings(text: string, checker: SpellChecker): Misspelling[] {
  const results: Misspelling[] = []
  let m: RegExpExecArray | null
  WORD_RE.lastIndex = 0
  while ((m = WORD_RE.exec(text)) !== null) {
    const word = m[0].replace(/^'+|'+$/g, '') // strip surrounding apostrophes
    // Skip ALL-CAPS words (ticker symbols, acronyms like UMAC, SPY, VWAP)
    if (!word || /^[A-Z]{2,}$/.test(word)) continue
    if (checker.correct(word) || checker.correct(word.toLowerCase())) continue
    results.push({
      word,
      start: m.index,
      end: m.index + m[0].length,
      suggestions: checker.suggest(word).slice(0, 6),
    })
  }
  return results
}
