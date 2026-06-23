import * as React from 'react'
import { cn } from '../lib/cn'
import { toneChip, toneDot, statusTone, type Tone } from '../tokens'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
  /** Render a leading status dot instead of a filled pill. */
  dot?: boolean
}

/** Low-opacity status pill. Pass an explicit `tone` or use <StatusChip> to infer it. */
export function Badge({ tone = 'neutral', dot = false, className, children, ...props }: BadgeProps) {
  if (dot) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-body-sm font-semibold', className)} {...props}>
        <span className={cn('h-2 w-2 rounded-full', toneDot[tone])} />
        {children}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-body-sm font-semibold',
        toneChip[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

/** Infers tone from a free-text status label (e.g. "At Risk", "Complete", "Critical"). */
export function StatusChip({
  status,
  dot,
  className,
}: {
  status: string
  dot?: boolean
  className?: string
}) {
  return (
    <Badge tone={statusTone(status)} dot={dot} className={className}>
      {status}
    </Badge>
  )
}
