import * as React from 'react'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, ...props }, ref) => {
    const field = (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest text-body-md text-on-surface placeholder:text-on-surface-variant',
          'px-3 outline-none transition-colors focus:border-secondary focus:ring-1 focus:ring-secondary',
          icon && 'pl-10',
          className,
        )}
        {...props}
      />
    )
    if (!icon) return field
    return (
      <div className="relative">
        <Icon
          name={icon}
          size={20}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
        />
        {field}
      </div>
    )
  },
)
Input.displayName = 'Input'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1 block text-body-sm font-semibold text-on-surface-variant', className)}
      {...props}
    />
  )
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface placeholder:text-on-surface-variant outline-none transition-colors focus:border-secondary focus:ring-1 focus:ring-secondary',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-10 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-md text-on-surface outline-none transition-colors focus:border-secondary focus:ring-1 focus:ring-secondary',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
)
Select.displayName = 'Select'
