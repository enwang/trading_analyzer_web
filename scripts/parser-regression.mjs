import fs from 'fs'
import { parseFlexCsv } from '../lib/ibkr/flex.ts'

function fail(message) {
  console.error(`parser-regression: FAIL - ${message}`)
  process.exit(1)
}

const csvPath = './mytrade.csv'
if (!fs.existsSync(csvPath)) {
  fail(`missing ${csvPath}`)
}

const csv = fs.readFileSync(csvPath, 'utf8')
const trades = parseFlexCsv(csv)

const wins = trades.filter((t) => t.outcome === 'win').length
if (wins !== 12) {
  fail(`expected 12 winners, got ${wins}`)
}

const losses = trades.filter((t) => t.outcome === 'loss').length
if (losses !== 39) {
  fail(`expected 39 losers, got ${losses}`)
}

const open = trades.filter((t) => t.outcome === 'open')
if (open.length !== 4) {
  fail(`expected 4 open trades, got ${open.length}`)
}

const closed = trades.filter((t) => t.exit_time != null)
if (closed.length !== 51) {
  fail(`expected 51 closed trades, got ${closed.length}`)
}

if (trades.length !== 55) {
  fail(`expected 55 total trades, got ${trades.length}`)
}

const netClosedPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0)
if (Math.abs(netClosedPnl - (-41966.3962)) > 1e-4) {
  fail(`expected net closed pnl -41966.3962, got ${netClosedPnl}`)
}

const expectedOpenShares = new Map([
  ['ASML', 30],
  ['CRS', 100],
  ['GDS', 1500],
  ['HSAI', 500],
])
for (const [sym, shares] of expectedOpenShares) {
  const row = open.find((t) => t.symbol === sym)
  if (!row) fail(`missing open trade for ${sym}`)
  if ((row.shares ?? 0) !== shares) {
    fail(`expected open ${sym} shares ${shares}, got ${row.shares}`)
  }
}

const ibm = trades
  .filter((t) => t.symbol === 'IBM')
  .filter((t) => t.entry_time?.slice(0, 10) === '2026-01-13')
if (ibm.length !== 2) {
  fail(`expected 2 IBM trades opened on 2026-01-13, got ${ibm.length}`)
}
const ibmShares = ibm
  .map((t) => t.shares ?? 0)
  .sort((a, b) => a - b)
if (ibmShares.length !== 2 || ibmShares[0] !== 100 || ibmShares[1] !== 200) {
  fail(`expected IBM share split [100, 200], got [${ibmShares.join(', ')}]`)
}

const goog = trades.filter((t) => t.symbol === 'GOOG')
if (goog.length !== 3) {
  fail(`expected 3 GOOG trades, got ${goog.length}`)
}

const lmndJan29 = trades.find(
  (t) => t.symbol === 'LMND' && t.entry_time?.startsWith('2026-01-29')
)
if (!lmndJan29) {
  fail('missing LMND trade opened on 2026-01-29')
}
if ((lmndJan29.shares ?? 0) !== 1000) {
  fail(`expected LMND Jan-29 shares = 1000, got ${lmndJan29.shares}`)
}

const serv = trades.filter((t) => t.symbol === 'SERV')
if (serv.length !== 2) {
  fail(`expected 2 SERV trades, got ${serv.length}`)
}

const asml = trades.filter((t) => t.symbol === 'ASML')
if (asml.length !== 2) {
  fail(`expected 2 ASML rows (1 closed + 1 open), got ${asml.length}`)
}
const asmlClosed = asml.find((t) => t.exit_time != null)
if (!asmlClosed) {
  fail('missing closed ASML trade')
}
if ((asmlClosed.shares ?? 0) !== 50) {
  fail(`expected closed ASML shares = 50, got ${asmlClosed.shares}`)
}
const asmlOpen = asml.find((t) => t.outcome === 'open')
if (!asmlOpen) {
  fail('missing open ASML trade')
}
if ((asmlOpen.shares ?? 0) !== 30) {
  fail(`expected open ASML shares = 30, got ${asmlOpen.shares}`)
}

const multiLotOpenCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,AAOI,100,2026-03-01 09:30:00,,BUY,10,
O,AAOI,50,2026-03-02 09:30:00,,BUY,12,
O,XYZ,10,2026-03-01 10:00:00,,BUY,20,
C,XYZ,10,2026-03-03 10:00:00,2026-03-01 10:00:00,SELL,21,200
`
const multiLotTrades = parseFlexCsv(multiLotOpenCsv)
const aaoi = multiLotTrades.filter((t) => t.symbol === 'AAOI')
if (aaoi.length !== 1) {
  fail(`expected 1 aggregated AAOI open trade, got ${aaoi.length}`)
}
if (aaoi[0].outcome !== 'open') {
  fail(`expected aggregated AAOI row to stay open, got ${aaoi[0].outcome}`)
}
if ((aaoi[0].shares ?? 0) !== 150) {
  fail(`expected aggregated AAOI shares = 150, got ${aaoi[0].shares}`)
}
if (Math.abs((aaoi[0].entry_price ?? 0) - (1600 / 150)) > 1e-9) {
  fail(`expected aggregated AAOI entry price = ${1600 / 150}, got ${aaoi[0].entry_price}`)
}

console.log('parser-regression: PASS')
