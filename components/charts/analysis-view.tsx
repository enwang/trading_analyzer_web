'use client'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { PnlBar } from '@/components/charts/pnl-bar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { GroupRow } from '@/types/trade'

interface AnalysisData {
  byHour: { hour: number; value: number }[]
  byDay: { day: string; value: number }[]
  bySymbol: GroupRow[]
  bySetup: GroupRow[]
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}
function fmtMoney(n: number) {
  return `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`
}
function fmtPf(n: number) {
  return n === Infinity ? '∞' : n.toFixed(2)
}

function GroupTable({ rows }: { rows: GroupRow[] }) {
  if (!rows.length) {
    return (
      <p className="text-muted-foreground text-sm py-6 text-center">No data</p>
    )
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Trades</TableHead>
            <TableHead className="text-right">Win Rate</TableHead>
            <TableHead className="text-right">Total P&L</TableHead>
            <TableHead className="text-right">Avg P&L</TableHead>
            <TableHead className="text-right">Profit Factor</TableHead>
            <TableHead className="text-right">Avg R</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.group}>
              <TableCell className="font-medium">{r.group}</TableCell>
              <TableCell className="text-right">{r.trades}</TableCell>
              <TableCell className="text-right">{fmtPct(r.winRate)}</TableCell>
              <TableCell
                className={`text-right font-medium ${r.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {fmtMoney(r.totalPnl)}
              </TableCell>
              <TableCell
                className={`text-right ${r.avgPnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
              >
                {fmtMoney(r.avgPnl)}
              </TableCell>
              <TableCell className="text-right">{fmtPf(r.profitFactor)}</TableCell>
              <TableCell className="text-right">
                {r.avgR != null ? r.avgR.toFixed(2) : '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function AnalysisView({ data }: { data: AnalysisData }) {
  const hourData = data.byHour.map(d => ({
    label: `${d.hour}:00`,
    value: d.value,
  }))

  const dayData = data.byDay.map(d => ({ label: d.day.slice(0, 3), value: d.value }))

  return (
    <Tabs defaultValue="hour" className="space-y-4">
      <TabsList>
        <TabsTrigger value="hour">By Hour</TabsTrigger>
        <TabsTrigger value="day">By Day</TabsTrigger>
        <TabsTrigger value="symbol">By Symbol</TabsTrigger>
        <TabsTrigger value="setup">By Setup</TabsTrigger>
      </TabsList>

      <TabsContent value="hour">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Average P&L by entry hour (ET)</p>
          <PnlBar data={hourData} height={240} tooltipLabel="Avg P&L" />
        </div>
      </TabsContent>

      <TabsContent value="day">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Total P&L by day of week</p>
          <PnlBar data={dayData} height={240} tooltipLabel="Total P&L" />
        </div>
      </TabsContent>

      <TabsContent value="symbol">
        <GroupTable rows={data.bySymbol} />
      </TabsContent>

      <TabsContent value="setup">
        <GroupTable rows={data.bySetup} />
      </TabsContent>
    </Tabs>
  )
}
