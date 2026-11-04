"use client";
import { Loader2 } from "lucide-react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LogoMark } from "@/components/domain/logo";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL, type Role } from "@/lib/types";

const DEMO: { email: string; role: Role; scope: string }[] = [
  { email: "dlh@doctorpv.id", role: "dlh", scope: "Seluruh data dan kontrol demo" },
  { email: "admin.rt@doctorpv.id", role: "admin_rt", scope: "Seluruh gang dan kontrol demo" },
  { email: "gang1@doctorpv.id", role: "koordinator", scope: "Hanya Gang 1" },
  { email: "teknisi1@doctorpv.id", role: "teknisi", scope: "Diagnosis dan alert, tanpa nama pemilik" },
];

function NeighborhoodScene() {
  const houses = [70, 190, 310, 430];
  return (
    <svg viewBox="0 0 560 300" className="w-full max-w-xl" role="img" aria-label="Rumah berpanel surya mengalirkan energi ke baterai bersama">
      <circle cx="470" cy="58" r="26" fill="#f59e0b" />
      <circle cx="470" cy="58" r="40" fill="#f59e0b" opacity="0.14" />
      {houses.map((x, i) => (
        <g key={x}>
          <path className="flow-line" d={`M${x} 90 C ${x} 40, ${430} 40, 470 62`} fill="none" stroke="#f59e0b" strokeOpacity="0.28" strokeWidth="1.5" style={{ animationDelay: `${i * 0.2}s` }} />
          <path d={`M${x - 42} 128 L${x} 92 L${x + 42} 128 Z`} fill="#1d3a55" />
          <path d={`M${x - 20} 118 L${x + 2} 99 L${x + 28} 121 L${x + 4} 124 Z`} fill="#10b981" />
          <path d={`M${x - 8} 108 L${x + 16} 122 M${x + 2} 99 L${x + 3} 124`} stroke="#0a1b2e" strokeWidth="1" />
          <rect x={x - 34} y="128" width="68" height="58" fill="#12293f" />
          <rect x={x - 22} y="142" width="16" height="16" fill="#f59e0b" opacity="0.75" />
          <rect x={x + 8} y="146" width="16" height="40" fill="#0a1b2e" />
          <path className="flow-line" d={`M${x} 186 V 226 H 250`} fill="none" stroke="#10b981" strokeWidth="2" />
        </g>
      ))}
      <rect x="205" y="208" width="130" height="62" rx="10" fill="#12293f" stroke="#10b981" strokeOpacity="0.5" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={218 + i * 21} y="224" width="15" height="32" rx="3" fill={i < 4 ? "#10b981" : "#1d3a55"} />
      ))}
      <path className="flow-line" d="M335 240 H 500 V 200" fill="none" stroke="#38bdf8" strokeWidth="2" />
      <path d="M485 200 L500 150 L515 200 M490 183 H510 M494 168 H506" fill="none" stroke="#38bdf8" strokeWidth="2" />
      <text x="270" y="288" textAnchor="middle" fill="#94a3b8" fontSize="12">Baterai bersama per gang</text>
      <text x="500" y="140" textAnchor="middle" fill="#94a3b8" fontSize="12">PLN</text>
    </svg>
  );
}

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
      router.replace("/dashboard");
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

  const input = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-primary";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-rail p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <LogoMark className="h-10 w-10" />
          <p className="text-lg font-bold tracking-tight">DOCTOR PV</p>
        </div>
        <div className="space-y-8">
          <NeighborhoodScene />
          <div className="max-w-lg">
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">
              Satu RT, 100 atap surya, 50 baterai, dipantau dan dirawat bersama.
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">Community Energy Management System berbasis AIoT.</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">Prototipe dengan data simulasi.</p>
      </section>

      <section className="flex items-center justify-center bg-bg p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <LogoMark />
            <p className="font-bold tracking-tight">DOCTOR PV</p>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-ink">Masuk ke pusat kendali</h2>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink-2">Email</label>
              <input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink-2">Kata sandi</label>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
            </div>
            {error ? <p role="alert" className="text-xs text-st-critical">{error}</p> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={busy !== null}>
              {busy === email && email ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Masuk
            </Button>
          </form>
          {demo ? (
            <div className="mt-7">
              <p className="text-xs font-medium text-ink-2">Masuk cepat sebagai akun demo</p>
              <ul className="mt-2 space-y-1.5">
                {DEMO.map((a) => (
                  <li key={a.email}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void login(a.email, "demo1234")}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-primary disabled:opacity-60"
                    >
                      <span>
                        <span className="block text-sm font-medium text-ink">{ROLE_LABEL[a.role]}</span>
                        <span className="block text-xs text-ink-3">{a.scope}</span>
                      </span>
                      {busy === a.email ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" aria-hidden /> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-3">Kata sandi semua akun demo: <span className="num">demo1234</span></p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
