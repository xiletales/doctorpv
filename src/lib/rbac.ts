import type { Role, SessionUser } from "./types";

export type Action =
  | "alerts:write"
  | "demo:control"
  | "workorders:create"
  | "workorders:update"
  | "owner:viewAll"
  | "owner:viewOwnGang";

const ACTIONS: Record<Role, Action[]> = {
  dlh: ["alerts:write", "demo:control", "owner:viewAll", "workorders:create", "workorders:update"],
  admin_rt: ["alerts:write", "demo:control", "owner:viewAll", "workorders:create", "workorders:update"],
  koordinator: ["alerts:write", "owner:viewOwnGang", "workorders:create"],
  teknisi: ["alerts:write", "workorders:update"],
};

export function can(role: Role, action: Action): boolean {
  return ACTIONS[role].includes(action);
}

/** null means every gang. Otherwise the list of gang ids the user may see. */
export function gangScope(user: Pick<SessionUser, "role" | "gangIds">): string[] | null {
  return user.role === "koordinator" ? user.gangIds : null;
}

export function inScope(user: Pick<SessionUser, "role" | "gangIds">, gangId: string): boolean {
  const scope = gangScope(user);
  return scope === null || scope.includes(gangId);
}

export function canSeeOwnerName(
  user: Pick<SessionUser, "role" | "gangIds">,
  gangId: string,
): boolean {
  if (can(user.role, "owner:viewAll")) return true;
  return can(user.role, "owner:viewOwnGang") && user.gangIds.includes(gangId);
}

export interface NavItem {
  href: string;
  label: string;
  group: "Pemantauan" | "Kecerdasan" | "Operasional" | "Sistem";
  icon: string;
  roles: Role[];
}

const ALL: Role[] = ["dlh", "admin_rt", "koordinator", "teknisi"];

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Ringkasan", group: "Pemantauan", icon: "gauge", roles: ALL },
  { href: "/map", label: "Peta Geospasial", group: "Pemantauan", icon: "map", roles: ALL },
  { href: "/solar", label: "Rumah dan Surya", group: "Pemantauan", icon: "home", roles: ALL },
  { href: "/batteries", label: "Kesehatan Baterai", group: "Pemantauan", icon: "battery", roles: ALL },
  { href: "/ai", label: "Diagnosis AI", group: "Kecerdasan", icon: "brain", roles: ALL },
  { href: "/energy", label: "Energi Hibrida", group: "Pemantauan", icon: "zap", roles: ALL },
  { href: "/alerts", label: "Pusat Alert", group: "Operasional", icon: "siren", roles: ALL },
  { href: "/maintenance", label: "Pemeliharaan", group: "Operasional", icon: "wrench", roles: ALL },
  { href: "/about", label: "Arsitektur Sistem", group: "Sistem", icon: "info", roles: ALL },
  { href: "/demo", label: "Kontrol Demo", group: "Sistem", icon: "sliders", roles: ["dlh", "admin_rt"] },
];

export function navFor(role: Role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

const PAGE_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/demo", roles: ["dlh", "admin_rt"] },
];

export function canOpenPage(role: Role, pathname: string): boolean {
  const rule = PAGE_ROLES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  return rule ? rule.roles.includes(role) : true;
}
