"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import maplibregl, {
  type ExpressionSpecification,
  type Map,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import {
  Car,
  CheckCircle2,
  CircleHelp,
  DoorOpen,
  Home,
  ShieldAlert,
  ShoppingBag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DEFAULT_STYLE_ID,
  type MapTilerStyleId,
  mapTilerStyleUrl,
} from "@/lib/maptiler";
import { fetchIncidents } from "@/lib/incidents";
import type {
  IncidentFeature,
  IncidentFeatureCollection,
  IncidentFilters,
  HeatmapSettings,
} from "@/lib/types";
import { getIncidentStyle } from "@/lib/incidentStyle";
import { Filters } from "@/components/Filters";
import { Sidebar } from "@/components/Sidebar";
import { HeatmapSettingsPanel } from "@/components/HeatmapSettingsPanel";
import { IncidentPopupContent } from "@/components/IncidentPopupContent";
import { SearchPopupContent } from "@/components/SearchPopupContent";

type Props = {
  styleId?: MapTilerStyleId;
};

function findLabelAnchorLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  const withText = layers.filter((l) => {
    if (l.type !== "symbol") return false;
    const layout = l.layout as Record<string, unknown> | undefined;
    return Boolean(layout && layout["text-field"]);
  });
  if (!withText.length) return undefined;

  const preferred = withText.find((l) =>
    /(place|settlement|city|town|village|suburb|neigh|district|region|county|state|province|boundary|area)/i.test(
      l.id
    )
  );
  return (preferred ?? withText[0])!.id;
}

const isRoadsideTest = (desc?: string) => {
  const d = (desc ?? "").trim().toUpperCase();
  return d === "ROADSIDE TEST" || d === "ROAD TEST" || d === "ROADTEST";
};

const isFederalStats = (desc?: string) => {
  const d = (desc ?? "").trim().toUpperCase();
  return d.startsWith("FEDERAL STATS");
};

const INCIDENT_ABBREVIATION_LEGEND: Array<{ abbr: string; meaning: string }> = [
  { abbr: "MVC", meaning: "Motor Vehicle Collision" },
  { abbr: "PI", meaning: "Personal Injury" },
];

const decorateIncidents = (
  fc: IncidentFeatureCollection,
  f: IncidentFilters
): IncidentFeatureCollection => {
  const features = fc.features
    .filter(
      (x) =>
        !f.hideRoadTests ||
        (!isRoadsideTest(x.properties.DESCRIPTION) &&
          !isFederalStats(x.properties.DESCRIPTION))
    )
    .map((x) => {
      const s = getIncidentStyle(x.properties.DESCRIPTION);
      const iconId = categoryIconId[s.category] ?? categoryIconId.Other;
      const nextProps = {
        ...x.properties,
        __styleColor: s.color,
        __styleCategory: s.category,
        __iconId: iconId,
        __isRoadsideTest: isRoadsideTest(x.properties.DESCRIPTION),
      } as typeof x.properties;
      return { ...x, properties: nextProps };
    });
  return { ...fc, features };
};

const categoryIconId: Record<string, string> = {
  "Break & Enter": "lucide-break-enter",
  Violence: "lucide-violence",
  Theft: "lucide-theft",
  Traffic: "lucide-traffic",
  "Impaired/Checks": "lucide-checks",
  Property: "lucide-property",
  Other: "lucide-other",
};

const iconById: Record<string, LucideIcon> = {
  [categoryIconId["Break & Enter"]]: DoorOpen,
  [categoryIconId["Violence"]]: ShieldAlert,
  [categoryIconId["Theft"]]: ShoppingBag,
  [categoryIconId["Traffic"]]: Car,
  [categoryIconId["Impaired/Checks"]]: CheckCircle2,
  [categoryIconId["Property"]]: Home,
  [categoryIconId["Other"]]: CircleHelp,
};

async function loadSvgAsImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load SVG image"));
  });
  return img;
}

async function ensureLucideImages(map: maplibregl.Map) {
  for (const id of Object.keys(iconById)) {
    if (map.hasImage(id)) continue;
    const Icon = iconById[id];
    const svg = renderToStaticMarkup(
      <Icon size={20} strokeWidth={2.25} color="rgba(255,255,255,0.92)" />
    );
    const img = await loadSvgAsImage(svg);
    map.addImage(id, img, { pixelRatio: 2 });
  }
}

