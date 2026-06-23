import { Suspense, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon, cn } from '@ds'

const TITLES: Record<string, string> = {
  '/m': 'Field App',
  '/m/arrival': 'Site Arrival',
  '/m/fpt': 'FPT Execution',
  '/m/scan': 'Asset Scan',
  '/m/sync': 'Offline Sync',
}

const TABS = [
  { to: '/m', icon: 'home', label: 'Home' },
  { to: '/m/scan', icon: 'qr_code_scanner', label: 'Scan' },
  { to: '/m/fpt', icon: 'science', label: 'FPT' },
  { to: '/m/sync', icon: 'sync', label: 'Sync' },
]

export function MobileShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [online, setOnline] = useState(true)
  const isHome = pathname === '/m'
  const title = TITLES[pathname] ?? 'Field App'

  return (
    <div className="flex min-h-screen justify-center bg-inverse-surface">
      <div className="relative flex min-h-screen w-full max-w-[440px] flex-col border-x border-outline-variant bg-background">
        {/* Top app bar */}
        <header className="sticky top-0 z-30 bg-primary text-on-primary">
          <div className="flex h-14 items-center gap-2 px-3">
            {!isHome ? (
              <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
                <Icon name="arrow_back" />
              </button>
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-on-secondary"><Icon name="precision_manufacturing" filled size={20} /></div>
            )}
            <div className="flex-1">
              <div className="text-body-lg font-bold leading-tight">{title}</div>
              {isHome && <div className="font-mono-tag text-label-sm uppercase text-on-primary/60">Denver EPC · Field</div>}
            </div>
            <NavLink to="/" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10" title="Exit to desktop">
              <Icon name="logout" size={20} />
            </NavLink>
          </div>
          {/* Connectivity strip */}
          <button
            onClick={() => setOnline((o) => !o)}
            className={cn('flex w-full items-center justify-center gap-1.5 py-1 text-label-md font-semibold', online ? 'bg-success/20 text-success-container' : 'bg-warning/20 text-warning')}
          >
            <Icon name={online ? 'wifi' : 'wifi_off'} size={14} />
            {online ? 'Online · synced' : 'Offline · changes will queue'}
          </button>
        </header>

        {/* Content */}
        <main className="custom-scrollbar flex-1 overflow-y-auto p-md pb-24">
          <Suspense fallback={<div className="flex h-40 items-center justify-center text-on-surface-variant"><Icon name="progress_activity" size={26} className="animate-spin" /></div>}>
            <Outlet context={{ online }} />
          </Suspense>
        </main>

        {/* Bottom tab bar */}
        <nav className="absolute bottom-0 left-0 right-0 z-30 flex border-t border-outline-variant bg-surface-container-lowest">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/m'}
              className={({ isActive }) =>
                cn('flex flex-1 flex-col items-center gap-0.5 py-2.5 text-label-md font-semibold transition-colors',
                  isActive ? 'text-secondary' : 'text-on-surface-variant')
              }
            >
              <Icon name={t.icon} size={22} />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
