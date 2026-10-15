# Claude Code — Project Rules

## Trade Parser Regression Rule

For any change to `lib/ibkr/flex.ts`, always run:

```bash
npm run test:parser-regression
```

Minimum required check (for current `mytrade.csv`):
- Winners count must be exactly `12`.

`mytrade.csv` is a local, gitignored fixture; when it is absent the script skips the real-data checks and still runs all inline synthetic cases.

## UI Verification Rule

For UI-related fixes or regressions, verify the actual behavior with browser MCP before claiming the issue is fixed.

## Hydration Guard Rule

Never read `sessionStorage`/`localStorage` inside a `useState` lazy initializer: the server render has no storage, so the first client render diverges and React discards the page and re-renders it entirely (a steep slowdown on heavy pages). Read storage in a mount `useEffect` instead. Guarded by:

```bash
npm run test:hydration-guard-regression
```

## Overlay Boundary Rule

For hovercards, tooltips, popovers, or any absolute-positioned UI near table edges or viewport edges, verify the overlay stays fully visible and is not clipped by the right boundary of the page.
