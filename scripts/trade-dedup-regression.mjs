import { normalizeTradesForDisplay, dedupeTradeRowsForCleanup } from '../lib/trades.ts'

function fail(message) {
  console.error(`trade-dedup-regression: FAIL - ${message}`)
  process.exit(1)
}

function makeTrade(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    userId: 'user-1',
    symbol: 'TEST',
    entryTime: '2026-03-09T13:40:00.000Z',
    exitTime: '2026-03-13T19:56:00.000Z',
    side: 'long',
    shares: 500,
    entryPrice: 98.25,
    exitPrice: 101.07044,
    pnl: 1410.22,
    pnlPct: 1410.22 / (98.25 * 500),
    outcome: 'win',
    holdDays: null,
    holdTimeMin: null,
    hourOfDay: null,
    dayOfWeek: null,
    stopLoss: 93.72,
    rMultiple: 0.62,
    setupTag: 'untagged',
    notes: '',
    executionLegs: [
      { time: '2026-03-09T13:40:00.000Z', action: 'BUY', shares: 500, price: 98.25 },
      { time: '2026-03-09T14:08:00.000Z', action: 'SELL', shares: 125, price: 103.45864 },
      { time: '2026-03-09T19:28:00.000Z', action: 'SELL', shares: 125, price: 107.94144 },
      { time: '2026-03-13T19:56:00.000Z', action: 'SELL', shares: 250, price: 96.44088 },
    ],
    mfe: null,
    mae: null,
    source: 'ibkr',
    createdAt: '2026-03-21T00:00:00.000Z',
    ...overrides,
  }
}

const aaoiFull = makeTrade({
  id: 'aaoi-full',
  symbol: 'AAOI',
  shares: 500,
  stopLoss: 93.81,
  rMultiple: 0.64,
})

const aaoiFragment1 = makeTrade({
  id: 'aaoi-frag-1',
  symbol: 'AAOI',
  shares: 125,
  exitTime: '2026-03-09T19:28:00.000Z',
  exitPrice: 107.94144,
  pnl: 1211.43,
  pnlPct: 1211.43 / (98.25 * 125),
  holdTimeMin: null,
  stopLoss: 93.72,
  rMultiple: 2.14,
})

const aaoiFragment2 = makeTrade({
  id: 'aaoi-frag-2',
  symbol: 'AAOI',
  shares: 125,
  exitTime: '2026-03-09T14:08:00.000Z',
  exitPrice: 103.45864,
  pnl: 651.08,
  pnlPct: 651.08 / (98.25 * 125),
  holdTimeMin: null,
  stopLoss: 93.72,
  rMultiple: 1.15,
})

const umacFull = makeTrade({
  id: 'umac-full',
  symbol: 'UMAC',
  entryTime: '2026-03-13T18:07:00.000Z',
  exitTime: '2026-03-16T16:09:00.000Z',
  shares: 4000,
  entryPrice: 20.3538,
  exitPrice: 18.894075,
  pnl: -2039.1,
  pnlPct: -2039.1 / (20.3538 * 4000),
  stopLoss: 19.89,
  rMultiple: -1.1,
  executionLegs: [
    { time: '2026-03-13T18:07:00.000Z', action: 'BUY', shares: 4000, price: 20.3538 },
    { time: '2026-03-13T19:50:00.000Z', action: 'SELL', shares: 3000, price: 20.364 },
    { time: '2026-03-16T16:09:00.000Z', action: 'SELL', shares: 1000, price: 18.2841 },
  ],
})

const umacFragment = makeTrade({
  id: 'umac-frag',
  symbol: 'UMAC',
  entryTime: '2026-03-13T18:07:00.000Z',
  exitTime: '2026-03-13T19:50:00.000Z',
  shares: 3000,
  entryPrice: 20.3538,
  exitPrice: 20.364,
  pnl: 30.6,
  pnlPct: 30.6 / (20.3538 * 3000),
  outcome: 'win',
  stopLoss: 19.89,
  rMultiple: 0.02,
  executionLegs: [
    { time: '2026-03-13T18:07:00.000Z', action: 'BUY', shares: 4000, price: 20.3538 },
    { time: '2026-03-13T19:50:00.000Z', action: 'SELL', shares: 3000, price: 20.364 },
    { time: '2026-03-16T16:09:00.000Z', action: 'SELL', shares: 1000, price: 18.2841 },
  ],
})

const openDuplicate1 = makeTrade({
  id: 'open-1',
  symbol: 'FSLY',
  exitTime: null,
  shares: 1000,
  outcome: 'open',
  entryPrice: 20.32,
  pnl: 1000,
  executionLegs: [{ time: '2026-03-09T14:31:00.000Z', action: 'BUY', shares: 1000, price: 20.32 }],
})

const openDuplicate2 = makeTrade({
  id: 'open-2',
  symbol: 'FSLY',
  exitTime: null,
  shares: 1500,
  outcome: 'open',
  entryPrice: 20.32,
  pnl: 3598.75,
  executionLegs: [{ time: '2026-03-09T15:00:00.000Z', action: 'BUY', shares: 1500, price: 20.32 }],
})

const trades = [
  aaoiFull,
  aaoiFragment1,
  aaoiFragment2,
  umacFull,
  umacFragment,
  openDuplicate1,
  openDuplicate2,
]

const normalized = normalizeTradesForDisplay(trades)
if (normalized.length !== 3) {
  fail(`expected 3 normalized rows, got ${normalized.length}`)
}

const aaoiRows = normalized.filter((trade) => trade.symbol === 'AAOI')
if (aaoiRows.length !== 1) {
  fail(`expected 1 AAOI row after normalization, got ${aaoiRows.length}`)
}
if ((aaoiRows[0].shares ?? 0) !== 500) {
  fail(`expected AAOI shares to stay 500, got ${aaoiRows[0].shares}`)
}
if (aaoiRows[0].executionLegs?.length !== 4) {
  fail(`expected AAOI to preserve 4 execution legs, got ${aaoiRows[0].executionLegs?.length ?? 0}`)
}

const umacRows = normalized.filter((trade) => trade.symbol === 'UMAC')
if (umacRows.length !== 1) {
  fail(`expected 1 UMAC row after normalization, got ${umacRows.length}`)
}
if ((umacRows[0].shares ?? 0) !== 4000) {
  fail(`expected UMAC shares to stay 4000, got ${umacRows[0].shares}`)
}
if (umacRows[0].outcome !== 'loss') {
  fail(`expected UMAC outcome to stay loss, got ${umacRows[0].outcome}`)
}

const fslyRows = normalized.filter((trade) => trade.symbol === 'FSLY')
if (fslyRows.length !== 1) {
  fail(`expected 1 FSLY open row after normalization, got ${fslyRows.length}`)
}
if ((fslyRows[0].shares ?? 0) !== 2500) {
  fail(`expected FSLY open shares to merge to 2500, got ${fslyRows[0].shares}`)
}

const cleanupGroups = dedupeTradeRowsForCleanup(trades)
if (cleanupGroups.length !== 3) {
  fail(`expected 3 cleanup groups, got ${cleanupGroups.length}`)
}

const deletedRows = cleanupGroups.reduce((sum, group) => sum + group.removeIds.length, 0)
if (deletedRows !== 4) {
  fail(`expected cleanup to remove 4 duplicate rows, got ${deletedRows}`)
}

console.log('trade-dedup-regression: PASS')
