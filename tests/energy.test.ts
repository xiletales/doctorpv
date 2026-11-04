import { describe, expect, it } from "vitest";
import { detectBatteryAnomalies, type BatteryDaily } from "../src/lib/ai/anomaly";
import { median } from "../src/lib/ai/stats";
import { Engine } from "../src/lib/sim/engine";
import { defaultFaults } from "../src/lib/sim/faults";
import { DAY, dayStart } from "../src/lib/sim/time";
import { buildWorld } from "../src/lib/sim/world";

const world = buildWorld({ lat: -6.2, lng: 106.8 });
const today = dayStart(20000);

describe("topology", () => {
  it("has 30 houses, 15 batteries and 3 gateways, with 1 battery per 2 neighbors", () => {
    expect(world.houses).toHaveLength(30);
    expect(world.batteries).toHaveLength(15);
    expect(world.gateways).toHaveLength(3);
    for (const b of world.batteries) expect(world.houses.filter((h) => h.batteryId === b.id)).toHaveLength(2);
    for (const g of world.gateways) {
      expect(world.houses.filter((h) => h.gatewayId === g.id)).toHaveLength(10);
      expect(world.batteries.filter((b) => b.gatewayId === g.id)).toHaveLength(5);
    }
    expect(world.houses.find((h) => h.id === "H21")?.gatewayId).toBe("GW-3");
  });
});

describe("default demo history", () => {
  it("flags no battery as overheating without a thermal fault, across the whole cluster", () => {
    const engine = new Engine({ world, faults: [], refDayStart: today, demoDay: 20000 });
    engine.warmUp(today - 35 * DAY, today - 30 * DAY);
    const days = new Map<string, Map<number, BatteryDaily>>();
    for (let t = today - 30 * DAY; t < today; t += 300) {
      for (const b of engine.step(t, 300).batteries) {
        const d = Math.floor(t / DAY);
        const m = days.get(b.id) ?? new Map<number, BatteryDaily>();
        const row = m.get(d) ?? { ts: t, maxTempC: 0, maxSpreadMv: 0, peerMaxTempC: 0 };
        row.maxTempC = Math.max(row.maxTempC, b.tempC);
        row.maxSpreadMv = Math.max(row.maxSpreadMv, b.spreadMv);
        m.set(d, row);
        days.set(b.id, m);
      }
    }
    for (const [id, m] of days) {
      const series = [...m.entries()].map(([d, row]) => {
        const peers = [...days.entries()].filter(([k]) => k !== id).map(([, o]) => o.get(d)?.maxTempC ?? row.maxTempC);
        return { ...row, peerMaxTempC: median(peers) };
      });
      expect(detectBatteryAnomalies(series), id).toHaveLength(0);
    }
  });
});

describe("energy balance", () => {
  it("closes at cluster level for every step across two days, with faults active", () => {
    const engine = new Engine({ world, faults: defaultFaults(today), refDayStart: today, demoDay: 20000 });
    engine.warmUp(today - 5 * DAY, today - DAY);
    const totals = { pv: 0, load: 0 };
    for (let t = today - DAY; t < today + DAY; t += 300) {
      const s = engine.step(t, 300);
      const sum = (f: (z: (typeof s.zones)[number]) => number) => s.zones.reduce((a, z) => a + f(z), 0);
      const supply = sum((z) => z.pvW) + sum((z) => z.plnW) + sum((z) => z.dischargeW);
      const demand = sum((z) => z.loadW) + sum((z) => z.chargeW) + sum((z) => z.curtailW);
      expect(Math.abs(supply - demand)).toBeLessThan(1e-6);
      totals.pv += sum((z) => z.pvW);
      totals.load += sum((z) => z.loadW);
    }
    expect(totals.pv).toBeGreaterThan(0);
    expect(totals.load).toBeGreaterThan(0);
  });

  it("keeps every battery within its SoC limits", () => {
    const engine = new Engine({ world, faults: [], refDayStart: today, demoDay: 20000 });
    for (let t = today - 3 * DAY; t < today; t += 300) {
      for (const b of engine.step(t, 300).batteries) {
        expect(b.soc).toBeGreaterThanOrEqual(10);
        expect(b.soc).toBeLessThanOrEqual(95);
      }
    }
  });
});
