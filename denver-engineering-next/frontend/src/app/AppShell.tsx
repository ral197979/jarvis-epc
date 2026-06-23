import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { cn, Icon } from '@ds'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ContextPanel } from './ContextPanel'
import { CommandPalette } from './CommandPalette'
import { useUi } from '../lib/store'

export function AppShell() {
  const { contextPanelOpen } = useUi()
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Sidebar />
      <Topbar />
      <CommandPalette />
      <ContextPanel />
      <main
        className={cn(
          'ml-[240px] min-h-screen px-lg pb-xl pt-[88px] transition-[margin]',
          contextPanelOpen ? 'xl:mr-[320px]' : '',
        )}
      >
        <Suspense fallback={
          <div className="flex h-[60vh] items-center justify-center text-on-surface-variant">
            <Icon name="progress_activity" size={28} className="animate-spin" />
          </div>
        }>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
