# Claude Code — Project Rules

## Trade Parser Regression Rule

For any change to `lib/ibkr/flex.ts`, always run:

```bash
npm run test:parser-regression
```

Minimum required check (for current `mytrade.csv`):
- Winners count must be exactly `12`.
