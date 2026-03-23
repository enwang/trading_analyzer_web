# Claude Code — Project Rules

## Trade Parser Regression Rule

For any change to `lib/ibkr/flex.ts`, always run:

```bash
npm run test:parser-regression
```

Minimum required check (for current `mytrade.csv`):
- Winners count must be exactly `12`.

## UI Verification Rule

For UI-related fixes or regressions, verify the actual behavior with browser MCP before claiming the issue is fixed.
