import type { WeatherProvider, WeatherReading } from "./types";

const CACHE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 5000;

interface Forecast {
  hourly: { time: string[]; shortwave_radiation: (number | null)[]; cloud_cover: (number | null)[]; temperature_2m: (number | null)[] };
  minutely_15?: { time: string[]; shortwave_radiation: (number | null)[] };
}

/** Times arrive as local WIB without an offset, because the request sets timezone=Asia/Jakarta. */
const toTs = (local: string) => Math.floor(new Date(`${local}:00+07:00`).getTime() / 1000);

function nearest(times: string[], ts: number): number {
  let best = -1;
  let gap = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(toTs(t) - ts);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}

/** Free, no API key. Responses are cached, and any failure returns null so that callers fall back quietly. */
export class OpenMeteoProvider implements WeatherProvider {
  readonly label = "Cuaca: Open-Meteo";
  private cache: { at: number; data: Forecast } | null = null;

  constructor(
    private readonly lat: number,
    private readonly lng: number,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async forecast(): Promise<Forecast | null> {
    if (this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.data;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.lat}&longitude=${this.lng}&minutely_15=shortwave_radiation&hourly=shortwave_radiation,cloud_cover,temperature_2m&forecast_days=2&timezone=Asia%2FJakarta`;
    try {
      const res = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) return this.cache?.data ?? null;
      const data = (await res.json()) as Forecast;
      if (!Array.isArray(data.hourly?.time)) return this.cache?.data ?? null;
      this.cache = { at: this.now(), data };
      return data;
    } catch {
      return this.cache?.data ?? null;
    }
  }

  async current(ts: number): Promise<WeatherReading | null> {
    const f = await this.forecast();
    if (!f) return null;
    const h = nearest(f.hourly.time, ts);
    if (h < 0) return null;
    const m = f.minutely_15 ? nearest(f.minutely_15.time, ts) : -1;
    const irradiance = (m >= 0 ? f.minutely_15?.shortwave_radiation[m] : null) ?? f.hourly.shortwave_radiation[h];
    if (irradiance === null) return null;
    return { ts, irradiance, cloudCover: (f.hourly.cloud_cover[h] ?? 0) / 100, ambientC: f.hourly.temperature_2m[h] ?? 28 };
  }
}
