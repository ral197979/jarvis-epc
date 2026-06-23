import * as React from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

/** Avatar with initials fallback. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-container font-mono-tag text-label-md text-white',
        className,
      )}
    >
      {initials}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-container-high', className)} />
}

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-md flex items-center justify-between', className)}>
      <h2 className="text-headline-sm font-bold text-primary">{title}</h2>
      {action}
    </div>
  )
}

export function EmptyState({
  icon = 'inbox',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
        <Icon name={icon} />
      </div>
      <p className="text-body-lg font-semibold text-primary">{title}</p>
      {description && <p className="max-w-sm text-body-sm text-on-surface-variant">{description}</p>}
      {action}
    </div>
  )
}

/** Lightweight divider. */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-outline-variant', className)} />
}
