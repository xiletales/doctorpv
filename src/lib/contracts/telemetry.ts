import { z } from "zod";

/** Mirrors docs/iot-contract.md. One message per device, and gateways POST messages as a batch. */
const base = {
  deviceId: z.string().min(3).max(40),
  assetId: z.string().min(2).max(20),
  gatewayId: z.string().regex(/^GW-[1-5]$/),
  ts: z.iso.datetime({ offset: true }),
  seq: z.number().int().nonnegative(),
  buffered: z.boolean(),
};

export const pvMessage = z.object({
  ...base,
  type: z.literal("pv"),
  metrics: z.object({
    dcVoltage: z.number(),
    dcCurrent: z.number(),
    acPowerW: z.number(),
    panelTempC: z.number(),
  }),
  status: z.object({ inverter: z.enum(["OK", "TRIP", "IDLE"]), rssi: z.number().int() }),
});

export const batteryMessage = z.object({
  ...base,
  type: z.literal("battery"),
  metrics: z.object({
    voltage: z.number(),
    currentA: z.number(),
    soc: z.number(),
    soh: z.number(),
    tempC: z.number(),
    spreadMv: z.number(),
    cycles: z.number(),
  }),
  status: z.object({ bms: z.enum(["OK", "WARN", "ALARM"]), rssi: z.number().int() }),
});

export const meterMessage = z.object({
  ...base,
  type: z.literal("meter"),
  metrics: z.object({
    pvW: z.number(),
    loadW: z.number(),
    plnImportW: z.number(),
    chargeW: z.number(),
    dischargeW: z.number(),
    curtailW: z.number(),
    irradiance: z.number(),
    ambientC: z.number(),
  }),
});

export const telemetryMessage = z.discriminatedUnion("type", [pvMessage, batteryMessage, meterMessage]);
export type TelemetryMessage = z.infer<typeof telemetryMessage>;
export type PvMessage = z.infer<typeof pvMessage>;
export type BatteryMessage = z.infer<typeof batteryMessage>;
export type MeterMessage = z.infer<typeof meterMessage>;

export const ingestBatch = z.object({
  gatewayId: z.string().regex(/^GW-[1-5]$/),
  messages: z.array(z.unknown()).max(5000),
});

export const SCENARIOS = [
  "inverter_h021",
  "battery_b025_overheat",
  "gateway_gw3_offline",
  "gateway_gw3_reconnect",
  "reset",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface SimDirective {
  clock: { mode: "locked" | "real"; lockAt: string };
  inverterH021: boolean;
  batteryB025: boolean;
  gw3Offline: boolean;
  /** Increments on reset so the simulator drops its scenario state exactly once. */
  resetEpoch: number;
}
