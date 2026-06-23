import { cn } from '../lib/cn'

export interface IconProps {
  /** Material Symbols Outlined ligature name, e.g. "dashboard", "smart_toy". */
  name: string
  filled?: boolean
  className?: string
  /** Pixel size; defaults to inherit (1em). */
  size?: number
  title?: string
}

/**
 * Material Symbols icon — the icon system used across every Stitch screen.
 * Lucide is also available for cases where a Material Symbol isn't a good fit.
 */
export function Icon({ name, filled, className, size, title }: IconProps) {
  return (
    <span
      className={cn('material-symbols-outlined select-none', filled && 'filled', className)}
      style={size ? { fontSize: size } : undefined}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
    >
      {name}
    </span>
  )
}
