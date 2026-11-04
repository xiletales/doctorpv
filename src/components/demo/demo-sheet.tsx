"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useUi } from "@/stores/ui";
import { DemoPanel } from "./demo-panel";

/** Shift+D opens the scenario controls over any page, without a backdrop, so the page stays visible. */
export function DemoSheet() {
  const open = useUi((s) => s.demoOpen);
  const setOpen = useUi((s) => s.setDemo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return;
      if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        setOpen(!useUi.getState().demoOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-y-3 right-3 z-40 flex w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-ink">Kontrol demo</Dialog.Title>
            <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Tutup kontrol demo"><X className="h-4 w-4" /></Button></Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-3"><DemoPanel /></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
