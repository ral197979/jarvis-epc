import { create } from 'zustand'

/** Global UI state: active project, panels, command palette. */
interface UiState {
  activeProjectId: string
  setActiveProject: (id: string) => void
  contextPanelOpen: boolean
  toggleContextPanel: () => void
  setContextPanel: (open: boolean) => void
  commandOpen: boolean
  setCommandOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  activeProjectId: 'PRJ-2024-004',
  setActiveProject: (id) => set({ activeProjectId: id }),
  contextPanelOpen: true,
  toggleContextPanel: () => set((s) => ({ contextPanelOpen: !s.contextPanelOpen })),
  setContextPanel: (open) => set({ contextPanelOpen: open }),
  commandOpen: false,
  setCommandOpen: (open) => set({ commandOpen: open }),
}))
