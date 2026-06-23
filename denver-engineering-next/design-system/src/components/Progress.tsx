import { cn } from '../lib/cn'

export interface ProgressProps {
  value: number // 0..100
  className?: string
  barClassName?: string
  /** Auto-colour by completion thresholds (red < 40, amber < 75, green ≥ 75). */
  threshold?: boolean
  height?: number
}

export function Progress({ value, className, barClassName, threshold, height = 8 }: ProgressProps) {
  const v = Math.max(0, Math.min(100, value))
  const tone = !threshold
    ? 'bg-secondary'
    : v < 40
      ? 'bg-danger'
      : v < 75
        ? 'bg-warning'
        : 'bg-success'
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-surface-container-high', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn('h-full rounded-full transition-all duration-500', tone, barClassName)}
        style={{ width: `${v}%` }}
      />
    </div>
  )
}

/** Circular completion gauge used on commissioning / readiness panels. */
export function Gauge({ value, size = 96, label }: { value: number; size?: number; label?: string }) {
  const v = Math.max(0, Math.min(100, value))
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const tone = v < 40 ? '#dc2626' : v < 75 ? '#f97316' : '#16a34a'
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#dce9ff" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-headline-sm font-bold text-primary">{Math.round(v)}%</span>
        {label && <span className="font-mono-tag text-label-sm uppercase text-on-surface-variant">{label}</span>}
      </div>
    </div>
  )
}
