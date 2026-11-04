import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-lg font-semibold text-ink">Halaman tidak ditemukan</h1>
      <p className="text-sm text-ink-3">Periksa alamatnya, atau kembali ke ringkasan energi.</p>
      <Link href="/dashboard" className="mt-2 text-sm font-medium text-primary underline">Buka ringkasan</Link>
    </main>
  );
}
