import { motion, useReducedMotion } from 'framer-motion'

/** Length of one loop in seconds. */
const D = 12
const GREEN = '#05b959'
const PALE = '#5edd4d'
const MINT = '#86edcf'
const DEEP = '#00150d'
const MUTED = 'rgba(0,21,13,0.18)'

type Value = number | string
type Track = Record<string, [number[], Value[]]>

/** Turns keyframe tracks into looping motion props, or one still frame when motion is reduced. */
function useLoop() {
  const reduce = useReducedMotion()
  return (tracks: Track) => {
    const animate: Record<string, Value | Value[]> = {}
    const initial: Record<string, Value> = {}
    const transition: Record<string, { duration: number; times?: number[]; repeat?: number; ease: 'linear' }> = {}
    for (const [prop, [times, vals]] of Object.entries(tracks)) {
      if (reduce) {
        // Still frame: the keyframe closest to 60% through the story (some milestones paid, some pending).
        let best = 0
        times.forEach((t, i) => {
          if (Math.abs(t - 0.6) < Math.abs((times[best] ?? 0) - 0.6)) best = i
        })
        animate[prop] = vals[best] ?? vals[0] ?? 0
        initial[prop] = animate[prop]
        transition[prop] = { duration: 0, ease: 'linear' }
      } else {
        animate[prop] = vals
        initial[prop] = vals[0] ?? 0
        transition[prop] = { duration: D, times, repeat: Infinity, ease: 'linear' }
      }
    }
    // initial={false} would skip the animation on mount, so only the still frame uses it.
    return { initial: reduce ? (false as const) : initial, animate, transition }
  }
}

/** Keyframe times for the story: fund, lock, three milestones each releasing a third, reset. */
const T = [0, 0.06, 0.18, 0.3, 0.36, 0.5, 0.56, 0.7, 0.76, 0.9, 1]

const MILESTONES = [
  { x: 480, label: 'Milestone 1', start: 0.3 },
  { x: 540, label: 'Milestone 2', start: 0.5 },
  { x: 600, label: 'Milestone 3', start: 0.7 },
]