function popupWithReact(popup: maplibregl.Popup, node: ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  root.render(node);
  popup.setDOMContent(el);
  popup.on("close", () => root.unmount());
  return popup;
}

const DEFAULT_HEATMAP_SETTINGS: HeatmapSettings = {
  radius0: 12,
  radius12: 46,
  intensity0: 0.65,
  intensity12: 1.35,
  opacity: 0.78,
  outlineOpacity: 0.55,
};

const heatmapWeightExpr = [
  "interpolate",
  ["linear"],
  ["zoom"],
  0,
  0.2,
  12,
  1,
] as unknown as ExpressionSpecification;

const zoomExpr = (v0: number, v12: number) =>
  [
    "interpolate",
    ["linear"],
    ["zoom"],
    0,
    v0,
    12,
    v12,
    15,
    v12,
  ] as unknown as ExpressionSpecification;

const heatmapColorExpr = [
  "interpolate",
  ["linear"],
  ["heatmap-density"],
  0,
  "rgba(0,0,0,0)",
  0.12,
  "rgba(80,200,255,0.10)",
  0.28,
  "rgba(80,200,255,0.25)",
  0.45,
  "rgba(80,200,255,0.48)",
  0.62,
  "rgba(255,110,160,0.55)",
  0.82,
  "rgba(255,110,160,0.80)",
  1,
  "rgba(255,110,160,0.95)",
] as unknown as ExpressionSpecification;

const heatmapOutlineColorExpr = [
  "interpolate",
  ["linear"],
  ["heatmap-density"],
  0,
  "rgba(0,0,0,0)",
  0.22,
  "rgba(0,0,0,0.10)",
  0.55,
  "rgba(0,0,0,0.22)",
  1,
  "rgba(0,0,0,0.34)",
] as unknown as ExpressionSpecification;

const applyHeatmapSettings = (m: Map, s: HeatmapSettings) => {
  if (m.getLayer("heatmap")) {
    m.setPaintProperty(
      "heatmap",
      "heatmap-radius",
      zoomExpr(s.radius0, s.radius12)
    );
    m.setPaintProperty(
      "heatmap",
      "heatmap-intensity",
      zoomExpr(s.intensity0, s.intensity12)
    );
    m.setPaintProperty("heatmap", "heatmap-opacity", s.opacity);
    m.setPaintProperty("heatmap", "heatmap-color", heatmapColorExpr);
  }

  if (m.getLayer("heatmap-outline")) {
    m.setPaintProperty(
      "heatmap-outline",
      "heatmap-radius",
      zoomExpr(s.radius0 * 2, s.radius12 * 2)
    );
    m.setPaintProperty(
      "heatmap-outline",
      "heatmap-intensity",
      zoomExpr(s.intensity0, s.intensity12)
    );
    m.setPaintProperty("heatmap-outline", "heatmap-opacity", s.outlineOpacity);
    m.setPaintProperty(
      "heatmap-outline",
      "heatmap-color",
      heatmapOutlineColorExpr
    );
  }
};

