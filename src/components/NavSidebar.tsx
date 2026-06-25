/**
 * Denver Engineering — NavSidebar (v4.30.0 UI refresh)
 * Clean sidebar with lucide icons, grouped sections, hover states, smooth motion.
 */
import React, { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Target, FlaskConical, ListChecks, HardHat, FileText, Calculator,
  Wrench, Users, Wallet, Sparkles, Zap, Hammer, Archive, BookOpen, Plug, Link2,
  Bell, Settings, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, Workflow, ShieldAlert, Lightbulb, Library, Bot, Compass, Network, ClipboardList, FolderKanban, Receipt, Radar, Cpu, Dices, Microscope, Truck, LifeBuoy, TrendingDown, FileWarning, Award, Inbox, Milestone, Wand2
} from 'lucide-react'
import { useAppStore, type OwnerConfig } from '../modules/store/appSlice'
import { NAVIGATION_ITEMS, NAV_SECTIONS, type NavItem } from '../config/navigation'

// v4.31.0 TS fix: lucide-react icons are ForwardRefExoticComponent, not plain
// ComponentType — use the library's own LucideIcon type so the map is assignable.
const ICON_MAP: Record<string, LucideIcon> = {
  dash: LayoutDashboard, crm: Target, feed: FlaskConical, projects: ListChecks, lifecycle: Milestone, setup: Wand2,
  construction: HardHat, proposals: FileText, calc: Calculator, hub: Wrench,
  team: Users, portfolio: Wallet, predict: Sparkles, focus: Compass, mywork: Inbox, coordination: Network, executive: ClipboardList, portfolioiq: FolderKanban, billing: Receipt, actions: Zap, field: Hammer, fieldai: Radar, autopilot: Cpu, forecast: Dices, quality: Microscope, procurementrisk: Truck, safety: LifeBuoy, costiq: TrendingDown, ncr: FileWarning, vendorscore: Award,
  ask: Bot, docs: Archive, directory: BookOpen, mcp: Plug, automation: Workflow,
  compliance: ShieldAlert, fixlibrary: Lightbulb, knowledge: Library, integrations: Link2,
  notifications: Bell, system: Settings,
}

export interface NavSidebarProps {
  badges?:     Record<string, number>
  policy?:     Partial<OwnerConfig>
  onNavigate?: (tab: string) => void
}

