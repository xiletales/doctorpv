"use client";
import { Activity, BatteryCharging, BrainCircuit, Loader2, MapPinned, Wrench } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LogoMark } from "@/components/domain/logo";
import { PulseLine } from "@/components/domain/pulse-score";
import { ClusterIsometric } from "@/components/illustrations/cluster-isometric";
import { Button } from "@/components/ui/button";
import { PROJECT_TITLE, SITE } from "@/lib/site";
import { ROLE_LABEL, type AssetStatus, type Role } from "@/lib/types";

const DEMO: { email: string; role: Role; scope: string }[] = [
  { email: "dlh@sunpulse.id", role: "dlh", scope: "Seluruh data dan kontrol demo" },
  { email: "pengurus@sunpulse.id", role: "pengurus", scope: "Pengelolaan RW 1 dan kontrol demo" },
  { email: "teknisi1@sunpulse.id", role: "teknisi", scope: "Diagnosis dan pekerjaan, tanpa nama pemilik" },
  { email: "warga.h01@sunpulse.id", role: "warga", scope: "Hanya rumah H01 dan baterainya" },
];

const FEATURES = [
  { icon: Activity, title: "Pantau", body: "Produksi, beban, dan baterai secara langsung" },
  { icon: BrainCircuit, title: "Diagnosis", body: "Anomali dan kemungkinan penyebab beserta buktinya" },
  { icon: BatteryCharging, title: "Rawat baterai", body: "SoH, suhu, dan estimasi sisa masa pakai" },
  { icon: MapPinned, title: "Petakan", body: "Setiap PV, baterai, dan gateway di peta" },
  { icon: Wrench, title: "Tindak lanjuti", body: "Dari alert ke perintah kerja, lalu evaluasi" },
];

/** The same four issues as the default demo state, so the art matches what the product shows after login. */
const HERO_STATUS: Record<string, AssetStatus> = { H07: "warning", H13: "warning", B11: "warning", H26: "offline", H19: "maintenance" };

export function LoginView({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = async (mail: string, pass: string) => {
    setBusy(mail);
    setError(null);
    const res = await signIn("credentials", { email: mail, password: pass, redirect: false });
    if (res?.ok) {
      router.replace("/");
      router.refresh();
      return;
    }
    setBusy(null);
    setError("Email atau kata sandi salah. Periksa kembali lalu coba lagi.");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void login(email, password);
  };

  const input = "h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-amber-400";

  return (
    <div className="dark relative min-h-dvh overflow-hidden bg-[#070b14] text-white">
      <div className="aurora" aria-hidden />
      <div className="relative mx-auto grid min-h-dvh max-w-[1500px] gap-6 p-6 lg:grid-cols-[1fr_400px] lg:gap-10 lg:p-10">
        <main className="flex min-w-0 flex-col justify-between gap-6">
          <header className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <div>
              <p className="display text-xl font-bold tracking-wide">SUNPULSE</p>
              <p className="text-xs text-slate-400">{SITE.name}, {SITE.area}</p>
            </div>
          </header>
          <div>
            <h1 className="display max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl xl:text-6xl">Denyut energi klaster permukiman Anda.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              {PROJECT_TITLE}
            </p>
            <PulseLine bpm={72} color="#FBBF24" className="mt-4 h-8 w-64" />
          </div>
          <ClusterIsometric statuses={HERO_STATUS} className="mx-auto hidden max-h-[48vh] w-full lg:block" />
          <ul className="grid gap-x-5 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <p className="flex items-center gap-1.5 text-sm font-semibold"><f.icon className="h-4 w-4 text-amber-300" aria-hidden /> {f.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{f.body}</p>
              </li>
            ))}
          </ul>
        </main>

        <section className="hairline self-center rounded-3xl bg-white/[0.04] p-6 backdrop-blur-md" aria-label="Masuk">
          <h2 className="display text-xl font-semibold tracking-tight">Masuk ke pusat kendali</h2>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-slate-300">Email</label>
              <input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-slate-300">Kata sandi</label>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            </div>
            {error ? <p role="alert" className="text-xs text-red-300">{error}</p> : null}
            <Button type="submit" className="w-full bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-[#070b14] hover:opacity-90" disabled={busy !== null}>
              {busy === email && email ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Masuk
            </Button>
          </form>
          {demo ? (
            <div className="mt-6">
              <p className="text-xs font-medium text-slate-300">Masuk cepat sebagai akun demo</p>
              <ul className="mt-2 space-y-1.5">
                {DEMO.map((a) => (
                  <li key={a.email}>
                    <button type="button" disabled={busy !== null} onClick={() => void login(a.email, "demo1234")} className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:border-amber-400/70 disabled:opacity-60">
                      <span>
                        <span className="block text-sm font-medium">{ROLE_LABEL[a.role]}</span>
                        <span className="block text-xs text-slate-400">{a.scope}</span>
                      </span>
                      {busy === a.email ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-hidden /> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-400">Kata sandi semua akun demo: <span className="num">demo1234</span></p>
            </div>
          ) : null}
          <p className="mt-4 text-xs text-slate-500">Prototipe dengan data simulasi.</p>
        </section>
      </div>
    </div>
  );
}