export function CrimeMap({ styleId = DEFAULT_STYLE_ID }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pulseRafRef = useRef<number | null>(null);
  const makeDefaultFilters = (): IncidentFilters => {
    const endMs = Date.now();
    const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
    return { startMs, endMs, timePreset: "1m", hideRoadTests: true };
  };
  const filtersRef = useRef<IncidentFilters>(makeDefaultFilters());
  const [loadingCount, setLoadingCount] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<
    "filters" | "incidents" | null
  >(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [groupingEnabled, setGroupingEnabled] = useState(true);
  const [heatmapSettingsOpen, setHeatmapSettingsOpen] = useState(false);
  const [heatmapSettings, setHeatmapSettings] = useState<HeatmapSettings>(
    DEFAULT_HEATMAP_SETTINGS
  );
  const heatmapSettingsRef = useRef<HeatmapSettings>(DEFAULT_HEATMAP_SETTINGS);
  const [useIcons, setUseIcons] = useState(true);
  const [activeHelpOpen, setActiveHelpOpen] = useState(false);
  const [currentStyleId, setCurrentStyleId] =
    useState<MapTilerStyleId>(styleId);
  const [filters, setFilters] = useState<IncidentFilters>(
    () => filtersRef.current
  );
  const [incidents, setIncidents] = useState<IncidentFeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
  const styleUrl = useMemo(() => {
    if (!maptilerKey) return "";
    return mapTilerStyleUrl(currentStyleId, maptilerKey);
  }, [maptilerKey, currentStyleId]);

  const isLoading = loadingCount > 0;
  const startLoading = () => setLoadingCount((c) => c + 1);
  const stopLoading = () => setLoadingCount((c) => Math.max(0, c - 1));
  const isAbortError = (e: unknown) =>
    e instanceof DOMException && e.name === "AbortError";

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    heatmapSettingsRef.current = heatmapSettings;
  }, [heatmapSettings]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!styleUrl) return;

    startLoading();
    let didStop = false;
    const stopOnce = () => {
      if (didStop) return;
      didStop = true;
      stopLoading();
    };
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [-79.82, 43.46],
      zoom: 10,
      pitchWithRotate: true,
      dragRotate: true,
      touchPitch: true,
    });

    mapRef.current = map;

    const setQueryArea = () => {
      const m = mapRef.current;
      if (!m) return;
      if (!m.isStyleLoaded()) return;
      const src = m.getSource("query-area") as
        | maplibregl.GeoJSONSource
        | undefined;
      if (!src) return;

      const b = m.getBounds();
      const w = b.getWest();
      const s = b.getSouth();
      const e = b.getEast();
      const n = b.getNorth();

      src.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [w, s],
                  [e, s],
                  [e, n],
                  [w, n],
                  [w, s],
                ],
              ],
            },
          },
        ],
      });
    };

    const refresh = async () => {
      const m = mapRef.current;
      if (!m) return;
      if (!m.isStyleLoaded()) return;
      if (!m.getSource("incidents")) return;
      if (!m.getSource("incidents-raw")) return;
      setQueryArea();

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const b = m.getBounds();
      const bbox = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      };

      startLoading();
      try {
        const data = await fetchIncidents({
          bbox,
          filters: filtersRef.current,
          signal: ac.signal,
        });

        const src = m.getSource("incidents") as maplibregl.GeoJSONSource;
        const srcRaw = m.getSource("incidents-raw") as maplibregl.GeoJSONSource;
        const next = decorateIncidents(data, filtersRef.current);
        src.setData(next);
        srcRaw.setData(next);
        setIncidents(next);
      } catch (e) {
        if (!isAbortError(e)) {
          setIncidents((prev) => prev);
        }
      } finally {
        stopLoading();
      }
    };

    const onMoveEnd = () => {
      void refresh();
    };

    map.on("load", () => {
      stopOnce();
      void ensureLucideImages(map);
      const beforeLabels = findLabelAnchorLayerId(map);
      map.addSource("incidents", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        } as IncidentFeatureCollection,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 52,
      });

      map.addSource("incidents-raw", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        } as IncidentFeatureCollection,
      });

      map.addSource("query-area", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer(
        {
          id: "query-area-fill",
          type: "fill",
          source: "query-area",
          paint: {
            "fill-color": "rgba(80,200,255,0.12)",
            "fill-opacity": 0.9,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "query-area-outline",
          type: "line",
          source: "query-area",
          paint: {
            "line-color": "rgba(80,200,255,0.70)",
            "line-width": 2,
            "line-blur": 0.2,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "clusters",
          type: "circle",
          source: "incidents",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": [
              "step",
              ["get", "point_count"],
              "rgba(80,200,255,0.55)",
              50,
              "rgba(80,200,255,0.70)",
              250,
              "rgba(255,110,160,0.75)",
            ],
            "circle-radius": [
              "step",
              ["get", "point_count"],
              18,
              50,
              22,
              250,
              28,
            ],
            "circle-stroke-color": "rgba(255,255,255,0.10)",
            "circle-stroke-width": 1,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "cluster-count",
          type: "symbol",
          source: "incidents",
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-size": 12,
          },
          paint: {
            "text-color": "rgba(255,255,255,0.92)",
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "points",
          type: "circle",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "__styleColor"],
              "rgba(148,163,184,0.90)",
            ],
            "circle-radius": 5,
            "circle-opacity": 0.92,
            "circle-stroke-color": "rgba(0,0,0,0.35)",
            "circle-stroke-width": 1.25,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "points-icons",
          type: "symbol",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          layout: {
            "icon-image": [
              "coalesce",
              ["get", "__iconId"],
              categoryIconId.Other,
            ] as ExpressionSpecification,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": 0.95,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "points-glow",
          type: "circle",
          source: "incidents",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "__styleColor"],
              "rgba(148,163,184,0.90)",
            ],
            "circle-radius": 5,
            "circle-opacity": 0.0,
            "circle-blur": 0.9,
            "circle-stroke-width": 0,
          },
        },
        "points"
      );

      map.addLayer(
        {
          id: "points-raw",
          type: "circle",
          source: "incidents-raw",
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "__styleColor"],
              "rgba(148,163,184,0.90)",
            ],
            "circle-radius": 5,
            "circle-opacity": 0.92,
            "circle-stroke-color": "rgba(0,0,0,0.35)",
            "circle-stroke-width": 1.25,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "points-raw-icons",
          type: "symbol",
          source: "incidents-raw",
          layout: {
            "icon-image": [
              "coalesce",
              ["get", "__iconId"],
              categoryIconId.Other,
            ] as ExpressionSpecification,
            "icon-size": 1,
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": 0.95,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "points-raw-glow",
          type: "circle",
          source: "incidents-raw",
          paint: {
            "circle-color": [
              "coalesce",
              ["get", "__styleColor"],
              "rgba(148,163,184,0.90)",
            ],
            "circle-radius": 5,
            "circle-opacity": 0.0,
            "circle-blur": 0.9,
            "circle-stroke-width": 0,
          },
        },
        "points-raw"
      );

      map.addLayer(
        {
          id: "heatmap-outline",
          type: "heatmap",
          source: "incidents-raw",
          maxzoom: 15,
          paint: {
            "heatmap-weight": heatmapWeightExpr,
            "heatmap-intensity": zoomExpr(
              DEFAULT_HEATMAP_SETTINGS.intensity0,
              DEFAULT_HEATMAP_SETTINGS.intensity12
            ),
            "heatmap-radius": zoomExpr(
              DEFAULT_HEATMAP_SETTINGS.radius0 * 2,
              DEFAULT_HEATMAP_SETTINGS.radius12 * 2
            ),
            "heatmap-opacity": DEFAULT_HEATMAP_SETTINGS.outlineOpacity,
            "heatmap-color": heatmapOutlineColorExpr,
          },
        },
        beforeLabels
      );

      map.addLayer(
        {
          id: "heatmap",
          type: "heatmap",
          source: "incidents-raw",
          maxzoom: 15,
          paint: {
            "heatmap-weight": heatmapWeightExpr,
            "heatmap-intensity": zoomExpr(
              DEFAULT_HEATMAP_SETTINGS.intensity0,
              DEFAULT_HEATMAP_SETTINGS.intensity12
            ),
            "heatmap-radius": zoomExpr(
              DEFAULT_HEATMAP_SETTINGS.radius0,
              DEFAULT_HEATMAP_SETTINGS.radius12
            ),
            "heatmap-opacity": DEFAULT_HEATMAP_SETTINGS.opacity,
            "heatmap-color": heatmapColorExpr,
          },
        },
        beforeLabels
      );

      map.setLayoutProperty("heatmap-outline", "visibility", "none");
      map.setLayoutProperty("heatmap", "visibility", "none");
      map.setLayoutProperty("query-area-fill", "visibility", "none");
      map.setLayoutProperty("query-area-outline", "visibility", "none");
      map.setLayoutProperty("points-raw", "visibility", "none");
      map.setLayoutProperty("points-raw-icons", "visibility", "none");
      map.setLayoutProperty("points-raw-glow", "visibility", "none");
      applyHeatmapSettings(map, heatmapSettingsRef.current);

      if (pulseRafRef.current != null) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }

      const periodMs = 1400;
      let lastTick = 0;
      const tick = (now: number) => {
        if (!mapRef.current || mapRef.current !== map) return;
        if (
          !map.isStyleLoaded() ||
          (!map.getLayer("points-glow") && !map.getLayer("points-raw-glow"))
        ) {
          pulseRafRef.current = requestAnimationFrame(tick);
          return;
        }

        if (now - lastTick >= 33) {
          lastTick = now;
          const t = (now % periodMs) / periodMs;
          const eased = 1 - Math.pow(1 - t, 3);
          const radius = 5 + eased * 33;
          const opacity = (1 - eased) * 0.38;
          if (map.getLayer("points-glow")) {
            map.setPaintProperty("points-glow", "circle-radius", radius);
            map.setPaintProperty("points-glow", "circle-opacity", opacity);
            map.setPaintProperty(
              "points-glow",
              "circle-blur",
              0.9 + eased * 0.7
            );
          }
          if (map.getLayer("points-raw-glow")) {
            map.setPaintProperty("points-raw-glow", "circle-radius", radius);
            map.setPaintProperty("points-raw-glow", "circle-opacity", opacity);
            map.setPaintProperty(
              "points-raw-glow",
              "circle-blur",
              0.9 + eased * 0.7
            );
          }
        }

        pulseRafRef.current = requestAnimationFrame(tick);
      };

      pulseRafRef.current = requestAnimationFrame(tick);
      const tryInitialRefresh = (tries: number) => {
        const c = map.getContainer();
        if (c.clientWidth <= 0 || c.clientHeight <= 0) {
          if (tries >= 30) {
            void refresh();
            return;
          }
          requestAnimationFrame(() => tryInitialRefresh(tries + 1));
          return;
        }
        if (
          !map.isStyleLoaded() ||
          !map.getSource("incidents") ||
          !map.getSource("incidents-raw")
        ) {
          if (tries >= 30) {
            void refresh();
            return;
          }
          requestAnimationFrame(() => tryInitialRefresh(tries + 1));
          return;
        }
        map.resize();
        const b = map.getBounds();
        const ok =
          Number.isFinite(b.getWest()) &&
          Number.isFinite(b.getSouth()) &&
          Number.isFinite(b.getEast()) &&
          Number.isFinite(b.getNorth());
        if (!ok) {
          if (tries >= 30) {
            void refresh();
            return;
          }
          requestAnimationFrame(() => tryInitialRefresh(tries + 1));
          return;
        }
        void refresh();
      };
      tryInitialRefresh(0);
    });

    map.on("moveend", onMoveEnd);

    return () => {
      stopOnce();
      abortRef.current?.abort();
      abortRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      if (pulseRafRef.current != null) {
        cancelAnimationFrame(pulseRafRef.current);
        pulseRafRef.current = null;
      }
      mapRef.current = null;
      map.remove();
    };
  }, [styleUrl]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const apply = () => {
      if (!m.getLayer("heatmap") || !m.getLayer("heatmap-outline")) return;
      const pointRadius = useIcons ? 10 : 5;
      const pointStroke = useIcons ? 1.6 : 1.25;
      m.setLayoutProperty(
        "heatmap-outline",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
      m.setLayoutProperty(
        "heatmap",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
      m.setLayoutProperty(
        "query-area-fill",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
      m.setLayoutProperty(
        "query-area-outline",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
      m.setLayoutProperty(
        "clusters",
        "visibility",
        heatmapEnabled || !groupingEnabled ? "none" : "visible"
      );
      m.setLayoutProperty(
        "cluster-count",
        "visibility",
        heatmapEnabled || !groupingEnabled ? "none" : "visible"
      );
      m.setLayoutProperty(
        "points",
        "visibility",
        heatmapEnabled || !groupingEnabled ? "none" : "visible"
      );
      if (m.getLayer("points")) {
        m.setPaintProperty("points", "circle-radius", pointRadius);
        m.setPaintProperty("points", "circle-stroke-width", pointStroke);
      }
      if (m.getLayer("points-icons")) {
        m.setLayoutProperty(
          "points-icons",
          "visibility",
          !useIcons || heatmapEnabled || !groupingEnabled ? "none" : "visible"
        );
      }
      if (m.getLayer("points-glow")) {
        m.setLayoutProperty(
          "points-glow",
          "visibility",
          heatmapEnabled || !groupingEnabled ? "none" : "visible"
        );
      }
      if (m.getLayer("points-raw")) {
        m.setLayoutProperty(
          "points-raw",
          "visibility",
          heatmapEnabled || groupingEnabled ? "none" : "visible"
        );
        m.setPaintProperty("points-raw", "circle-radius", pointRadius);
        m.setPaintProperty("points-raw", "circle-stroke-width", pointStroke);
      }
      if (m.getLayer("points-raw-icons")) {
        m.setLayoutProperty(
          "points-raw-icons",
          "visibility",
          !useIcons || heatmapEnabled || groupingEnabled ? "none" : "visible"
        );
      }
      if (m.getLayer("points-raw-glow")) {
        m.setLayoutProperty(
          "points-raw-glow",
          "visibility",
          heatmapEnabled || groupingEnabled ? "none" : "visible"
        );
      }
    };

    if (m.isStyleLoaded()) {
      apply();
      return;
    }

    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [heatmapEnabled, groupingEnabled, styleUrl, useIcons]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const apply = () => {
      if (!m.getLayer("heatmap") || !m.getLayer("heatmap-outline")) return;
      applyHeatmapSettings(m, heatmapSettings);
    };

    if (m.isStyleLoaded()) {
      apply();
      return;
    }

    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [heatmapSettings, styleUrl]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;

    const isLngLat = (v: unknown): v is [number, number] =>
      Array.isArray(v) &&
      v.length >= 2 &&
      Number.isFinite(v[0]) &&
      Number.isFinite(v[1]);

    const onClickCluster = async (e: MapLayerMouseEvent) => {
      const features = m.queryRenderedFeatures(e.point, {
        layers: ["clusters"],
      });
      const f = features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;

      const src = m.getSource("incidents") as maplibregl.GeoJSONSource;
      const getZoom = src as unknown as {
        getClusterExpansionZoom: (id: number) => Promise<number>;
      };

      const zoom = await getZoom.getClusterExpansionZoom(Number(clusterId));
      const coords = (f.geometry as GeoJSON.Point | undefined)?.coordinates;
      if (!isLngLat(coords)) return;
      m.easeTo({ center: coords, zoom });
    };

    const onClickPoint = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      const coords = (f.geometry as GeoJSON.Point | undefined)?.coordinates;
      if (!isLngLat(coords)) return;

      const p = f.properties ?? {};
      popupWithReact(
        new maplibregl.Popup({
          closeButton: true,
          closeOnClick: true,
        }).setLngLat(coords),
        <IncidentPopupContent p={p} useIcons={useIcons} />
      ).addTo(m);
    };

    m.on("click", "clusters", onClickCluster);
    m.on("click", "points", onClickPoint);
    m.on("click", "points-raw", onClickPoint);
    m.on("mouseenter", "clusters", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "clusters", () => {
      m.getCanvas().style.cursor = "";
    });
    m.on("mouseenter", "points", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "points", () => {
      m.getCanvas().style.cursor = "";
    });
    m.on("mouseenter", "points-raw", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "points-raw", () => {
      m.getCanvas().style.cursor = "";
    });

    return () => {
      m.off("click", "clusters", onClickCluster);
      m.off("click", "points", onClickPoint);
      m.off("click", "points-raw", onClickPoint);
    };
  }, [styleUrl, useIcons]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (!m.isStyleLoaded()) return;
    if (!m.getSource("incidents")) return;
    if (!m.getSource("incidents-raw")) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const b = m.getBounds();
    const bbox = {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };

    void (async () => {
      startLoading();
      try {
        const data = await fetchIncidents({
          bbox,
          filters,
          signal: ac.signal,
        });
        const src = m.getSource("incidents") as maplibregl.GeoJSONSource;
        const srcRaw = m.getSource("incidents-raw") as maplibregl.GeoJSONSource;
        const next = decorateIncidents(data, filters);
        src.setData(next);
        srcRaw.setData(next);
        setIncidents(next);
      } catch (e) {
        if (!isAbortError(e)) {
          setIncidents((prev) => prev);
        }
      } finally {
        stopLoading();
      }
    })();

    return () => {
      ac.abort();
    };
  }, [filters]);

  if (!maptilerKey) {
    return (
      <div className="relative h-full w-full bg-black">
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/80">
          Set NEXT_PUBLIC_MAPTILER_KEY in .env.local
        </div>
      </div>
    );
  }

  const flyToIncident = (f: IncidentFeature) => {
    const m = mapRef.current;
    if (!m) return;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) return;
    const center: [number, number] = [Number(c[0]), Number(c[1])];
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    m.easeTo({ center, zoom: Math.max(m.getZoom(), 14) });

    popupRef.current?.remove();
    popupRef.current = popupWithReact(
      new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
      }).setLngLat(center),
      <IncidentPopupContent p={f.properties} useIcons={useIcons} />
    ).addTo(m);
  };

  const onSearchPick = (center: [number, number], label: string) => {
    const m = mapRef.current;
    if (!m) return;

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = new maplibregl.Marker({ color: "#50c8ff" })
      .setLngLat(center)
      .addTo(m);

    m.easeTo({ center, zoom: 14 });

    popupRef.current?.remove();
    popupRef.current = popupWithReact(
      new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
      }).setLngLat(center),
      <SearchPopupContent label={String(label)} useIcons={useIcons} />
    ).addTo(m);
  };

  return (
    <div className="relative h-full w-full">
      <div className="ui-panel absolute top-3 left-3 right-3 z-10 hidden w-auto max-w-[400px] p-4 md:block md:right-auto md:w-[400px]">
        <Filters
          styleId={currentStyleId}
          onStyleId={(v) => setCurrentStyleId(v)}
          heatmapEnabled={heatmapEnabled}
          onHeatmapSettingsOpen={() => setHeatmapSettingsOpen(true)}
          filters={filters}
          onFilters={setFilters}
          onSearchPick={onSearchPick}
        />
      </div>

      <div className="ui-panel absolute top-auto right-3 bottom-3 left-3 z-10 hidden h-[42dvh] w-auto overflow-hidden md:block md:top-3 md:right-3 md:bottom-auto md:left-auto md:h-[calc(100%-54px)] md:w-[400px]">
        <Sidebar items={incidents.features} onPick={flyToIncident} />
      </div>

      <div className="fixed right-3 bottom-3 z-20 flex flex-col gap-2 md:hidden">
        <button
          type="button"
          className={mobilePanel === "filters" ? "ui-btn-primary" : "ui-btn"}
          onClick={() =>
            setMobilePanel((p) => (p === "filters" ? null : "filters"))
          }
        >
          {mobilePanel === "filters" ? "Close Filters" : "Filters"}
        </button>
        <button
          type="button"
          className={mobilePanel === "incidents" ? "ui-btn-primary" : "ui-btn"}
          onClick={() =>
            setMobilePanel((p) => (p === "incidents" ? null : "incidents"))
          }
        >
          {mobilePanel === "incidents"
            ? "Close Incidents"
            : `Incidents (${incidents.features.length})`}
        </button>
      </div>

      {mobilePanel !== null && (
        <div
          className="fixed inset-0 z-30 bg-black/55 md:hidden"
          onClick={() => setMobilePanel(null)}
        >
          <div
            className="ui-panel absolute top-3 right-3 bottom-3 left-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <div className="text-sm font-semibold text-white/90">
                {mobilePanel === "filters" ? "Filters" : "Incidents"}
              </div>
              <button
                type="button"
                className="ui-btn h-9 px-3 text-[13px]"
                onClick={() => setMobilePanel(null)}
              >
                Close
              </button>
            </div>
            <div className="ui-divider mx-4" />
            <div className="h-[calc(100%-64px)] overflow-auto p-4">
              {mobilePanel === "filters" ? (
                <Filters
                  styleId={currentStyleId}
                  onStyleId={(v) => setCurrentStyleId(v)}
                  heatmapEnabled={heatmapEnabled}
                  onHeatmapSettingsOpen={() => {
                    setHeatmapSettingsOpen(true);
                    setMobilePanel(null);
                  }}
                  filters={filters}
                  onFilters={setFilters}
                  onSearchPick={(center, label) => {
                    onSearchPick(center, label);
                    setMobilePanel(null);
                  }}
                />
              ) : (
                <div className="h-full overflow-hidden">
                  <Sidebar
                    items={incidents.features}
                    onPick={(f) => {
                      flyToIncident(f);
                      setMobilePanel(null);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <HeatmapSettingsPanel
        open={heatmapSettingsOpen}
        enabled={heatmapEnabled}
        onEnabled={setHeatmapEnabled}
        settings={heatmapSettings}
        onSettings={setHeatmapSettings}
        onReset={() => setHeatmapSettings(DEFAULT_HEATMAP_SETTINGS)}
        onClose={() => setHeatmapSettingsOpen(false)}
      />

      {isLoading && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-end justify-center">
          <div className="ui-panel-strong inline-flex items-center gap-2 px-3 py-2 mb-4 text-[12px] text-white/85">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
            <span>Updating...</span>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed left-3 bottom-3 z-40">
        <div
          className="ui-panel pointer-events-auto inline-flex max-w-[440px] flex-col gap-2 px-3 py-2 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => setActiveHelpOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setActiveHelpOpen(true);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              Active
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-white/65 hover:bg-white/10 hover:text-white/85"
              aria-label="What do these toggles do?"
              onClick={(e) => {
                e.stopPropagation();
                setActiveHelpOpen(true);
              }}
            >
              <CircleHelp size={16} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] ring-1 ring-white/10 cursor-pointer " +
                (heatmapEnabled
                  ? "cursor-not-allowed bg-white/5 text-white/35"
                  : groupingEnabled
                    ? "bg-white/10 text-white/90 hover:bg-white/12"
                    : "bg-white/5 text-white/55 hover:bg-white/10")
              }
              disabled={heatmapEnabled}
              aria-pressed={groupingEnabled}
              onClick={(e) => {
                e.stopPropagation();
                setGroupingEnabled((v) => !v);
              }}
            >
              <span
                className={
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[11px] " +
                  (groupingEnabled
                    ? "border-white/35 text-white/85"
                    : "border-white/15 text-white/40")
                }
              >
                {groupingEnabled ? "✓" : ""}
              </span>
              <span>Grouping</span>
            </button>

            <button
              type="button"
              className={
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] ring-1 ring-white/10 cursor-pointer " +
                (useIcons
                  ? "bg-white/10 text-white/90 hover:bg-white/12"
                  : "bg-white/5 text-white/55 hover:bg-white/10")
              }
              aria-pressed={useIcons}
              onClick={(e) => {
                e.stopPropagation();
                setUseIcons((v) => !v);
              }}
            >
              <span
                className={
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[11px] " +
                  (useIcons
                    ? "border-white/35 text-white/85"
                    : "border-white/15 text-white/40")
                }
              >
                {useIcons ? "✓" : ""}
              </span>
              <span>Icons</span>
            </button>

            <button
              type="button"
              className={
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] ring-1 ring-white/10 cursor-pointer " +
                (filters.hideRoadTests
                  ? "bg-white/10 text-white/90 hover:bg-white/12"
                  : "bg-white/5 text-white/55 hover:bg-white/10")
              }
              aria-pressed={Boolean(filters.hideRoadTests)}
              onClick={(e) => {
                e.stopPropagation();
                setFilters((f) => ({ ...f, hideRoadTests: !f.hideRoadTests }));
              }}
            >
              <span
                className={
                  "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[11px] " +
                  (filters.hideRoadTests
                    ? "border-white/35 text-white/85"
                    : "border-white/15 text-white/40")
                }
              >
                {filters.hideRoadTests ? "✓" : ""}
              </span>
              <span>Hide Tests/Stats</span>
            </button>
          </div>
        </div>
      </div>

      {activeHelpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 md:p-6"
          onClick={() => setActiveHelpOpen(false)}
        >
          <div
            className="ui-panel w-full max-w-[620px] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white/90">
                  Active Settings
                </div>
                <div className="mt-1 text-[11px] leading-4 text-white/60">
                  Quick toggles that affect how incidents are shown.
                </div>
              </div>
              <button
                type="button"
                className="ui-btn h-9 px-3 text-[13px]"
                onClick={() => setActiveHelpOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="ui-divider mx-4" />
            <div className="p-4">
              <div className="flex flex-col gap-3">
                <div className="ui-card">
                  <div className="text-[13px] font-semibold text-white/90">
                    Grouping
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-white/60">
                    Combines nearby incidents into clusters when zoomed out.
                    Grouping is disabled while Heatmap is enabled.
                  </div>
                </div>

                <div className="ui-card">
                  <div className="text-[13px] font-semibold text-white/90">
                    Icons
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-white/60">
                    Shows an icon in labels/popups to visually indicate the
                    incident category.
                  </div>
                </div>

                <div className="ui-card">
                  <div className="text-[13px] font-semibold text-white/90">
                    Hide Tests/Stats
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-white/60">
                    Removes “Roadside Test” and “Federal Stats” entries from the
                    dataset.
                  </div>
                </div>

                <div className="ui-card">
                  <div className="text-[13px] font-semibold text-white/90">
                    Legend
                  </div>
                  <div className="mt-1 text-[11px] leading-4 text-white/60">
                    Common abbreviations you may see in incident names:
                  </div>
                  <div className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] leading-4 text-white/70">
                    {INCIDENT_ABBREVIATION_LEGEND.map((x) => (
                      <div key={x.abbr} className="contents">
                        <div className="font-semibold text-white/85">
                          {x.abbr}
                        </div>
                        <div>{x.meaning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
