export interface WeatherReading {
  ts: number;
  /** Global irradiance in W/m². */
  irradiance: number;
  /** Cloud cover from 0 (clear) to 1 (overcast). */
  cloudCover: number;
  ambientC: number;
}

/** A source of weather reference data. current() returns null when no data is available, and never throws. */
export interface WeatherProvider {
  /** Shown to users, for example "Cuaca: simulasi". */
  readonly label: string;
  current(ts: number): Promise<WeatherReading | null>;
}
