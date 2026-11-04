import { z } from "zod";

/** Mirrors docs/iot-contract.md. One message per device, and gateways POST messages as a batch. */
const base = {
  deviceId: z.string().min(3).max(40),
  assetId: z.string().min(2).max(20),
  gatewayId: z.string().regex(/^GW-[1-3]$/),
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
    /** The point's own low-cost irradiance sensor, in W/m². Null when it reports nothing. */
    irradiance: z.number().nullable(),
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
  gatewayId: z.string().regex(/^GW-[1-3]$/),
  messages: z.array(z.unknown()).max(5000),
});

/** Irradiance multiplier for the cloud scenarios. Cooler panels recover a little, so output falls about 60%. */
export const CLOUD_FACTOR = 0.36;

export const SCENARIOS = [
  "inverter_h21",
  "battery_b08_overheat",
  "gateway_gw3_offline",
  "gateway_gw3_reconnect",
  "cloudy_day",
  "cloudy_soiled",
  "fast_forward_30d",
  "reset",
] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

export interface SimDirective {
  clock: { mode: "locked" | "real"; lockAt: string };
  inverterH21: boolean;
  batteryB08: boolean;
  gw3Offline: boolean;
  cloudy: boolean;
  /** Set by "Mendung + panel kotor": other faults are cleared so that only one panel stands out. */
  cloudySoiled: boolean;
  fastForward: boolean;
  /** Assets whose fault a completed work order has physically fixed. */
  repaired: string[];
  /** Increments on reset so the simulator drops its scenario state exactly once. */
  resetEpoch: number;
}
