"use client";
import type { Feature, FeatureCollection, Point, Polygon, LineString } from "geojson";
import { setWorkerUrl, type FilterSpecification, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl";
import { AnimatePresence, motion } from "motion/react";
import { Box, Gauge, Layers, Map as MapIcon, Radio, RotateCw, Rotate3d, WifiOff, X } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapRef } from "react-map-gl/maplibre";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, StatusBadge } from "@/components/domain/status";
import { HealthScoreRing, LevelBar } from "@/components/domain/health-ring";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import type { AlertDto } from "@/lib/alerts/dto";
import { apiGet } from "@/lib/client";
import { dateTime, longDate, num } from "@/lib/format";
import type { BatteryLive, GatewayLive, PvLive } from "@/lib/live/store";
import type { MapBattery, MapData, MapGateway, MapHouse } from "@/lib/map-dto";
import { NAV } from "@/lib/rbac";
import { hourOfDay } from "@/lib/sim/time";
import { facilityOf } from "@/lib/site";
import { VERDICT_LABEL } from "@/lib/ai/assess";
import { STATUS_LABEL, type AssetStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLive } from "@/stores/live";
import { ensureAllIcons, ensureIcon, STATUS_COLOR } from "./icons";
import { buildScene, sunLight, type FlowSegment, type SceneBattery, type SceneHouse } from "./scene-3d";
import { applyLighting, EnergyParticles, SceneLayers } from "./scene-layers";
import { areaLabel } from "@/lib/site";

setWorkerUrl("/maplibre-gl-worker.mjs");

type Basemap = "light" | "dark" | "satellite" | "schematic";
type StatusFilter = "all" | "faults" | "maintenance" | "offline";
type Selected = { kind: "house" | "battery" | "gateway"; id: string } | null;

/** Esri World Imagery. Generated houses will not match the real roofs, so this is never the default. */
const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Citra: Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "imagery", type: "raster", source: "imagery" }],
};

const VIEW_3D = { pitch: 60, bearing: 20 };
const ORBIT_DEG_PER_SEC = 5;

const STYLE_URL: Record<"light" | "dark", string> = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

function schematicStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": dark ? "#0f1a2c" : "#eef3f1" } }],
  };
}

const ZONE_FILL = ["#10b981", "#0ea5e9", "#f59e0b"];
/** 30 points fit at any useful zoom, so clustering is off. Turn it on here for a larger site. */
const CLUSTERING = false;
const STATUSES: AssetStatus[] = ["normal", "warning", "critical", "offline", "maintenance"];

