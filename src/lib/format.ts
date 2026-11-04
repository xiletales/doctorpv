const cache = new Map<string, Intl.NumberFormat>();

function nf(digits: number): Intl.NumberFormat {
  const key = String(digits);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    cache.set(key, f);
  }
  return f;
}

export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  return nf(digits).format(value);
}

export function rupiah(value: number): string {
  return `Rp${nf(0).format(Math.round(value))}`;
}

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
});
const fullFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const longFmt = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" });
export const longDate = (ts: number): string => longFmt.format(ts * 1000);
export const clockTime = (ts: number): string => timeFmt.format(ts * 1000);
export const shortDate = (ts: number): string => dateFmt.format(ts * 1000);
export const dateTime = (ts: number): string => `${fullFmt.format(ts * 1000)} WIB`;
