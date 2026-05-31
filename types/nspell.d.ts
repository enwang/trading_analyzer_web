declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean
    suggest(word: string): string[]
  }
  function nspell(dict: { aff: string | Uint8Array; dic: string | Uint8Array }): NSpell
  export default nspell
}
