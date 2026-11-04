import { describe, expect, it } from "vitest";
import { buildScene, flowLines, particlesAt, sunLight, type FlowSegment, type SceneHouse } from "../src/components/map/scene-3d";

const house = (id: string, kind: SceneHouse["kind"] = "rumah"): SceneHouse => ({ id, lat: -7.57, lng: 110.81, kind, status: "normal", ratio: 1 });

describe("sun lighting follows the clock", () => {
  it("is dark at night and brightest near midday", () => {
    expect(sunLight(2).up).toBe(false);
    expect(sunLight(2).daylight).toBe(0);
    expect(sunLight(11.6).daylight).toBeGreaterThan(sunLight(6).daylight);
    for (let h = 0; h < 24; h += 0.5) {
      const l = sunLight(h);
      expect(l.intensity).toBeGreaterThan(0);
      expect(l.intensity).toBeLessThanOrEqual(1);
      expect(l.polar).toBeGreaterThanOrEqual(0);
      expect(l.polar).toBeLessThanOrEqual(90);
    }
  });

  it("moves from east in the morning to west in the afternoon", () => {
    expect(sunLight(7).azimuth).toBeLessThan(180);
    expect(sunLight(16).azimuth).toBeGreaterThan(180);
  });

  it("clouds dim the scene", () => {
    expect(sunLight(11, 0.36).daylight).toBeLessThan(sunLight(11, 1).daylight);
  });
});

describe("scene geometry", () => {
  const scene = buildScene({ houses: [house("H01"), house("H03", "musala"), house("H25", "sekolah")], batteries: [{ id: "B01", lat: -7.57, lng: 110.81, status: "warning" }], gateways: [{ id: "GW-1", lat: -7.57, lng: 110.81, status: "normal" }], roads: [[[110.81, -7.57], [110.812, -7.57]]] }, sunLight(10));

  it("gives every clickable part its asset id, with closed rings and positive height", () => {
    for (const f of scene.structures.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(f.properties.top).toBeGreaterThan(f.properties.base);
      expect(f.properties.id).toBeTruthy();
    }
    const ids = new Set(scene.structures.features.map((f) => f.properties.id));
    expect([...ids].sort()).toEqual(["B01", "GW-1", "H01", "H03", "H25"]);
  });

  it("colours a house roof by its status", () => {
    const faulty = buildScene({ houses: [{ ...house("H01"), status: "critical" }], batteries: [], gateways: [], roads: [] }, sunLight(10));
    const normal = buildScene({ houses: [house("H01")], batteries: [], gateways: [], roads: [] }, sunLight(10));
    expect(faulty.structures.features[1].properties.color).not.toBe(normal.structures.features[1].properties.color);
  });
});

describe("energy particles", () => {
  const seg = (power: number): FlowSegment => ({ from: [0, 0], to: [1, 1], power, color: "#fff" });

  it("shows nothing on an idle segment", () => {
    expect(particlesAt([seg(0)], 1).features).toHaveLength(0);
  });

  it("moves faster and looks larger with more power", () => {
    const pos = (power: number, t: number) => (particlesAt([seg(power)], t).features[0].geometry.coordinates[0] as number);
    const travelled = (power: number) => (pos(power, 0.5) - pos(power, 0) + 1) % 1;
    expect(travelled(2500)).toBeGreaterThan(travelled(200));
    expect(particlesAt([seg(2500)], 0).features[0].properties.r).toBeGreaterThan(particlesAt([seg(200)], 0).features[0].properties.r);
  });

  it("draws one line per segment", () => {
    expect(flowLines([seg(10), seg(20)]).features).toHaveLength(2);
  });
});
