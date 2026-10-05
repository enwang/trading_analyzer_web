'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import type {
  IChartApi,
  UTCTimestamp,
  ISeriesApi,
  SeriesType,
} from 'lightweight-charts'
import type { ExecutionLeg } from '@/types/trade'
import { buildSwingDataSnapshot, swingMarketDateKey, tradeSwingAnchorDateKeys } from '@/lib/market/swing-data'
import {
  calculateIntradayRvol,
  calculateTradeChartLogicalRange,
  macdPeriodsForTimeframe,
} from '@/lib/market/chart-utils'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Props {
  symbol:      string
  entryTime:   string | null
  exitTime:    string | null
  side?:       'long' | 'short' | null
  entryPrice?: number | null
  exitPrice?:  number | null
  executionLegs?: ExecutionLeg[] | null
}

type Timeframe  = '5' | '60' | '1D' | '1W'
type ChartStyle = 'candles' | 'hollow' | 'bars' | 'line' | 'area'

interface Candle {
  time:   number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number | null
}

interface ChartMeta {
  entryTimeSec:  number | null
  exitTimeSec:   number | null
  visibleRange:  { from: number; to: number } | null
  interval:      string | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const QUICK_TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: '5',  label: '5m'  },
  { value: '60', label: '1h'  },
  { value: '1D', label: '1D'  },
  { value: '1W', label: 'W'   },
]

const TF_TO_BACKEND: Record<Timeframe, string> = {
  '5': '5m', '60': '1h', '1D': '1d', '1W': '1wk',
}
const CHART_STYLE_STORAGE_KEY = 'trade-chart-style-v2'
const TV_UP_COLOR = '#089981'
const TV_DOWN_COLOR = '#f23645'
const TV_VWAP_COLOR = '#787b86'
const TV_DOLLAR_UP_COLOR = 'rgba(38,166,154,0.55)'
const TV_DOLLAR_DOWN_COLOR = 'rgba(239,83,80,0.55)'
const TV_DOLLAR_MA_COLOR = '#ff6d00'
const MARKET_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getDefaultTimeframe(entryTime: string | null, _exitTime: string | null): Timeframe {
  if (!entryTime) return '1D'
  const entryMs = Date.parse(entryTime)
  if (!Number.isFinite(entryMs)) return '1D'
  return Date.now() - entryMs <= 55 * 86_400_000 ? '5' : '1D'
}

function intervalLabel(interval: string | null | undefined) {
  if (!interval) return null
  if (interval === '60m') return '1h'
  if (interval === '1wk') return 'W'
  return interval
}

function calcEMA(candles: Candle[], period: number): { time: number; value: number }[] {
  if (candles.length < period) return []
  const k = 2 / (period + 1)
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  const result = [{ time: candles[period - 1].time, value: ema }]
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k)
    result.push({ time: candles[i].time, value: ema })
  }
  return result
}

function calcSMA(candles: Candle[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = []
  if (candles.length === 0 || period <= 0) return result

  let rollingSum = 0
  for (let i = 0; i < candles.length; i++) {
    rollingSum += candles[i].close
    if (i >= period) {
      rollingSum -= candles[i - period].close
    }
    if (i >= period - 1) {
      result.push({ time: candles[i].time, value: rollingSum / period })
    }
  }
  return result
}

function calcDollarVolumeSMA(candles: Candle[], period: number): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = []
  if (candles.length === 0 || period <= 0) return result

  let rollingSum = 0
  for (let i = 0; i < candles.length; i++) {
    rollingSum += (candles[i].volume ?? 0) * candles[i].close
    if (i >= period) {
      rollingSum -= (candles[i - period].volume ?? 0) * candles[i - period].close
    }
    if (i >= period - 1) {
      result.push({ time: candles[i].time, value: rollingSum / period })
    }
  }
  return result
}

function formatCompactIndicator(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  return value.toFixed(2)
}

function getLatestDollarVolume(candles: Candle[] | null) {
  if (!candles) return null
  for (let index = candles.length - 1; index >= 0; index--) {
    const candle = candles[index]
    if ((candle.volume ?? 0) > 0) {
      return { candle, value: candle.volume! * candle.close }
    }
  }
  return null
}

function marketDateKey(time: number) {
  return MARKET_DATE_FORMATTER.format(new Date(time * 1000))
}

function calcSessionVWAP(candles: Candle[]) {
  let session = ''
  let cumulativePriceVolume = 0
  let cumulativeVolume = 0

  return candles.map((candle) => {
    const nextSession = marketDateKey(candle.time)
    if (nextSession !== session) {
      session = nextSession
      cumulativePriceVolume = 0
      cumulativeVolume = 0
    }
    const volume = candle.volume ?? 0
    cumulativePriceVolume += ((candle.high + candle.low + candle.close) / 3) * volume
    cumulativeVolume += volume
    return {
      time: candle.time,
      value: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : candle.close,
    }
  })
}

function emaValues(values: number[], period: number) {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (values.length < period) return result
  const multiplier = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  result[period - 1] = ema
  for (let index = period; index < values.length; index++) {
    ema = values[index] * multiplier + ema * (1 - multiplier)
    result[index] = ema
  }
  return result
}

function calcMACD(candles: Candle[], fastPeriod: number, slowPeriod: number, signalPeriod: number) {
  const closes = candles.map((candle) => candle.close)
  const fast = emaValues(closes, fastPeriod)
  const slow = emaValues(closes, slowPeriod)
  const macdValues = candles.map((_, index) => (
    fast[index] != null && slow[index] != null ? fast[index]! - slow[index]! : null
  ))
  const validMacd = macdValues.filter((value): value is number => value != null)
  const validSignal = emaValues(validMacd, signalPeriod)
  let signalIndex = 0

  return candles.flatMap((candle, index) => {
    const macd = macdValues[index]
    if (macd == null) return []
    const signal = validSignal[signalIndex++]
    if (signal == null) return []
    return [{ time: candle.time, macd, signal, histogram: macd - signal }]
  })
}

