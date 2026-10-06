import assert from 'node:assert/strict'

import {
  buildInitialStopSyncDatabaseUpdate,
  buildStopSyncDatabaseUpdate,
  matchFilledStopsToClosedTrades,
  matchOpenStopsToTrades,
  reconcileStopOrderSymbols,
} from '../lib/ibkr/open-stop-orders.ts'

const trade = (id, shares, side = 'long', symbol = 'TEAM') => ({
  id,
  symbol,
  side,
  shares,
  entry_time: '2026-09-28T15:00:00.000Z',
  entry_price: side === 'long' ? 180 : 160,
  stop_loss: null,
  current_stop_loss: null,
  initial_risk_amount: null,
})
const stop = (orderId, quantity, stopPrice, action = 'SELL', symbol = 'TEAM') => ({
  orderId,
  symbol,
  action,
  quantity,
  orderType: 'STP',
  stopPrice,
})

{
  const emptyInitialSl = trade('initialize', 100)
  assert.deepEqual(buildStopSyncDatabaseUpdate(emptyInitialSl, 172.5), {
    current_stop_loss: 172.5,
    stop_loss: 172.5,
    stop_loss_locked: true,
    initial_risk_amount: 750,
  })

  const existingInitialSl = { ...emptyInitialSl, stop_loss: 170, initial_risk_amount: 1000 }
  assert.deepEqual(buildStopSyncDatabaseUpdate(existingInitialSl, 175), {
    current_stop_loss: 175,
  })

  const existingRiskOnly = { ...emptyInitialSl, initial_risk_amount: 900 }
  assert.deepEqual(buildStopSyncDatabaseUpdate(existingRiskOnly, 172.5), {
    current_stop_loss: 172.5,
    stop_loss: 172.5,
    stop_loss_locked: true,
  })
}

{
  const result = matchOpenStopsToTrades([trade('one', 100)], [stop(1, 100, 172.5)])
  assert.deepEqual(result.updates, [{ tradeId: 'one', symbol: 'TEAM', stopPrice: 172.5, orderId: 1 }])
  assert.equal('stop_loss' in result.updates[0], false)
}

{
  const result = matchOpenStopsToTrades(
    [trade('first', 100), trade('second', 200)],
    [stop(2, 300, 170)],
  )
  assert.deepEqual(result.updates.map(update => update.tradeId), ['first', 'second'])
}

{
  const result = matchOpenStopsToTrades(
    [trade('small', 100), trade('large', 250)],
    [stop(3, 250, 168), stop(4, 100, 171)],
  )
  assert.deepEqual(result.updates.map(update => [update.tradeId, update.stopPrice]), [
    ['small', 171],
    ['large', 168],
  ])
}

{
  const result = matchOpenStopsToTrades(
    [trade('ambiguous-a', 100), trade('ambiguous-b', 100)],
    [stop(5, 100, 168), stop(6, 100, 171)],
  )
  assert.equal(result.updates.length, 0)
  assert.equal(result.skipped.length, 1)
}

{
  const result = matchOpenStopsToTrades(
    [
      trade('new', 100),
      { ...trade('existing', 100), current_stop_loss: 168 },
    ],
    [stop(5, 100, 171), stop(6, 100, 168)],
  )
  assert.deepEqual(result.updates.map(update => [update.tradeId, update.stopPrice]), [
    ['existing', 168],
    ['new', 171],
  ])
  assert.equal(result.skipped.length, 0)
}

{
  const result = matchOpenStopsToTrades([trade('long', 100)], [stop(7, 100, 175, 'BUY')])
  assert.equal(result.updates.length, 0)
  assert.deepEqual(result.skipped, [{ symbol: 'TEAM', reason: 'No matching SELL stop order was read' }])
}

{
  const result = matchOpenStopsToTrades([trade('missing', 100, 'long', 'AMD')], [])
  assert.deepEqual(result.skipped, [{ symbol: 'AMD', reason: 'No matching SELL stop order was read' }])
}

{
  const result = matchOpenStopsToTrades(
    [trade('one-trade', 200)],
    [stop(9, 100, 168), stop(10, 100, 171)],
  )
  assert.equal(result.updates.length, 0)
  assert.equal(result.skipped.length, 1)
}

{
  const result = matchOpenStopsToTrades(
    [trade('short', 75, 'short', 'MU')],
    [stop(8, 75, 214.5, 'BUY', 'MU')],
  )
  assert.equal(result.updates[0].stopPrice, 214.5)
}

{
  const closed = (id, entryPrice, exitPrice) => ({
    ...trade(id, 200, 'long', 'BE'),
    entry_price: entryPrice,
    exit_time: '2026-10-01T14:45:00.000Z',
    exit_price: exitPrice,
  })
  const filledStop = (orderId, stopPrice, fillPrice) => ({
    ...stop(orderId, 200, stopPrice, 'SELL', 'BE'),
    status: 'FILLED',
    fillPrice,
  })
  const result = matchFilledStopsToClosedTrades(
    [closed('be-first', 277.4, 273.89), closed('be-second', 276.6, 274.31)],
    [filledStop(11, 273.9, 273.89), filledStop(12, 274.3, 274.31)],
  )
  assert.deepEqual(result.updates.map(update => [update.tradeId, update.stopPrice]), [
    ['be-first', 273.9],
    ['be-second', 274.3],
  ])
  assert.equal(result.skipped.length, 0)
  assert.deepEqual(buildInitialStopSyncDatabaseUpdate(closed('risk', 277.4, 273.89), 273.9), {
    stop_loss: 273.9,
    stop_loss_locked: true,
    initial_risk_amount: 700,
  })
}

{
  const qcomTrade = {
    ...trade('qcom', 400, 'long', 'QCOM'),
    exit_time: '2026-10-05T19:45:04.000Z',
    exit_price: 180.389,
  }
  const ocrOrder = {
    ...stop(14, 400, 180.4, 'SELL', 'OCOM'),
    status: 'FILLED',
    fillPrice: 180.39,
  }
  const reconciled = reconcileStopOrderSymbols([ocrOrder], [qcomTrade])
  assert.equal(reconciled[0].symbol, 'QCOM')
  assert.equal(matchFilledStopsToClosedTrades([qcomTrade], reconciled).updates.length, 1)
}

{
  const ambiguous = reconcileStopOrderSymbols(
    [stop(15, 100, 180, 'SELL', 'OCOM')],
    [trade('qcom', 100, 'long', 'QCOM'), trade('ocom', 100, 'long', 'OCON')],
  )
  assert.equal(ambiguous[0].symbol, 'OCOM')
}

{
  const closedTrade = {
    ...trade('manual-sl', 100, 'long', 'MRNA'),
    exit_time: '2026-10-01T15:00:00.000Z',
    exit_price: 190.76,
    stop_loss: 188,
  }
  const result = matchFilledStopsToClosedTrades(
    [closedTrade],
    [{ ...stop(13, 100, 190.75, 'SELL', 'MRNA'), status: 'FILLED', fillPrice: 190.76 }],
  )
  assert.equal(result.updates.length, 0)
}

console.log('Open stop order regression checks passed.')
