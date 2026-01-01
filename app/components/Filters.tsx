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
  filters: IncidentFilters;
  onFilters: (next: IncidentFilters) => void;
  cities: string[];
  descriptions: string[];
  onSearchPick: (center: [number, number], label: string) => void;
};

export function Filters({
  styleId,
  onStyleId,
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wide text-white/80">
          Filters
        </div>
      </div>

      <div className="relative">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-white/60">Search</span>
          <input
            className="h-9 w-full rounded-lg bg-white/10 px-3 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/40"
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
          <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl bg-black/90 ring-1 ring-white/10">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10"
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
        <span className="text-[11px] text-white/60">Basemap</span>
        <select
          className="h-9 rounded-lg bg-white/10 px-3 text-sm text-white outline-none ring-1 ring-white/10"
          value={String(styleId)}
          onChange={(e) => onStyleId(e.target.value)}
        >
          {STYLE_CHOICES.map((s) => (
            <option
              key={String(s.id)}
              value={String(s.id)}
              className="text-black"
            >
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-white/60">Date range</span>
        <select
          className="h-9 rounded-lg bg-white/10 px-3 text-sm text-white outline-none ring-1 ring-white/10"
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
          <option value="7d" className="text-black">
            Last 7 days
          </option>
          <option value="30d" className="text-black">
            Last 30 days
          </option>
          <option value="90d" className="text-black">
            Last 90 days
          </option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-white/60">City</span>
        <select
          className="h-9 rounded-lg bg-white/10 px-3 text-sm text-white outline-none ring-1 ring-white/10"
          value={filters.city ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, city: e.target.value || undefined })
          }
        >
          <option value="" className="text-black">
            All
          </option>
          {cities.map((c) => (
            <option key={c} value={c} className="text-black">
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-white/60">Type</span>
        <select
          className="h-9 rounded-lg bg-white/10 px-3 text-sm text-white outline-none ring-1 ring-white/10"
          value={filters.description ?? ""}
          onChange={(e) =>
            onFilters({ ...filters, description: e.target.value || undefined })
          }
        >
          <option value="" className="text-black">
            All
          </option>
          {descriptions.map((d) => (
            <option key={d} value={d} className="text-black">
              {d}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
