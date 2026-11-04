"use client";
import { useEffect } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { flowLines, particlesAt, sunLight, type FlowSegment, type Scene } from "./scene-3d";

const PARTICLE_FRAME_MS = 50;

/** Moves the energy dots by updating one small source, at a capped rate so it stays cheap on a laptop. */
export function EnergyParticles({ segments, animate }: { segments: FlowSegment[]; animate: boolean }) {
  const { current } = useMap();
  useEffect(() => {
    const map = current?.getMap();
    if (!map || !animate) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < PARTICLE_FRAME_MS) return;
      last = now;
      const source = map.getSource("energy-dots") as GeoJSONSource | undefined;
      source?.setData(particlesAt(segments, now / 1000));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [current, segments, animate]);
  return (
    <>
      <Source id="energy-lines" type="geojson" data={flowLines(segments)}>
        <Layer id="energy-line" type="line" paint={{ "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.45 }} />
      </Source>
      {animate ? (
        <Source id="energy-dots" type="geojson" data={particlesAt(segments, 0)}>
          <Layer id="energy-dot" type="circle" paint={{ "circle-color": ["get", "color"], "circle-radius": ["get", "r"], "circle-stroke-color": "#ffffff", "circle-stroke-width": 0.6, "circle-pitch-alignment": "map" }} />
        </Source>
      ) : null}
    </>
  );
}

export function SceneLayers({ scene, glow, nightGlow }: { scene: Scene; glow: boolean; nightGlow: number }) {
  return (
    <>
      {nightGlow > 0.05 ? (
        <Source id="lamps" type="geojson" data={scene.lamps}>
          <Layer id="lamp-glow" type="circle" paint={{ "circle-color": "#ffd27d", "circle-radius": 13, "circle-blur": 1, "circle-opacity": 0.55 * nightGlow, "circle-pitch-alignment": "map" }} />
          <Layer id="lamp-core" type="circle" paint={{ "circle-color": "#fff1c9", "circle-radius": 2.2, "circle-opacity": nightGlow }} />
        </Source>
      ) : null}
      {glow ? (
        <Source id="halos" type="geojson" data={scene.halos}>
          <Layer id="asset-halo" type="circle" paint={{ "circle-color": ["get", "color"], "circle-radius": 22, "circle-blur": 1, "circle-opacity": 0.55, "circle-pitch-alignment": "map" }} />
        </Source>
      ) : null}
      <Source id="structures" type="geojson" data={scene.structures}>
        <Layer
          id="structures-3d"
          type="fill-extrusion"
          paint={{ "fill-extrusion-color": ["get", "color"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-vertical-gradient": true, "fill-extrusion-opacity": 0.98 }}
        />
      </Source>
    </>
  );
}

/** Sky and ground for the time of day. Called again after every basemap change, which resets both. */
export function applyLighting(map: MapLibreMap, hour: number, clearFraction: number, schematic: boolean, dark: boolean, plainSky: boolean) {
  const light = sunLight(hour, clearFraction);
  map.setLight({ anchor: "map", position: [1.4, light.azimuth, light.polar], color: light.color, intensity: light.intensity });
  const d = light.daylight;
  const cloudy = clearFraction < 0.7 && light.up;
  map.setSky(plainSky ? {} : {
    "sky-color": !light.up ? "#050a18" : cloudy ? "#6f7d8c" : d > 0.6 ? "#3f95d8" : "#c76d4a",
    "horizon-color": !light.up ? "#111a33" : cloudy ? "#9aa6b2" : d > 0.6 ? "#bfe0f2" : "#f6b37c",
    "fog-color": !light.up ? "#0b1220" : cloudy ? "#7d8a97" : "#9fc1d6",
    "fog-ground-blend": 0.75,
    "horizon-fog-blend": 0.6,
    "sky-horizon-blend": 0.8,
    "atmosphere-blend": 0,
  });
  if (schematic && map.getLayer("background")) {
    const day = dark ? [32, 46, 66] : [214, 226, 224];
    const night = [8, 13, 26];
    const mix = day.map((v, i) => Math.round(night[i] + (v - night[i]) * (0.15 + 0.85 * d)));
    map.setPaintProperty("background", "background-color", `rgb(${mix.join(",")})`);
  }
  return light;
}
