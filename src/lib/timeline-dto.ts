export interface TimelinePoint {
  ts: number;
  pvW: number;
  loadW: number;
  plnW: number;
  chargeW: number;
  dischargeW: number;
  curtailW: number;
  irradiance: number;
  soc: number;
}

export interface TimelineDto {
  now: number;
  dayStart: number;
  points: TimelinePoint[];
}
