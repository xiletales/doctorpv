"use client";
import { create } from "zustand";

interface UiState {
  gangId: string | null;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  demoOpen: boolean;
  setGang: (id: string | null) => void;
  toggleSidebar: () => void;
  setPalette: (open: boolean) => void;
  setDemo: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  gangId: null,
  sidebarCollapsed: false,
  paletteOpen: false,
  demoOpen: false,
  setGang: (gangId) => set({ gangId }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setDemo: (demoOpen) => set({ demoOpen }),
}));
