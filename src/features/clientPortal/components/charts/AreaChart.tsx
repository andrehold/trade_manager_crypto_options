import { useId } from 'react'
import {
  Area, AreaChart as RAreaChart, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { SeriesPoint } from '../../dashboard/series'
import { CHART_COLORS } from '../../dashboard/chartTheme'

type Props = {
  data: SeriesPoint[]
  color: string
  height?: number
  zeroBaseline?: boolean
  formatValue: (v: number) => string
  testId?: string
}

export function AreaChart({ data, color, height = 176, zeroBaseline, formatValue, testId }: Props) {
  const gid = useId().replace(/:/g, '')
  const crossesZero = zeroBaseline && data.some((d) => d.v < 0) && data.some((d) => d.v > 0)
  return (
    <div data-testid={testId} style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RAreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.32} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="t" hide />
          <YAxis hide domain={zeroBaseline ? ['auto', 'auto'] : ['dataMin', 'dataMax']} />
          {crossesZero && <ReferenceLine y={0} stroke={CHART_COLORS.zero} strokeDasharray="3 3" />}
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.28)' }}
            contentStyle={{ background: '#202029', border: '1px solid #1F2A3A', borderRadius: 9, fontSize: 12 }}
            labelStyle={{ color: '#8A8A98' }}
            formatter={(v: number) => [formatValue(v), '']}
          />
          <Area
            type="monotone" dataKey="v" stroke={color} strokeWidth={2}
            fill={`url(#${gid})`} dot={false}
            activeDot={{ r: 3.5, fill: color, stroke: '#101013', strokeWidth: 1.5 }}
          />
        </RAreaChart>
      </ResponsiveContainer>
    </div>
  )
}
