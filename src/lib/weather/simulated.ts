import { ambientC, clearSky, irradiance } from "../sim/physics";
import { wibDay } from "../sim/time";
import type { WeatherProvider, WeatherReading } from "./types";

/**
 * The reference for simulated telemetry, and the offline fallback. Simulated panels must be judged
 * against the simulated sky: comparing them with real weather would create false disagreements.
 */
export class SimulatedWeatherProvider implements WeatherProvider {
  readonly label = "Cuaca: simulasi";

  constructor(private readonly cloudOverride: () => number | null) {}

  async current(ts: number): Promise<WeatherReading> {
    const g = irradiance(ts, wibDay(ts)) * (this.cloudOverride() ?? 1);
    const clear = clearSky(ts);
    return { ts, irradiance: g, cloudCover: clear > 20 ? Math.max(0, Math.min(1, 1 - g / clear)) : 0, ambientC: ambientC(ts) };
  }
}
