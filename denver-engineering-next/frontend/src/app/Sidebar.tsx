import { NavLink } from 'react-router-dom'
import { Icon, cn } from '@ds'
import { NAV } from './navigation'

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-full w-[240px] flex-col border-r border-outline-variant bg-primary px-sm py-md">
      <div className="mb-lg flex items-center gap-2 px-sm">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-on-secondary">
          <Icon name="precision_manufacturing" filled size={22} />
        </div>
        <div>
          <h1 className="text-headline-sm font-bold leading-tight text-on-primary">Denver</h1>
          <p className="font-mono-tag text-label-sm uppercase tracking-wide text-on-primary/60">EPC OS · v0.1</p>
        </div>
      </div>

      <nav className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto pr-1">
        {NAV.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-sm py-2.5 text-body-sm font-semibold transition-colors',
                isActive
                  ? 'bg-secondary text-on-secondary'
                  : 'text-on-primary/70 hover:bg-white/10 hover:text-on-primary',
              )
            }
          >
            <Icon name={item.icon} size={20} />
            <span className="flex-1">{item.label}</span>
            {item.preview && (
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono-tag text-[9px] uppercase text-on-primary/70">
                Soon
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-white/10 pt-md">
        <NavLink
          to="/admin"
          className="flex items-center gap-3 rounded-lg px-sm py-2.5 text-body-sm font-semibold text-on-primary/70 transition-colors hover:bg-white/10 hover:text-on-primary"
        >
          <Icon name="settings" size={20} />
          Settings
        </NavLink>
      </div>
    </aside>
  )
}
