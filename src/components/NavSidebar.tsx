/**
 * JARVIS EPC — NavSidebar  (v4.29.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 19b extraction: Navigation sidebar from JarvisApp.
 * Replaces the inline sidebar JSX block (~200 lines) inside JarvisCore.jsx.
 * Reads nav state from useAppStore instead of closure variables.
 */

import React, { useState } from 'react'
import { useAppStore, type OwnerConfig } from '../modules/store/appSlice'
import { NAVIGATION_ITEMS, type NavItem } from '../config/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavSidebarProps {
  badges?:      Record<string, number>   // nav item id → badge count
  policy?:      Partial<OwnerConfig>
  onNavigate?:  (tab: string) => void    // called in addition to store setTab
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NavSidebar({ badges = {}, policy, onNavigate }: NavSidebarProps) {
  const activeTab   = useAppStore(s => s.ui.activeTab)
  const navOrder    = useAppStore(s => s.ui.navOrder)
  const navHidden   = useAppStore(s => s.ui.navHidden)
  const collapsed   = useAppStore(s => s.ui.sidebarCollapsed)
  const setTab      = useAppStore(s => s.setTab)
  const setCollapsed= useAppStore(s => s.setSidebarCollapsed)
  const ownerConfig = useAppStore(s => s.ownerConfig)
  const cfg         = { ...ownerConfig, ...policy }

  // Ordered, filtered nav items
  const orderedItems: NavItem[] = navOrder.length
    ? navOrder.map(id => NAVIGATION_ITEMS.find(n => n.id === id)!).filter(Boolean)
    : NAVIGATION_ITEMS

  const visibleItems = orderedItems.filter(item => {
    if (navHidden[item.id]) return false
    // Role-based tab filter (owner sees all)
    if (cfg.activeRole === 'owner') return true
    // Engineering roles: show engineering domains + operations
    if (cfg.activeRole === 'engineer' || cfg.activeRole === 'project_manager') {
      return ['operations','engineering','construction','documents','field'].includes(item.domain ?? '')
    }
    // Viewers: limited
    if (cfg.activeRole === 'viewer') {
      return ['operations','documents'].includes(item.domain ?? '')
    }
    return true
  })

  function navigate(id: string) {
    setTab(id)
    onNavigate?.(id)
  }

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        width:         collapsed ? 44 : 120,
        minWidth:      collapsed ? 44 : 120,
        background:    'var(--jarvis-bg2)',
        borderRight:   '1px solid var(--jarvis-bd)',
        display:       'flex',
        flexDirection: 'column',
        transition:    'width 0.2s',
        overflow:      'hidden',
        userSelect:    'none',
      }}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
        style={{
          padding:     '8px 0',
          background:  'none',
          border:      'none',
          cursor:      'pointer',
          fontSize:    12,
          color:       'var(--jarvis-ts)',
          textAlign:   'center',
          borderBottom:'1px solid var(--jarvis-bd)',
          flexShrink:  0,
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* Nav items */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
        {visibleItems.map(item => {
          const isActive  = activeTab === item.id
          const badgeCount = badges[item.id] ?? 0
          return (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
              style={{
                width:       '100%',
                display:     'flex',
                flexDirection: collapsed ? 'column' : 'column',
                alignItems:  'center',
                gap:         3,
                padding:     collapsed ? '10px 0' : '8px 4px',
                background:  isActive ? 'color-mix(in srgb, var(--jarvis-ac) 12%, transparent)' : 'none',
                border:      'none',
                borderLeft:  isActive ? '3px solid var(--jarvis-ac)' : '3px solid transparent',
                cursor:      'pointer',
                position:    'relative',
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }} aria-hidden>{item.icon}</span>
              {!collapsed && (
                <span style={{
                  fontSize:   9, fontWeight: isActive ? 700 : 500,
                  color:      isActive ? 'var(--jarvis-ac)' : 'var(--jarvis-ts)',
                  textAlign:  'center', lineHeight: 1.2, maxWidth: 80,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  width: '100%',
                }}>
                  {item.label}
                </span>
              )}
              {badgeCount > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 6,
                  minWidth: 14, height: 14, borderRadius: 7,
                  background: 'var(--jarvis-red)', color: '#fff',
                  fontSize: 8, fontWeight: 700, lineHeight: '14px',
                  textAlign: 'center', padding: '0 3px',
                }} aria-label={`${badgeCount} items`}>
                  {badgeCount > 99 ? '99+' : badgeCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Owner panel button (bottom) */}
      {cfg.activeRole === 'owner' && (
        <button
          onClick={() => useAppStore.getState().setOwnerPanel(true)}
          aria-label="Owner settings"
          title={collapsed ? 'Owner settings' : undefined}
          style={{
            padding:    collapsed ? '10px 0' : '8px 4px',
            background: 'none', border: 'none', cursor: 'pointer',
            borderTop:  '1px solid var(--jarvis-bd)',
            display:    'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
          }}
        >
          <span style={{ fontSize: 16 }} aria-hidden>⚙️</span>
          {!collapsed && <span style={{ fontSize: 9, color: 'var(--jarvis-ts)' }}>Owner</span>}
        </button>
      )}
    </nav>
  )
}

export default NavSidebar
