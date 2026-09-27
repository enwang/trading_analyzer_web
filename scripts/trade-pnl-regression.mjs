import { totalOpenTradePnl } from '../lib/trade-pnl.ts'

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`trade-pnl-regression: FAIL - ${label}: expected ${expected}, got ${actual}`)
    process.exit(1)
  }
}

assertEqual(totalOpenTradePnl({
  side: 'long',
  entryPrice: 100,
  remainingShares: 60,
  currentPrice: 110,
  realizedPnl: 400,
}), 1000, 'long trade includes realized and unrealized P&L')

assertEqual(totalOpenTradePnl({
  side: 'short',
  entryPrice: 100,
  remainingShares: -40,
  currentPrice: 90,
  realizedPnl: 250,
}), 650, 'short trade includes realized and unrealized P&L')

assertEqual(totalOpenTradePnl({
  side: 'long',
  entryPrice: 100,
  remainingShares: 50,
  currentPrice: 95,
  realizedPnl: 600,
}), 350, 'realized gain offsets unrealized loss')

assertEqual(totalOpenTradePnl({
  side: 'long',
  entryPrice: 100,
  remainingShares: 50,
  currentPrice: null,
  realizedPnl: 600,
}), null, 'missing quote cannot produce total P&L')

console.log('trade-pnl-regression: PASS')
