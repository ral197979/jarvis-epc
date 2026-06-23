import type { ReactNode } from 'react'
import { Icon, Button, Skeleton, cn } from '@ds'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-lg flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-headline-md font-bold text-primary">{title}</h1>
        {subtitle && <p className="mt-0.5 text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Inline AI recommendation banner (dark, navy) used atop several modules. */
export function AiBanner({ text, action }: { text: string; action?: string }) {
  return (
    <div className="mb-lg flex items-start gap-3 rounded-xl bg-primary p-md text-white shadow-md">
      <Icon name="smart_toy" filled size={22} className="mt-0.5 text-secondary-fixed" />
      <div className="flex-1">
        <div className="font-mono-tag text-label-sm uppercase tracking-wide text-secondary-fixed">AI Copilot</div>
        <p className="mt-0.5 text-body-md leading-relaxed">{text}</p>
      </div>
      {action && (
        <Button variant="accent" size="sm" className="shrink-0">
          {action}
        </Button>
      )}
    </div>
  )
}

export function GridSkeleton({ rows = 3, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className={cn('grid gap-md', `grid-cols-${cols}`)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
      {Array.from({ length: rows * cols }).map((_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  )
}

export function CriticalAlert({ title, body, action }: { title: string; body: string; action?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-error-container border-l-4 border-l-danger bg-error-container/40 p-md">
      <Icon name="warning" className="mt-0.5 text-danger" />
      <div className="flex-1">
        <div className="font-bold text-on-error-container">{title}</div>
        <p className="text-body-sm text-on-surface-variant">{body}</p>
      </div>
      {action && (
        <Button variant="danger" size="sm">
          {action}
        </Button>
      )}
    </div>
  )
}
