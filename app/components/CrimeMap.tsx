"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map, type MapLayerMouseEvent } from "maplibre-gl";
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
} from "@/app/lib/types";
import { Filters } from "@/app/components/Filters";
import { Sidebar } from "@/app/components/Sidebar";

type Props = {
  styleId?: MapTilerStyleId;
};

export function CrimeMap({ styleId = DEFAULT_STYLE_ID }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const filtersRef = useRef<IncidentFilters>({});
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [currentStyleId, setCurrentStyleId] =
    useState<MapTilerStyleId>(styleId);
  const [filters, setFilters] = useState<IncidentFilters>(() => {
    const endMs = Date.now();
    const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
    return { startMs, endMs };
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

  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!styleUrl) return;

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

      map.addSource("query-area", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: "query-area-fill",
        type: "fill",
        source: "query-area",
        paint: {
          "fill-color": "rgba(46,229,157,0.10)",
          "fill-opacity": 0.9,
        },
      });

      map.addLayer({
        id: "query-area-outline",
        type: "line",
        source: "query-area",
        paint: {
          "line-color": "rgba(46,229,157,0.65)",
          "line-width": 2,
          "line-blur": 0.2,
        },
      });

      map.addLayer({
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
      });

      map.addLayer({
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
      });

      map.addLayer({
        id: "points",
        type: "circle",
        source: "incidents",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgba(255,110,160,0.85)",
          "circle-radius": 4.5,
          "circle-stroke-color": "rgba(0,0,0,0.25)",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "heatmap-outline",
        type: "heatmap",
        source: "incidents",
        maxzoom: 15,
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.2,
            12,
            1,
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.8,
            12,
            1.8,
          ],
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            14,
            12,
            50,
          ],
          "heatmap-opacity": 0.9,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.14,
            "rgba(0,0,0,0.00)",
            0.22,
            "rgba(0,0,0,0.22)",
            0.55,
            "rgba(0,0,0,0.38)",
            1,
            "rgba(0,0,0,0.60)",
          ],
        },
      });

      map.addLayer({
        id: "heatmap",
        type: "heatmap",
        source: "incidents",
        maxzoom: 15,
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.2,
            12,
            1,
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.8,
            12,
            1.8,
          ],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 6, 12, 22],
          "heatmap-opacity": 0.85,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.2,
            "rgba(80,200,255,0.20)",
            0.45,
            "rgba(80,200,255,0.50)",
            0.7,
            "rgba(255,110,160,0.70)",
            1,
            "rgba(255,110,160,0.95)",
          ],
        },
      });

      map.setLayoutProperty("heatmap-outline", "visibility", "none");
      map.setLayoutProperty("heatmap", "visibility", "none");
      map.setLayoutProperty("query-area-fill", "visibility", "none");
      map.setLayoutProperty("query-area-outline", "visibility", "none");
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

      const data = await fetchIncidentsGeoJSON({
        bbox,
        filters: filtersRef.current,
        signal: ac.signal,
      });

      const src = m.getSource("incidents") as maplibregl.GeoJSONSource;
      src.setData(data);
      setIncidents(data);
    };

    const onMoveEnd = () => {
      void refresh();
    };

    map.on("moveend", onMoveEnd);
    map.on("load", onMoveEnd);

    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
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
        heatmapEnabled ? "none" : "visible"
      );
      m.setLayoutProperty(
        "cluster-count",
        "visibility",
        heatmapEnabled ? "none" : "visible"
      );
      m.setLayoutProperty(
        "points",
        "visibility",
        heatmapEnabled ? "none" : "visible"
      );
    };

    if (m.isStyleLoaded()) {
      apply();
      return;
    }

    m.once("load", apply);
    return () => {
      m.off("load", apply);
    };
  }, [heatmapEnabled, styleUrl]);

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
      const title = p.DESCRIPTION ?? "Incident";
      const city = p.CITY ?? "";
      const date = p.DATE ? new Date(Number(p.DATE)).toLocaleString() : "";

      new maplibregl.Popup({ closeButton: true, closeOnClick: true })
        .setLngLat(coords)
        .setHTML(
          `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;">
            <div style="font-weight:700;margin-bottom:6px;">${String(
              title
            )}</div>
            <div style="opacity:.75;">${String(city)}</div>
            <div style="opacity:.75;">${String(date)}</div>
          </div>`
        )
        .addTo(m);
    };

    m.on("click", "clusters", onClickCluster);
    m.on("click", "points", onClickPoint);
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

    return () => {
      m.off("click", "clusters", onClickCluster);
      m.off("click", "points", onClickPoint);
    };
  }, [styleUrl]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (!m.isStyleLoaded()) return;
    if (!m.getSource("incidents")) return;

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
      const data = await fetchIncidentsGeoJSON({
        bbox,
        filters,
        signal: ac.signal,
      });
      const src = m.getSource("incidents") as maplibregl.GeoJSONSource;
      src.setData(data);
      setIncidents(data);
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

  const sortedForSidebar: IncidentFeature[] = [...incidents.features].sort(
    (a, b) => {
      const ad = Number(a.properties.DATE ?? 0);
      const bd = Number(b.properties.DATE ?? 0);
      return bd - ad;
    }
  );

  const flyToIncident = (f: IncidentFeature) => {
    const m = mapRef.current;
    if (!m) return;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) return;
    const center: [number, number] = [Number(c[0]), Number(c[1])];
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
    m.easeTo({ center, zoom: Math.max(m.getZoom(), 14) });

    const title = f.properties.DESCRIPTION ?? "Incident";
    const city = f.properties.CITY ?? "";
    const date = f.properties.DATE
      ? new Date(Number(f.properties.DATE)).toLocaleString()
      : "";

    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
    })
      .setLngLat(center)
      .setHTML(
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;">
          <div style="font-weight:700;margin-bottom:6px;">${String(title)}</div>
          <div style="opacity:.75;">${String(city)}</div>
          <div style="opacity:.75;">${String(date)}</div>
        </div>`
      )
      .addTo(m);
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
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
    })
      .setLngLat(center)
      .setHTML(
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:12px;">
          <div style="font-weight:700;margin-bottom:6px;">${String(label)}</div>
        </div>`
      )
      .addTo(m);
  };

  return (
    <div className="relative h-full w-full">
      <div className="ui-panel absolute top-3 left-3 right-3 z-10 w-auto max-w-[400px] p-4 md:right-auto md:w-[400px]">
        <Filters
          styleId={currentStyleId}
          onStyleId={(v) => setCurrentStyleId(v)}
          heatmapEnabled={heatmapEnabled}
          onHeatmapEnabled={setHeatmapEnabled}
          filters={filters}
          onFilters={setFilters}
          onSearchPick={onSearchPick}
        />
      </div>

      <div className="ui-panel absolute top-auto right-3 bottom-3 left-3 z-10 h-[42dvh] w-auto overflow-hidden md:top-3 md:right-3 md:bottom-auto md:left-auto md:h-[calc(100%-24px)] md:w-[400px]">
        <Sidebar items={sortedForSidebar} onPick={flyToIncident} />
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