/** Looping picture of the product: funds go into the vault, then are released to the recipient milestone by milestone. */
export function FlowGraphic() {
  const loop = useLoop()
  const vaultFill = loop({ height: [T, [0, 0, 64, 64, 43, 43, 22, 22, 0, 0, 0]], y: [T, [142, 142, 78, 78, 99, 99, 120, 120, 142, 142, 142]] })
  const shackle = loop({ y: [T, [-10, -10, 0, 0, 0, 0, 0, 0, 0, -10, -10]] })

  return (
    <div className="mt-8" aria-hidden={false}>
      <svg
        viewBox="0 0 720 220"
        role="img"
        aria-label="Animation: a payer funds a vault, and the money is released to the recipient one milestone at a time."
        className="h-auto w-full"
      >
        <defs>
          <linearGradient id="flow-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={PALE} />
            <stop offset="1" stopColor={MINT} />
          </linearGradient>
        </defs>

        {/* Tracks */}
        <line x1="104" y1="110" x2="296" y2="110" stroke={MUTED} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />
        <line x1="424" y1="110" x2="618" y2="110" stroke={MUTED} strokeWidth="3" strokeDasharray="2 8" strokeLinecap="round" />

        {/* Payer */}
        <g>
          <circle cx="70" cy="110" r="32" fill="#fff" stroke={MUTED} strokeWidth="2" />
          <rect x="54" y="98" width="32" height="24" rx="6" fill="none" stroke={DEEP} strokeWidth="2.5" />
          <path d="M54 106h32" stroke={DEEP} strokeWidth="2.5" />
          <circle cx="79" cy="114" r="2.5" fill={DEEP} />
          <text x="70" y="166" textAnchor="middle" fontSize="13" fontWeight="600" fill={DEEP}>
            Payer
          </text>
        </g>

        {/* Vault */}
        <g>
          <rect x="300" y="60" width="120" height="100" rx="22" fill="#fff" stroke={MUTED} strokeWidth="2" />
          <clipPath id="flow-vault-clip">
            <rect x="310" y="78" width="100" height="64" rx="14" />
          </clipPath>
          <g clipPath="url(#flow-vault-clip)">
            <rect x="310" y="78" width="100" height="64" fill={MUTED} opacity="0.35" />
            <motion.rect x="310" width="100" fill="url(#flow-line)" {...vaultFill} />
          </g>
          <motion.path d="M346 62v-8a14 14 0 0 1 28 0v8" fill="none" stroke={DEEP} strokeWidth="5" strokeLinecap="round" {...shackle} />
          <rect x="336" y="60" width="48" height="6" rx="3" fill={DEEP} />
          <text x="360" y="186" textAnchor="middle" fontSize="13" fontWeight="600" fill={DEEP}>
            Escrow vault
          </text>
        </g>

        {/* Milestones */}
        {MILESTONES.map((m) => {
          const lit = loop({
            fill: [T, T.map((t) => (t >= m.start && t < 1 ? GREEN : '#ffffff'))],
            scale: [T, T.map((t) => (t >= m.start && t < m.start + 0.06 ? 1.25 : 1))],
          })
          return (
            <g key={m.label}>
              <motion.circle cx={m.x} cy="110" r="9" stroke={GREEN} strokeWidth="2.5" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} {...lit} />
              <text x={m.x} y="140" textAnchor="middle" fontSize="10.5" fill="rgba(0,21,13,0.6)">
                {m.label.replace('Milestone ', 'M')}
              </text>
            </g>
          )
        })}

        {/* Recipient */}
        <g>
          <circle cx="650" cy="110" r="32" fill="#fff" stroke={MUTED} strokeWidth="2" />
          <circle cx="650" cy="102" r="9" fill="none" stroke={DEEP} strokeWidth="2.5" />
          <path d="M633 128a17 15 0 0 1 34 0" fill="none" stroke={DEEP} strokeWidth="2.5" strokeLinecap="round" />
          <text x="650" y="166" textAnchor="middle" fontSize="13" fontWeight="600" fill={DEEP}>
            Recipient
          </text>
          {['$0', '$333', '$667', '$1,000'].map((label, i) => {
            const show = loop({ opacity: [T, T.map((t) => (i === 0 ? (t < 0.3 || t >= 0.9 ? 1 : 0) : i === 1 ? (t >= 0.3 && t < 0.5 ? 1 : 0) : i === 2 ? (t >= 0.5 && t < 0.7 ? 1 : 0) : t >= 0.7 && t < 0.9 ? 1 : 0))] })
            return (
              <motion.text key={label} x="650" y="68" textAnchor="middle" fontSize="15" fontWeight="700" fill={GREEN} {...show}>
                {label}
              </motion.text>
            )
          })}
        </g>

        {/* Funding coin: payer to vault */}
        <motion.circle cy="110" r="9" fill={PALE} stroke={GREEN} strokeWidth="2" {...loop({ cx: [T, [104, 104, 296, 296, 296, 296, 296, 296, 296, 296, 104]], opacity: [T, [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]] })} />

        {/* Release coins: vault to recipient, one per milestone */}
        {MILESTONES.map((m) => {
          const x = T.map((t) => (t < m.start ? 424 : t < m.start + 0.06 ? m.x : t < m.start + 0.12 ? 618 : 618))
          const op = T.map((t) => (t >= m.start && t < m.start + 0.12 ? 1 : 0))
          return <motion.circle key={`coin-${m.label}`} cy="110" r="8" fill={PALE} stroke={GREEN} strokeWidth="2" {...loop({ cx: [T, x], opacity: [T, op] })} />
        })}
      </svg>
      <p className="mt-1 text-center text-xs" style={{ color: 'var(--subtle)' }}>
        Example: $1,000 is locked once, then released in three milestones.
      </p>
    </div>
  )
}
