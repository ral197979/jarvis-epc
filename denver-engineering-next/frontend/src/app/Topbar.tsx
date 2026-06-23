import { useLocation } from 'react-router-dom'
import { Icon, Avatar, Button, cn } from '@ds'
import { useProjects } from '@adapters'
import { NAV } from './navigation'
import { useUi } from '../lib/store'

function useTitle() {
  const { pathname } = useLocation()
  if (pathname.startsWith('/projects/')) return 'Project Workspace'
  const match = [...NAV].sort((a, b) => b.path.length - a.path.length).find((n) => pathname === n.path || (n.path !== '/' && pathname.startsWith(n.path)))
  return match?.label ?? 'Dashboard'
}

export function Topbar() {
  const title = useTitle()
  const { data: projects } = useProjects()
  const { activeProjectId, setActiveProject, toggleContextPanel, setCommandOpen } = useUi()

  return (
    <header className="fixed right-0 top-0 z-30 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-lg"
      style={{ left: 240 }}
    >
      <div className="flex items-center gap-xl">
        <h2 className="text-headline-md font-extrabold text-primary">{title}</h2>
        <button
          onClick={() => setCommandOpen(true)}
          className="flex h-10 w-96 items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 text-left text-body-sm text-on-surface-variant transition-colors hover:border-secondary"
        >
          <Icon name="search" size={20} />
          <span className="flex-1">Search projects, systems, documents…</span>
          <kbd className="rounded border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono-tag text-label-sm">⌘K</kbd>
        </button>
      </div>

      <div className="flex items-center gap-3">
        {/* Project switcher */}
        <div className="relative">
          <select
            value={activeProjectId}
            onChange={(e) => setActiveProject(e.target.value)}
            className="h-10 appearance-none rounded-lg border border-outline-variant bg-background pl-3 pr-9 text-body-sm font-semibold text-primary outline-none focus:border-secondary"
            aria-label="Active project"
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          <Icon name="expand_more" size={18} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant" />
        </div>

        <Button variant="accent" size="sm" className="gap-1">
          <Icon name="add" size={18} /> Create
        </Button>

        <div className="flex items-center gap-1">
          <IconButton icon="smart_toy" onClick={toggleContextPanel} />
          <IconButton icon="notifications" badge />
          <IconButton icon="apps" />
        </div>
        <Avatar name="Alex Sterling" />
      </div>
    </header>
  )
}

function IconButton({ icon, badge, onClick }: { icon: string; badge?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn('relative flex h-9 w-9 items-center justify-center rounded-full text-primary transition-colors hover:bg-surface-container-high')}
    >
      <Icon name={icon} size={22} />
      {badge && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-error" />}
    </button>
  )
}
