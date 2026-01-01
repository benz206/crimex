"use client";

import { useEffect, useRef, useState } from "react";
import {
  mapTilerGeocode,
  STYLE_CHOICES,
  type MapTilerGeocodeResult,
  type MapTilerStyleId,
} from "@/app/lib/maptiler";
import type { IncidentFilters } from "@/app/lib/types";

type Props = {
  styleId: MapTilerStyleId;
  onStyleId: (v: MapTilerStyleId) => void;
  heatmapEnabled: boolean;
  onHeatmapEnabled: (v: boolean) => void;
  filters: IncidentFilters;
  onFilters: (next: IncidentFilters) => void;
  cities: string[];
  descriptions: string[];
  onSearchPick: (center: [number, number], label: string) => void;
};

export function Filters({
  styleId,
  onStyleId,
  heatmapEnabled,
  onHeatmapEnabled,
  filters,
  onFilters,
  cities,
  descriptions,
  onSearchPick,
}: Props) {
  const rangeValue = (() => {
    const start = filters.startMs;
    const end = filters.endMs;
    if (typeof start !== "number" || typeof end !== "number") return "30d";
    const days = Math.round((end - start) / (24 * 60 * 60 * 1000));
    if (days <= 8) return "7d";
    if (days <= 35) return "30d";
    if (days <= 100) return "90d";
    return "30d";
  })();

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
  const abortRef = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapTilerGeocodeResult[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!maptilerKey) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await mapTilerGeocode({
            query,
            key: maptilerKey,
            signal: ac.signal,
          });
          setResults(r);
        } catch {
          setResults([]);
        }
      })();
    }, 250);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [query, maptilerKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">
            Halton Crime
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-white/55">
            Filter incidents and switch between clusters and heatmap density.
          </div>
        </div>
        <button
          type="button"
          className="ui-btn shrink-0"
          onClick={() => {
            const endMs = Date.now();
            const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
            onFilters({ startMs, endMs });
            setQuery("");
            setOpen(false);
          }}
        >
          Reset
        </button>
      </div>

      <div className="ui-divider" />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="ui-title">View</div>
          <div className="mt-0.5 text-[11px] leading-4 text-white/55">
            Heatmap shows density; the outline shows the current data window.
          </div>
        </div>
        <button
          type="button"
          className={
            heatmapEnabled ? "ui-btn-primary shrink-0" : "ui-btn shrink-0"
          }
          onClick={() => onHeatmapEnabled(!heatmapEnabled)}
        >
          {heatmapEnabled ? "Heatmap On" : "Heatmap Off"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="text-[11px] text-white/55">Low</div>
        <div className="h-2 flex-1 rounded-full ring-1 ring-white/10 bg-gradient-to-r from-transparent via-[rgba(80,200,255,0.75)] to-[rgba(255,110,160,0.95)]" />
        <div className="text-[11px] text-white/55">High</div>
      </div>

      <div className="relative">
        <label className="flex flex-col gap-1">
          <span className="ui-label">Search</span>
          <input
            className="ui-input placeholder:text-white/35"
            value={query}
            placeholder="Search Halton address/place"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </label>
        {open && results.length > 0 && (
          <div className="ui-panel-strong absolute z-10 mt-2 w-full overflow-hidden">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm text-white/90 hover:bg-white/8"
                onClick={() => {
                  onSearchPick(r.center, r.label);
                  setQuery(r.label);
                  setOpen(false);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="ui-label">Basemap</span>
        <select
          className="ui-select"
          value={String(styleId)}
          onChange={(e) => onStyleId(e.target.value)}
        >
          {STYLE_CHOICES.map((s) => (
            <option key={String(s.id)} value={String(s.id)}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="ui-label">Time window</span>
        <select
          className="ui-select"
          value={rangeValue}
          onChange={(e) => {
            const v = e.target.value;
            const endMs = Date.now();
            const startMs =
              v === "7d"
                ? endMs - 7 * 24 * 60 * 60 * 1000
                : v === "90d"
                ? endMs - 90 * 24 * 60 * 60 * 1000
                : endMs - 30 * 24 * 60 * 60 * 1000;
            onFilters({ ...filters, startMs, endMs });
          }}
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="ui-label">Municipality</span>
        <select
          className="ui-select"
          value={filters.city ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, city: e.target.value || undefined })
          }
        >
          <option value="">All municipalities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="ui-label">Incident type</span>
        <select
          className="ui-select"
          value={filters.description ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, description: e.target.value || undefined })
          }
        >
          <option value="">All types</option>
          {descriptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
