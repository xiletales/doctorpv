import { hash01 } from "./rng";
import { hourOfDay, wibDay } from "./time";

const SUNRISE = 5.5;
const SUNSET = 17.75;

export const GAMMA = -0.004;

/** Clear-sky global irradiance on the panel plane in W/m². */
export function clearSky(ts: number): number {
  const h = hourOfDay(ts);
  if (h <= SUNRISE || h >= SUNSET) return 0;
  const x = (h - SUNRISE) / (SUNSET - SUNRISE);
  return 1000 * Math.pow(Math.sin(Math.PI * x), 1.25);
}

/** demoDay is kept fair-weather in the morning so that a pitch never opens on an overcast sky. */
export function cloudFactor(ts: number, demoDay: number): number {
  const day = wibDay(ts);
  const h = hourOfDay(ts);
  const kind = hash01(day, 7);
  const bucket = Math.floor(ts / 600);
  const noise = hash01(bucket, 13);
  const next = hash01(bucket + 1, 13);
  const frac = (ts % 600) / 600;
  const drift = noise + (next - noise) * frac;

  if (day === demoDay) {
    if (h < 13) return 0.93 + 0.07 * drift;
    return kind < 0.3 && h > 14 ? 0.45 + 0.25 * drift : 0.8 + 0.2 * drift;
  }
  if (kind < 0.1) return 0.35 + 0.25 * drift; // overcast
  if (kind < 0.4 && h > 13) return 0.3 + 0.35 * drift; // rainy afternoon
  if (kind < 0.7) return 0.7 + 0.3 * drift; // scattered cloud
  return 0.9 + 0.1 * drift;
}

export function irradiance(ts: number, demoDay: number): number {
  return clearSky(ts) * cloudFactor(ts, demoDay);
}

export function ambientC(ts: number): number {
  const h = hourOfDay(ts);
  return 27 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + (hash01(wibDay(ts), 3) - 0.5) * 1.5;
}

export function cellTempC(g: number, ambient: number): number {
  return ambient + (g / 800) * 26;
}

/** P = capacity × (G/1000) × PR × (1 + γ(Tcell − 25)), in watts. */
export function pvPowerW(capacityKwp: number, g: number, ambient: number, pr: number): number {
  const t = cellTempC(g, ambient);
  return Math.max(0, capacityKwp * 1000 * (g / 1000) * pr * (1 + GAMMA * (t - 25)));
}

const bump = (h: number, center: number, width: number) => Math.exp(-Math.pow(h - center, 2) / width);

/**
 * Load by building type. Homes: morning peak, low midday, strong evening peak 18:00 to 22:00.
 * Musala: evening-heavy around the prayer times. School and hall: daytime-heavy.
 */
export function loadW(index: number, scale: number, ts: number, kind: "rumah" | "musala" | "balai" | "sekolah" = "rumah"): number {
  const h = hourOfDay(ts);
  const noise = 0.85 + 0.3 * hash01(index, Math.floor(ts / 900));
  if (kind === "musala") return (60 + 350 * bump(h, 4.8, 0.3) + 250 * bump(h, 12, 0.3) + 800 * bump(h, 18, 0.5) + 900 * bump(h, 19.25, 0.5)) * noise;
  if (kind === "balai") return (70 + (h >= 8 && h < 15 ? 520 : 0) + 450 * bump(h, 20, 1.2)) * noise;
  if (kind === "sekolah") {
    const weekday = new Date(ts * 1000 + 7 * 3600 * 1000).getUTCDay();
    const inSession = weekday >= 1 && weekday <= 5 && h >= 7 && h < 14;
    return (80 + (inSession ? 1100 : 0)) * noise;
  }
  const morning = 300 * bump(h, 6.5, 1.6);
  const evening = 650 * bump(h, 19.5, 4.2);
  const midday = 120 * bump(h, 13, 6);
  return (140 + morning + midday + evening) * scale * noise;
}