function formatTradeDate(entryTime: string | null, timeZone: string) {
  if (!entryTime) return ''
  const d = new Date(entryTime)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    timeZone,
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

function nearestCandleTimeSec(candles: Candle[], targetSec: number): number | null {
  // Each candle's `time` is the START of its bucket (e.g. 08:45 for a 08:45-08:50 5min bar).
  // A fill at 08:48 should attach to the 08:45 bar — floor to the latest candle whose
  // start time is <= target. Only when target precedes the first candle do we snap forward.
  if (!candles.length) return null
  if (targetSec < candles[0].time) return candles[0].time
  let lo = 0
  let hi = candles.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (candles[mid].time <= targetSec) lo = mid
    else hi = mid - 1
  }
  return candles[lo].time
}

function mergeLegsForMarkers(legs: ExecutionLeg[]) {
  const map = new Map<string, { timeSec: number; action: 'BUY' | 'SELL'; shares: number; weightedCost: number }>()
  for (const leg of legs) {
    const ms = Date.parse(leg.time)
    if (!Number.isFinite(ms)) continue
    const timeSec = Math.floor(ms / 1000)
    // Merge only exact-timestamp fills of the same side (same order burst),
    // but do not collapse different executions that merely happen in the same second.
    const key = `${ms}|${leg.action}`
    const current = map.get(key) ?? { timeSec, action: leg.action, shares: 0, weightedCost: 0 }
    current.shares += leg.shares
    current.weightedCost += leg.price * leg.shares
    map.set(key, current)
  }

  return Array.from(map.values())
    .map((x) => ({
      timeSec: x.timeSec,
      action: x.action,
      shares: x.shares,
      price: x.shares > 0 ? x.weightedCost / x.shares : 0,
    }))
    .sort((a, b) => a.timeSec - b.timeSec)
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TradeChart({ symbol, entryTime, exitTime, side, entryPrice, exitPrice, executionLegs }: Props) {
  const containerRef     = useRef<HTMLDivElement>(null)
  const ohlcOverlayRef   = useRef<HTMLDivElement>(null)
  const dollarVolumeValueRef = useRef<HTMLSpanElement>(null)
  const dollarVolumeMaValueRef = useRef<HTMLSpanElement>(null)
  const rvolValueRef = useRef<HTMLSpanElement>(null)
  const arrowsOverlayRef = useRef<HTMLDivElement>(null)
  const indicatorAxisRef = useRef<HTMLDivElement>(null)

  const [timeframe, setTimeframe] = useState<Timeframe>(() => getDefaultTimeframe(entryTime, exitTime))
  const [style,     setStyle]     = useState<ChartStyle>(() => {
    if (typeof window === 'undefined') return 'hollow'
    const raw = window.localStorage.getItem(CHART_STYLE_STORAGE_KEY)
    return raw === 'candles' || raw === 'hollow' || raw === 'bars' || raw === 'line' || raw === 'area'
      ? raw
      : 'hollow'
  })
  const [styleHydrated, setStyleHydrated] = useState(false)
  const [volumeOn,  setVolumeOn]  = useState(true)
  const [ema6On,    setEma6On]    = useState(true)
  const [ema10On,   setEma10On]   = useState(true)
  const [sma10On,   setSma10On]   = useState(true)
  const [ema20On,   setEma20On]   = useState(true)
  const [ema50On,   setEma50On]   = useState(true)
  const [ma200On,   setMa200On]   = useState(true)
  const [vwapOn,    setVwapOn]    = useState(true)
  const [macdOn,    setMacdOn]    = useState(true)
  const [rvolOn,    setRvolOn]    = useState(true)
  const [volumeMa20On, setVolumeMa20On] = useState(true)
  const [swingDataOn, setSwingDataOn] = useState(true)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [candles,   setCandles]   = useState<Candle[] | null>(null)
  const [dailyCandles, setDailyCandles] = useState<Candle[]>([])
  const [meta,      setMeta]      = useState<ChartMeta | null>(null)
  const [userTimeZone, setUserTimeZone] = useState('UTC')
  const intradayIndicatorsAvailable = timeframe === '5' || timeframe === '60'
  const macdPeriods = macdPeriodsForTimeframe(timeframe)

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) setUserTimeZone(tz)
  }, [])

  useEffect(() => {
    setStyleHydrated(true)
  }, [])

  useEffect(() => {
    if (!styleHydrated) return
    window.localStorage.setItem(CHART_STYLE_STORAGE_KEY, style)
  }, [style, styleHydrated])

  // Sync default timeframe when trade changes
  useEffect(() => {
    setTimeframe(getDefaultTimeframe(entryTime, exitTime))
  }, [entryTime, exitTime])

  // -------------------------------------------------------------------------
  // Effect 1 — fetch OHLCV data (only when symbol / timeframe / times change)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!symbol) return
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({ symbol, timeframe: TF_TO_BACKEND[timeframe] })
      if (entryTime) params.set('entryTime', entryTime)
      if (exitTime)  params.set('exitTime',  exitTime)

      try {
        const res = await fetch(`/api/market/trade-chart?${params}`)
        if (cancelled) return
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as {
          candles: Candle[]
          dailyCandles?: Candle[]
          interval?: string
          entryTimeSec: number | null
          exitTimeSec: number | null
          visibleRange: { from: number; to: number } | null
        }
        if (cancelled) return
        if (!data.candles?.length) {
          setError('No chart data available for this symbol / timeframe.')
          setCandles(null)
          return
        }
        setCandles(data.candles)
        setDailyCandles(data.dailyCandles ?? [])
        setMeta({
          entryTimeSec: data.entryTimeSec ?? null,
          exitTimeSec:  data.exitTimeSec  ?? null,
          visibleRange: data.visibleRange  ?? null,
          interval: data.interval ?? null,
        })
      } catch (e) {
        if (!cancelled) setError(`Failed to load chart data: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchData()
    return () => { cancelled = true }
  }, [symbol, timeframe, entryTime, exitTime])

  // -------------------------------------------------------------------------
  // Effect 2 — build / rebuild chart whenever data or display options change
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!candles || !meta || !containerRef.current) return

    const container = containerRef.current

    const chart: IChartApi = createChart(container, {
      width:  container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor:   '#374151',
        fontFamily:  'Inter, system-ui, sans-serif',
        fontSize:    12,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.04, bottom: 0.43 },
      },
      timeScale: {
        borderVisible:  false,
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    5,
        // X-axis ticks: render in the user's local timezone (lightweight-charts
        // defaults to UTC otherwise, so on 5min/1min the times don't match PST).
        tickMarkFormatter: (time: number, tickMarkType: number) => {
          const d = new Date(Number(time) * 1000)
          if (tickMarkType === 0) {
            return new Intl.DateTimeFormat('en-US', { timeZone: userTimeZone, year: 'numeric' }).format(d)
          }
          if (tickMarkType === 1) {
            return new Intl.DateTimeFormat('en-US', { timeZone: userTimeZone, month: 'short' }).format(d)
          }
          if (tickMarkType === 2) {
            const weekday = new Intl.DateTimeFormat('en-US', { timeZone: userTimeZone, weekday: 'short' }).format(d)
            const day = new Intl.DateTimeFormat('en-US', { timeZone: userTimeZone, day: 'numeric' }).format(d)
            return `${weekday} ${day}`
          }
          if (timeframe === '1D' || timeframe === '1W') return ''
          return new Intl.DateTimeFormat('en-US', {
            timeZone: userTimeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(d)
        },
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (time: number) => {
          const ms = Number(time) * 1000
          const d = new Date(ms)
          const datePart = new Intl.DateTimeFormat('en-US', {
            timeZone: userTimeZone,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: '2-digit',
          }).format(d)
          if (timeframe === '1D' || timeframe === '1W') return datePart
          const timePart = new Intl.DateTimeFormat('en-US', {
            timeZone: userTimeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(d)
          return `${datePart} ${timePart}`
        },
      },
    })

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      })
      requestAnimationFrame(() => renderArrows())
    })
    ro.observe(container)

    const ts = (t: number) => t as UTCTimestamp
    const dollarVolume = candles.map((candle) => ({
      time: candle.time,
      value: (candle.volume ?? 0) * candle.close,
    }))
    const dollarVolumeMa20 = calcDollarVolumeSMA(candles, 20)
    const rvol = intradayIndicatorsAvailable ? calculateIntradayRvol(candles) : []
    const dollarVolumeByTime = new Map(dollarVolume.map((point) => [point.time, point.value]))
    const dollarVolumeMaByTime = new Map(dollarVolumeMa20.map((point) => [point.time, point.value]))
    const rvolByTime = new Map(rvol.map((point) => [point.time, point.value]))
    const latestSessionDate = candles.length > 0 ? swingMarketDateKey(candles[candles.length - 1].time) : null
    const swingSnapshots = swingDataOn && (timeframe === '5' || timeframe === '60')
      ? tradeSwingAnchorDateKeys(entryTime, exitTime, latestSessionDate)
          .map((dateKey) => buildSwingDataSnapshot(candles, dailyCandles, dateKey))
          .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot != null)
      : []

    // --- Dollar volume (before main series so it sits behind) ---
    if (volumeOn) {
      const vol = chart.addHistogramSeries({
        priceFormat:  { type: 'volume' },
        priceScaleId: 'volume',
        priceLineVisible: false,
        lastValueVisible: false,
      })
      chart.priceScale('volume').applyOptions({
        visible: false,
        scaleMargins: { top: 0.61, bottom: 0.28 },
      })
      vol.setData(
        dollarVolume.map((point, index) => ({
          time:  ts(point.time),
          value: point.value,
          color: candles[index].close >= candles[index].open ? TV_DOLLAR_UP_COLOR : TV_DOLLAR_DOWN_COLOR,
        }))
      )

      if (volumeMa20On) {
        if (dollarVolumeMa20.length) {
          const s = chart.addLineSeries({
            color: TV_DOLLAR_MA_COLOR,
            lineWidth: 1,
            lineStyle: 0,
            priceScaleId: 'volume',
            priceLineVisible: false,
            lastValueVisible: false,
          })
          s.setData(
            dollarVolumeMa20.map((d) => ({
              time: ts(d.time),
              value: d.value,
            }))
          )
        }
      }
    }

    // --- MACD: Pine uses 8 / 21 / 5 intraday and 12 / 26 / 9 on day+ ---
    if (macdOn) {
      const macd = calcMACD(candles, macdPeriods.fast, macdPeriods.slow, macdPeriods.signal)
      if (macd.length) {
        const histogram = chart.addHistogramSeries({
          priceScaleId: 'macd',
          priceLineVisible: false,
          lastValueVisible: false,
          base: 0,
        })
        chart.priceScale('macd').applyOptions({
          visible: false,
          scaleMargins: { top: 0.76, bottom: 0.11 },
        })
        histogram.setData(macd.map((point, index) => {
          const previous = index > 0 ? macd[index - 1].histogram : point.histogram
          const color = point.histogram >= 0
            ? previous < point.histogram ? '#26a69a' : '#b2dfdb'
            : previous < point.histogram ? '#ffcdd2' : '#ff5252'
          return { time: ts(point.time), value: point.histogram, color }
        }))
        const macdLine = chart.addLineSeries({
          priceScaleId: 'macd',
          color: '#2962ff',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        macdLine.setData(macd.map((point) => ({ time: ts(point.time), value: point.macd })))
        const signalLine = chart.addLineSeries({
          priceScaleId: 'macd',
          color: '#ff6d00',
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        signalLine.setData(macd.map((point) => ({ time: ts(point.time), value: point.signal })))
      }
    }

    // --- Relative volume by matching intraday slot over the prior 5 sessions ---
    if (intradayIndicatorsAvailable && rvolOn) {
      if (rvol.length) {
        const rvolSeries = chart.addHistogramSeries({
          priceScaleId: 'rvol',
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
          priceLineVisible: false,
          lastValueVisible: false,
          base: 0,
        })
        chart.priceScale('rvol').applyOptions({
          visible: false,
          scaleMargins: { top: 0.92, bottom: 0.01 },
        })
        const candleByTime = new Map(candles.map((candle) => [candle.time, candle]))
        rvolSeries.setData(rvol.map((point) => {
          const candle = candleByTime.get(point.time)
          return {
            time: ts(point.time),
            value: point.value,
            color: candle && candle.close >= candle.open
              ? 'rgba(8,153,129,0.8)'
              : 'rgba(242,54,69,0.8)',
          }
        }))
      }
    }

    // --- Main price series ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let main: ISeriesApi<SeriesType>

    if (style === 'candles') {
      const s = chart.addCandlestickSeries({
        upColor:         TV_UP_COLOR,
        downColor:       TV_DOWN_COLOR,
        borderUpColor:   TV_UP_COLOR,
        borderDownColor: TV_DOWN_COLOR,
        wickUpColor:     TV_UP_COLOR,
        wickDownColor:   TV_DOWN_COLOR,
      })
      s.setData(candles.map(c => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
      main = s
    } else if (style === 'hollow') {
      // Hollow candles (TradingView convention):
      //   color  = green if close >= prevClose, red if close < prevClose
      //   body   = hollow (transparent) if close >= open, filled with color if close < open
      const s = chart.addCandlestickSeries({
        upColor:         'rgba(0,0,0,0)',
        downColor:       TV_DOWN_COLOR,
        borderUpColor:   TV_UP_COLOR,
        borderDownColor: TV_DOWN_COLOR,
        wickUpColor:     TV_UP_COLOR,
        wickDownColor:   TV_DOWN_COLOR,
      })
      s.setData(candles.map((c, i) => {
        const prevClose = i > 0 ? candles[i - 1].close : c.open
        const isGreen   = c.close >= prevClose
        const isHollow  = c.close >= c.open
        const color     = isGreen ? TV_UP_COLOR : TV_DOWN_COLOR
        return { time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close,
          color:       isHollow ? 'rgba(0,0,0,0)' : color,
          borderColor: color,
          wickColor:   color }
      }))
      main = s
    } else if (style === 'bars') {
      const s = chart.addBarSeries({ upColor: TV_UP_COLOR, downColor: TV_DOWN_COLOR })
      s.setData(candles.map(c => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
      main = s
    } else if (style === 'area') {
      const s = chart.addAreaSeries({
        lineColor:   '#3b82f6',
        topColor:    'rgba(59,130,246,0.2)',
        bottomColor: 'rgba(59,130,246,0)',
      })
      s.setData(candles.map(c => ({ time: ts(c.time), value: c.close })))
      main = s
    } else {
      const s = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 })
      s.setData(candles.map(c => ({ time: ts(c.time), value: c.close })))
      main = s
    }

    // --- Swing Data Desktop / Replay levels ---
    for (const snapshot of swingSnapshots) {
      for (const level of snapshot.levels) {
        const lineStyle = level.lineStyle === 'dashed'
          ? LineStyle.Dashed
          : level.lineStyle === 'dotted'
            ? LineStyle.Dotted
            : LineStyle.Solid
        const series = chart.addLineSeries({
          color: level.color,
          lineWidth: level.lineWidth,
          lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        series.setData([
          { time: ts(snapshot.sessionStart), value: level.value },
          { time: ts(snapshot.sessionEnd), value: level.value },
        ])
      }
    }

    // --- Moving Averages script: intraday EMA 6 / 10 / 20 / 50 + SMA 200 ---
    if (ema6On) {
      const data = calcEMA(candles, 6)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#f48fb1', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    if (ema10On) {
      const data = calcEMA(candles, 10)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#f23645', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    // Separate visible SMA 10 indicator.
    if (sma10On) {
      const data = calcSMA(candles, 10)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#ff9999', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    if (ema20On) {
      const data = calcEMA(candles, 20)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#ff9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    if (ema50On) {
      const data = calcEMA(candles, 50)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#2962ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    // --- Session VWAP ---
    if (intradayIndicatorsAvailable && vwapOn) {
      const data = calcSessionVWAP(candles)
      if (data.length) {
        const s = chart.addLineSeries({
          color: TV_VWAP_COLOR, lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
        })
        s.setData(data.map((point) => ({ time: ts(point.time), value: point.value })))
      }
    }

    // --- MA 200 ---
    if (ma200On) {
      const data = calcSMA(candles, 200)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#673ab7', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    // --- Execution arrows (HTML overlay, horizontal triangles pointing at exact price) ---
    type ArrowPoint = { timeSec: number; price: number; action: 'BUY' | 'SELL' }
    const arrowPoints: ArrowPoint[] = []

    if (executionLegs && executionLegs.length > 0) {
      const mergedLegs = mergeLegsForMarkers(executionLegs)
      for (const leg of mergedLegs) {
        const markerSec = nearestCandleTimeSec(candles, leg.timeSec)
        if (markerSec == null) continue
        arrowPoints.push({ timeSec: markerSec, price: leg.price, action: leg.action })
      }
    } else {
      const isShort = side === 'short'
      if (meta.entryTimeSec && entryPrice != null) {
        arrowPoints.push({
          timeSec: meta.entryTimeSec,
          price: entryPrice,
          action: isShort ? 'SELL' : 'BUY',
        })
      }
      if (meta.exitTimeSec && exitTime && exitPrice != null) {
        arrowPoints.push({
          timeSec: meta.exitTimeSec,
          price: exitPrice,
          action: isShort ? 'BUY' : 'SELL',
        })
      }
    }

    main.setMarkers([])

    const formatAxisCompact = (value: number) => {
      if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))}B`
      if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
      if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
      return String(Math.round(value))
    }

    const niceStep = (value: number) => {
      if (!(value > 0)) return 1
      const magnitude = 10 ** Math.floor(Math.log10(value))
      const normalized = value / magnitude
      if (normalized <= 1) return magnitude
      if (normalized <= 2) return 2 * magnitude
      if (normalized <= 5) return 5 * magnitude
      return 10 * magnitude
    }

    const renderIndicatorAxes = () => {
      const axis = indicatorAxisRef.current
      if (!axis) return
      axis.innerHTML = ''

      const visibleRange = chart.timeScale().getVisibleRange()
      const from = visibleRange ? Number(visibleRange.from) : Number.NEGATIVE_INFINITY
      const to = visibleRange ? Number(visibleRange.to) : Number.POSITIVE_INFINITY
      const addLabel = (text: string, yPercent: number) => {
        const label = document.createElement('span')
        label.textContent = text
        label.style.position = 'absolute'
        label.style.right = '8px'
        label.style.top = `${yPercent}%`
        label.style.transform = 'translateY(-50%)'
        label.style.color = '#4b5563'
        label.style.fontSize = '10px'
        label.style.fontVariantNumeric = 'tabular-nums'
        label.style.whiteSpace = 'nowrap'
        axis.appendChild(label)
      }

      if (volumeOn) {
        const visibleDollarVolume = dollarVolume
          .filter((point) => point.time >= from && point.time <= to)
          .map((point) => point.value)
        const maxValue = Math.max(0, ...visibleDollarVolume)
        const step = niceStep(maxValue / 3)
        const topValue = Math.max(step, Math.ceil(maxValue / step) * step)
        for (let value = 0; value <= topValue; value += step) {
          const y = 72.5 - (value / topValue) * 11.5
          addLabel(formatAxisCompact(value), y)
        }
      }

      if (intradayIndicatorsAvailable && rvolOn) {
        const visibleRvol = rvol
          .filter((point) => point.time >= from && point.time <= to)
          .map((point) => point.value)
        const maxValue = Math.max(0, ...visibleRvol)
        const topValue = Math.max(2, Math.ceil(maxValue))
        const step = topValue <= 4 ? 1 : niceStep(topValue / 3)
        for (let value = 0; value <= topValue; value += step) {
          const y = 98 - (value / topValue) * 6.5
          addLabel(value.toFixed(1), y)
        }
      }
    }

    const renderArrows = () => {
      const overlay = arrowsOverlayRef.current
      if (!overlay) return
      overlay.innerHTML = ''
      renderIndicatorAxes()

      if (timeframe === '5' || timeframe === '60') {
        let previousSession = marketDateKey(candles[0].time)
        for (const candle of candles.slice(1)) {
          const session = marketDateKey(candle.time)
          if (session === previousSession) continue
          previousSession = session
          const x = chart.timeScale().timeToCoordinate(ts(candle.time))
          if (x == null) continue
          const divider = document.createElement('div')
          divider.style.position = 'absolute'
          divider.style.left = `${x}px`
          divider.style.top = '15%'
          divider.style.bottom = '0'
          divider.style.borderLeft = '1px dashed rgba(148, 163, 184, 0.55)'
          overlay.appendChild(divider)
        }
      }

      for (const snapshot of swingSnapshots) {
        const baseX = chart.timeScale().timeToCoordinate(ts(snapshot.sessionEnd))
        if (baseX == null) continue
        const labels = snapshot.levels
          .flatMap((level) => {
            const coordinate = main.priceToCoordinate(level.value)
            return coordinate == null ? [] : [{ level, y: Number(coordinate) }]
          })
          .sort((a, b) => a.y - b.y)
        let previousY = Number.NEGATIVE_INFINITY
        let slot = 0
        for (const { level, y } of labels) {
          slot = y - previousY < 14 ? Math.min(slot + 1, 2) : 0
          previousY = y
          const label = document.createElement('div')
          label.textContent = level.label
          label.style.position = 'absolute'
          label.style.left = `${Math.max(4, Math.min(overlay.clientWidth - 96, baseX + 8 + slot * 34))}px`
          label.style.top = `${y - 8}px`
          label.style.whiteSpace = 'nowrap'
          label.style.color = level.color
          label.style.background = 'rgba(255,255,255,0.9)'
          label.style.fontSize = '10px'
          label.style.fontWeight = '600'
          label.style.padding = '1px 3px'
          overlay.appendChild(label)
        }
      }

      if (arrowPoints.length === 0) return

      for (const pt of arrowPoints) {
        const x = chart.timeScale().timeToCoordinate(ts(pt.timeSec))
        const y = main.priceToCoordinate(pt.price)
        if (x == null || y == null) continue

        const isBuy = pt.action === 'BUY'
        const color = isBuy ? '#16a34a' : '#dc2626'

        // Wrapper enables pointer events for hover; bigger hit area than the triangle itself.
        const wrapper = document.createElement('div')
        wrapper.style.position = 'absolute'
        wrapper.style.pointerEvents = 'auto'
        wrapper.style.cursor = 'default'
        wrapper.style.width = '24px'
        wrapper.style.height = '20px'
        wrapper.style.top = `${y - 10}px`
        wrapper.style.left = `${isBuy ? x - 18 : x - 6}px`

        const triangle = document.createElement('div')
        triangle.style.position = 'absolute'
        triangle.style.width = '0'
        triangle.style.height = '0'
        triangle.style.borderTop = '7px solid transparent'
        triangle.style.borderBottom = '7px solid transparent'
        triangle.style.filter = 'drop-shadow(0 0 1px rgba(255,255,255,0.95))'
        triangle.style.top = '3px'
        if (isBuy) {
          triangle.style.borderLeft = `12px solid ${color}`
          triangle.style.left = '6px'
        } else {
          triangle.style.borderRight = `12px solid ${color}`
          triangle.style.left = '6px'
        }
        wrapper.appendChild(triangle)

        const label = document.createElement('span')
        label.textContent = `$${pt.price.toFixed(2)}`
        label.style.position = 'absolute'
        label.style.whiteSpace = 'nowrap'
        label.style.padding = '2px 6px'
        label.style.borderRadius = '4px'
        label.style.fontSize = '11px'
        label.style.fontWeight = '600'
        label.style.fontVariantNumeric = 'tabular-nums'
        label.style.color = '#ffffff'
        label.style.background = color
        label.style.boxShadow = '0 1px 3px rgba(0,0,0,0.25)'
        label.style.top = '-2px'
        label.style.opacity = '0'
        label.style.transition = 'opacity 120ms ease'
        label.style.pointerEvents = 'none'
        // Position label to the side the arrow points away from, so the tip stays visible.
        if (isBuy) {
          label.style.right = 'calc(100% + 4px)'
        } else {
          label.style.left = 'calc(100% + 4px)'
        }
        wrapper.appendChild(label)

        wrapper.addEventListener('mouseenter', () => { label.style.opacity = '1' })
        wrapper.addEventListener('mouseleave', () => { label.style.opacity = '0' })

        overlay.appendChild(wrapper)
      }
    }

    const applyAdaptiveMarkers = renderArrows

    // --- OHLC overlay on crosshair move ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCrosshair = (param: any) => {
      const overlay = ohlcOverlayRef.current
      if (!overlay) return
      if (!param.time) {
        overlay.style.opacity = '0'
        const latestDollarVolume = getLatestDollarVolume(candles)
        const lastCandle = latestDollarVolume?.candle ?? candles[candles.length - 1]
        if (dollarVolumeValueRef.current) {
          dollarVolumeValueRef.current.textContent = formatCompactIndicator(latestDollarVolume?.value)
          dollarVolumeValueRef.current.style.color = lastCandle.close >= lastCandle.open ? TV_DOLLAR_UP_COLOR : TV_DOLLAR_DOWN_COLOR
        }
        if (dollarVolumeMaValueRef.current) {
          dollarVolumeMaValueRef.current.textContent = formatCompactIndicator(dollarVolumeMa20.at(-1)?.value)
        }
        if (rvolValueRef.current) {
          const latestRvol = rvol.at(-1)?.value
          rvolValueRef.current.textContent = latestRvol != null ? `${Math.round(latestRvol * 100)}%` : '—'
          rvolValueRef.current.style.color = latestRvol != null && latestRvol > 0.5 ? '#008080' : TV_DOWN_COLOR
        }
        return
      }
      const idx = candles.findIndex((c) => c.time === Number(param.time))
      const candle = idx >= 0 ? candles[idx] : null
      if (!candle) {
        overlay.style.opacity = '0'
        return
      }
      const time = Number(param.time)
      if (dollarVolumeValueRef.current) {
        dollarVolumeValueRef.current.textContent = formatCompactIndicator(dollarVolumeByTime.get(time))
        dollarVolumeValueRef.current.style.color = candle.close >= candle.open ? TV_DOLLAR_UP_COLOR : TV_DOLLAR_DOWN_COLOR
      }
      if (dollarVolumeMaValueRef.current) {
        dollarVolumeMaValueRef.current.textContent = formatCompactIndicator(dollarVolumeMaByTime.get(time))
      }
      if (rvolValueRef.current) {
        const rvolValue = rvolByTime.get(time)
        rvolValueRef.current.textContent = rvolValue != null ? `${Math.round(rvolValue * 100)}%` : '—'
        rvolValueRef.current.style.color = rvolValue != null && rvolValue > 0.5 ? '#008080' : TV_DOWN_COLOR
      }
      const prevClose = idx > 0 ? candles[idx - 1].close : null
      const base = prevClose ?? candle.open
      const isUp = candle.close >= base
      const change = candle.close - base
      const changePct = base > 0 ? (change / base) * 100 : 0
      const fmtVol = (v: number) =>
        v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
        : v >= 1_000   ? `${(v / 1_000).toFixed(0)}K`
        : String(v)
      const color = isUp ? '#16a34a' : '#dc2626'
      overlay.innerHTML = [
        `O&nbsp;<b>${candle.open.toFixed(2)}</b>`,
        `H&nbsp;<b>${candle.high.toFixed(2)}</b>`,
        `L&nbsp;<b>${candle.low.toFixed(2)}</b>`,
        `C&nbsp;<b style="color:${color}">${candle.close.toFixed(2)}</b>`,
        `<span style="color:${color}">${change >= 0 ? '+' : ''}${change.toFixed(2)}&nbsp;(${changePct.toFixed(2)}%)</span>`,
        candle.volume != null ? `Vol&nbsp;<b>${fmtVol(candle.volume)}</b>` : '',
      ].filter(Boolean).join('<span style="opacity:.35">&nbsp;│&nbsp;</span>')
      overlay.style.opacity = '1'
    }
    chart.subscribeCrosshairMove(handleCrosshair)

    // --- Visible range ---
    const logicalRange = timeframe === '5'
      ? calculateTradeChartLogicalRange(candles, meta.entryTimeSec, meta.exitTimeSec)
      : null
    if (logicalRange) {
      chart.timeScale().setVisibleLogicalRange(logicalRange)
    } else if (meta.visibleRange) {
      try {
        chart.timeScale().setVisibleRange({
          from: ts(meta.visibleRange.from),
          to:   ts(meta.visibleRange.to),
        })
      } catch {
        chart.timeScale().fitContent()
      }
    } else {
      chart.timeScale().fitContent()
    }

    applyAdaptiveMarkers()

    // Re-render arrows on every chart range change. We listen to BOTH the
    // logical-range and time-range subscriptions because each fires at slightly
    // different moments during smooth pan/zoom; missing either causes the HTML
    // arrows to drift relative to the redrawn candles.
    let pendingFrame = 0
    const scheduleRerender = () => {
      if (pendingFrame) return
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0
        renderArrows()
      })
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleRerender)
    chart.timeScale().subscribeVisibleTimeRangeChange(scheduleRerender)
    // Wheel + drag interactions: re-render continuously while the user is
    // actively manipulating the chart so arrows track the candles frame-for-frame.
    let interactionLoop = 0
    const startInteractionLoop = () => {
      if (interactionLoop) return
      const tick = () => {
        renderArrows()
        interactionLoop = requestAnimationFrame(tick)
      }
      interactionLoop = requestAnimationFrame(tick)
      const stop = () => {
        if (interactionLoop) cancelAnimationFrame(interactionLoop)
        interactionLoop = 0
        renderArrows()
        window.removeEventListener('mouseup', stop)
      }
      window.addEventListener('mouseup', stop)
    }
    container.addEventListener('mousedown', startInteractionLoop)
    const wheelHandler = () => scheduleRerender()
    container.addEventListener('wheel', wheelHandler, { passive: true })

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair)
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleRerender)
      chart.timeScale().unsubscribeVisibleTimeRangeChange(scheduleRerender)
      container.removeEventListener('mousedown', startInteractionLoop)
      container.removeEventListener('wheel', wheelHandler)
      if (pendingFrame) cancelAnimationFrame(pendingFrame)
      if (interactionLoop) cancelAnimationFrame(interactionLoop)
      ro.disconnect()
      chart.remove()
    }
  }, [
    candles,
    dailyCandles,
    meta,
    style,
    volumeOn,
    volumeMa20On,
    macdOn,
    rvolOn,
    vwapOn,
    ema6On,
    ema10On,
    sma10On,
    ema20On,
    ema50On,
    ma200On,
    swingDataOn,
    side,
    entryPrice,
    exitPrice,
    executionLegs,
    entryTime,
    exitTime,
    intradayIndicatorsAvailable,
    macdPeriods.fast,
    macdPeriods.slow,
    macdPeriods.signal,
    userTimeZone,
  ])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const latestDollarVolume = getLatestDollarVolume(candles)
  const latestDollarVolumeMa = candles ? calcDollarVolumeSMA(candles, 20).at(-1)?.value : null
  const latestRvol = candles && intradayIndicatorsAvailable
    ? calculateIntradayRvol(candles).at(-1)?.value
    : null

  return (
    <div className="rounded-xl border border-[#d9dce3] bg-[#f4f5f8] p-2.5">
      <div className="overflow-hidden rounded-lg border border-[#d8dce5] bg-white">

        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-[#e6e9ef] px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-[#23262d]">{symbol}</span>
            <span className="text-xs text-[#6f7687]">{formatTradeDate(entryTime, userTimeZone)}</span>
            {entryPrice != null && (
              <span className="text-xs text-[#6f7687]">
                Entry: <span className="font-medium text-emerald-600">${entryPrice.toFixed(2)}</span>
              </span>
            )}
            {exitPrice != null && exitTime && (
              <span className="text-xs text-[#6f7687]">
                Exit: <span className="font-medium text-red-500">${exitPrice.toFixed(2)}</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
              <SelectTrigger size="sm" className="h-8 w-[84px] border-[#d7dbe5] text-xs">
                <SelectValue placeholder="TF" />
              </SelectTrigger>
              <SelectContent>
                {QUICK_TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf.value} value={tf.value}>{tf.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={style} onValueChange={(v) => setStyle(v as ChartStyle)}>
              <SelectTrigger size="sm" className="h-8 w-[100px] border-[#d7dbe5] text-xs">
                <SelectValue placeholder="Style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="candles">Candles</SelectItem>
                <SelectItem value="hollow">Hollow</SelectItem>
                <SelectItem value="bars">Bars</SelectItem>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="area">Area</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Indicator toggles */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e6e9ef] px-3 py-1.5">
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              ema6On
                ? 'border-[#f48fb1] bg-[#fff0f5] text-[#b05c79] hover:bg-[#ffe2ec]'
                : 'text-[#b05c79]'
            }`}
            variant="outline"
            onClick={() => setEma6On(v => !v)}
          >
            EMA 6
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              ema10On
                ? 'border-[#f23645] bg-[#fdecee] text-[#b71c2a] hover:bg-[#fbd9dc]'
                : 'text-[#b71c2a]'
            }`}
            variant="outline"
            onClick={() => setEma10On(v => !v)}
          >
            EMA 10
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              sma10On
                ? 'border-[#ff9999] bg-[#fff1f1] text-[#c85f5f] hover:bg-[#ffe2e2]'
                : 'text-[#c85f5f]'
            }`}
            variant="outline"
            onClick={() => setSma10On(v => !v)}
          >
            SMA 10
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              ema20On
                ? 'border-[#ff9800] bg-[#fff3e0] text-[#b86600] hover:bg-[#ffe5bd]'
                : 'text-[#c45a00]'
            }`}
            variant="outline"
            onClick={() => setEma20On(v => !v)}
          >
            EMA 20
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              ema50On
                ? 'border-[#2962ff] bg-[#edf1ff] text-[#1745c4] hover:bg-[#dce4ff]'
                : 'text-[#0d4f9b]'
            }`}
            variant="outline"
            onClick={() => setEma50On(v => !v)}
          >
            EMA 50
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              ma200On
                ? 'border-[#673ab7] bg-[#f2edfa] text-[#553098] hover:bg-[#e6dcf6]'
                : 'text-[#553098]'
            }`}
            variant="outline"
            onClick={() => setMa200On(v => !v)}
          >
            SMA 200
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              swingDataOn
                ? 'border-[#00897b] bg-[#e9f7f5] text-[#007268] hover:bg-[#d4efeb]'
                : 'text-[#007268]'
            }`}
            variant="outline"
            onClick={() => setSwingDataOn(value => !value)}
          >
            Swing Data
          </Button>
          {intradayIndicatorsAvailable && (
            <Button
              size="xs"
              className={`h-7 text-[11px] ${
                vwapOn
                  ? 'border-[#787b86] bg-[#f4f4f5] text-[#5d606b] hover:bg-[#e7e8ea]'
                  : 'text-[#5d606b]'
              }`}
              variant="outline"
              onClick={() => setVwapOn(v => !v)}
            >
              VWAP
            </Button>
          )}
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              volumeOn
                ? 'border-[#14b8a6] bg-[#f0fdfa] text-[#0f766e] hover:bg-[#ccfbf1]'
                : 'text-[#0f766e]'
            }`}
            variant="outline"
            onClick={() => setVolumeOn(v => !v)}
          >
            Dollar Vol
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              volumeMa20On
                ? 'border-[#f97316] bg-[#fff7ed] text-[#ea580c] hover:bg-[#ffedd5]'
                : 'text-[#ea580c]'
            }`}
            variant="outline"
            onClick={() => setVolumeMa20On(v => !v)}
          >
            DV MA20
          </Button>
          <Button
            size="xs"
            className={`h-7 text-[11px] ${
              macdOn
                ? 'border-[#3b82f6] bg-[#eff6ff] text-[#2563eb] hover:bg-[#dbeafe]'
                : 'text-[#2563eb]'
            }`}
            variant="outline"
            onClick={() => setMacdOn(v => !v)}
          >
            MACD
          </Button>
          {intradayIndicatorsAvailable && (
            <Button
              size="xs"
              className={`h-7 text-[11px] ${
                rvolOn
                  ? 'border-[#16a34a] bg-[#f0fdf4] text-[#15803d] hover:bg-[#dcfce7]'
                  : 'text-[#15803d]'
              }`}
              variant="outline"
              onClick={() => setRvolOn(v => !v)}
            >
              RVOL 5D
            </Button>
          )}
          {loading && (
            <span className="ml-2 text-[11px] text-[#7b8291]">Loading…</span>
          )}
        </div>

        {/* Chart area */}
        <div className="relative h-[720px]">
          {/* Chart container — always mounted so the ref stays valid */}
          <div
            ref={containerRef}
            className={`h-full w-full ${(loading || !candles) && !error ? 'invisible' : ''}`}
          />

          {/* Execution-arrow and Swing Data label overlay. */}
          <div
            ref={arrowsOverlayRef}
            className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
          />

          {/* TradingView-style pane labels and separators. */}
          <div className="pointer-events-none absolute inset-0 z-[4] text-[10px] font-medium text-[#667085]">
                {volumeOn && (
                  <>
                    <div className="absolute left-0 right-0 top-[59%] border-t border-[#e6e9ef]" />
                    <div className="absolute left-2 top-[60%] flex items-center gap-1.5">
                      <span>Dollar Vol</span>
                      <span>20</span>
                      <span
                        ref={dollarVolumeValueRef}
                        style={{
                          color: latestDollarVolume && latestDollarVolume.candle.close >= latestDollarVolume.candle.open
                            ? TV_DOLLAR_UP_COLOR
                            : TV_DOLLAR_DOWN_COLOR,
                        }}
                      >
                        {formatCompactIndicator(latestDollarVolume?.value)}
                      </span>
                      <span ref={dollarVolumeMaValueRef} style={{ color: TV_DOLLAR_MA_COLOR }}>
                        {formatCompactIndicator(latestDollarVolumeMa)}
                      </span>
                    </div>
                  </>
                )}
                {macdOn && (
                  <>
                    <div className="absolute left-0 right-0 top-[74%] border-t border-[#e6e9ef]" />
                    <span className="absolute left-2 top-[75%]">
                      MACD {macdPeriods.fast} {macdPeriods.slow} {macdPeriods.signal}
                    </span>
                  </>
                )}
                {intradayIndicatorsAvailable && rvolOn && (
                  <>
                    <div className="absolute left-0 right-0 top-[90%] border-t border-[#e6e9ef]" />
                    <div className="absolute left-2 top-[91%] flex items-center gap-1.5">
                      <span>RVOL</span>
                      <span>5</span>
                      <span>0</span>
                      <span
                        ref={rvolValueRef}
                        style={{ color: latestRvol != null && latestRvol > 0.5 ? '#008080' : TV_DOWN_COLOR }}
                      >
                        {latestRvol != null ? `${Math.round(latestRvol * 100)}%` : '—'}
                      </span>
                      <span className="text-[#787b86]">0.00</span>
                    </div>
                  </>
                )}
          </div>
          <div
            className="pointer-events-none absolute bottom-0 right-0 top-[59%] z-[3] w-[72px] bg-white"
            aria-hidden="true"
          />
          <div
            ref={indicatorAxisRef}
            className="pointer-events-none absolute inset-0 z-[6]"
            aria-hidden="true"
          />
          {/* OHLC crosshair overlay — updated directly via DOM to avoid re-renders */}
          <div
            ref={ohlcOverlayRef}
            className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded bg-white/85 px-2 py-1 text-[11px] text-[#374151] opacity-0 shadow-sm backdrop-blur-sm transition-opacity"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          />

          {/* Loading overlay */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              Loading chart data…
            </div>
          )}

          {/* Error overlay */}
          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center px-8">
              <div className="max-w-sm rounded-md bg-amber-50 p-4 text-center text-sm text-amber-700">
                {error}
              </div>
            </div>
          )}
        </div>

        {/* Bottom quick-timeframe strip */}
        <div className="flex items-center justify-between border-t border-[#e6e9ef] px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1">
            {QUICK_TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                className={`rounded px-2 py-1 ${
                  timeframe === tf.value
                    ? 'bg-[#eceff5] font-medium text-[#252932]'
                    : 'text-[#656d7e] hover:bg-[#f4f6fa]'
                }`}
                onClick={() => setTimeframe(tf.value)}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <div className="text-[#7a8190]">
            {(() => {
              const actual = intervalLabel(meta?.interval)
              const requested = intervalLabel(TF_TO_BACKEND[timeframe])
              return actual && requested && actual !== requested
                ? `Showing ${actual} · ${userTimeZone}`
                : userTimeZone
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
