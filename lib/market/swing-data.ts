export interface SwingCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export interface SwingDataLevel {
  key: string
  label: string
  value: number
  color: string
  lineStyle: 'solid' | 'dashed' | 'dotted'
  lineWidth: 1 | 2
}

export interface SwingDataSnapshot {
  sessionStart: number
  sessionEnd: number
  levels: SwingDataLevel[]
}

const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MARKET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function swingMarketDateKey(time: number) {
  return MARKET_DATE_FORMATTER.format(new Date(time * 1000))
}

function marketTimeSlot(time: number) {
  return MARKET_TIME_FORMATTER.format(new Date(time * 1000))
}

function sma(candles: SwingCandle[], endIndex: number, period: number) {
  if (endIndex < period - 1) return null
  let total = 0
  for (let index = endIndex - period + 1; index <= endIndex; index++) total += candles[index].close
  return total / period
}

function ema(candles: SwingCandle[], endIndex: number, period: number) {
  if (endIndex < period - 1) return null
  let value = candles.slice(0, period).reduce((total, candle) => total + candle.close, 0) / period
  const multiplier = 2 / (period + 1)
  for (let index = period; index <= endIndex; index++) {
    value = candles[index].close * multiplier + value * (1 - multiplier)
  }
  return value
}

function isNearSession(value: number, close: number, low: number, high: number) {
  const band = close * 0.03
  return value >= low && value <= high
    || Math.abs(value - close) <= band
    || Math.abs(value - low) <= band
    || Math.abs(value - high) <= band
}

/**
 * Mirrors the visible output of Swing Data Desktop/Replay for one intraday
 * session. Historical trades anchor to their entry day; live trades can pass
 * the latest session date.
 */
