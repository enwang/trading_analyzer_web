import { enrichOpenTradesWithStopLosses } from '../lib/market/stop-loss.ts'

function fail(message) {
  console.error(`stop-loss-enrichment-regression: FAIL - ${message}`)
  process.exit(1)
}

const baseRow = {
  user_id: 'user-1',
  symbol: 'FSLY',
  entry_time: '2026-03-09T13:48:00.000Z',
  exit_time: null,
  side: 'long',
  shares: 1000,
  entry_price: 20.315,
  exit_price: null,
  pnl: 4598.75,
  pnl_pct: null,
  outcome: 'open',
  hold_days: null,
  hold_time_min: null,
  hour_of_day: null,
  day_of_week: null,
  r_multiple: null,
  setup_tag: 'untagged',
  notes: null,
  stop_loss: null,
  source: 'ibkr',
}

let calls = 0
const enriched = await enrichOpenTradesWithStopLosses(
  [
    { ...baseRow, symbol: 'FSLY' },
    { ...baseRow, symbol: 'PL', stop_loss: 32.25 },
    { ...baseRow, symbol: 'MRNA', exit_time: '2026-03-20T19:59:00.000Z', outcome: 'loss', stop_loss: null },
    { ...baseRow, symbol: 'NVDA', side: 'short', entry_time: '2026-03-10T15:00:00.000Z' },
  ],
  async (symbol, entryTime) => {
    calls += 1
    if (symbol === 'FSLY' && entryTime === '2026-03-09T13:48:00.000Z') {
      return { low: 19.4, high: 20.9 }
    }
    if (symbol === 'NVDA' && entryTime === '2026-03-10T15:00:00.000Z') {
      return { low: 115.2, high: 118.45 }
    }
    return null
  }
)

if (calls !== 2) {
  fail(`expected lookup to run for 2 missing open stops, got ${calls}`)
}

const fsly = enriched.find((row) => row.symbol === 'FSLY')
if (!fsly) fail('missing enriched FSLY row')
if (fsly.stop_loss !== 19.39) {
  fail(`expected FSLY stop loss 19.39, got ${fsly.stop_loss}`)
}

const nvda = enriched.find((row) => row.symbol === 'NVDA')
if (!nvda) fail('missing enriched NVDA row')
if (nvda.stop_loss !== 118.46) {
  fail(`expected NVDA short stop loss 118.46, got ${nvda.stop_loss}`)
}

const pl = enriched.find((row) => row.symbol === 'PL')
if (!pl) fail('missing PL row')
if (pl.stop_loss !== 32.25) {
  fail(`expected existing PL stop loss to be preserved, got ${pl.stop_loss}`)
}

const mrna = enriched.find((row) => row.symbol === 'MRNA')
if (!mrna) fail('missing MRNA row')
if (mrna.stop_loss != null) {
  fail(`expected closed MRNA trade to stay untouched, got ${mrna.stop_loss}`)
}

console.log('stop-loss-enrichment-regression: PASS')
