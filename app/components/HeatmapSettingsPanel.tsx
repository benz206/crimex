"use client";

import type { HeatmapSettings } from "@/app/lib/types";

type Props = {
  open: boolean;
  enabled: boolean;
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
  settings,
  onSettings,
  onClose,
  onReset,
}: Props) {
  if (!open) return null;

  const set = (patch: Partial<HeatmapSettings>) =>
    onSettings({ ...settings, ...patch });

  return (
    <div className="fixed inset-0 z-40 bg-black/55" onClick={onClose}>
      <div
        className="ui-panel absolute top-3 right-3 bottom-3 left-3 overflow-hidden md:top-12 md:right-12 md:bottom-auto md:left-auto md:w-[420px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
          <div className="text-sm font-semibold text-white/90">
            Heatmap Settings
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-btn h-9 px-3 text-[13px] disabled:opacity-50"
              disabled={!enabled}
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

        <div className="h-[calc(100%-64px)] overflow-auto p-4">
          {!enabled && (
            <div className="ui-card mb-4 text-[12px] text-white/70">
              Turn on the heatmap to see changes.
            </div>
          )}

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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={2}
                max={30}
                step={1}
                value={settings.radius0}
                disabled={!enabled}
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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={10}
                max={120}
                step={1}
                value={settings.radius12}
                disabled={!enabled}
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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={0.1}
                max={2.0}
                step={0.05}
                value={settings.intensity0}
                disabled={!enabled}
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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={0.2}
                max={3.0}
                step={0.05}
                value={settings.intensity12}
                disabled={!enabled}
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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={0}
                max={1}
                step={0.05}
                value={settings.opacity}
                disabled={!enabled}
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
              <input
                type="range"
                className="mt-3 w-full accent-(--accent) disabled:opacity-50"
                min={0}
                max={1}
                step={0.05}
                value={settings.outlineOpacity}
                disabled={!enabled}
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
