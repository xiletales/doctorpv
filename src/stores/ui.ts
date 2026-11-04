"use client";
import { create } from "zustand";

interface UiState {
  zoneId: string | null;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  demoOpen: boolean;
  setZone: (id: string | null) => void;
  toggleSidebar: () => void;
  setPalette: (open: boolean) => void;
  setDemo: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  zoneId: null,
  sidebarCollapsed: false,
  paletteOpen: false,
  demoOpen: false,
  setZone: (zoneId) => set({ zoneId }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setDemo: (demoOpen) => set({ demoOpen }),
}));
