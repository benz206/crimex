"use client";

import type { IncidentFeature } from "@/app/lib/types";

type Props = {
  items: IncidentFeature[];
  onPick: (item: IncidentFeature) => void;
};

function formatDate(ms?: number) {
  if (!ms) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function Sidebar({ items, onPick }: Props) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="px-4 pt-4 pb-3">
        <div className="pb-2 md:hidden">
          <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-white/95">
              Incidents
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              Most recent first
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80 ring-1 ring-white/10">
            {items.length}
          </div>
        </div>
      </div>
      <div className="ui-divider mx-4" />
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-3">
        <div className="flex flex-col gap-2">
          {items.map((f) => (
            <button
              key={String(f.properties.OBJECTID)}
              type="button"
              className="ui-card"
              onClick={() => onPick(f)}
            >
              <div className="text-[14px] font-semibold text-white/95">
                {f.properties.DESCRIPTION ?? "Incident"}
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-white/65">
                <span className="truncate">{f.properties.CITY ?? ""}</span>
                <span className="shrink-0">
                  {formatDate(f.properties.DATE)}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
