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
      <div className="px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-white/80">
        Incidents
        <span className="ml-2 font-normal text-white/50">{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        <div className="flex flex-col gap-2">
          {items.map((f) => (
            <button
              key={String(f.properties.OBJECTID)}
              type="button"
              className="rounded-xl bg-white/5 px-3 py-2 text-left ring-1 ring-white/10 hover:bg-white/8"
              onClick={() => onPick(f)}
            >
              <div className="text-sm font-semibold text-white/90">
                {f.properties.DESCRIPTION ?? "Incident"}
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 text-[11px] text-white/55">
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
