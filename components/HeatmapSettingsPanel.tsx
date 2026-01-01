"use client";

import type { HeatmapSettings } from "@/lib/types";

type Props = {
  open: boolean;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  settings: HeatmapSettings;
  onSettings: (next: HeatmapSettings) => void;
  onClose: () => void;
  onReset: () => void;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const toNum = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function HeatmapSettingsPanel({
  open,
  enabled,
  onEnabled,
  settings,
  onSettings,
  onClose,
  onReset,
}: Props) {
  if (!open) return null;

  const set = (patch: Partial<HeatmapSettings>) =>
    onSettings({ ...settings, ...patch });

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="ui-panel w-full max-w-[760px] overflow-hidden md:max-h-[85dvh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white/90">
              Heatmap Settings
            </div>
            <div className="mt-1 text-[11px] leading-4 text-white/60">
              The heatmap is a density view. Increase radius for smoother blobs;
              increase intensity for stronger hotspots.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={
                enabled
                  ? "ui-btn-primary h-9 px-3 text-[13px]"
                  : "ui-btn h-9 px-3 text-[13px]"
              }
              onClick={() => onEnabled(!enabled)}
            >
              {enabled ? "Enabled" : "Disabled"}
            </button>
            <button
              type="button"
              className="ui-btn h-9 px-3 text-[13px]"
              onClick={onReset}
            >
              Reset
            </button>
            <button
              type="button"
              className="ui-btn h-9 px-3 text-[13px]"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="ui-divider mx-4" />

        <div className="max-h-[calc(85dvh-64px)] overflow-auto p-4">
          <div className="flex flex-col gap-3">
            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Radius (zoomed out)
                </div>
                <div className="text-[12px] text-white/60">
                  {Math.round(settings.radius0)}px
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Controls how wide each point spreads while zoomed out (bigger =
                smoother).
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={2}
                max={30}
                step={1}
                value={settings.radius0}
                onChange={(e) => set({ radius0: toNum(e.target.value) })}
              />
            </div>

            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Radius (zoomed in)
                </div>
                <div className="text-[12px] text-white/60">
                  {Math.round(settings.radius12)}px
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Same as above, but used when zoomed in (bigger = larger
                hotspots).
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={10}
                max={120}
                step={1}
                value={settings.radius12}
                onChange={(e) =>
                  set({ radius12: clamp(toNum(e.target.value), 10, 120) })
                }
              />
            </div>

            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Intensity (zoomed out)
                </div>
                <div className="text-[12px] text-white/60">
                  {settings.intensity0.toFixed(2)}
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Boosts how quickly density builds up while zoomed out (higher =
                hotter).
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={0.1}
                max={2.0}
                step={0.05}
                value={settings.intensity0}
                onChange={(e) =>
                  set({ intensity0: clamp(toNum(e.target.value), 0.1, 2.0) })
                }
              />
            </div>

            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Intensity (zoomed in)
                </div>
                <div className="text-[12px] text-white/60">
                  {settings.intensity12.toFixed(2)}
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Same as above, but used when zoomed in.
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={0.2}
                max={3.0}
                step={0.05}
                value={settings.intensity12}
                onChange={(e) =>
                  set({ intensity12: clamp(toNum(e.target.value), 0.2, 3.0) })
                }
              />
            </div>

            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Opacity
                </div>
                <div className="text-[12px] text-white/60">
                  {settings.opacity.toFixed(2)}
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Makes the heat layer more or less transparent.
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={0}
                max={1}
                step={0.05}
                value={settings.opacity}
                onChange={(e) =>
                  set({ opacity: clamp(toNum(e.target.value), 0, 1) })
                }
              />
            </div>

            <div className="ui-card">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-white/90">
                  Outline opacity
                </div>
                <div className="text-[12px] text-white/60">
                  {settings.outlineOpacity.toFixed(2)}
                </div>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-white/60">
                Controls the dark “extent”/outline heat layer behind the main
                colors.
              </div>
              <input
                type="range"
                className="mt-3 w-full accent-(--accent)"
                min={0}
                max={1}
                step={0.05}
                value={settings.outlineOpacity}
                onChange={(e) =>
                  set({
                    outlineOpacity: clamp(toNum(e.target.value), 0, 1),
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
