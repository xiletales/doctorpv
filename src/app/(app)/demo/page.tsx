"use client";
import { DemoPanel } from "@/components/demo/demo-panel";
import { PageTitle } from "@/components/domain/status";

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <PageTitle title="Kontrol demo" description="Picu gangguan selama presentasi. Tekan Shift+D untuk membuka panel ini di halaman mana pun." />
      <DemoPanel />
    </div>
  );
}