export function buildSwingDataSnapshot(
  intradayCandles: SwingCandle[],
  dailyCandles: SwingCandle[],
  anchorDateKey: string,
): SwingDataSnapshot | null {
  const session = intradayCandles.filter((candle) => swingMarketDateKey(candle.time) === anchorDateKey)
  if (session.length === 0) return null

  const contextCandles = [...dailyCandles]
  let dailyIndex = contextCandles.findIndex((candle) => swingMarketDateKey(candle.time) === anchorDateKey)
  if (dailyIndex < 0) {
    const volumeValues = session.map((candle) => candle.volume).filter((volume): volume is number => volume != null)
    contextCandles.push({
      time: session[0].time,
      open: session[0].open,
      high: Math.max(...session.map((candle) => candle.high)),
      low: Math.min(...session.map((candle) => candle.low)),
      close: session[session.length - 1].close,
      volume: volumeValues.length > 0 ? volumeValues.reduce((total, volume) => total + volume, 0) : null,
    })
    contextCandles.sort((a, b) => a.time - b.time)
    dailyIndex = contextCandles.findIndex((candle) => swingMarketDateKey(candle.time) === anchorDateKey)
  }

  const close = contextCandles[dailyIndex].close
  const sessionLow = Math.min(...session.map((candle) => candle.low))
  const sessionHigh = Math.max(...session.map((candle) => candle.high))
  const previousDay = contextCandles[dailyIndex - 1]
  const previousPreviousDay = contextCandles[dailyIndex - 2]
  const intervalSec = session.length > 1 ? session[1].time - session[0].time : Number.POSITIVE_INFINITY
  const supportsOpeningRanges = intervalSec <= 30 * 60
  const firstFiveMinutes = supportsOpeningRanges
    ? session.filter((candle) => marketTimeSlot(candle.time) >= '09:30' && marketTimeSlot(candle.time) < '09:35')
    : []
  const firstThirtyMinutes = supportsOpeningRanges
    ? session.filter((candle) => marketTimeSlot(candle.time) >= '09:30' && marketTimeSlot(candle.time) < '10:00')
    : []

  const values = {
    sma10: sma(contextCandles, dailyIndex, 10),
    sma20: sma(contextCandles, dailyIndex, 20),
    sma50: sma(contextCandles, dailyIndex, 50),
    sma150: sma(contextCandles, dailyIndex, 150),
    sma200: sma(contextCandles, dailyIndex, 200),
    ema10: ema(contextCandles, dailyIndex, 10),
    ema20: ema(contextCandles, dailyIndex, 20),
    ema50: ema(contextCandles, dailyIndex, 50),
  }

  const levels: SwingDataLevel[] = []
  const add = (level: SwingDataLevel | null) => {
    if (level && Number.isFinite(level.value) && isNearSession(level.value, close, sessionLow, sessionHigh)) levels.push(level)
  }

  add(values.sma10 == null ? null : { key: 'sma10', label: '10D SMA', value: values.sma10, color: '#ff9999', lineStyle: 'solid', lineWidth: 1 })
  add(values.sma20 == null ? null : { key: 'sma20', label: '20D SMA', value: values.sma20, color: '#ffb74d', lineStyle: 'solid', lineWidth: 1 })
  add(values.sma50 == null ? null : { key: 'sma50', label: '50D SMA', value: values.sma50, color: '#66b2ff', lineStyle: 'solid', lineWidth: 2 })
  add(values.sma150 == null ? null : { key: 'sma150', label: '150D SMA', value: values.sma150, color: '#be96ff', lineStyle: 'solid', lineWidth: 2 })
  add(values.sma200 == null ? null : { key: 'sma200', label: '200D SMA', value: values.sma200, color: '#800080', lineStyle: 'solid', lineWidth: 2 })

  const emaSkipGap = close * 0.003
  add(values.ema10 == null || values.sma10 != null && Math.abs(values.ema10 - values.sma10) <= emaSkipGap
    ? null : { key: 'ema10', label: '10D EMA', value: values.ema10, color: '#d32f2f', lineStyle: 'solid', lineWidth: 1 })
  add(values.ema20 == null || values.sma20 != null && Math.abs(values.ema20 - values.sma20) <= emaSkipGap
    ? null : { key: 'ema20', label: '20D EMA', value: values.ema20, color: '#ef6c00', lineStyle: 'solid', lineWidth: 1 })
  add(values.ema50 == null || values.sma50 != null && Math.abs(values.ema50 - values.sma50) <= emaSkipGap
    ? null : { key: 'ema50', label: '50D EMA', value: values.ema50, color: '#1565c0', lineStyle: 'solid', lineWidth: 1 })

  add(previousDay ? { key: 'pd-high', label: `PD High (${previousDay.high.toFixed(2)})`, value: previousDay.high, color: '#008000', lineStyle: 'dashed', lineWidth: 1 } : null)
  add(previousDay ? { key: 'pd-low', label: `PD Low (${previousDay.low.toFixed(2)})`, value: previousDay.low, color: '#800000', lineStyle: 'dashed', lineWidth: 1 } : null)
  if (previousDay && previousPreviousDay && previousPreviousDay.low < previousDay.low && (previousDay.low - previousPreviousDay.low) / previousDay.low < 0.03) {
    add({ key: 'ppd-low', label: `PPD Low (${previousPreviousDay.low.toFixed(2)})`, value: previousPreviousDay.low, color: '#800000', lineStyle: 'dashed', lineWidth: 1 })
  }

  levels.push({ key: 'today-low', label: `Today Low (${sessionLow.toFixed(2)})`, value: sessionLow, color: '#00897b', lineStyle: 'dashed', lineWidth: 1 })
  if (firstFiveMinutes.length > 0) {
    const value = Math.max(...firstFiveMinutes.map((candle) => candle.high))
    add({ key: 'or5', label: '5m', value, color: '#008080', lineStyle: 'dotted', lineWidth: 1 })
  }
  if (firstThirtyMinutes.length > 0) {
    const value = Math.max(...firstThirtyMinutes.map((candle) => candle.high))
    add({ key: 'or30', label: '30m', value, color: '#d000d0', lineStyle: 'dotted', lineWidth: 1 })
  }

  return {
    sessionStart: session[0].time,
    sessionEnd: session[session.length - 1].time,
    levels,
  }
}
