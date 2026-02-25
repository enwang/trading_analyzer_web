'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
} from 'lightweight-charts'
import type {
  IChartApi,
  UTCTimestamp,
  SeriesMarker,
  ISeriesApi,
  SeriesType,
} from 'lightweight-charts'

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
}

type Timeframe  = '1' | '5' | '15' | '30' | '60' | '1D'
type ChartStyle = 'candles' | 'bars' | 'line' | 'area'

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
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const QUICK_TIMEFRAMES: Array<{ value: Timeframe; label: string }> = [
  { value: '1',  label: '1m'  },
  { value: '5',  label: '5m'  },
  { value: '15', label: '15m' },
  { value: '30', label: '30m' },
  { value: '60', label: '1h'  },
  { value: '1D', label: '1D'  },
]

const TF_TO_BACKEND: Record<Timeframe, string> = {
  '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', '1D': '1d',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getDefaultTimeframe(entryTime: string | null, exitTime: string | null): Timeframe {
  if (!entryTime || !exitTime) return '15'
  const diffMin = (Date.parse(exitTime) - Date.parse(entryTime)) / 60_000
  if (Number.isNaN(diffMin) || diffMin <= 0) return '15'
  if (diffMin <=  90) return '5'
  if (diffMin <=  8 * 60) return '15'
  if (diffMin <= 24 * 60) return '30'
  if (diffMin <=  3 * 24 * 60) return '60'
  return '1D'
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
  for (let i = period - 1; i < candles.length; i++) {
    const avg = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.close, 0) / period
    result.push({ time: candles[i].time, value: avg })
  }
  return result
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function TradeChart({ symbol, entryTime, exitTime, side, entryPrice, exitPrice }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const [topTab,    setTopTab]    = useState<'chart' | 'notes' | 'running'>('chart')
  const [timeframe, setTimeframe] = useState<Timeframe>(() => getDefaultTimeframe(entryTime, exitTime))
  const [style,     setStyle]     = useState<ChartStyle>('candles')
  const [volumeOn,  setVolumeOn]  = useState(true)
  const [ema9On,    setEma9On]    = useState(true)
  const [ma20On,    setMa20On]    = useState(true)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [candles,   setCandles]   = useState<Candle[] | null>(null)
  const [meta,      setMeta]      = useState<ChartMeta | null>(null)
  const [userTimeZone, setUserTimeZone] = useState('UTC')

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) setUserTimeZone(tz)
  }, [])

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
        setMeta({
          entryTimeSec: data.entryTimeSec ?? null,
          exitTimeSec:  data.exitTimeSec  ?? null,
          visibleRange: data.visibleRange  ?? null,
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
    if (!candles || !meta || !containerRef.current || topTab !== 'chart') return

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
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#e5e7eb' },
      timeScale: {
        borderColor:    '#e5e7eb',
        timeVisible:    true,
        secondsVisible: false,
        rightOffset:    5,
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (time: number) => {
          const ms = Number(time) * 1000
          return new Intl.DateTimeFormat('en-US', {
            timeZone: userTimeZone,
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).format(new Date(ms))
        },
      },
    })

    const ro = new ResizeObserver(() => {
      chart.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      })
    })
    ro.observe(container)

    const ts = (t: number) => t as UTCTimestamp

    // --- Volume (before main series so it sits behind) ---
    if (volumeOn) {
      const vol = chart.addHistogramSeries({
        priceFormat:  { type: 'volume' },
        priceScaleId: 'volume',
      })
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } })
      vol.setData(
        candles.map(c => ({
          time:  ts(c.time),
          value: c.volume ?? 0,
          color: c.close >= c.open ? 'rgba(22,163,74,0.4)' : 'rgba(220,38,38,0.4)',
        }))
      )
    }

    // --- Main price series ---
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let main: ISeriesApi<SeriesType>

    if (style === 'candles') {
      const s = chart.addCandlestickSeries({
        upColor:          '#22c55e',
        downColor:        '#ef4444',
        borderUpColor:    '#22c55e',
        borderDownColor:  '#ef4444',
        wickUpColor:      '#22c55e',
        wickDownColor:    '#ef4444',
      })
      s.setData(candles.map(c => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })))
      main = s
    } else if (style === 'bars') {
      const s = chart.addBarSeries({ upColor: '#22c55e', downColor: '#ef4444' })
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

    // --- EMA 9 ---
    if (ema9On) {
      const data = calcEMA(candles, 9)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    // --- MA 20 ---
    if (ma20On) {
      const data = calcSMA(candles, 20)
      if (data.length) {
        const s = chart.addLineSeries({
          color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
        })
        s.setData(data.map(d => ({ time: ts(d.time), value: d.value })))
      }
    }

    // --- Entry / exit markers ---
    const markers: SeriesMarker<UTCTimestamp>[] = []

    if (meta.entryTimeSec) {
      const isShort = side === 'short'
      markers.push({
        time:     ts(meta.entryTimeSec),
        position: 'belowBar',
        color:    isShort ? '#dc2626' : '#16a34a',
        shape:    'arrowUp',
        text:     entryPrice != null
          ? `${isShort ? 'SHORT' : 'BUY'} $${entryPrice.toFixed(2)}`
          : (isShort ? 'SHORT' : 'BUY'),
        size: 1,
      })
    }

    if (meta.exitTimeSec && exitTime) {
      const isShort = side === 'short'
      markers.push({
        time:     ts(meta.exitTimeSec),
        position: 'aboveBar',
        color:    isShort ? '#16a34a' : '#dc2626',
        shape:    'arrowDown',
        text:     exitPrice != null
          ? `${isShort ? 'COVER' : 'SELL'} $${exitPrice.toFixed(2)}`
          : (isShort ? 'COVER' : 'SELL'),
        size: 1,
      })
    }

    if (markers.length > 0) {
      main.setMarkers(markers)
    }

    // --- Visible range ---
    if (meta.visibleRange) {
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

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [candles, meta, style, volumeOn, ema9On, ma20On, topTab, side, entryPrice, exitPrice, userTimeZone])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="h-[720px] rounded-xl border border-[#d9dce3] bg-[#f4f5f8] p-2.5">

      {/* Top tabs */}
      <div className="mb-2 flex items-center gap-1 rounded-md border border-[#d7dae2] bg-[#eeeff3] p-1">
        {(['chart', 'notes', 'running'] as const).map((tab) => (
          <button
            key={tab}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
              topTab === tab ? 'bg-white text-[#272a30] shadow-sm' : 'text-[#5a6071] hover:text-[#272a30]'
            }`}
            onClick={() => setTopTab(tab)}
          >
            {tab === 'chart' ? 'Chart' : tab === 'notes' ? 'Notes' : 'Running P&L'}
          </button>
        ))}
      </div>

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
                <SelectItem value="bars">Bars</SelectItem>
                <SelectItem value="line">Line</SelectItem>
                <SelectItem value="area">Area</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Indicator toggles */}
        <div className="flex items-center gap-1.5 border-b border-[#e6e9ef] px-3 py-1.5">
          <Button
            size="xs" className="h-7 text-[11px]"
            variant={volumeOn ? 'default' : 'outline'}
            onClick={() => setVolumeOn(v => !v)}
          >
            Volume
          </Button>
          <Button
            size="xs" className="h-7 text-[11px]"
            variant={ema9On ? 'default' : 'outline'}
            onClick={() => setEma9On(v => !v)}
          >
            EMA 9
          </Button>
          <Button
            size="xs" className="h-7 text-[11px]"
            variant={ma20On ? 'default' : 'outline'}
            onClick={() => setMa20On(v => !v)}
          >
            MA 20
          </Button>
          {loading && (
            <span className="ml-2 text-[11px] text-[#7b8291]">Loading…</span>
          )}
        </div>

        {/* Chart / placeholder area */}
        <div className="relative h-[592px]">
          {topTab === 'chart' ? (
            <>
              {/* Chart container — always mounted so the ref stays valid */}
              <div
                ref={containerRef}
                className={`h-full w-full ${(loading || !candles) && !error ? 'invisible' : ''}`}
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
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {topTab === 'notes' ? 'Notes panel coming next.' : 'Running P&L panel coming next.'}
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
          <div className="text-[#7a8190]">{userTimeZone}</div>
        </div>
      </div>
    </div>
  )
}
