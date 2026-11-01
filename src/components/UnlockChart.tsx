import { useId, useMemo } from 'react'
import { formatUnitsExact } from '@/onchain-money'
import { unlockedByParams, type SchedParams } from '@/lib/vault'

const W = 600
const PAD = { l: 44, r: 12, t: 12, b: 26 }
const MAX_BOUNDARIES = 150
const UNIFORM_SAMPLES = 160

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 })
const shortDate = (seconds: bigint) =>
  new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })

function sampleTimes(series: SchedParams[], t0: bigint, t1: bigint): bigint[] {
  const times = new Set<bigint>([t0, t1])
  let needUniform = false
  for (const p of series) {
    times.add(p.start + p.cliff)
    times.add(p.start + p.stepDuration * BigInt(p.steps))
    if (p.steps <= MAX_BOUNDARIES) {
      for (let k = 1; k <= p.steps; k++) times.add(p.start + p.stepDuration * BigInt(k))
    } else needUniform = true
  }
  if (needUniform) {
    const span = t1 - t0
    for (let i = 0; i <= UNIFORM_SAMPLES; i++) times.add(t0 + (span * BigInt(i)) / BigInt(UNIFORM_SAMPLES))
  }
  return [...times].filter((t) => t >= t0 && t <= t1).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** Cumulative unlock curve for one or more schedules, with a live "now" marker. */
export function UnlockChart({ series, now, height = 190, label, decimals = 6 }: { series: SchedParams[]; now: bigint; height?: number; label: string; decimals?: number }) {
  const gradientId = useId()

  const model = useMemo(() => {
    if (series.length === 0) return null
    const t0 = series.reduce((m, p) => (p.start < m ? p.start : m), series[0].start)
    const t1 = series.reduce((m, p) => {
      const end = p.start + p.stepDuration * BigInt(p.steps)
      return end > m ? end : m
    }, t0)
    const max = series.reduce((m, p) => m + p.total, 0n)
    if (t1 <= t0 || max === 0n) return null
    const value = (t: bigint) => series.reduce((sum, p) => sum + unlockedByParams(p, t), 0n)
    return { t0, t1, max, value, times: sampleTimes(series, t0, t1) }
  }, [series])

  if (!model) return null
  const { t0, t1, max, value, times } = model
  const innerW = W - PAD.l - PAD.r
  const innerH = height - PAD.t - PAD.b
  const x = (t: bigint) => PAD.l + (Number(t - t0) / Number(t1 - t0)) * innerW
  const y = (v: bigint) => PAD.t + innerH - (Number((v * 10000n) / max) / 10000) * innerH

  let line = ''
  let prev = 0n
  times.forEach((t, i) => {
    const v = value(t)
    line += i === 0 ? `M${x(t).toFixed(1)},${y(v).toFixed(1)}` : `L${x(t).toFixed(1)},${y(prev).toFixed(1)}L${x(t).toFixed(1)},${y(v).toFixed(1)}`
    prev = v
  })
  const baseY = PAD.t + innerH
  const area = `${line}L${x(t1).toFixed(1)},${baseY}L${x(t0).toFixed(1)},${baseY}Z`
  const inRange = now >= t0 && now <= t1
  const nowV = inRange ? value(now) : null

  return (
    <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="block w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#05b959" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#86edcf" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH * (1 - f)} y2={PAD.t + innerH * (1 - f)} stroke="rgba(0,21,13,0.08)" />
          <text x={PAD.l - 8} y={PAD.t + innerH * (1 - f) + 3} textAnchor="end" fontSize="10" fill="#6b7c80">
            {compact.format(Number(formatUnitsExact((max * BigInt(Math.round(f * 100))) / 100n, decimals)))}
          </text>
        </g>
      ))}
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="#05b959" strokeWidth="2" strokeLinejoin="round" />
      {nowV !== null && (
        <g>
          <line x1={x(now)} x2={x(now)} y1={PAD.t} y2={baseY} stroke="rgba(0,21,13,0.4)" strokeDasharray="3 3" />
          <circle cx={x(now)} cy={y(nowV)} r="4.5" fill="#ffffff" stroke="#00150d" strokeWidth="2" />
          <text x={x(now)} y={PAD.t - 2} textAnchor="middle" fontSize="10" fill="#00150d">
            Now
          </text>
        </g>
      )}
      <text x={PAD.l} y={height - 6} fontSize="10" fill="#6b7c80">
        {shortDate(t0)}
      </text>
      <text x={W - PAD.r} y={height - 6} textAnchor="end" fontSize="10" fill="#6b7c80">
        {shortDate(t1)}
      </text>
    </svg>
  )
}