export function NavSidebar({ badges = {}, policy, onNavigate }: NavSidebarProps) {
  const activeTab   = useAppStore(s => s.ui.activeTab)
  const navOrder    = useAppStore(s => s.ui.navOrder)
  const navHidden   = useAppStore(s => s.ui.navHidden)
  const collapsed   = useAppStore(s => s.ui.sidebarCollapsed)
  const setTab      = useAppStore(s => s.setTab)
  const setCollapsed= useAppStore(s => s.setSidebarCollapsed)
  const ownerConfig = useAppStore(s => s.ownerConfig)
  const cfg         = { ...ownerConfig, ...policy }

  const orderedItems: NavItem[] = navOrder.length
    ? navOrder.map(id => NAVIGATION_ITEMS.find(n => n.id === id)!).filter(Boolean)
    : NAVIGATION_ITEMS

  const _filtered = orderedItems.filter(item => {
    if (navHidden[item.id]) return false
    if (cfg.activeRole === 'owner' || !cfg.activeRole) return true
    if (cfg.activeRole === 'admin') return true
    if (cfg.activeRole === 'engineer' || cfg.activeRole === 'project_manager') {
      return ['operations','engineering','construction','documents','field'].includes(item.domain ?? '')
    }
    if (cfg.activeRole === 'viewer') {
      return ['operations','documents'].includes(item.domain ?? '')
    }
    return true
  })
  // Safety: if filter wipes everything (bad persisted state or unknown role), show full nav
  const visibleItems = _filtered.length ? _filtered : orderedItems

  function navigate(id: string) {
    setTab(id)
    onNavigate?.(id)
  }

  // Lifecycle sections (WORKFLOW_REDESIGN W1). Group the already-filtered items
  // by section, preserving section order and per-item order within each section.
  // Any item without a known section falls into a trailing "More" group so nothing
  // can ever be hidden by a missing/typo'd section id.
  const [collapsedSecs, setCollapsedSecs] = useState<Record<string, boolean>>({})
  const KNOWN_SECTIONS = new Set(NAV_SECTIONS.map(s => s.id))
  const grouped = [
    ...NAV_SECTIONS.map(sec => ({ ...sec, items: visibleItems.filter(it => it.section === sec.id) })),
    { id: '_more', label: 'More', items: visibleItems.filter(it => !it.section || !KNOWN_SECTIONS.has(it.section)) },
  ].filter(sec => sec.items.length)
  function toggleSection(id: string) {
    setCollapsedSecs(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function renderItem(item: NavItem) {
    const isActive   = activeTab === item.id
    const badgeCount = badges[item.id] ?? 0
    const Icon       = ICON_MAP[item.id] ?? LayoutDashboard
    return (
      <button
        key={item.id}
        onClick={() => navigate(item.id)}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className="jarvis-nav-item"
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 10,
          padding: collapsed ? '10px 0' : '8px 10px',
          marginBottom: 2,
          background: isActive ? 'rgba(245,158,11,0.12)' : 'transparent',
          border: 'none', borderRadius: 'var(--jarvis-r-md)',
          cursor: 'pointer', position: 'relative',
          color: isActive ? 'var(--jarvis-ac-hover)' : 'var(--jarvis-ts)',
          transition: 'background var(--jarvis-t-fast), color var(--jarvis-t-fast)',
          fontFamily: 'var(--jarvis-font-sans)',
          fontSize: 13, fontWeight: isActive ? 600 : 500,
        }}
        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = 'var(--jarvis-sf)'; e.currentTarget.style.color = 'var(--jarvis-tx)' } }}
        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--jarvis-ts)' } }}
      >
        <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
        {!collapsed && (
          <span style={{ flex: 1, textAlign: 'left', letterSpacing: '-0.01em' }}>{item.label}</span>
        )}
        {!collapsed && badgeCount > 0 && (
          <span style={{
            minWidth: 20, height: 20, borderRadius: 10,
            background: 'var(--jarvis-ac)', color: '#0a0b0f',
            fontSize: 10, fontWeight: 700, lineHeight: '20px',
            textAlign: 'center', padding: '0 6px',
            fontFamily: 'var(--jarvis-font-mono)',
          }}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
        {collapsed && badgeCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 6,
            minWidth: 8, height: 8, borderRadius: 4,
            background: 'var(--jarvis-ac)',
          }} aria-label={String(badgeCount) + ' items'} />
        )}
      </button>
    )
  }

  const WIDTH = collapsed ? 64 : 208

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: WIDTH, minWidth: WIDTH,
        background: 'linear-gradient(180deg, var(--jarvis-bg2) 0%, var(--jarvis-bg) 100%)',
        borderRight: '1px solid var(--jarvis-bd)',
        display: 'flex', flexDirection: 'column',
        transition: 'width var(--jarvis-t-normal)',
        overflow: 'hidden', userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Brand */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: collapsed ? '16px 0' : '16px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderBottom: '1px solid var(--jarvis-bd)', flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, var(--jarvis-ac) 0%, var(--jarvis-ac-dim) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 20px rgba(245,158,11,0.3)', flexShrink: 0,
        }}>
          <ShieldCheck size={18} strokeWidth={2.5} color="#0a0b0f" />
        </div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1.2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--jarvis-tx)', letterSpacing: '-0.01em' }}>Denver Engineering</span>
            <span style={{ fontSize: 10, color: 'var(--jarvis-ts)', fontFamily: 'var(--jarvis-font-mono)' }}>v4.30.0</span>
          </div>
        )}
      </div>

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 8px' }}>
        {collapsed
          ? visibleItems.map(renderItem)
          : grouped.map(sec => {
              const hasActive = sec.items.some(it => it.id === activeTab)
              // Active section is always shown; otherwise honor the user's toggle.
              const open = hasActive || !collapsedSecs[sec.id]
              return (
                <div key={sec.id} style={{ marginBottom: 6 }}>
                  <button
                    onClick={() => toggleSection(sec.id)}
                    aria-expanded={open}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 10px 4px', marginTop: 2,
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'var(--jarvis-td)', textTransform: 'uppercase',
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                      fontFamily: 'var(--jarvis-font-sans)',
                    }}
                  >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span style={{ flex: 1, textAlign: 'left' }}>{sec.label}</span>
                  </button>
                  {open && sec.items.map(renderItem)}
                </div>
              )
            })}
      </div>

      {/* Footer: Owner + Collapse */}
      <div style={{ borderTop: '1px solid var(--jarvis-bd)', padding: 8, flexShrink: 0 }}>
        {cfg.activeRole === 'owner' && (
          <button
            onClick={() => useAppStore.getState().setOwnerPanel(true)}
            aria-label="Owner settings"
            title={collapsed ? 'Owner settings' : undefined}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-start', gap: 10,
              padding: collapsed ? '10px 0' : '8px 10px', marginBottom: 4,
              background: 'transparent', border: 'none',
              borderRadius: 'var(--jarvis-r-md)', cursor: 'pointer',
              color: 'var(--jarvis-ts)', fontSize: 13, fontWeight: 500,
              fontFamily: 'var(--jarvis-font-sans)',
              transition: 'background var(--jarvis-t-fast), color var(--jarvis-t-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--jarvis-sf)'; e.currentTarget.style.color = 'var(--jarvis-tx)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--jarvis-ts)' }}
          >
            <Settings size={18} strokeWidth={1.75} />
            {!collapsed && <span style={{ letterSpacing: '-0.01em' }}>Owner</span>}
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start', gap: 10,
            padding: collapsed ? '10px 0' : '8px 10px',
            background: 'transparent', border: 'none',
            borderRadius: 'var(--jarvis-r-md)', cursor: 'pointer',
            color: 'var(--jarvis-td)', fontSize: 12,
            transition: 'color var(--jarvis-t-fast)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--jarvis-ts)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--jarvis-td)' }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}

export default NavSidebar
