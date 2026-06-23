import { cn } from '../lib/cn'
import { Icon } from './Icon'
import { Card } from './Card'

export interface KpiCardProps {
  label: string
  value: string
  icon?: string
  /** Sub-line under the value. */
  hint?: string
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; tone?: 'success' | 'danger' | 'muted' }
  /** Critical KPIs get a red left accent + red value, per the design language. */
  critical?: boolean
  onClick?: () => void
  className?: string
}

const trendIcon = { up: 'trending_up', down: 'trending_down', flat: 'trending_flat' }

export function KpiCard({ label, value, icon, hint, trend, critical, onClick, className }: KpiCardProps) {
  const trendColor =
    trend?.tone === 'success'
      ? 'text-success'
      : trend?.tone === 'danger'
        ? 'text-danger'
        : 'text-on-surface-variant'
  return (
    <Card
      onClick={onClick}
      className={cn(
        'p-lg transition-shadow',
        critical && 'border-l-4 border-l-danger',
        onClick && 'cursor-pointer hover:shadow-md',
        className,
      )}
    >
      <div className="mb-sm flex items-start justify-between">
        <span className="font-mono-tag text-label-md uppercase text-on-surface-variant">{label}</span>
        {icon && <Icon name={icon} className={cn('text-secondary', critical && 'text-danger')} size={20} />}
      </div>
      <div className={cn('text-headline-md font-bold', critical ? 'text-danger' : 'text-primary')}>{value}</div>
      {trend && (
        <div className={cn('mt-xs flex items-center gap-1 text-body-sm font-semibold', trendColor)}>
          <Icon name={trendIcon[trend.direction]} size={16} />
          {trend.label}
        </div>
      )}
      {hint && !trend && <div className="mt-xs text-body-sm text-on-surface-variant">{hint}</div>}
    </Card>
  )
}
