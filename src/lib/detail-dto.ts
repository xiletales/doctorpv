import type { HealthScore } from "./ai/health";
import type { SohForecast } from "./ai/forecast";
import type { AnomalyPayload } from "./ai/pipeline";
import type { AlertDto } from "./alerts/dto";

export interface AssetAnomaly {
  id: string;
  createdAt: number;
  payload: AnomalyPayload;
}

export interface BatteryDetail {
  id: string;
  zoneId: string;
  servedHouses: string[];
  chemistry: string;
  capacityKwh: number;
  nominalVoltage: number;
  installDate: number;
  lat: number;
  lng: number;
  simTs: number;
  series: { ts: number; soc: number; temp: number; voltage: number; current: number }[];
  sohHistory: { ts: number; soh: number }[];
  forecast: SohForecast;
  energy: { ts: number; chargeKwh: number; dischargeKwh: number }[];
  peerTemp: number;
  health: HealthScore | null;
  alerts: AlertDto[];
  anomalies: AssetAnomaly[];
}

export interface HouseDetail {
  id: string;
  zoneId: string;
  batteryId: string;
  ownerCode: string;
  ownerName: string | null;
  address: string;
  lat: number;
  lng: number;
  capacityKwp: number;
  panelCount: number;
  inverterModel: string;
  tilt: number;
  azimuth: number;
  installDate: number;
  baselinePr: number;
  simTs: number;
  dayStart: number;
  today: { ts: number; actual: number; expected: number }[];
  daily: { ts: number; kwh: number; expectedKwh: number; ratio: number }[];
  health: HealthScore | null;
  alerts: AlertDto[];
  anomalies: AssetAnomaly[];
}
