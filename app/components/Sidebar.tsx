"use client";

import type { IncidentFeature } from "@/app/lib/types";
import {
  formatCity,
  formatIncidentDate,
  formatIncidentDescription,
  getIncidentStyle,
} from "@/app/lib/incidentStyle";
import { useMemo, useState } from "react";

type Props = {
  items: IncidentFeature[];
  onPick: (item: IncidentFeature) => void;
};

export function Sidebar({ items, onPick }: Props) {
  const [sortKey, setSortKey] = useState<
    | "date_desc"
    | "date_asc"
    | "city_asc"
    | "city_desc"
    | "type_asc"
    | "type_desc"
    | "category_asc"
    | "category_desc"
  >("date_desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const normalize = (v: unknown) =>
      String(v ?? "")
        .trim()
        .toUpperCase();
    const withKeys = items.map((f) => {
      const rawDesc =
        typeof f.properties.DESCRIPTION === "string"
          ? f.properties.DESCRIPTION
          : "";
      const rawCity =
        typeof f.properties.CITY === "string" ? f.properties.CITY : "";
      const date = Number(f.properties.DATE ?? 0);
      const type = normalize(formatIncidentDescription(rawDesc) || rawDesc);
      const city = normalize(formatCity(rawCity) || rawCity);
      const category = normalize(getIncidentStyle(rawDesc).category);
      return { f, date, type, city, category };
    });

    const dir = sortKey.endsWith("_desc") ? -1 : 1;
    const key = sortKey.replace(/_(asc|desc)$/, "");

    withKeys.sort((a, b) => {
      if (key === "date") return (a.date - b.date) * dir;
      if (key === "city") return a.city.localeCompare(b.city) * dir;
      if (key === "type") return a.type.localeCompare(b.type) * dir;
      return a.category.localeCompare(b.category) * dir;
    });

    return withKeys.map((x) => x.f);
  }, [items, sortKey]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const start = (safePage - 1) * pageSize;
  const paged = sorted.slice(start, start + pageSize);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="pb-2 md:hidden">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[25px] font-semibold text-white/95">
              Incidents
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              Sorted & paginated
            </div>
          </div>
          <div className="shrink-0 rounded-full mb-auto bg-white/10 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
            {total}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="ui-label">Sort</span>
            <select
              className="ui-select h-9 text-[13px]"
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value as typeof sortKey);
                setPage(1);
              }}
            >
              <option value="date_desc">Date (newest)</option>
              <option value="date_asc">Date (oldest)</option>
              <option value="city_asc">City (A–Z)</option>
              <option value="city_desc">City (Z–A)</option>
              <option value="type_asc">Type (A–Z)</option>
              <option value="type_desc">Type (Z–A)</option>
              <option value="category_asc">Category (A–Z)</option>
              <option value="category_desc">Category (Z–A)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="ui-label">Per page</span>
            <select
              className="ui-select h-9 text-[13px]"
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value) || 25);
                setPage(1);
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>
      </div>
      <div className="ui-divider mx-4" />
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-3">
        <div className="flex flex-col gap-2">
          {paged.map((f) => {
            const s = getIncidentStyle(f.properties.DESCRIPTION);
            return (
              <button
                key={String(f.properties.OBJECTID)}
                type="button"
                className="ui-card relative cursor-pointer overflow-hidden"
                onClick={() => onPick(f)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-white/95">
                      {formatIncidentDescription(f.properties.DESCRIPTION) ||
                        "Incident"}
                    </div>
                    <div className="mt-1 text-[11px] text-white/65">
                      <span className="truncate">
                        {formatCity(f.properties.CITY) || ""}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <div className="text-[11px] text-white/65">
                      {formatIncidentDate(f.properties.DATE)}
                    </div>
                    <div className="mt-2 inline-flex rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-white/75 ring-1 ring-white/10">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span>{s.category}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  className="absolute left-0 top-0 bottom-0 w-1"
                  style={{ backgroundColor: s.color }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="ui-divider mx-4" />
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-white/60">
            Page {safePage} / {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-btn h-9 px-3 text-[13px] disabled:opacity-50"
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
            >
              Prev
            </button>
            <button
              type="button"
              className="ui-btn h-9 px-3 text-[13px] disabled:opacity-50"
              disabled={safePage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
