import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function Overlay({ className, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-primary/40 backdrop-blur-sm animate-fade-in', className)}
      {...props}
    />
  )
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title?: string; description?: string }
>(({ className, children, title, description, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <Overlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-outline-variant bg-surface-container-lowest p-lg shadow-lg animate-fade-in',
        className,
      )}
      {...props}
    >
      {title && (
        <div className="mb-md">
          <DialogPrimitive.Title className="text-headline-sm font-bold text-primary">{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className="mt-1 text-body-sm text-on-surface-variant">
              {description}
            </DialogPrimitive.Description>
          )}
        </div>
      )}
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded p-1 text-on-surface-variant hover:bg-surface-container-high">
        <Icon name="close" size={20} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'
