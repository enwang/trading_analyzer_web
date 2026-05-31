declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
  }
  function nspell(dict: { aff: Uint8Array; dic: Uint8Array }): NSpell
  export default nspell
}
