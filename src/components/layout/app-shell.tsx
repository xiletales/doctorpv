"use client";
import { Battery, Bell, BrainCircuit, ChevronsLeft, Gauge, Home, Info, Map, Moon, Search, Siren, SlidersHorizontal, Sun, Wrench, Zap, LogOut, type LucideIcon } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogoMark } from "@/components/domain/logo";
import { Button } from "@/components/ui/button";
import { navFor, type NavItem } from "@/lib/rbac";
import { ROLE_LABEL, type SessionUser } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { SessionContext } from "./session-context";
import { StaleBanner, TopbarLive } from "./topbar-live";
import { CommandPalette } from "./command-palette";
import { LiveProvider } from "./live-provider";
import { DemoSheet } from "@/components/demo/demo-sheet";
import { can } from "@/lib/rbac";

const ICONS: Record<string, LucideIcon> = {
  gauge: Gauge, map: Map, home: Home, battery: Battery, zap: Zap, brain: BrainCircuit, wrench: Wrench,
  siren: Siren, sliders: SlidersHorizontal, info: Info, bell: Bell,
};
const GROUPS: NavItem["group"][] = ["Pemantauan", "Kecerdasan", "Operasional", "Sistem"];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // next-themes only knows the theme on the client, so the icon waits for mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? "Gunakan tema terang" : "Gunakan tema gelap"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2"
          aria-label={`Menu pengguna ${user.name}`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
            {initials}
          </span>
          <span className="hidden text-left leading-tight lg:block">
            <span className="block text-xs font-medium text-ink">{user.name}</span>
            <span className="block text-[11px] text-ink-3">{ROLE_LABEL[user.role]}</span>
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-xl border border-line bg-surface p-1.5 text-ink shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-ink-3">{user.email}</p>
            {user.gangIds.length > 0 ? (
              <p className="mt-1 text-xs text-ink-3">Wilayah: {user.gangIds.map((g) => g.replace("G", "Gang ")).join(", ")}</p>
            ) : null}
          </div>
          <DropdownMenu.Item
            onSelect={() => void signOut({ callbackUrl: "/login" })}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Keluar
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const setPalette = useUi((s) => s.setPalette);
  const items = navFor(user.role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  return (
    <SessionContext.Provider value={user}>
      <div className="flex h-dvh overflow-hidden">
        <aside
          className={cn(
            "hidden shrink-0 flex-col bg-rail text-slate-300 transition-[width] duration-200 md:flex",
            collapsed ? "w-[68px]" : "w-60",
          )}
        >
          <div className="flex h-14 items-center gap-2.5 px-4">
            <LogoMark />
            {!collapsed ? (
              <div className="leading-tight">
                <p className="text-sm font-bold tracking-tight text-white">DOCTOR PV</p>
                <p className="text-[11px] text-slate-400">RT percontohan, 5 gang</p>
              </div>
            ) : null}
          </div>
          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Menu utama">
            {GROUPS.map((group) => {
              const list = items.filter((i) => i.group === group);
              if (list.length === 0) return null;
              return (
                <div key={group}>
                  {!collapsed ? <p className="mb-1.5 px-2.5 text-[11px] font-medium text-slate-500">{group}</p> : null}
                  <ul className="space-y-0.5">
                    {list.map((item) => {
                      const Icon = ICONS[item.icon] ?? Gauge;
                      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            aria-current={active ? "page" : undefined}
                            title={collapsed ? item.label : undefined}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-rail-2 hover:text-white",
                              active && "bg-rail-2 font-medium text-white",
                              collapsed && "justify-center",
                            )}
                          >
                            <Icon className={cn("h-4 w-4 shrink-0", active && "text-emerald-400")} aria-hidden />
                            {!collapsed ? item.label : <span className="sr-only">{item.label}</span>}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Perluas menu" : "Ciutkan menu"}
            className="flex h-11 items-center justify-center border-t border-white/10 text-slate-400 hover:text-white"
          >
            <ChevronsLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} aria-hidden />
          </button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 md:px-4">
            <LogoMark className="md:hidden" />
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink-3 hover:text-ink md:w-64"
            >
              <Search className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden truncate sm:inline">Cari rumah, baterai, halaman</span>
              <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] md:inline">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1 md:gap-2">
              <TopbarLive />
              <ThemeToggle />
              <UserMenu user={user} />
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1.5 md:hidden" aria-label="Menu seluler">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link key={item.href} href={item.href} className={cn("whitespace-nowrap rounded-lg px-2.5 py-1 text-xs", active ? "bg-primary-soft font-medium text-primary" : "text-ink-2")}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <StaleBanner />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <CommandPalette items={items} />
      <LiveProvider />
      {can(user.role, "demo:control") ? <DemoSheet /> : null}
    </SessionContext.Provider>
  );
}
