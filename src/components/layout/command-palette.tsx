"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { NavItem } from "@/lib/rbac";
import { useUi } from "@/stores/ui";

const pad = (n: number) => String(n).padStart(2, "0");

export function CommandPalette({ items }: { items: NavItem[] }) {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const router = useRouter();
  const canSolar = items.some((i) => i.href === "/solar");
  const canBatt = items.some((i) => i.href === "/batteries");
  const houses = useMemo(() => (canSolar ? Array.from({ length: 30 }, (_, i) => `H${pad(i + 1)}`) : []), [canSolar]);
  const batteries = useMemo(() => (canBatt ? Array.from({ length: 15 }, (_, i) => `B${pad(i + 1)}`) : []), [canBatt]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const row = "cursor-pointer rounded-lg px-2.5 py-2 text-sm text-ink data-[selected=true]:bg-surface-2";
  const head = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-ink-3";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[15%] z-50 w-[92vw] max-w-lg -translate-x-1/2 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        >
          <Dialog.Title className="sr-only">Pencarian cepat</Dialog.Title>
          <Command label="Pencarian cepat">
            <Command.Input
              autoFocus
              placeholder="Ketik H21, B08, atau nama halaman"
              className="h-12 w-full border-b border-line bg-transparent px-4 text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-ink-3">Tidak ada hasil. Coba ID aset, misalnya H21.</Command.Empty>
              <Command.Group heading="Halaman" className={head}>
                {items.map((i) => (
                  <Command.Item key={i.href} value={i.label} onSelect={() => go(i.href)} className={row}>
                    {i.label}
                  </Command.Item>
                ))}
              </Command.Group>
              {houses.length > 0 ? (
                <Command.Group heading="Rumah dan PV" className={head}>
                  {houses.map((id) => (
                    <Command.Item key={id} value={id} onSelect={() => go(`/solar/${id}`)} className={`${row} num`}>
                      {id}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
              {batteries.length > 0 ? (
                <Command.Group heading="Baterai" className={head}>
                  {batteries.map((id) => (
                    <Command.Item key={id} value={id} onSelect={() => go(`/batteries/${id}`)} className={`${row} num`}>
                      {id}
                    </Command.Item>
                  ))}
                </Command.Group>
              ) : null}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
