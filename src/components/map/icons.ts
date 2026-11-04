import type { Map as MapLibreMap } from "maplibre-gl";
import type { AssetStatus } from "@/lib/types";

export const STATUS_COLOR: Record<AssetStatus, string> = {
  normal: "#059669",
  warning: "#d97706",
  critical: "#dc2626",
  offline: "#64748b",
  maintenance: "#7c3aed",
};

const SIZE = 56;

function draw(kind: "house" | "battery" | "gateway", status: AssetStatus): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const c = canvas.getContext("2d");
  if (!c) return null;
  const color = STATUS_COLOR[status];
  c.lineWidth = 4;
  c.strokeStyle = "#ffffff";
  c.fillStyle = color;
  c.beginPath();
  if (kind === "house") {
    // Round marker with a roof glyph: PV installation on a house.
    c.arc(28, 28, 24, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.moveTo(14, 28);
    c.lineTo(28, 15);
    c.lineTo(42, 28);
    c.lineTo(38, 28);
    c.lineTo(38, 40);
    c.lineTo(18, 40);
    c.lineTo(18, 28);
    c.closePath();
    c.fill();
  } else if (kind === "battery") {
    // Square marker with a battery glyph, so shape separates it from houses without relying on colour.
    c.roundRect(5, 5, 46, 46, 9);
    c.fill();
    c.stroke();
    c.fillStyle = "#ffffff";
    c.fillRect(13, 20, 26, 16);
    c.fillRect(39, 24, 4, 8);
    c.fillStyle = color;
    c.fillRect(16, 23, 6, 10);
    c.fillRect(24, 23, 6, 10);
  } else {
    // Diamond marker with an antenna glyph for gateways.
    c.moveTo(28, 2);
    c.lineTo(54, 28);
    c.lineTo(28, 54);
    c.lineTo(2, 28);
    c.closePath();
    c.fill();
    c.stroke();
    c.strokeStyle = "#ffffff";
    c.lineWidth = 3.5;
    c.beginPath();
    c.moveTo(28, 40);
    c.lineTo(28, 22);
    c.moveTo(20, 18);
    c.quadraticCurveTo(28, 10, 36, 18);
    c.stroke();
  }
  return c.getImageData(0, 0, SIZE, SIZE);
}

/** Adds any marker icon the current style is missing. Styles lose their images when the basemap changes. */
export function ensureIcon(map: MapLibreMap, id: string) {
  const [kind, status] = id.split("-") as ["house" | "battery" | "gateway", AssetStatus];
  if (!STATUS_COLOR[status] || map.hasImage(id)) return;
  const image = draw(kind, status);
  if (image) map.addImage(id, image, { pixelRatio: 2 });
}

export function ensureAllIcons(map: MapLibreMap) {
  for (const kind of ["house", "battery", "gateway"]) {
    for (const status of Object.keys(STATUS_COLOR)) ensureIcon(map, `${kind}-${status}`);
  }
}
