"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
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
  MapPin,
  ShieldAlert,
  ShoppingBag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  DEFAULT_STYLE_ID,
  type MapTilerStyleId,
  mapTilerStyleUrl,
} from "@/app/lib/maptiler";
import { fetchIncidentsGeoJSON } from "@/app/lib/arcgis";
import type {
  IncidentFeature,
  IncidentFeatureCollection,
  IncidentFilters,
  HeatmapSettings,
} from "@/app/lib/types";
import {
  formatCity,
  formatIncidentDate,
  formatIncidentDescription,
  getIncidentStyle,
} from "@/app/lib/incidentStyle";
import { Filters } from "@/app/components/Filters";
import { Sidebar } from "@/app/components/Sidebar";
import { HeatmapSettingsPanel } from "@/app/components/HeatmapSettingsPanel";

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

const decorateIncidents = (
  fc: IncidentFeatureCollection,
  f: IncidentFilters
): IncidentFeatureCollection => {
  const features = fc.features
    .filter(
      (x) => !f.hideRoadTests || !isRoadsideTest(x.properties.DESCRIPTION)
    )
    .map((x) => {
      const s = getIncidentStyle(x.properties.DESCRIPTION);
      const nextProps = {
        ...x.properties,
        __styleColor: s.color,
        __styleCategory: s.category,
        __isRoadsideTest: isRoadsideTest(x.properties.DESCRIPTION),
      } as typeof x.properties;
      return { ...x, properties: nextProps };
    });
  return { ...fc, features };
};

const categoryIcon: Record<string, LucideIcon> = {
  "Break & Enter": DoorOpen,
  Violence: ShieldAlert,
  Theft: ShoppingBag,
  Traffic: Car,
  "Impaired/Checks": CheckCircle2,
  Property: Home,
  Other: CircleHelp,
};

function popupWithReact(popup: maplibregl.Popup, node: ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  root.render(node);
  popup.setDOMContent(el);
  popup.on("close", () => root.unmount());
  return popup;
}

function IncidentPopupContent({
  p,
  useIcons,
}: {
  p: Record<string, unknown>;
  useIcons: boolean;
}) {
  type CSSVarStyle = CSSProperties & { "--incident-color"?: string };
  const rawDesc = typeof p.DESCRIPTION === "string" ? p.DESCRIPTION : "";
  const rawCity = typeof p.CITY === "string" ? p.CITY : "";
  const rawDate = typeof p.DATE === "number" ? p.DATE : undefined;
  const rawCaseNo =
    typeof p.CASE_NO === "string" || typeof p.CASE_NO === "number"
      ? String(p.CASE_NO)
      : "";
  const caseNo = rawCaseNo.trim();
  const title = formatIncidentDescription(rawDesc) || "Incident";
  const city = formatCity(rawCity) || "";
  const date = formatIncidentDate(rawDate) || "";
  const style = getIncidentStyle(rawDesc);
  const Icon = categoryIcon[style.category] ?? CircleHelp;
  const note = isRoadsideTest(rawDesc)
    ? "Roadside tests are police screening checks and aren’t necessarily a reported incident."
    : "";

  return (
    <div
      className="incident-popup"
      style={{ "--incident-color": style.color } as CSSVarStyle}
    >
      <div className="incident-popup__row">
        <div className="incident-popup__badge">
          <span className="incident-popup__dot" />
          <span>{style.category}</span>
        </div>
      </div>
      <div className="incident-popup__titleRow">
        {useIcons ? (
          <Icon size={16} strokeWidth={2} className="shrink-0 opacity-90" />
        ) : null}
        <div className="incident-popup__title">{title}</div>
      </div>
      <div className="incident-popup__meta">
        {caseNo ? <div>{`Case #${caseNo}`}</div> : null}
        {city ? <div>{city}</div> : null}
        {date ? <div>{date}</div> : null}
      </div>
      {note ? <div className="incident-popup__note">{note}</div> : null}
    </div>
  );
}

function SearchPopupContent({
  label,
  useIcons,
}: {
  label: string;
  useIcons: boolean;
}) {
  return (
    <div className="incident-popup">
      <div className="incident-popup__titleRow">
        {useIcons ? (
          <MapPin size={16} strokeWidth={2} className="shrink-0 opacity-90" />
        ) : null}
        <div className="incident-popup__title">{label}</div>
      </div>
    </div>
  );
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
  const filtersRef = useRef<IncidentFilters>({});
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
  const [currentStyleId, setCurrentStyleId] =
    useState<MapTilerStyleId>(styleId);
  const [filters, setFilters] = useState<IncidentFilters>(() => {
    const endMs = Date.now();
    const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
    return { startMs, endMs, hideRoadTests: true };
  });
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

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true }),
      "top-right"
    );
    mapRef.current = map;

    map.on("load", () => {
      stopOnce();
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
    });

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
        const data = await fetchIncidentsGeoJSON({
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

    map.on("moveend", onMoveEnd);
    map.on("load", onMoveEnd);

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
  }, [heatmapEnabled, groupingEnabled, styleUrl]);

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
        const data = await fetchIncidentsGeoJSON({
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
          onHeatmapEnabled={setHeatmapEnabled}
          onHeatmapSettingsOpen={() => setHeatmapSettingsOpen(true)}
          groupingEnabled={groupingEnabled}
          onGroupingEnabled={setGroupingEnabled}
          useIcons={useIcons}
          onUseIcons={setUseIcons}
          filters={filters}
          onFilters={setFilters}
          onSearchPick={onSearchPick}
        />
      </div>

      <div className="ui-panel absolute top-auto right-3 bottom-3 left-3 z-10 hidden h-[42dvh] w-auto overflow-hidden md:block md:top-3 md:right-11 md:bottom-auto md:left-auto md:h-[calc(100%-20px)] md:w-[400px]">
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
                  onHeatmapEnabled={setHeatmapEnabled}
                  onHeatmapSettingsOpen={() => {
                    setHeatmapSettingsOpen(true);
                    setMobilePanel(null);
                  }}
                  groupingEnabled={groupingEnabled}
                  onGroupingEnabled={setGroupingEnabled}
                  useIcons={useIcons}
                  onUseIcons={setUseIcons}
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
        settings={heatmapSettings}
        onSettings={setHeatmapSettings}
        onReset={() => setHeatmapSettings(DEFAULT_HEATMAP_SETTINGS)}
        onClose={() => setHeatmapSettingsOpen(false)}
      />

      {isLoading && (
        <div className="pointer-events-none fixed left-3 bottom-3 z-40 md:left-3 md:bottom-3">
          <div className="ui-panel-strong inline-flex items-center gap-2 px-3 py-2 text-[12px] text-white/85">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
            <span>Updating…</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
