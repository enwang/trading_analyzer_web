export type ActiveStopOrder = {
  orderId: number
  symbol: string
  action: string
  quantity: number
  orderType: string
  stopPrice: number
  status?: string
  fillPrice?: number | null
}

export type OpenTradeForStopSync = {
  id: string
  symbol: string
  side: string | null
  shares: number | null
  entry_time: string | null
  entry_price?: number | null
  stop_loss?: number | null
  current_stop_loss: number | null
  initial_risk_amount?: number | null
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

export type StopSyncDatabaseUpdate = {
  current_stop_loss: number
  stop_loss?: number
  stop_loss_locked?: true
  initial_risk_amount?: number
}

export type ClosedTradeForStopSync = OpenTradeForStopSync & {
  exit_time: string | null
  exit_price: number | null
}

export type InitialStopLossUpdate = StopLossUpdate

const EPSILON = 0.000001

function sameNumber(a: number, b: number) {
  return Math.abs(a - b) < EPSILON
}

function normalizeSymbol(symbol: string) {
  const lookalikes: Record<string, string> = {
    'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H',
    'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y',
  }

  return symbol
    .trim()
    .toUpperCase()
    .replace(/[•|\s]/g, '')
    .replace(/[АВЕКМНОРСТХУ]/g, character => lookalikes[character])
}

function oneCharacterApart(left: string, right: string) {
  if (left.length !== right.length) return false
  let differences = 0
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) differences += 1
    if (differences > 1) return false
  }
  return differences === 1
}

function closingAction(side: string | null) {
  if (side === 'long') return 'SELL'
  if (side === 'short') return 'BUY'
  return null
}

/** Repair a one-character OCR error only when trade direction and quantity identify one symbol. */
export function reconcileStopOrderSymbols<T extends ActiveStopOrder>(
  orders: T[],
  trades: OpenTradeForStopSync[],
): T[] {
  const knownSymbols = new Set(trades.map(trade => normalizeSymbol(trade.symbol)))

  return orders.map(order => {
    const orderSymbol = normalizeSymbol(order.symbol)
    if (knownSymbols.has(orderSymbol)) {
      return orderSymbol === order.symbol ? order : { ...order, symbol: orderSymbol }
    }

    const candidates = [...new Set(trades
      .filter(trade => (
        closingAction(trade.side) === order.action.trim().toUpperCase()
        && sameNumber(Math.abs(trade.shares ?? 0), Math.abs(order.quantity))
        && oneCharacterApart(orderSymbol, normalizeSymbol(trade.symbol))
      ))
      .map(trade => normalizeSymbol(trade.symbol)))]

    return candidates.length === 1 ? { ...order, symbol: candidates[0] } : order
  })
}

export function buildStopSyncDatabaseUpdate(
  trade: OpenTradeForStopSync,
  stopPrice: number,
): StopSyncDatabaseUpdate {
  const payload: StopSyncDatabaseUpdate = { current_stop_loss: stopPrice }
  if (trade.stop_loss != null) return payload

  payload.stop_loss = stopPrice
  payload.stop_loss_locked = true

  if (trade.initial_risk_amount == null && trade.entry_price != null && trade.shares != null) {
    const riskPerShare = trade.side === 'long'
      ? trade.entry_price - stopPrice
      : trade.side === 'short'
        ? stopPrice - trade.entry_price
        : null
    const initialRisk = riskPerShare == null ? null : riskPerShare * Math.abs(trade.shares)
    if (initialRisk != null && Number.isFinite(initialRisk) && initialRisk > 0) {
      payload.initial_risk_amount = initialRisk
    }
  }

  return payload
}

export function buildInitialStopSyncDatabaseUpdate(
  trade: ClosedTradeForStopSync,
  stopPrice: number,
): Omit<StopSyncDatabaseUpdate, 'current_stop_loss'> {
  const payload: Omit<StopSyncDatabaseUpdate, 'current_stop_loss'> = {
    stop_loss: stopPrice,
    stop_loss_locked: true,
  }

  if (trade.initial_risk_amount == null && trade.entry_price != null && trade.shares != null) {
    const riskPerShare = trade.side === 'long'
      ? trade.entry_price - stopPrice
      : trade.side === 'short'
        ? stopPrice - trade.entry_price
        : null
    const initialRisk = riskPerShare == null ? null : riskPerShare * Math.abs(trade.shares)
    if (initialRisk != null && Number.isFinite(initialRisk) && initialRisk > 0) {
      payload.initial_risk_amount = initialRisk
    }
  }

  return payload
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
      if (sideOrders.length === 0) {
        skipped.push({ symbol, reason: `No matching ${action} stop order was read` })
        continue
      }

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
        if (trade.current_stop_loss == null) continue

        const matchingOrders = [...unmatchedOrders].filter(order => (
          sameNumber(order.stopPrice, trade.current_stop_loss as number)
        ))
        const matchingTrades = [...unmatchedTrades].filter(candidate => (
          candidate.current_stop_loss != null
          && sameNumber(candidate.current_stop_loss, trade.current_stop_loss as number)
        ))
        if (matchingOrders.length !== 1 || matchingTrades.length !== 1) continue

        const order = matchingOrders[0]
        updates.push(updateFor(trade, order))
        unmatchedTrades.delete(trade)
        unmatchedOrders.delete(order)
      }

      for (const trade of sideTrades) {
        if (!unmatchedTrades.has(trade)) continue
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

/** Match filled stop orders to same-day closed trades without overwriting Initial SL. */
export function matchFilledStopsToClosedTrades(
  trades: ClosedTradeForStopSync[],
  orders: ActiveStopOrder[],
): { updates: InitialStopLossUpdate[]; skipped: SkippedStopMatch[] } {
  const updates: InitialStopLossUpdate[] = []
  const skipped: SkippedStopMatch[] = []
  const unmatchedTrades = new Set(trades.filter(trade => trade.stop_loss == null))
  const filledStops = orders.filter(order => order.status?.trim().toUpperCase() === 'FILLED')

  for (const order of filledStops) {
    const symbol = normalizeSymbol(order.symbol)
    const candidates = [...unmatchedTrades].filter(trade => (
      normalizeSymbol(trade.symbol) === symbol
      && closingAction(trade.side) === order.action.trim().toUpperCase()
      && sameNumber(Math.abs(trade.shares ?? 0), Math.abs(order.quantity))
    ))
    const hasUsableFillPrice = order.fillPrice != null && order.fillPrice > 0
    const priceMatches = !hasUsableFillPrice
      ? []
      : candidates.filter(trade => (
          trade.exit_price != null && Math.abs(trade.exit_price - order.fillPrice!) <= 0.05
        ))
    const matches = hasUsableFillPrice ? priceMatches : candidates

    if (matches.length !== 1) {
      if (candidates.length > 0) {
        skipped.push({ symbol, reason: 'Filled stop could not be uniquely matched by quantity and exit price' })
      }
      continue
    }

    const trade = matches[0]
    updates.push(updateFor(trade, order))
    unmatchedTrades.delete(trade)
  }

  return { updates, skipped }
}
