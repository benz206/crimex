"use client";

import Link from "next/link";
import { CircleHelp, CircleUserRound, RotateCcw } from "lucide-react";
import type { IncidentFilters } from "@/lib/types";

const INCIDENT_ABBREVIATION_LEGEND: Array<{ abbr: string; meaning: string }> = [
  { abbr: "MVC", meaning: "Motor Vehicle Collision" },
  { abbr: "PI", meaning: "Personal Injury" },
];

export type MapOverlayControlsProps = {
  // chip bar + help button
  activeHelpOpen: boolean;
  setActiveHelpOpen: (v: boolean) => void;
  predictionsEnabled: boolean;
  setPredictionsEnabled: (fn: (v: boolean) => boolean) => void;
  heatmapEnabled: boolean;
  groupingEnabled: boolean;
  setGroupingEnabled: (fn: (v: boolean) => boolean) => void;
  useIcons: boolean;
  setUseIcons: (fn: (v: boolean) => boolean) => void;
  filters: IncidentFilters;
  setFilters: (fn: (f: IncidentFilters) => IncidentFilters) => void;
  // reset-confirm modal + trigger
  filterResetConfirmOpen: boolean;
  setFilterResetConfirmOpen: (v: boolean) => void;
};

export function MapOverlayControls({
  activeHelpOpen,
  setActiveHelpOpen,
  predictionsEnabled,
  setPredictionsEnabled,
  heatmapEnabled,
  groupingEnabled,
  setGroupingEnabled,
  useIcons,
  setUseIcons,
  filters,
  setFilters,
  filterResetConfirmOpen,
  setFilterResetConfirmOpen,
}: MapOverlayControlsProps) {
  return (
    <>
      {/* Bottom-right reset + profile buttons (desktop only) */}
      <div className="pointer-events-none fixed right-3 bottom-3 z-40 hidden md:block">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            className="ui-btn inline-flex min-h-10 min-w-10 items-center justify-center p-0"
            aria-label="Reset filters"
            onClick={() => setFilterResetConfirmOpen(true)}
          >
            <RotateCcw size={14} />
          </button>
          <Link
            href="/profile"
            className="ui-btn inline-flex min-h-10 min-w-10 items-center justify-center p-0"
            aria-label="Profile"
          >
            <CircleUserRound size={14} />
          </Link>
        </div>

        {/* Reset-confirm modal */}
        {filterResetConfirmOpen && (
          <div className="ui-panel absolute right-0 bottom-12 w-[280px] max-h-[90dvh] overflow-y-auto p-3">
            <div className="text-[13px] font-semibold text-white/90">
              Reset filters?
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              This resets map filters to the default 1 month range.
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="ui-btn h-8 px-2.5 text-[11px]"
                onClick={() => setFilterResetConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn-primary h-8 px-2.5 text-[11px]"
                onClick={() => {
                  const endMs = Date.now();
                  const startMs = endMs - 30 * 24 * 60 * 60 * 1000;
                  setFilters(() => ({
                    startMs,
                    endMs,
                    timePreset: "1m",
                    hideRoadTests: true,
                  }));
                  setFilterResetConfirmOpen(false);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Active-settings chip bar */}
      <div className="pointer-events-none fixed left-2 bottom-2 z-40 sm:left-3 sm:bottom-3">
        <div
          className="ui-panel pointer-events-auto inline-flex max-w-[calc(100vw-1rem)] flex-col gap-1.5 px-2 py-1.5 cursor-pointer sm:max-w-[440px] sm:gap-2 sm:px-3 sm:py-2"
          role="button"
          tabIndex={0}
          onClick={() => setActiveHelpOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setActiveHelpOpen(true);
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="hidden text-[11px] font-semibold uppercase tracking-wide text-white/60 sm:block">
              Active
            </div>
            <button
              type="button"
              className="rounded-md p-1 min-h-10 min-w-10 flex items-center justify-center text-white/65 hover:bg-white/10 hover:text-white/85"
              aria-label="What do these toggles do?"
              onClick={(e) => {
                e.stopPropagation();
                setActiveHelpOpen(true);
              }}
            >
              <CircleHelp size={16} />
            </button>
          </div>
          <div className="flex max-w-full flex-nowrap gap-2 overflow-x-auto">
            <button
              type="button"
              className={
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] ring-1 ring-white/10 cursor-pointer sm:gap-2 sm:px-3 sm:text-[12px] " +
                (predictionsEnabled
                  ? "bg-[#22c55e]/20 text-[#22c55e] hover:bg-[#22c55e]/25"
                  : "bg-white/5 text-white/55 hover:bg-white/10")
              }
              aria-pressed={predictionsEnabled}
              onClick={(e) => {
                e.stopPropagation();
                setPredictionsEnabled((v) => !v);
              }}
            >
              <span
                className={
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] sm:h-4 sm:w-4 sm:text-[11px] " +
                  (predictionsEnabled
                    ? "border-[#22c55e]/50 text-[#22c55e]"
                    : "border-white/15 text-white/40")
                }
              >
                {predictionsEnabled ? "✓" : ""}
              </span>
              <span>Predictions</span>
            </button>

            <button
              type="button"
              className={
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] ring-1 ring-white/10 cursor-pointer sm:gap-2 sm:px-3 sm:text-[12px] " +
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
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] sm:h-4 sm:w-4 sm:text-[11px] " +
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
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] ring-1 ring-white/10 cursor-pointer sm:gap-2 sm:px-3 sm:text-[12px] " +
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
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] sm:h-4 sm:w-4 sm:text-[11px] " +
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
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] ring-1 ring-white/10 cursor-pointer sm:gap-2 sm:px-3 sm:text-[12px] " +
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
                  "inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[10px] sm:h-4 sm:w-4 sm:text-[11px] " +
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

      {/* Help / info modal */}
      {activeHelpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 md:p-6"
          onClick={() => setActiveHelpOpen(false)}
        >
          <div
            className="ui-panel w-full max-w-[620px] max-h-[90dvh] overflow-y-auto"
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
                    Removes &quot;Roadside Test&quot; and &quot;Federal Stats&quot; entries from the
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
    </>
  );
}
