"use client";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Layer, Source, type MapRef } from "react-map-gl/maplibre";
import { applyLighting, SceneLayers } from "@/components/map/scene-layers";
import { buildScene, sunLight, type SceneHouse } from "@/components/map/scene-3d";
import { FACILITIES, SITE } from "@/lib/site";
import { buildWorld } from "@/lib/sim/world";
import type { AssetStatus } from "@/lib/types";

setWorkerUrl("/maplibre-gl-worker.mjs");

const STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#101b30" } }] };
const STATUS: Record<string, AssetStatus> = { H07: "warning", H13: "warning", B11: "warning", H26: "offline", H19: "maintenance" };
const HOUR = 10.25;
const FLYOVER_MS = 26_000;

/** A short, offline flyover of the generated RW 1 cluster. Needs no network, and holds still under reduced motion. */
export function LoginFlyover({ className }: { className?: string }) {
  const ref = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const data = useMemo(() => {
    const world = buildWorld(SITE.center);
    const houses: SceneHouse[] = world.houses.map((h) => ({ id: h.id, lat: h.lat, lng: h.lng, kind: FACILITIES[h.id]?.kind ?? "rumah", status: STATUS[h.id] ?? "normal", ratio: 1 }));
    const scene = buildScene(
      { houses, batteries: world.batteries.map((b) => ({ id: b.id, lat: b.lat, lng: b.lng, status: STATUS[b.id] ?? "normal" })), gateways: world.gateways.map((g) => ({ id: g.id, lat: g.lat, lng: g.lng, status: "normal" })), roads: world.zones.map((z) => z.road) },
      sunLight(HOUR),
    );
    const ground = {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [world.boundary] } },
        ...world.zones.map((z) => ({ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: z.road } })),
      ],
    };
    return { scene, ground };
  }, []);

  useEffect(() => {
    const map = ref.current?.getMap();
    if (!map || !ready) return;
    applyLighting(map, HOUR, 1, true, true, true);
    map.setPaintProperty("background", "background-color", "#0a1120");
    // Keeps the cluster in the open space between the headline and the login card.
    map.setPadding({ top: 300, bottom: 40, left: 0, right: 470 });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const f = Math.min(1, (now - started) / FLYOVER_MS);
      const eased = f * (2 - f);
      map.jumpTo({ bearing: -22 + 62 * eased, zoom: 17.75 + 0.35 * eased, pitch: 58 + 6 * eased });
      if (f < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  return (
    <div className={className} aria-hidden>
      <MapGL
        ref={ref}
        initialViewState={{ latitude: SITE.center.lat, longitude: SITE.center.lng, zoom: 17.75, pitch: 58, bearing: -22 }}
        mapStyle={STYLE}
        interactive={false}
        maxPitch={70}
        attributionControl={false}
        onLoad={() => setReady(true)}
        style={{ width: "100%", height: "100%" }}
      >
        {ready ? (
          <>
            <Source id="ground" type="geojson" data={data.ground}>
              <Layer id="ground-fill" type="fill" filter={["==", ["geometry-type"], "Polygon"]} paint={{ "fill-color": "#16233a", "fill-opacity": 0.9 }} />
              <Layer id="ground-road" type="line" filter={["==", ["geometry-type"], "LineString"]} paint={{ "line-color": "#47566e", "line-width": 7 }} layout={{ "line-cap": "round" }} />
            </Source>
            <SceneLayers scene={data.scene} glow nightGlow={0} />
          </>
        ) : null}
      </MapGL>
    </div>
  );
}
