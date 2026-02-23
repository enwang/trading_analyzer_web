export interface Trade {
  id: string
  userId: string
  symbol: string
  entryTime: string | null        // ISO 8601 UTC string
  exitTime: string | null         // null for open positions
  side: 'long' | 'short' | null
  shares: number | null
  entryPrice: number | null
  exitPrice: number | null
  pnl: number | null
  pnlPct: number | null
  outcome: 'win' | 'loss' | 'breakeven' | 'open' | null
  holdDays: number | null
  holdTimeMin: number | null
  hourOfDay: number | null
  dayOfWeek: string | null
  rMultiple: number | null
  setupTag: string
  source: 'ibkr' | 'csv'
  createdAt: string
}

/** Row as returned by Supabase (snake_case) */
export interface TradeRow {
  id: string
  user_id: string
  symbol: string
  entry_time: string | null
  exit_time: string | null
  side: string | null
  shares: number | null
  entry_price: number | null
  exit_price: number | null
  pnl: number | null
  pnl_pct: number | null
  outcome: string | null
  hold_days: number | null
  hold_time_min: number | null
  hour_of_day: number | null
  day_of_week: string | null
  r_multiple: number | null
  setup_tag: string
  source: string
  created_at: string
}

export function rowToTrade(r: TradeRow): Trade {
  return {
    id: r.id,
    userId: r.user_id,
    symbol: r.symbol,
    entryTime: r.entry_time,
    exitTime: r.exit_time,
    side: r.side as Trade['side'],
    shares: r.shares,
    entryPrice: r.entry_price,
    exitPrice: r.exit_price,
    pnl: r.pnl,
    pnlPct: r.pnl_pct,
    outcome: r.outcome as Trade['outcome'],
    holdDays: r.hold_days,
    holdTimeMin: r.hold_time_min,
    hourOfDay: r.hour_of_day,
    dayOfWeek: r.day_of_week,
    rMultiple: r.r_multiple,
    setupTag: r.setup_tag ?? 'untagged',
    source: r.source as Trade['source'],
    createdAt: r.created_at,
  }
}

export interface SummaryStats {
  totalTrades: number
  nWins: number
  nLosses: number
  winRate: number
  netPnl: number
  grossProfit: number
  grossLoss: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  payoffRatio: number
  expectancy: number
  largestWin: number
  largestLoss: number
  maxDrawdown: number
  maxConsecWins: number
  maxConsecLosses: number
  avgHoldWinMin: number | null
  avgHoldLossMin: number | null
  dateRange: string
}

export interface EquityPoint {
  tradeNum: number
  entryTime: string | null
  symbol: string
  pnl: number
  cumulativePnl: number
  outcome: string
}

export interface GroupRow {
  group: string
  trades: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnl: number
  avgR: number | null
  profitFactor: number
}
