import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '../lib/cn'
import { Icon } from './Icon'

/** Right-anchored slide-over sheet (record detail panels, filters, etc.). */
export const Drawer = DialogPrimitive.Root
export const DrawerTrigger = DialogPrimitive.Trigger
export const DrawerClose = DialogPrimitive.Close

export const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    title?: string
    subtitle?: string
    width?: number
  }
>(({ className, children, title, subtitle, width = 480, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-primary/40 backdrop-blur-sm animate-fade-in" />
    <DialogPrimitive.Content
      ref={ref}
      style={{ width }}
      className={cn(
        'fixed right-0 top-0 z-50 flex h-full max-w-[92vw] flex-col border-l border-outline-variant bg-surface-container-lowest shadow-lg animate-slide-in-right',
        className,
      )}
      {...props}
    >
      {(title || subtitle) && (
        <div className="flex items-start justify-between border-b border-outline-variant p-md">
          <div>
            {title && <DialogPrimitive.Title className="text-headline-sm font-bold text-primary">{title}</DialogPrimitive.Title>}
            {subtitle && (
              <DialogPrimitive.Description className="mt-0.5 text-body-sm text-on-surface-variant">
                {subtitle}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded p-1 text-on-surface-variant hover:bg-surface-container-high">
            <Icon name="close" size={20} />
          </DialogPrimitive.Close>
        </div>
      )}
      <div className="custom-scrollbar flex-1 overflow-y-auto">{children}</div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DrawerContent.displayName = 'DrawerContent'
