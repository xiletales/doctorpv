"use client";
import { create } from "zustand";
import type { LiveSnapshot } from "@/lib/live/store";

interface LiveState {
  snapshot: LiveSnapshot | null;
  connected: boolean;
  lastUpdate: number;
  setSnapshot: (s: LiveSnapshot) => void;
  setConnected: (c: boolean) => void;
}

export const useLive = create<LiveState>((set) => ({
  snapshot: null,
  connected: false,
  lastUpdate: 0,
  setSnapshot: (snapshot) => set({ snapshot, lastUpdate: Date.now(), connected: true }),
  setConnected: (connected) => set({ connected }),
}));
