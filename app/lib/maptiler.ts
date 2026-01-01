export type MapTilerStyleId =
  | "darkmatter"
  | "streets-v2-dark"
  | "night"
  | "toner-dark"
  | string;

export const DEFAULT_STYLE_ID: MapTilerStyleId = "streets-v2-dark";

export function mapTilerStyleUrl(styleId: MapTilerStyleId, key: string): string {
  const id = (styleId || DEFAULT_STYLE_ID).trim();
  return `https://api.maptiler.com/maps/${encodeURIComponent(id)}/style.json?key=${encodeURIComponent(
    key,
  )}`;
}

export const STYLE_CHOICES: Array<{ id: MapTilerStyleId; label: string }> = [
  { id: "darkmatter", label: "Darkmatter" },
  { id: "streets-v2-dark", label: "Streets (Dark)" },
  { id: "night", label: "Night" },
  { id: "toner-dark", label: "Toner (Dark)" },
];

export type MapTilerGeocodeResult = {
  id: string;
  label: string;
  center: [number, number];
};

export async function mapTilerGeocode(input: {
  query: string;
  key: string;
  signal?: AbortSignal;
}): Promise<MapTilerGeocodeResult[]> {
  const q = input.query.trim();
  if (!q) return [];

  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
    q,
  )}.json?key=${encodeURIComponent(input.key)}&limit=5&country=ca`;

  const res = await fetch(url, { signal: input.signal });
  if (!res.ok) throw new Error(`MapTiler geocoding failed: ${res.status}`);
  const data = (await res.json()) as unknown;

  const featsUnknown = (data as { features?: unknown } | null | undefined)?.features;
  const feats = Array.isArray(featsUnknown) ? featsUnknown : [];
  const out: MapTilerGeocodeResult[] = [];
  for (const f of feats) {
    const label = (f as { place_name?: unknown } | null | undefined)?.place_name;
    const center = (f as { center?: unknown } | null | undefined)?.center;
    if (typeof label !== "string") continue;
    if (!Array.isArray(center) || center.length < 2) continue;
    const lng = Number(center[0]);
    const lat = Number(center[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const idVal = (f as { id?: unknown } | null | undefined)?.id;
    out.push({
      id: String(idVal ?? label),
      label,
      center: [lng, lat],
    });
  }
  return out;
}

