'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { Expand, Redo2, Search, Settings, Undo2, ZoomIn, ZoomOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

interface ChartPayload {
  symbol: string
  interval: string
  timeframe: string
  candles: Candle[]
  entryTimeSec: number
  exitTimeSec: number
  autoFocus: boolean
  visibleRange: { from: number; to: number } | null
}

interface Props {
  symbol: string
  entryTime: string | null
  exitTime: string | null
}

type Timeframe = 'auto' | '1m' | '5m' | '15m' | '30m' | '1h' | '1d'

interface IndicatorsState {
  ema9: boolean
  ema20: boolean
  ema50: boolean
}

function buildEma(candles: Candle[], period: number) {
  if (candles.length < period) return []
  const k = 2 / (period + 1)
  let ema = candles[0].close
  const points: { time: UTCTimestamp; value: number }[] = []

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    ema = i === 0 ? c.close : c.close * k + ema * (1 - k)
    if (i >= period - 1) {
      points.push({ time: c.time as UTCTimestamp, value: ema })
    }
  }
  return points
}

export function TradeChart({ symbol, entryTime, exitTime }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const candlesRef = useRef<Candle[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [timeframe, setTimeframe] = useState<Timeframe>('auto')
  const [indicators, setIndicators] = useState<IndicatorsState>({
    ema9: true,
    ema20: true,
    ema50: false,
  })
  const [topTab, setTopTab] = useState<'chart' | 'notes' | 'running'>('chart')

  function clearIndicatorLines() {
    if (!chartRef.current) return
    for (const line of lineSeriesRef.current) {
      chartRef.current.removeSeries(line)
    }
    lineSeriesRef.current = []
  }

  function applyIndicators() {
    if (!chartRef.current) return
    clearIndicatorLines()
    const candles = candlesRef.current
    if (candles.length === 0) return

    const specs: Array<{ enabled: boolean; period: number; color: string }> = [
      { enabled: indicators.ema9, period: 9, color: '#3b82f6' },
      { enabled: indicators.ema20, period: 20, color: '#f97316' },
      { enabled: indicators.ema50, period: 50, color: '#8b5cf6' },
    ]

    for (const spec of specs) {
      if (!spec.enabled) continue
      const line = chartRef.current.addLineSeries({
        color: spec.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      line.setData(buildEma(candles, spec.period))
      lineSeriesRef.current.push(line)
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const chart = createChart(host, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#444444',
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      rightPriceScale: {
        borderColor: '#e2e8f0',
      },
      timeScale: {
        borderColor: '#e2e8f0',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0,
      },
      width: host.clientWidth,
      height: 520,
    })

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    })

    chartRef.current = chart
    seriesRef.current = series
    volumeSeriesRef.current = volumeSeries

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !chartRef.current) return
      chartRef.current.applyOptions({ width: Math.floor(entry.contentRect.width) })
    })
    resizeObserver.observe(host)

    return () => {
      resizeObserver.disconnect()
      clearIndicatorLines()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      volumeSeriesRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!entryTime || !symbol || !seriesRef.current || !chartRef.current) return
    const entryTs = entryTime

    let canceled = false
    async function loadData() {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({ symbol, entryTime: entryTs })
        if (exitTime) params.set('exitTime', exitTime)
        params.set('timeframe', timeframe)

        const res = await fetch(`/api/market/trade-chart?${params.toString()}`)
        const json = (await res.json()) as ChartPayload | { error?: string }

        if (!res.ok) {
          if (!canceled) setError((json as { error?: string }).error ?? 'Failed to load chart data')
          return
        }

        const payload = json as ChartPayload
        candlesRef.current = payload.candles
        const points = payload.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
        const volumePoints = payload.candles
          .filter((c) => c.volume != null)
          .map((c) => ({
            time: c.time as UTCTimestamp,
            value: c.volume as number,
            color: c.close >= c.open ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
          }))

        if (canceled || !seriesRef.current || !chartRef.current || !volumeSeriesRef.current) return

        seriesRef.current.setData(points)
        volumeSeriesRef.current.setData(volumePoints)

        const markerData: Array<{
          time: UTCTimestamp
          position: 'aboveBar' | 'belowBar'
          color: string
          shape: 'arrowUp' | 'arrowDown'
          text: string
        }> = [
          {
            time: payload.entryTimeSec as UTCTimestamp,
            position: 'belowBar',
            color: '#16a34a',
            shape: 'arrowUp',
            text: 'BUY',
          },
        ]

        if (exitTime) {
          markerData.push({
            time: payload.exitTimeSec as UTCTimestamp,
            position: 'aboveBar',
            color: '#dc2626',
            shape: 'arrowDown',
            text: 'SELL',
          })
        }

        seriesRef.current.setMarkers(markerData)
        applyIndicators()
        if (payload.autoFocus && payload.visibleRange) {
          chartRef.current.timeScale().setVisibleRange({
            from: payload.visibleRange.from as UTCTimestamp,
            to: payload.visibleRange.to as UTCTimestamp,
          })
        } else {
          chartRef.current.timeScale().fitContent()
        }
      } catch {
        if (!canceled) setError('Failed to load chart data')
      } finally {
        if (!canceled) setIsLoading(false)
      }
    }

    void loadData()

    return () => {
      canceled = true
    }
  }, [symbol, entryTime, exitTime, timeframe])

  useEffect(() => {
    applyIndicators()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators])

  return (
    <div className="h-[700px] rounded-xl border bg-[#f6f6f8] p-3">
      <div className="mb-2 flex items-center gap-1 rounded-lg border bg-[#ececef] p-1">
        <button
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            topTab === 'chart' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
          onClick={() => setTopTab('chart')}
        >
          Chart
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            topTab === 'notes' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
          onClick={() => setTopTab('notes')}
        >
          Notes
        </button>
        <button
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            topTab === 'running' ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground'
          }`}
          onClick={() => setTopTab('running')}
        >
          Running P&L
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold">{symbol}</div>
            <div className="text-xs text-muted-foreground">{isLoading ? 'Loading...' : 'Live'}</div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost">
              <Undo2 />
            </Button>
            <Button size="icon-xs" variant="ghost">
              <Redo2 />
            </Button>
            <Button size="icon-xs" variant="ghost">
              <Settings />
            </Button>
            <Button size="icon-xs" variant="ghost">
              <Expand />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
              <SelectTrigger size="sm" className="w-[110px]">
                <SelectValue placeholder="Timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="1m">1m</SelectItem>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="15m">15m</SelectItem>
                <SelectItem value="30m">30m</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
                <SelectItem value="1d">1D</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="xs"
              variant={indicators.ema9 ? 'default' : 'outline'}
              onClick={() => setIndicators((s) => ({ ...s, ema9: !s.ema9 }))}
            >
              EMA 9
            </Button>
            <Button
              size="xs"
              variant={indicators.ema20 ? 'default' : 'outline'}
              onClick={() => setIndicators((s) => ({ ...s, ema20: !s.ema20 }))}
            >
              EMA 20
            </Button>
            <Button
              size="xs"
              variant={indicators.ema50 ? 'default' : 'outline'}
              onClick={() => setIndicators((s) => ({ ...s, ema50: !s.ema50 }))}
            >
              EMA 50
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost">
              <Search />
            </Button>
            <Button size="icon-xs" variant="ghost">
              <ZoomOut />
            </Button>
            <Button size="icon-xs" variant="ghost">
              <ZoomIn />
            </Button>
          </div>
        </div>

        <div className="flex h-[560px]">
          <div className="flex w-10 flex-col items-center gap-1 border-r bg-[#fafafb] py-2">
            <Button size="icon-xs" variant="ghost">+</Button>
            <Button size="icon-xs" variant="ghost">/</Button>
            <Button size="icon-xs" variant="ghost">T</Button>
            <Button size="icon-xs" variant="ghost">[]</Button>
            <Button size="icon-xs" variant="ghost">O</Button>
          </div>
          <div className="flex-1 bg-white">
            <div ref={hostRef} className="h-[520px] w-full" />
            <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <button className={`rounded px-2 py-1 ${timeframe === '5m' ? 'bg-[#ececef] text-foreground' : ''}`} onClick={() => setTimeframe('5m')}>5m</button>
                <button className={`rounded px-2 py-1 ${timeframe === '30m' ? 'bg-[#ececef] text-foreground' : ''}`} onClick={() => setTimeframe('30m')}>30m</button>
                <button className={`rounded px-2 py-1 ${timeframe === '1h' ? 'bg-[#ececef] text-foreground' : ''}`} onClick={() => setTimeframe('1h')}>1h</button>
                <button className={`rounded px-2 py-1 ${timeframe === '1d' ? 'bg-[#ececef] text-foreground' : ''}`} onClick={() => setTimeframe('1d')}>1D</button>
                <button className={`rounded px-2 py-1 ${timeframe === 'auto' ? 'bg-[#ececef] text-foreground' : ''}`} onClick={() => setTimeframe('auto')}>auto</button>
              </div>
              <div>UTC-8</div>
            </div>
          </div>
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      {topTab !== 'chart' && (
        <div className="mt-2 text-xs text-muted-foreground">
          {topTab === 'notes' ? 'Notes panel coming next.' : 'Running P&L panel coming next.'}
        </div>
      )}
    </div>
  )
}
