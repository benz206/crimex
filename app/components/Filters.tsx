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
  onSearchPick: (center: [number, number], label: string) => void;
};

export function Filters({
  styleId,
  onStyleId,
  heatmapEnabled,
  onHeatmapEnabled,
  filters,
  onFilters,
  onSearchPick,
}: Props) {
  const rangeValue = (() => {
    const start = filters.startMs;
    const end = filters.endMs;
    if (typeof start !== "number" || typeof end !== "number") return "all";
    const days = Math.round((end - start) / (24 * 60 * 60 * 1000));
    if (days <= 8) return "7d";
    if (days <= 35) return "1m";
    if (days <= 70) return "2m";
    if (days <= 200) return "6m";
    if (days <= 400) return "1y";
    return "all";
  })();

  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY ?? "";
  const abortRef = useRef<AbortController | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = searchWrapRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[25px] font-semibold text-white/95">
            Halton Crime
          </div>
          <div className="mt-1 text-[11px] leading-4 text-white/60">
            Filter incidents and switch between clusters and heatmap density.
          </div>
        </div>
        <button
          type="button"
          className="ui-btn shrink-0"
          onClick={() => {
            const endMs = Date.now();
            const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
            onFilters({ startMs, endMs, hideRoadTests: false });
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
          <div className="mt-1 text-[11px] leading-4 text-white/60">
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
        <div className="text-[11px] text-white/60">Low</div>
        <div className="h-2 flex-1 rounded-full ring-1 ring-white/10 bg-linear-to-r from-transparent via-[rgba(255,255,255,0.45)] to-[rgba(255,255,255,0.9)]" />
        <div className="text-[11px] text-white/60">High</div>
      </div>

      <div ref={searchWrapRef} className="relative">
        <label className="flex flex-col gap-1">
          <span className="ui-label">Search</span>
          <div className="relative">
            <input
              className="ui-input pr-10 placeholder:text-white/35"
              value={query}
              placeholder="Search Halton address/place"
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
            />
            {query.length > 0 && (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-sm text-white/70 hover:bg-white/10"
                aria-label="Clear search"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                }}
              >
                ×
              </button>
            )}
          </div>
        </label>
        {open && results.length > 0 && (
          <div className="ui-panel-strong absolute z-10 mt-2 w-full overflow-hidden">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full px-3 py-2.5 text-left text-sm text-white/95 hover:bg-white/10"
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
        <span className="ui-label">Time Range</span>
        <select
          className="ui-select"
          value={rangeValue}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "all") {
              const next = { ...filters };
              delete next.startMs;
              delete next.endMs;
              onFilters(next);
              return;
            }

            const endMs = Date.now();
            const startMs =
              v === "7d"
                ? endMs - 7 * 24 * 60 * 60 * 1000
                : v === "2m"
                ? endMs - 60 * 24 * 60 * 60 * 1000
                : v === "6m"
                ? endMs - 180 * 24 * 60 * 60 * 1000
                : v === "1y"
                ? endMs - 365 * 24 * 60 * 60 * 1000
                : endMs - 30 * 24 * 60 * 60 * 1000;
            onFilters({ ...filters, startMs, endMs });
          }}
        >
          <option value="7d">7 days</option>
          <option value="1m">1 month</option>
          <option value="2m">2 months</option>
          <option value="6m">6 months</option>
          <option value="1y">1 year</option>
          <option value="all">All</option>
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
          <option value="">All</option>
          <option value="ACTON">Acton</option>
          <option value="BURLINGTON">Burlington</option>
          <option value="GEORGETOWN">Georgetown</option>
          <option value="HALTON HILLS">Halton Hills</option>
          <option value="MILTON">Milton</option>
          <option value="OAKVILLE">Oakville</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="ui-label">Incident / Crime Types</span>
        <select
          className="ui-select"
          value={filters.description ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, description: e.target.value || undefined })
          }
        >
          <option value="">All</option>
          <option value=" ARSON">Arson</option>
          <option value=" ATTEMPT MURDER">Attempt Murder</option>
          <option value=" BREAK AND ENTER HOUSE">
            Break and Enter – House
          </option>
          <option value=" BREAK AND ENTER OTHER">
            Break and Enter – Other
          </option>
          <option value=" BREAK AND ENTER SCHOOL">
            Break and Enter – School
          </option>
          <option value=" BREAK AND ENTER SHOP">Break and Enter – Shop</option>
          <option value=" DANGEROUS OPERATION TRAFFIC">
            Dangerous Operation – Traffic
          </option>
          <option value=" FEDERAL STATS DRUGS">Federal Stats – Drugs</option>
          <option value=" HOMICIDE">Homicide</option>
          <option value=" IMPAIRED DRIVING">Impaired Driving</option>
          <option value=" MVC FATALITY">MVC – Fatality</option>
          <option value=" MVC HIT & RUN">MVC – Hit & Run</option>
          <option value=" MVC PI">MVC – PI</option>
          <option value=" OFFENSIVE WEAPONS">Offensive Weapons</option>
          <option value=" PROPERTY DAMAGE OVER $5,000">
            Property Damage Over $5,000
          </option>
          <option value=" PROPERTY DAMAGE UNDER $5,000">
            Property Damage Under $5,000
          </option>
          <option value=" RECOVERED VEHICLE OTHER SERVICE">
            Recovered Vehicle – Other Service
          </option>
          <option value=" ROADSIDE TEST">Roadside Test</option>
          <option value=" ROBBERY">Robbery</option>
          <option value=" THEFT FROM AUTO">Theft From Auto</option>
          <option value=" THEFT OF BICYCLE">Theft of Bicycle</option>
          <option value=" THEFT OF VEHICLE">Theft of Vehicle</option>
          <option value=" THEFT OVER">Theft Over</option>
          <option value=" THEFT UNDER">Theft Under</option>
        </select>
      </label>

      <div className="ui-card">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="ui-checkbox mt-0.5"
            checked={Boolean(filters.hideRoadTests)}
            onChange={(e) =>
              onFilters({ ...filters, hideRoadTests: e.target.checked })
            }
          />
          <span className="min-w-0">
            <div className="text-[13px] font-semibold text-white/90">
              Hide Roadside Tests
            </div>
            <div className="mt-0.5 text-[11px] leading-4 text-white/60">
              Roadside tests are police screening checks and aren’t necessarily
              a reported incident.
            </div>
          </span>
        </label>
      </div>
    </div>
  );
}
