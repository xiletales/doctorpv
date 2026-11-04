import type { Role, SessionUser } from "./types";

export type Action =
  | "alerts:write"
  | "demo:control"
  | "workorders:create"
  | "workorders:update"
  | "owner:viewAll";

const ACTIONS: Record<Role, Action[]> = {
  dlh: ["alerts:write", "demo:control", "owner:viewAll", "workorders:create", "workorders:update"],
  admin: ["alerts:write", "demo:control", "owner:viewAll", "workorders:create", "workorders:update"],
  teknisi: ["alerts:write", "workorders:update"],
  warga: [],
};

export function can(role: Role, action: Action): boolean {
  return ACTIONS[role].includes(action);
}

export function canSeeOwnerName(user: Pick<SessionUser, "role">): boolean {
  return can(user.role, "owner:viewAll");
}

export interface NavItem {
  href: string;
  label: string;
  group: "Pemantauan" | "Kecerdasan" | "Operasional" | "Sistem";
  icon: string;
  roles: Role[];
}

const STAFF: Role[] = ["dlh", "admin", "teknisi"];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dasbor", group: "Pemantauan", icon: "gauge", roles: STAFF },
  { href: "/map", label: "Peta", group: "Pemantauan", icon: "map", roles: STAFF },
  { href: "/solar", label: "Rumah & PLTS", group: "Pemantauan", icon: "home", roles: STAFF },
  { href: "/batteries", label: "Baterai", group: "Pemantauan", icon: "battery", roles: STAFF },
  { href: "/energy", label: "Energi Hibrida", group: "Pemantauan", icon: "zap", roles: STAFF },
  { href: "/ai", label: "Diagnosis AI", group: "Kecerdasan", icon: "brain", roles: STAFF },
  { href: "/alerts", label: "Pusat Notifikasi", group: "Operasional", icon: "siren", roles: STAFF },
  { href: "/maintenance", label: "Pemeliharaan", group: "Operasional", icon: "wrench", roles: STAFF },
  { href: "/about", label: "Arsitektur Sistem", group: "Sistem", icon: "info", roles: STAFF },
  { href: "/demo", label: "Kontrol Demo", group: "Sistem", icon: "sliders", roles: ["dlh", "admin"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

/** Warga only ever reach the resident page. Staff never need it. */
export function homeFor(role: Role): string {
  return role === "warga" ? "/r" : "/dashboard";
}

export function canOpenPage(role: Role, pathname: string): boolean {
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  if (role === "warga") return under("/r");
  if (under("/r")) return false;
  if (under("/demo")) return can(role, "demo:control");
  return true;
}
