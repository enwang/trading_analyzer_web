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
if (losses !== 38) {
  fail(`expected 38 losers, got ${losses}`)
}

const open = trades.filter((t) => t.outcome === 'open')
if (open.length !== 4) {
  fail(`expected 4 open trades, got ${open.length}`)
}

const closed = trades.filter((t) => t.exit_time != null)
if (closed.length !== 50) {
  fail(`expected 50 closed trades, got ${closed.length}`)
}

if (trades.length !== 54) {
  fail(`expected 54 total trades, got ${trades.length}`)
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
// IBM had two entry lots (100 + 200 shares) closed in one sell order at the same
// exit timestamp — mergeSameExitTrades correctly combines them into one 300-share trade.
if (ibm.length !== 1) {
  fail(`expected 1 merged IBM trade opened on 2026-01-13, got ${ibm.length}`)
}
if ((ibm[0].shares ?? 0) !== 300) {
  fail(`expected merged IBM shares = 300, got ${ibm[0].shares}`)
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

const afterSellAddonCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,ARM,100,2026-03-01 09:30:00,,BUY,100,
C,ARM,50,2026-03-02 10:00:00,,SELL,110,5000
O,ARM,100,2026-03-03 09:30:00,,BUY,120,
C,ARM,100,2026-03-04 10:00:00,,SELL,130,12000
O,XYZ,10,2026-03-01 10:00:00,,BUY,20,
C,XYZ,10,2026-03-03 10:00:00,2026-03-01 10:00:00,SELL,21,200
`
const afterSellAddonTrades = parseFlexCsv(afterSellAddonCsv)
// Partial sell on first lot is absorbed; only the fully-closed second lot (100 @ 120→130) shows as closed.
const armClosedHigh = afterSellAddonTrades.find((t) => t.symbol === 'ARM' && t.exit_time != null)
if (!armClosedHigh || armClosedHigh.entry_price !== 120 || armClosedHigh.shares !== 100 || armClosedHigh.pnl !== 1000) {
  fail(`expected ARM later add-on to close as separate 100 @ 120 lot for +1000, got ${JSON.stringify(armClosedHigh)}`)
}
const armOpenLow = afterSellAddonTrades.find((t) => t.symbol === 'ARM' && t.outcome === 'open')
if (!armOpenLow || armOpenLow.entry_price !== 100 || armOpenLow.shares !== 50 || armOpenLow.pnl !== 500) {
  fail(`expected original ARM lot to remain open with 50 shares and +500 partial P&L, got ${JSON.stringify(armOpenLow)}`)
}

const sameDaySellAddonCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,ARM,100,2026-03-01 09:30:00,,BUY,100,
C,ARM,50,2026-03-02 10:00:00,,SELL,110,5000
O,ARM,100,2026-03-02 11:30:00,,BUY,120,
O,XYZ,10,2026-03-01 10:00:00,,BUY,20,
C,XYZ,10,2026-03-03 10:00:00,2026-03-01 10:00:00,SELL,21,200
`
const sameDaySellAddonTrades = parseFlexCsv(sameDaySellAddonCsv)
// Both lots remain open; partial exit absorbed into first lot's pnl.
const armSameDayRows = sameDaySellAddonTrades.filter((t) => t.symbol === 'ARM')
if (armSameDayRows.length !== 2) {
  fail(`expected same-day ARM add after sell to result in 2 open trades, got ${JSON.stringify(armSameDayRows)}`)
}
if (!armSameDayRows.some((t) => t.entry_price === 100 && t.shares === 50 && t.pnl === 500)) {
  fail(`expected original same-day ARM lot to remain open with 50 shares and +500 partial P&L, got ${JSON.stringify(armSameDayRows)}`)
}
if (!armSameDayRows.some((t) => t.entry_price === 120 && t.shares === 100 && t.pnl === null)) {
  fail(`expected same-day ARM add-on to be separate open 100 @ 120 trade with null pnl, got ${JSON.stringify(armSameDayRows)}`)
}

const multiSellOpenCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,FSLY,2500,2026-03-09 09:48:00,,BUY,20.315,
O,XYZ,10,2026-03-01 10:00:00,,BUY,20,
C,FSLY,500,2026-03-18 14:36:00,2026-03-09 09:48:00,SELL,23.38,10157.5
C,FSLY,500,2026-03-18 14:37:00,2026-03-09 09:48:00,SELL,23.40,10157.5
C,FSLY,500,2026-03-18 14:38:00,2026-03-09 09:48:00,SELL,23.36,10157.5
C,XYZ,10,2026-03-03 10:00:00,2026-03-01 10:00:00,SELL,21,200
`
const multiSellTrades = parseFlexCsv(multiSellOpenCsv)
const fsly = multiSellTrades.find((t) => t.symbol === 'FSLY' && t.outcome === 'open')
if (!fsly) {
  fail('missing FSLY open trade with partial sells')
}
if ((fsly.shares ?? 0) !== 1000) {
  fail(`expected FSLY remaining shares = 1000, got ${fsly.shares}`)
}
if ((fsly.execution_legs?.length ?? 0) !== 4) {
  fail(`expected FSLY execution legs to preserve 1 buy + 3 sells, got ${fsly.execution_legs?.length ?? 0}`)
}
const fslySellLegs = (fsly.execution_legs ?? []).filter((leg) => leg.action === 'SELL')
if (fslySellLegs.length !== 3) {
  fail(`expected FSLY to keep 3 sell legs, got ${fslySellLegs.length}`)
}

const crwdSplitCsv = `ClientAccountID,Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
U123,O,CRWD,10,2026-06-10 09:30:00,,BUY,700,
U123,O,XYZ,10,2026-06-10 10:00:00,,BUY,20,
U123,C,XYZ,10,2026-06-11 10:00:00,2026-06-10 10:00:00,SELL,21,200
ClientAccountID,CurrencyPrimary,AssetCategory,Symbol,Position,CostBasisPrice
U123,USD,STK,CRWD,40,175
`
const crwdSplitTrades = parseFlexCsv(crwdSplitCsv)
const crwd = crwdSplitTrades.find((t) => t.symbol === 'CRWD' && t.outcome === 'open')
if (!crwd) {
  fail('missing CRWD open trade after split-adjusted open-position snapshot')
}
if ((crwd.shares ?? 0) !== 40) {
  fail(`expected split-adjusted CRWD shares = 40, got ${crwd.shares}`)
}
if ((crwd.entry_price ?? 0) !== 175) {
  fail(`expected split-adjusted CRWD entry price = 175, got ${crwd.entry_price}`)
}
const crwdBuyLeg = crwd.execution_legs?.find((leg) => leg.action === 'BUY')
if (!crwdBuyLeg || crwdBuyLeg.shares !== 40 || crwdBuyLeg.price !== 175) {
  fail(`expected CRWD buy leg to be split-adjusted to 40 @ 175, got ${JSON.stringify(crwd.execution_legs)}`)
}

const crwdKnownSplitCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,CRWD,100,2026-06-18 11:07:20,,BUY,680,
C,CRWD,27,2026-07-01 09:58:26,2026-06-18 11:07:20,SELL,781,18360
C,CRWD,6,2026-07-01 09:58:26,2026-06-18 11:07:20,SELL,781,4080
O,XYZ,10,2026-06-10 10:00:00,,BUY,20,
C,XYZ,10,2026-06-11 10:00:00,2026-06-10 10:00:00,SELL,21,200
`
const crwdKnownSplitTrades = parseFlexCsv(crwdKnownSplitCsv)
const crwdKnownSplit = crwdKnownSplitTrades.find((t) => t.symbol === 'CRWD' && t.outcome === 'open')
if (!crwdKnownSplit) {
  fail('missing CRWD open trade after known split adjustment')
}
if ((crwdKnownSplit.shares ?? 0) !== 268) {
  fail(`expected known-split CRWD shares = 268, got ${crwdKnownSplit.shares}`)
}
if ((crwdKnownSplit.entry_price ?? 0) !== 170) {
  fail(`expected known-split CRWD entry price = 170, got ${crwdKnownSplit.entry_price}`)
}
if ((crwdKnownSplit.pnl ?? 0) !== 3333) {
  fail(`expected known-split CRWD realized pnl to remain 3333, got ${crwdKnownSplit.pnl}`)
}
const crwdKnownSplitNetShares = (crwdKnownSplit.execution_legs ?? []).reduce(
  (sum, leg) => sum + (leg.action === 'BUY' ? leg.shares : -leg.shares),
  0
)
if (crwdKnownSplitNetShares !== 268) {
  fail(`expected known-split CRWD execution legs to net to 268 shares, got ${crwdKnownSplitNetShares}`)
}

const crwdPostSplitPartialLossCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,CRWD,100,2026-06-18 11:07:20,,BUY,680,
C,CRWD,132,2026-07-10 09:58:26,2026-06-18 11:07:20,SELL,160,22440
O,XYZ,10,2026-06-10 10:00:00,,BUY,20,
C,XYZ,10,2026-06-11 10:00:00,2026-06-10 10:00:00,SELL,21,200
`
const crwdPostSplitPartialLossTrades = parseFlexCsv(crwdPostSplitPartialLossCsv)
const crwdPostSplitClosed = crwdPostSplitPartialLossTrades.find((t) => t.symbol === 'CRWD' && t.exit_time != null)
if (crwdPostSplitClosed) {
  fail(`expected post-split partial CRWD sale not to create a closed trade, got ${JSON.stringify(crwdPostSplitClosed)}`)
}
const crwdPostSplitOpen = crwdPostSplitPartialLossTrades.find((t) => t.symbol === 'CRWD' && t.outcome === 'open')
if (!crwdPostSplitOpen) {
  fail('missing CRWD open trade after post-split partial sale')
}
if ((crwdPostSplitOpen.shares ?? 0) !== 268) {
  fail(`expected post-split CRWD remaining shares = 268, got ${crwdPostSplitOpen.shares}`)
}
if ((crwdPostSplitOpen.entry_price ?? 0) !== 170) {
  fail(`expected post-split CRWD entry price = 170, got ${crwdPostSplitOpen.entry_price}`)
}
if ((crwdPostSplitOpen.pnl ?? 0) !== -1320) {
  fail(`expected post-split CRWD realized pnl = -1320, got ${crwdPostSplitOpen.pnl}`)
}
const crwdPostSplitNetShares = (crwdPostSplitOpen.execution_legs ?? []).reduce(
  (sum, leg) => sum + (leg.action === 'BUY' ? leg.shares : -leg.shares),
  0
)
if (crwdPostSplitNetShares !== 268) {
  fail(`expected post-split CRWD execution legs to net to 268 shares, got ${crwdPostSplitNetShares}`)
}

const crwdMixedSplitScaleCsv = `Open/CloseIndicator,Symbol,Quantity,Date/Time,Open Date/Time,Buy/Sell,T. Price,Basis
O,CRWD,100,2026-06-18 11:07:20,,BUY,680,
C,CRWD,27,2026-07-01 09:58:26,2026-06-18 11:07:20,SELL,781,18360
C,CRWD,6,2026-07-01 09:58:26,2026-06-18 11:07:20,SELL,781,4080
C,CRWD,134,2026-07-14 11:02:11,2026-06-18 11:07:20,SELL,207,22780
O,XYZ,10,2026-06-10 10:00:00,,BUY,20,
C,XYZ,10,2026-06-11 10:00:00,2026-06-10 10:00:00,SELL,21,200
`
const crwdMixedSplitScaleTrades = parseFlexCsv(crwdMixedSplitScaleCsv)
const crwdMixedClosed = crwdMixedSplitScaleTrades.find((t) => t.symbol === 'CRWD' && t.exit_time != null)
if (crwdMixedClosed) {
  fail(`expected mixed-scale CRWD partial sells not to create a closed trade, got ${JSON.stringify(crwdMixedClosed)}`)
}
const crwdMixedOpen = crwdMixedSplitScaleTrades.find((t) => t.symbol === 'CRWD' && t.outcome === 'open')
if (!crwdMixedOpen) {
  fail('missing CRWD open trade after mixed pre/post split partial sells')
}
if ((crwdMixedOpen.shares ?? 0) !== 134) {
  fail(`expected mixed-scale CRWD remaining shares = 134, got ${crwdMixedOpen.shares}`)
}
if ((crwdMixedOpen.entry_price ?? 0) !== 170) {
  fail(`expected mixed-scale CRWD entry price = 170, got ${crwdMixedOpen.entry_price}`)
}
if (Math.abs((crwdMixedOpen.pnl ?? 0) - 8291) > 1e-9) {
  fail(`expected mixed-scale CRWD realized pnl = 8291, got ${crwdMixedOpen.pnl}`)
}
const crwdMixedLegs = crwdMixedOpen.execution_legs ?? []
if (!crwdMixedLegs.some((leg) => leg.action === 'BUY' && leg.shares === 400 && leg.price === 170)) {
  fail(`expected mixed-scale CRWD buy leg adjusted to 400 @ 170, got ${JSON.stringify(crwdMixedLegs)}`)
}
if (!crwdMixedLegs.some((leg) => leg.action === 'SELL' && leg.shares === 108 && leg.price === 195.25)) {
  fail(`expected mixed-scale CRWD first sell leg adjusted to 108 @ 195.25, got ${JSON.stringify(crwdMixedLegs)}`)
}
if (!crwdMixedLegs.some((leg) => leg.action === 'SELL' && leg.shares === 24 && leg.price === 195.25)) {
  fail(`expected mixed-scale CRWD second sell leg adjusted to 24 @ 195.25, got ${JSON.stringify(crwdMixedLegs)}`)
}
if (!crwdMixedLegs.some((leg) => leg.action === 'SELL' && leg.shares === 134 && leg.price === 207)) {
  fail(`expected mixed-scale CRWD post-split sell leg to stay 134 @ 207, got ${JSON.stringify(crwdMixedLegs)}`)
}

console.log('parser-regression: PASS')