function matches(status: AssetStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "faults") return status === "warning" || status === "critical";
  return status === filter;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function History({ assetId }: { assetId: string }) {
  const q = useQuery({ queryKey: ["alerts", "asset", assetId], queryFn: () => apiGet<{ alerts: AlertDto[] }>(`/api/v1/alerts?assetId=${assetId}&limit=5`) });
  return (
    <section>
      <h3 className="text-xs font-semibold text-ink-2">Riwayat gangguan</h3>
      {q.isLoading ? <Skeleton className="mt-2 h-12" /> : null}
      {q.data?.alerts.length === 0 ? <p className="mt-1 text-sm text-ink-3">Belum ada gangguan tercatat.</p> : null}
      <ul className="mt-1 space-y-2">
        {q.data?.alerts.map((a) => (
          <li key={a.id} className="text-sm">
            <p className="text-ink">{a.message}</p>
            {a.diagnosis ? <p className="mt-0.5 text-xs text-ink-2">{a.diagnosis.summary}</p> : null}
            <p className="text-xs text-ink-3">{dateTime(a.createdAt)}, {a.status === "resolved" ? "selesai" : "masih terbuka"}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DrawerShell({ title, subtitle, status, onClose, children, href }: { title: string; subtitle: string; status: AssetStatus; onClose: () => void; children: React.ReactNode; href?: string }) {
  const hasPage = href ? NAV.some((n) => href.startsWith(`${n.href}/`)) : false;
  return (
    <motion.aside
      initial={{ x: 32, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 32, opacity: 0 }}
      transition={{ duration: 0.18 }}
      aria-label={`Detail ${title}`}
      className="absolute inset-y-3 right-3 z-20 flex w-[min(360px,calc(100%-24px))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-xl"
    >
      <div className="flex items-start justify-between gap-2 border-b border-line p-4">
        <div>
          <p className="num text-lg font-semibold text-ink">{title}</p>
          <p className="text-xs text-ink-3">{subtitle}</p>
          <StatusBadge status={status} className="mt-2" />
        </div>
        <Button variant="ghost" size="icon" aria-label="Tutup detail" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
      {hasPage && href ? (
        <div className="border-t border-line p-3"><Link href={href} className="flex h-9 items-center justify-center rounded-lg bg-primary text-sm font-medium text-white dark:text-[#06281d]">Buka detail</Link></div>
      ) : null}
    </motion.aside>
  );
}

/** Says plainly whether low output is the weather or something at this panel. */
function VerdictNote({ live }: { live: PvLive }) {
  const weather = useLive((st) => st.snapshot?.weather);
  const tone = live.verdict === "gangguan" ? "bg-st-warning-soft" : live.verdict === "sensor" ? "bg-st-maintenance-soft" : "bg-surface-2";
  return (
    <section className={cn("rounded-xl p-3 text-sm", tone)}>
      <p className="font-medium text-ink">{VERDICT_LABEL[live.verdict]}</p>
      <p className="mt-0.5 text-xs text-ink-2">
        {live.verdict === "cuaca" ? "Produksi rendah karena mendung, bukan kerusakan. " : ""}
        Aktual {num(live.ratio * 100, 0)}% dari ekspektasi pada iradiasi {num(live.irradiance, 0)} W/m² ({live.irradianceSource === "sensor" ? "sensor titik ini" : "referensi cuaca"}).
      </p>
      <p className="mt-1 text-xs text-ink-3">{weather?.label ?? "Cuaca"}. Estimasi, perlu verifikasi teknisi.</p>
    </section>
  );
}

function HouseDrawer({ house, live, onClose }: { house: MapHouse; live?: PvLive; onClose: () => void }) {
  return (
    <DrawerShell title={house.id} subtitle={`${house.address}${facilityOf(house.id) ? ", fasilitas umum" : ""}`} status={live?.status ?? "offline"} onClose={onClose} href={`/solar/${house.id}`}>
      <HealthScoreRing score={live?.health ?? 0} />
      {live ? <VerdictNote live={live} /> : null}
      <dl className="divide-y divide-line">
        <Row label="Daya saat ini" value={<span className="num">{num((live?.acW ?? 0) / 1000, 2)} kW</span>} />
        <Row label="Energi hari ini" value={<span className="num">{num(live?.todayKwh, 1)} kWh</span>} />
        <Row label="Terhadap ekspektasi" value={<span className="num">{num((live?.ratio ?? 0) * 100, 0)}%</span>} />
        <Row label="Kapasitas PV" value={<span className="num">{num(house.capacityKwp, 2)} kWp</span>} />
        <Row label="Inverter" value={`${house.inverterModel}, ${live?.inverter ?? "–"}`} />
        <Row label="Baterai" value={<span className="num">{house.batteryId}</span>} />
        <Row label="Pemilik" value={house.ownerName ?? house.ownerCode} />
        <Row label="Koordinat" value={<span className="num text-xs">{num(house.lat, 5)}, {num(house.lng, 5)}</span>} />
        <Row label="Pemasangan" value={longDate(house.installDate)} />
      </dl>
      <History assetId={house.id} />
    </DrawerShell>
  );
}

function BatteryDrawer({ battery, live, served, onClose }: { battery: MapBattery; live?: BatteryLive; served: string[]; onClose: () => void }) {
  return (
    <DrawerShell title={battery.id} subtitle={`${areaLabel(battery.zoneId)}, ${battery.chemistry} ${num(battery.capacityKwh, 2)} kWh`} status={live?.status ?? "offline"} onClose={onClose} href={`/batteries/${battery.id}`}>
      <HealthScoreRing score={live?.health ?? 0} />
      <div>
        <div className="mb-1 flex justify-between text-sm"><span className="text-ink-3">State of Charge</span><span className="num text-ink">{num(live?.soc, 1)}%</span></div>
        <LevelBar value={live?.soc ?? 0} label="State of Charge" />
      </div>
      <dl className="divide-y divide-line">
        <Row label="Melayani" value={<span className="num">{served.join(", ")}</span>} />
        <Row label="SoH" value={<span className="num">{num(live?.soh, 1)}%</span>} />
        <Row label="Suhu" value={<span className="num">{num(live?.tempC, 1)} °C</span>} />
        <Row label="Tegangan" value={<span className="num">{num(live?.voltage, 1)} V</span>} />
        <Row label="Arus" value={<span className="num">{num(live?.currentA, 1)} A</span>} />
        <Row label="Selisih sel" value={<span className="num">{num(live?.spreadMv, 0)} mV</span>} />
        <Row label="Status BMS" value={live?.bms ?? "–"} />
        <Row label="Siklus" value={<span className="num">{num(live?.cycles, 0)}</span>} />
        <Row label="Koordinat" value={<span className="num text-xs">{num(battery.lat, 5)}, {num(battery.lng, 5)}</span>} />
      </dl>
      <History assetId={battery.id} />
    </DrawerShell>
  );
}

function GatewayDrawer({ gateway, live, onClose }: { gateway: MapGateway; live?: GatewayLive; onClose: () => void }) {
  return (
    <DrawerShell title={gateway.id} subtitle={`Gateway ${areaLabel(gateway.zoneId)}`} status={live?.online === false ? "offline" : "normal"} onClose={onClose}>
      <dl className="divide-y divide-line">
        <Row label="Koneksi" value={live?.online === false ? "Terputus" : "Tersambung"} />
        <Row label="Estimasi antrean buffer" value={<span className="num">{num(live?.bufferEstimate ?? 0)} pesan</span>} />
        <Row label="Sinkronisasi terakhir" value={<span className="num">{num(live?.lastSyncCount ?? 0)} pesan</span>} />
        <Row label="Firmware" value={<span className="num">{gateway.firmware}</span>} />
      </dl>
      <History assetId={gateway.id} />
    </DrawerShell>
  );
}

const chip = (active: boolean) =>
  cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-colors", active ? "bg-primary text-white dark:text-[#06281d]" : "text-ink-2 hover:bg-surface-2");

const glass = "rounded-xl border border-line bg-surface/90 backdrop-blur";

export function MapView() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const search = useSearchParams();
  const mapRef = useRef<MapRef>(null);
  const snapshot = useLive((s) => s.snapshot);
  const [basemap, setBasemap] = useState<Basemap | "auto">("auto");
  const [tilesReachable, setTilesReachable] = useState<boolean | null>(null);
  const [layers, setLayers] = useState({ zones: true, houses: true, batteries: true, gateways: true, links: true, heat: false, alerts: true });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [focusZone, setFocusZone] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [loaded, setLoaded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 768);
  const [view3d, setView3d] = useState(true);
  const [orbit, setOrbit] = useState(false);
  const [previewHour, setPreviewHour] = useState<number | null>(null);
  const reducedMotion = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const [performanceMode, setPerformanceMode] = useState(() => {
    try {
      return localStorage.getItem("sunpulse-performance") === "1";
    } catch {
      return false;
    }
  });
  const togglePerformance = () => {
    const next = !performanceMode;
    setPerformanceMode(next);
    if (next) setOrbit(false);
    try {
      localStorage.setItem("sunpulse-performance", next ? "1" : "0");
    } catch {
      // Storage can be blocked. The setting then lasts for this visit only.
    }
  };

  const q = useQuery({ queryKey: ["map"], queryFn: () => apiGet<MapData>("/api/v1/map/geojson"), staleTime: Infinity });

  // The map opens on the schematic style, so assets show instantly with any network.
  // It moves to the online basemap once the tile server answers, and keeps retrying if it does not.
  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      fetch(STYLE_URL.light, { signal: controller.signal, cache: "no-store" })
        .then((r) => r.ok)
        .catch(() => false)
        .then((ok) => {
          clearTimeout(timer);
          if (stopped) return;
          setTilesReachable(ok);
          if (!ok) retry = setTimeout(check, 15000);
        });
    };
    check();
    const offline = () => setTilesReachable(false);
    const online = () => check();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      clearTimeout(retry);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  const effective: Basemap = basemap === "schematic" || !tilesReachable ? "schematic" : basemap === "auto" ? (dark ? "dark" : "light") : basemap;
  const mapStyle = useMemo<string | StyleSpecification>(() => (effective === "schematic" ? schematicStyle(dark) : effective === "satellite" ? SATELLITE_STYLE : STYLE_URL[effective]), [effective, dark]);

  const pvById = useMemo(() => new Map((snapshot?.pv ?? []).map((p) => [p.id, p])), [snapshot]);
  const battById = useMemo(() => new Map((snapshot?.batteries ?? []).map((b) => [b.id, b])), [snapshot]);
  const gwById = useMemo(() => new Map((snapshot?.gateways ?? []).map((g) => [g.id, g])), [snapshot]);

  const houses = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.houses ?? []).flatMap((h): Feature<Point>[] => {
      const live = pvById.get(h.id);
      const status: AssetStatus = live?.status ?? "normal";
      if (!matches(status, statusFilter)) return [];
      return [{ type: "Feature", id: Number(h.id.slice(1)), geometry: { type: "Point", coordinates: [h.lng, h.lat] }, properties: { id: h.id, kind: "house", status, icon: `${facilityOf(h.id) ? "facility" : "house"}-${status}`, kwh: live?.todayKwh ?? 0 } }];
    }),
  }), [q.data, pvById, statusFilter]);

  const batteries = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.batteries ?? []).flatMap((b): Feature<Point>[] => {
      const status: AssetStatus = battById.get(b.id)?.status ?? "normal";
      if (!matches(status, statusFilter)) return [];
      return [{ type: "Feature", geometry: { type: "Point", coordinates: [b.lng, b.lat] }, properties: { id: b.id, kind: "battery", status, icon: `battery-${status}` } }];
    }),
  }), [q.data, battById, statusFilter]);

  const gateways = useMemo<FeatureCollection<Point>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.gateways ?? []).map((g): Feature<Point> => {
      const status: AssetStatus = gwById.get(g.id)?.online === false ? "offline" : "normal";
      return { type: "Feature", geometry: { type: "Point", coordinates: [g.lng, g.lat] }, properties: { id: g.id, kind: "gateway", status, icon: `gateway-${status}` } };
    }),
  }), [q.data, gwById]);

  const zonePolys = useMemo<FeatureCollection<Polygon>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.zones ?? []).map((g, i): Feature<Polygon> => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [g.boundary] }, properties: { id: g.id, color: ZONE_FILL[i % ZONE_FILL.length] } })),
  }), [q.data]);

  const links = useMemo<FeatureCollection<LineString>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.houses ?? []).flatMap((h): Feature<LineString>[] => {
      const b = q.data?.batteries.find((x) => x.id === h.batteryId);
      return b ? [{ type: "Feature", geometry: { type: "LineString", coordinates: [[h.lng, h.lat], [b.lng, b.lat]] }, properties: {} }] : [];
    }),
  }), [q.data]);

  const boundary = useMemo<FeatureCollection<Polygon>>(() => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [q.data?.boundary ?? []] }, properties: {} }],
  }), [q.data]);

  const alleys = useMemo<FeatureCollection<LineString>>(() => ({
    type: "FeatureCollection",
    features: (q.data?.zones ?? []).map((g): Feature<LineString> => ({ type: "Feature", geometry: { type: "LineString", coordinates: g.road }, properties: {} })),
  }), [q.data]);

  const hour = previewHour ?? (snapshot ? hourOfDay(snapshot.simTs) : 10.25);
  const clearFraction = snapshot?.weather.clearFraction ?? 1;
  const light = useMemo(() => sunLight(hour, clearFraction), [hour, clearFraction]);
  const cloudy = clearFraction < 0.7 && light.up;
  const nightGlow = light.up ? Math.max(0, 1 - light.daylight * 3) : 1;

  const scene = useMemo(() => {
    if (!q.data) return null;
    const sceneHouses: SceneHouse[] = q.data.houses.flatMap((h) => {
      const live = pvById.get(h.id);
      const status: AssetStatus = live?.status ?? "normal";
      if (!layers.houses || !matches(status, statusFilter)) return [];
      return [{ id: h.id, lat: h.lat, lng: h.lng, kind: facilityOf(h.id)?.kind ?? "rumah", status, ratio: live?.ratio ?? 1 }];
    });
    const sceneBatteries: SceneBattery[] = q.data.batteries.flatMap((b) => {
      const status: AssetStatus = battById.get(b.id)?.status ?? "normal";
      if (!layers.batteries || !matches(status, statusFilter)) return [];
      return [{ id: b.id, lat: b.lat, lng: b.lng, status }];
    });
    const corner = q.data.boundary[1];
    return buildScene({
      houses: sceneHouses,
      batteries: sceneBatteries,
      gateways: layers.gateways ? q.data.gateways.map((g) => ({ id: g.id, lat: g.lat, lng: g.lng, status: gwById.get(g.id)?.online === false ? "offline" as const : "normal" as const })) : [],
      roads: q.data.zones.map((z) => z.road),
      pln: corner ? { lng: corner[0] + 0.0001, lat: corner[1] } : null,
    }, light);
  }, [q.data, pvById, battById, gwById, layers.houses, layers.batteries, layers.gateways, statusFilter, light]);

  // Each battery and its two houses, then the cluster and PLN. Dots run in the direction energy actually flows.
  const flows = useMemo<FlowSegment[]>(() => {
    if (!q.data || !layers.links) return [];
    const out: FlowSegment[] = [];
    for (const h of q.data.houses) {
      const b = q.data.batteries.find((x) => x.id === h.batteryId);
      const live = b ? battById.get(b.id) : undefined;
      if (!b) continue;
      const watts = (live?.currentA ?? 0) * (live?.voltage ?? 51);
      const toBattery = watts >= 0;
      out.push({ from: toBattery ? [h.lng, h.lat] : [b.lng, b.lat], to: toBattery ? [b.lng, b.lat] : [h.lng, h.lat], power: Math.abs(watts) / 2, color: toBattery ? "#fbbf24" : "#34d399" });
    }
    const corner = q.data.boundary[1];
    const plnW = (snapshot?.zones ?? []).reduce((a, z) => a + z.plnW, 0);
    if (corner) {
      for (const g of q.data.gateways) out.push({ from: [corner[0] + 0.0001, corner[1]], to: [g.lng, g.lat], power: plnW / 3, color: "#38bdf8" });
    }
    return out;
  }, [q.data, battById, snapshot?.zones, layers.links]);

  const counts = useMemo(() => {
    const c: Record<AssetStatus, number> = { normal: 0, warning: 0, critical: 0, offline: 0, maintenance: 0 };
    for (const p of snapshot?.pv ?? []) c[p.status] += 1;
    for (const b of snapshot?.batteries ?? []) c[b.status] += 1;
    return c;
  }, [snapshot]);

  const pulsing = useMemo(() => {
    if (!q.data || !layers.alerts) return [];
    const out: { id: string; lat: number; lng: number; status: AssetStatus }[] = [];
    for (const h of q.data.houses) {
      const s = pvById.get(h.id)?.status;
      if (s === "critical" || s === "warning") out.push({ id: h.id, lat: h.lat, lng: h.lng, status: s });
    }
    for (const b of q.data.batteries) {
      const s = battById.get(b.id)?.status;
      if (s === "critical" || s === "warning") out.push({ id: b.id, lat: b.lat, lng: b.lng, status: s });
    }
    for (const g of q.data.gateways) {
      out.push({ id: g.id, lat: g.lat, lng: g.lng, status: gwById.get(g.id)?.online === false ? "offline" : "normal" });
    }
    return out;
  }, [q.data, pvById, battById, gwById, layers.alerts]);

  const flyToZone = useCallback((id: string | null) => {
    const map = mapRef.current;
    if (!map || !q.data) return;
    const list = id ? q.data.zones.filter((g) => g.id === id) : q.data.zones;
    const coords = list.flatMap((g) => g.boundary);
    if (coords.length === 0) return;
    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const camera = view3d ? VIEW_3D : { pitch: 0, bearing: 0 };
    const narrow = map.getContainer().clientWidth < 640;
    const fit = map.getMap().cameraForBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: narrow ? 20 : { top: 80, bottom: 40, left: 60, right: 240 }, ...camera });
    if (fit) map.flyTo({ ...fit, ...camera, zoom: (fit.zoom ?? 17) + (view3d ? 0.3 : 0), duration: 1100 });
  }, [q.data, view3d]);

  useEffect(() => {
    if (loaded) flyToZone(focusZone);
  }, [focusZone, loaded, flyToZone]);

  // Sun, sky and ground follow the simulated clock, and are reapplied whenever a new basemap loads.
  const lightingArgs = useRef({ hour, clearFraction, effective, dark, performanceMode });
  useEffect(() => {
    lightingArgs.current = { hour, clearFraction, effective, dark, performanceMode };
    const map = mapRef.current?.getMap();
    if (!map || !loaded || !map.isStyleLoaded()) return;
    applyLighting(map, hour, clearFraction, effective === "schematic", dark, performanceMode);
  }, [hour, clearFraction, effective, dark, performanceMode, loaded]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !orbit || !loaded) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      map.setBearing(map.getBearing() + ((now - last) / 1000) * ORBIT_DEG_PER_SEC);
      last = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const stop = () => setOrbit(false);
    map.on("dragstart", stop);
    return () => {
      cancelAnimationFrame(frame);
      map.off("dragstart", stop);
    };
  }, [orbit, loaded]);

  // Deep link: /map?asset=H021 selects the asset and flies to it.
  const assetParam = search.get("asset");
  useEffect(() => {
    if (!assetParam || !q.data || !loaded) return;
    const h = q.data.houses.find((x) => x.id === assetParam);
    const b = q.data.batteries.find((x) => x.id === assetParam);
    const target = h ?? b;
    if (!target) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected({ kind: h ? "house" : "battery", id: assetParam });
    mapRef.current?.flyTo({ center: [target.lng, target.lat], zoom: 18.2, duration: 1200, offset: [-180, 0], ...(view3d ? VIEW_3D : {}) });
  }, [assetParam, q.data, loaded, view3d]);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      setSelected(null);
      return;
    }
    const props = f.properties as { id?: string; kind?: "house" | "battery" | "gateway"; cluster_id?: number; cluster?: boolean };
    if (props.cluster) {
      const geometry = f.geometry as Point;
      mapRef.current?.flyTo({ center: geometry.coordinates as [number, number], zoom: (mapRef.current?.getZoom() ?? 14) + 2, duration: 500 });
      return;
    }
    if (props.id && props.kind) setSelected({ kind: props.kind, id: props.id });
  }, []);

  const onLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    // Tiles parsed without their icons lose those symbols, so icons must exist before data layers mount.
    ensureAllIcons(map);
    map.on("style.load", () => {
      ensureAllIcons(map);
      const a = lightingArgs.current;
      applyLighting(map, a.hour, a.clearFraction, a.effective === "schematic", a.dark, a.performanceMode);
    });
    const a = lightingArgs.current;
    applyLighting(map, a.hour, a.clearFraction, a.effective === "schematic", a.dark, a.performanceMode);
    map.on("styleimagemissing", (e: { id: string }) => ensureIcon(map, e.id));
    setLoaded(true);
  }, []);

  if (q.isError) return <div className="p-6"><ErrorState message={(q.error as Error).message} /></div>;
  if (!q.data) return <Skeleton className="m-4 h-[calc(100%-2rem)] rounded-2xl" />;

  const clusterFilter: FilterSpecification = ["has", "point_count"];
  const pointFilter: FilterSpecification = ["!", ["has", "point_count"]];
  const interactive = [view3d ? "structures-3d" : null, view3d && !performanceMode ? "asset-halo" : null, layers.houses ? "house-points" : null, layers.houses ? "house-clusters" : null, layers.batteries ? "battery-points" : null, layers.batteries ? "battery-clusters" : null, layers.gateways ? "gateway-points" : null].filter(Boolean) as string[];
  // In 3D the buildings carry status, so only assets that need attention keep a floating icon.
  const iconFilter: FilterSpecification = view3d ? ["all", pointFilter, ["!=", ["get", "status"], "normal"]] : pointFilter;
  const showGateways = layers.gateways && !view3d;

  const selHouse = selected?.kind === "house" ? q.data.houses.find((h) => h.id === selected.id) : undefined;
  const selBatt = selected?.kind === "battery" ? q.data.batteries.find((b) => b.id === selected.id) : undefined;
  const selGw = selected?.kind === "gateway" ? q.data.gateways.find((g) => g.id === selected.id) : undefined;

  const layerToggles: { key: keyof typeof layers; label: string }[] = [
    { key: "zones", label: "Batas area RT" },
    { key: "links", label: "Aliran energi" },
    { key: "houses", label: "Rumah dan PV" },
    { key: "batteries", label: "Baterai" },
    { key: "gateways", label: "Gateway" },
    { key: "heat", label: "Heatmap produksi hari ini" },
    { key: "alerts", label: "Cincin alert" },
  ];

  return (
    <div className="relative h-full min-h-[560px]">
      <h1 className="sr-only">Peta geospasial</h1>
      <MapGL
        ref={mapRef}
        initialViewState={{ latitude: q.data.center.lat, longitude: q.data.center.lng, zoom: q.data.center.zoom, ...VIEW_3D }}
        maxPitch={70}
        mapStyle={mapStyle}
        interactiveLayerIds={interactive}
        onClick={onClick}
        onLoad={onLoad}
        cursor="auto"
        style={{ width: "100%", height: "100%" }}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-left" showCompass={false} />
        <ScaleControl position="bottom-left" />

        {loaded && layers.zones ? (
          <Source id="zones" type="geojson" data={zonePolys}>
            <Layer id="zone-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": dark ? 0.12 : 0.14 }} />
            <Layer id="zone-line" type="line" paint={{ "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.75 }} />
          </Source>
        ) : null}
        {loaded ? (
          <Source id="alleys" type="geojson" data={alleys}>
            <Layer id="alley-line" type="line" paint={{ "line-color": dark ? "#475569" : "#94a3b8", "line-width": 5, "line-opacity": 0.65 }} layout={{ "line-cap": "round" }} />
          </Source>
        ) : null}

        {loaded ? (
          <Source id="cluster-boundary" type="geojson" data={boundary}>
            <Layer id="cluster-line" type="line" paint={{ "line-color": "#f97316", "line-width": 2, "line-dasharray": [3, 2] }} />
          </Source>
        ) : null}
        {loaded && layers.links && !view3d ? (
          <Source id="battery-links" type="geojson" data={links}>
            <Layer id="battery-link-line" type="line" paint={{ "line-color": "#10b981", "line-width": 1.5, "line-opacity": 0.7, "line-dasharray": [1, 2] }} />
          </Source>
        ) : null}

        {loaded && layers.heat ? (
          <Source id="heat" type="geojson" data={houses}>
            <Layer
              id="heat-layer"
              type="heatmap"
              paint={{
                "heatmap-weight": ["interpolate", ["linear"], ["get", "kwh"], 0, 0, 8, 1],
                "heatmap-radius": 34,
                "heatmap-intensity": 0.9,
                "heatmap-opacity": 0.75,
                "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(245,158,11,0)", 0.3, "rgba(253,224,71,0.6)", 0.7, "rgba(245,158,11,0.85)", 1, "rgba(180,83,9,0.95)"],
              }}
            />
          </Source>
        ) : null}

        {loaded && view3d && scene ? <SceneLayers scene={scene} glow={!performanceMode} nightGlow={nightGlow} /> : null}
        {loaded && view3d && layers.links ? <EnergyParticles segments={flows} animate={!performanceMode && !reducedMotion} /> : null}

        {loaded && layers.houses ? (
          <Source id="houses" type="geojson" data={houses} cluster={CLUSTERING} clusterMaxZoom={14} clusterRadius={46}>
            <Layer id="house-clusters" type="circle" filter={clusterFilter} paint={{ "circle-color": "#047857", "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 40, 24], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }} />
            {effective !== "schematic" ? (
              <Layer id="house-cluster-count" type="symbol" filter={clusterFilter} layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 12, "text-font": ["Noto Sans Bold"] }} paint={{ "text-color": "#ffffff" }} />
            ) : null}
            <Layer id="house-points" type="symbol" filter={iconFilter} layout={{ "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.55, 18, 1.15], "icon-allow-overlap": true }} />
          </Source>
        ) : null}

        {loaded && layers.batteries ? (
          <Source id="batteries" type="geojson" data={batteries} cluster={CLUSTERING} clusterMaxZoom={14} clusterRadius={46}>
            <Layer id="battery-clusters" type="circle" filter={clusterFilter} paint={{ "circle-color": "#0369a1", "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 30, 20], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" }} />
            {effective !== "schematic" ? (
              <Layer id="battery-cluster-count" type="symbol" filter={clusterFilter} layout={{ "text-field": ["get", "point_count_abbreviated"], "text-size": 11, "text-font": ["Noto Sans Bold"] }} paint={{ "text-color": "#ffffff" }} />
            ) : null}
            <Layer id="battery-points" type="symbol" filter={iconFilter} layout={{ "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.5, 18, 0.95], "icon-allow-overlap": true }} />
          </Source>
        ) : null}

        {loaded && showGateways ? (
          <Source id="gateways" type="geojson" data={gateways}>
            <Layer id="gateway-points" type="symbol" layout={{ "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 15, 0.55, 18, 1.15], "icon-allow-overlap": true }} />
          </Source>
        ) : null}

        {layers.zones ? q.data.zones.map((g) => (
          <Marker key={g.id} longitude={g.label[0]} latitude={g.label[1]} anchor="center">
            <button type="button" onClick={() => setFocusZone(focusZone === g.id ? null : g.id)} className="rounded-md border border-line bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold text-ink shadow-sm">{g.name}</button>
          </Marker>
        )) : null}

        {pulsing.map((p) => (
          <Marker key={p.id} longitude={p.lng} latitude={p.lat} anchor="center" style={{ pointerEvents: "none" }}>
            <span className="pulse-ring block h-6 w-6 rounded-full border-2" style={{ borderColor: STATUS_COLOR[p.status], pointerEvents: "none" }} aria-hidden />
          </Marker>
        ))}
      </MapGL>

      {cloudy && !performanceMode ? <div className={cn("cloud-veil pointer-events-none absolute inset-0 z-[1]", !reducedMotion && "cloud-drift")} aria-hidden /> : null}

      {/* Camera */}
      <div className={cn(glass, "absolute right-3 top-3 z-10 flex flex-wrap items-center justify-end gap-1 p-1.5", selected && "hidden")} role="toolbar" aria-label="Kontrol kamera">
        <button type="button" aria-pressed={view3d} className={chip(view3d)} onClick={() => { setView3d(!view3d); setOrbit(false); }}><span className="flex items-center gap-1">{view3d ? <Box className="h-3.5 w-3.5" aria-hidden /> : <MapIcon className="h-3.5 w-3.5" aria-hidden />}{view3d ? "3D" : "2D"}</span></button>
        <button type="button" aria-pressed={orbit} disabled={!view3d || performanceMode || reducedMotion} title={reducedMotion ? "Dimatikan karena preferensi kurangi gerakan" : undefined} className={cn(chip(orbit), "disabled:opacity-40")} onClick={() => setOrbit(!orbit)}><span className="flex items-center gap-1"><Rotate3d className="h-3.5 w-3.5" aria-hidden />Orbit</span></button>
        <button type="button" className={chip(false)} onClick={() => { setOrbit(false); setFocusZone(null); flyToZone(null); }}><span className="flex items-center gap-1"><RotateCw className="h-3.5 w-3.5" aria-hidden />Atur ulang</span></button>
        <button type="button" aria-pressed={performanceMode} className={chip(performanceMode)} onClick={togglePerformance}><span className="flex items-center gap-1"><Gauge className="h-3.5 w-3.5" aria-hidden />Mode performa</span></button>
      </div>

      {view3d ? (
        <div className={cn(glass, "absolute left-3 top-[60px] z-10 hidden w-72 px-3 py-1.5 text-[11px] text-ink-2 md:block", selected && "md:hidden")}>
          <label htmlFor="light-hour" className="flex items-center justify-between gap-2">
            <span>{previewHour === null ? "Cahaya mengikuti waktu simulasi" : `Pratinjau cahaya pukul ${String(Math.floor(hour)).padStart(2, "0")}.${String(Math.round((hour % 1) * 60) % 60).padStart(2, "0")}`}</span>
            {previewHour !== null ? <button type="button" className="font-medium text-primary hover:underline" onClick={() => setPreviewHour(null)}>Kembali</button> : null}
          </label>
          <input id="light-hour" type="range" min={0} max={23.75} step={0.25} value={hour} onChange={(e) => setPreviewHour(Number(e.target.value))} className="time-slider mt-1 w-full" />
        </div>
      ) : null}

      {/* Filters */}
      <div className={cn(glass, "absolute left-3 top-3 z-10 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-1 p-1.5")}>
        {([["all", "Semua"], ["faults", "Hanya gangguan"], ["maintenance", "Pemeliharaan"], ["offline", "Offline"]] as [StatusFilter, string][]).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={statusFilter === k} className={chip(statusFilter === k)} onClick={() => setStatusFilter(k)}>{label}</button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" aria-hidden />
        <label className="sr-only" htmlFor="zone-focus">Fokus area RT</label>
        <select id="zone-focus" value={focusZone ?? ""} onChange={(e) => setFocusZone(e.target.value || null)} className="rounded-lg bg-transparent px-1.5 py-1 text-xs font-medium text-ink outline-none">
          <option value="">Semua RT</option>
          {q.data.zones.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Layer panel, basemap, legend */}
      <div className={cn(glass, "absolute bottom-10 right-3 z-10 w-56 p-3 text-xs", selected && "hidden lg:hidden")}>
        <button type="button" onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} className="flex w-full items-center gap-1.5 font-semibold text-ink">
          <Layers className="h-3.5 w-3.5" aria-hidden /> Lapisan dan legenda
        </button>
        {panelOpen ? (
          <div className="mt-2 space-y-3">
            <div className="space-y-1">
              {layerToggles.map((l) => (
                <label key={l.key} className="flex cursor-pointer items-center gap-2 text-ink-2">
                  <input type="checkbox" checked={layers[l.key]} onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })} className="accent-[var(--primary)]" />
                  {l.label}
                </label>
              ))}
            </div>
            <div>
              <p className="mb-1 font-medium text-ink-2">Peta dasar</p>
              <div className="flex flex-wrap gap-1">
                {([["light", "Terang"], ["dark", "Gelap"], ["satellite", "Satelit"], ["schematic", "Skematik"]] as [Basemap, string][]).map(([k, label]) => (
                  <button key={k} type="button" aria-pressed={effective === k} disabled={k !== "schematic" && !tilesReachable} className={cn(chip(effective === k), "disabled:opacity-40")} onClick={() => setBasemap(k)}>{label}</button>
                ))}
              </div>
              {tilesReachable === false ? (
                <p className="mt-1.5 flex items-start gap-1 text-ink-3"><WifiOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> Server peta tidak terjangkau. Peta skematik tetap menampilkan seluruh aset dalam 3D.</p>
              ) : null}
            </div>
            <div>
              <p className="mb-1 font-medium text-ink-2">Status aset</p>
              <ul className="space-y-0.5">
                {STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-ink-2">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s] }} aria-hidden />{STATUS_LABEL[s]}</span>
                    <span className="num text-ink">{counts[s]}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-3">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-ink-3" aria-hidden />Rumah/PV</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] bg-ink-3" aria-hidden />Baterai</span>
                <span className="flex items-center gap-1"><span aria-hidden className="text-[11px] leading-none">⬢</span>Fasilitas umum</span>
                <span className="flex items-center gap-1"><Radio className="h-3 w-3" aria-hidden />Gateway</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <p className={cn(glass, "absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 px-2.5 py-1 text-[11px] text-ink-3 md:block")}>Posisi rumah hasil generator, bukan survei. Data simulasi.</p>

      <AnimatePresence>
        {selHouse ? <HouseDrawer key={selHouse.id} house={selHouse} live={pvById.get(selHouse.id)} onClose={() => setSelected(null)} /> : null}
        {selBatt ? <BatteryDrawer key={selBatt.id} battery={selBatt} live={battById.get(selBatt.id)} served={q.data.houses.filter((h) => h.batteryId === selBatt.id).map((h) => h.id)} onClose={() => setSelected(null)} /> : null}
        {selGw ? <GatewayDrawer key={selGw.id} gateway={selGw} live={gwById.get(selGw.id)} onClose={() => setSelected(null)} /> : null}
      </AnimatePresence>
    </div>
  );
}
