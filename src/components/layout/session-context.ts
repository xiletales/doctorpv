"use client";
import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/types";

export const SessionContext = createContext<SessionUser | null>(null);

export function useSessionUser(): SessionUser {
  const user = useContext(SessionContext);
  if (!user) throw new Error("useSessionUser must be used inside AppShell");
  return user;
}
