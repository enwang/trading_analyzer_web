export type ActiveStopOrder = {
  orderId: number
  symbol: string
  action: string
  quantity: number
  orderType: string
  stopPrice: number
}

export type OpenTradeForStopSync = {
  id: string
  symbol: string
  side: string | null
  shares: number | null
  entry_time: string | null
  current_stop_loss: number | null
}

export type StopLossUpdate = {
  tradeId: string
  symbol: string
  stopPrice: number
  orderId: number
}

export type SkippedStopMatch = {
  symbol: string
  reason: string
}

const EPSILON = 0.000001

function sameNumber(a: number, b: number) {
  return Math.abs(a - b) < EPSILON
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase()
}

function closingAction(side: string | null) {
  if (side === 'long') return 'SELL'
  if (side === 'short') return 'BUY'
  return null
}

function allSameStop(orders: ActiveStopOrder[]) {
  return orders.length > 0 && orders.every(order => sameNumber(order.stopPrice, orders[0].stopPrice))
}

function updateFor(trade: OpenTradeForStopSync, order: ActiveStopOrder): StopLossUpdate {
  return {
    tradeId: trade.id,
    symbol: normalizeSymbol(trade.symbol),
    stopPrice: order.stopPrice,
    orderId: order.orderId,
  }
}

/**
 * Match active IBKR stop orders to open trades without guessing when one symbol
 * has several independently managed positions.
 */
export function matchOpenStopsToTrades(
  trades: OpenTradeForStopSync[],
  orders: ActiveStopOrder[],
): { updates: StopLossUpdate[]; skipped: SkippedStopMatch[] } {
  const updates: StopLossUpdate[] = []
  const skipped: SkippedStopMatch[] = []
  const symbols = new Set(trades.map(trade => normalizeSymbol(trade.symbol)))

  for (const symbol of symbols) {
    const symbolTrades = trades.filter(trade => normalizeSymbol(trade.symbol) === symbol)

    for (const action of ['SELL', 'BUY']) {
      const sideTrades = symbolTrades.filter(trade => closingAction(trade.side) === action)
      if (sideTrades.length === 0) continue

      const sideOrders = orders.filter(order => (
        normalizeSymbol(order.symbol) === symbol
        && order.action.trim().toUpperCase() === action
      ))
      if (sideOrders.length === 0) continue

      if (sideTrades.length === 1 && allSameStop(sideOrders)) {
        updates.push(updateFor(sideTrades[0], sideOrders[0]))
        continue
      }

      if (sideTrades.length === 1) {
        skipped.push({ symbol, reason: 'Several stop prices apply to one open trade' })
        continue
      }

      const totalTradeShares = sideTrades.reduce((sum, trade) => sum + Math.abs(trade.shares ?? 0), 0)
      const totalOrderShares = sideOrders.reduce((sum, order) => sum + Math.abs(order.quantity), 0)
      if (
        totalTradeShares > 0
        && sameNumber(totalTradeShares, totalOrderShares)
        && allSameStop(sideOrders)
      ) {
        for (const trade of sideTrades) updates.push(updateFor(trade, sideOrders[0]))
        continue
      }

      const unmatchedTrades = new Set(sideTrades)
      const unmatchedOrders = new Set(sideOrders)

      for (const trade of sideTrades) {
        const shares = Math.abs(trade.shares ?? 0)
        if (shares <= 0) continue

        const matchingOrders = [...unmatchedOrders].filter(order => sameNumber(Math.abs(order.quantity), shares))
        const matchingTrades = [...unmatchedTrades].filter(candidate => sameNumber(Math.abs(candidate.shares ?? 0), shares))
        if (matchingOrders.length !== 1 || matchingTrades.length !== 1) continue

        const order = matchingOrders[0]
        updates.push(updateFor(trade, order))
        unmatchedTrades.delete(trade)
        unmatchedOrders.delete(order)
      }

      if (unmatchedTrades.size > 0) {
        skipped.push({
          symbol,
          reason: `${unmatchedTrades.size} open trade(s) could not be uniquely matched by quantity`,
        })
      }
    }
  }

  return { updates, skipped }
}
