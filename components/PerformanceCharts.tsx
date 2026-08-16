"use client";

import { memo, useMemo, useState } from "react";

const SERIES_PREDICTED = "#3987e5";
const SERIES_ACTUAL = "#d95926";
const GRID = "rgba(255,255,255,0.08)";
const AXIS_TEXT = "rgba(255,255,255,0.45)";

const VB_W = 680;
const VB_H = 240;
const PAD = { l: 44, r: 16, t: 14, b: 30 };
const PLOT_W = VB_W - PAD.l - PAD.r;
const PLOT_H = VB_H - PAD.t - PAD.b;

const CAL_PAD = { l: 48, r: 14, t: 14, b: 52 };
const CAL_PLOT = 340;
const CAL_W = CAL_PLOT + CAL_PAD.l + CAL_PAD.r;
const CAL_H = CAL_PLOT + CAL_PAD.t + CAL_PAD.b;

export type DailyPoint = {
  dayMs: number;
  runs: number;
  evaluatedPredictions: number;
  avgScore: number | null;
  avgBrier: number | null;
  predictedTotal: number;
  actualTotal: number;
};

export type CalibrationPoint = {
  bin: number;
  n: number;
  avgPredicted: number;
  avgActual: number;
  minPredicted: number;
  maxPredicted: number;
};

const NICE_STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = NICE_STEPS.find((s) => norm <= s + 1e-9) ?? 10;
  return step * mag;
}

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function fmtNum(v: number): string {
  if (v === 0) return "0";
  if (Math.abs(v) >= 10) return v.toFixed(0);
  return Number.isInteger(v) ? v.toFixed(0) : v.toFixed(2).replace(/0$/, "");
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-[140px] items-center justify-center rounded-lg border border-dashed border-white/10 px-4 text-center text-[11px] leading-4 text-white/45">
      {message}
    </div>
  );
}

function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[11px] text-white/70">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export const PredictedVsActualChart = memo(function PredictedVsActualChart({
  daily,
}: {
  daily: DailyPoint[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geom = useMemo(() => {
    if (daily.length === 0) return null;
    const yMax = niceMax(
      Math.max(1, ...daily.map((d) => Math.max(d.predictedTotal, d.actualTotal))),
    );
    const n = daily.length;
    const x = (i: number) =>
      n === 1 ? PAD.l + PLOT_W / 2 : PAD.l + (i / (n - 1)) * PLOT_W;
    const y = (v: number) => PAD.t + PLOT_H - (v / yMax) * PLOT_H;
    const line = (get: (d: DailyPoint) => number) =>
      daily.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(get(d)).toFixed(1)}`).join(" ");
    return {
      yMax,
      x,
      y,
      predictedPath: line((d) => d.predictedTotal),
      actualPath: line((d) => d.actualTotal),
      ticks: [0, yMax / 2, yMax],
    };
  }, [daily]);

  if (daily.length === 0) {
    return (
      <ChartEmpty message="No evaluated runs yet. This chart fills in once prediction windows close and evaluation runs." />
    );
  }

  const totalPredicted = daily.reduce((s, d) => s + d.predictedTotal, 0);
  const totalActual = daily.reduce((s, d) => s + d.actualTotal, 0);
  const ratio = totalActual > 0 ? totalPredicted / totalActual : null;
  const g = geom!;
  const active = hover != null ? daily[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Legend
          items={[
            { color: SERIES_PREDICTED, label: "Predicted" },
            { color: SERIES_ACTUAL, label: "Actual" },
          ]}
        />
        <button
          type="button"
          className="text-[10px] text-white/40 hover:text-white/65"
          onClick={() => setShowTable((p) => !p)}
        >
          {showTable ? "Hide data" : "Show data"}
        </button>
      </div>

      <div className="relative mt-2">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" role="img">
          {g.ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={VB_W - PAD.r} y1={g.y(t)} y2={g.y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.l - 8} y={g.y(t) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {fmtNum(t)}
              </text>
            </g>
          ))}

          {daily.length > 1 && (
            <>
              <path d={g.predictedPath} fill="none" stroke={SERIES_PREDICTED} strokeWidth={2} strokeLinejoin="round" />
              <path d={g.actualPath} fill="none" stroke={SERIES_ACTUAL} strokeWidth={2} strokeLinejoin="round" />
            </>
          )}

          {daily.map((d, i) => (
            <g key={d.dayMs}>
              <circle cx={g.x(i)} cy={g.y(d.predictedTotal)} r={4} fill={SERIES_PREDICTED} stroke="#121214" strokeWidth={2} />
              <circle cx={g.x(i)} cy={g.y(d.actualTotal)} r={4} fill={SERIES_ACTUAL} stroke="#121214" strokeWidth={2} />
            </g>
          ))}

          {hover != null && (
            <line
              x1={g.x(hover)}
              x2={g.x(hover)}
              y1={PAD.t}
              y2={PAD.t + PLOT_H}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
            />
          )}

          {daily.map((d, i) => {
            const isEdge = i === 0 || i === daily.length - 1;
            if (!isEdge && daily.length > 6) return null;
            return (
              <text key={d.dayMs} x={g.x(i)} y={VB_H - 10} textAnchor={i === 0 ? "start" : i === daily.length - 1 ? "end" : "middle"} fontSize={10} fill={AXIS_TEXT}>
                {fmtDay(d.dayMs)}
              </text>
            );
          })}

          {daily.map((d, i) => {
            const bandW = daily.length === 1 ? PLOT_W : PLOT_W / (daily.length - 1);
            return (
              <rect
                key={d.dayMs}
                x={g.x(i) - bandW / 2}
                y={PAD.t}
                width={bandW}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>

        {active && (
          <div
            className={
              "pointer-events-none absolute top-0 rounded-md border border-white/10 bg-black/90 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white/85 " +
              (hover! < daily.length / 2 ? "right-0" : "left-0")
            }
          >
            <div className="font-medium">{fmtDay(active.dayMs)}</div>
            <div className="mt-0.5 text-white/65">
              Predicted {active.predictedTotal.toFixed(1)} · Actual {active.actualTotal}
            </div>
            <div className="text-white/45">
              {active.runs} runs · {active.evaluatedPredictions} scored
            </div>
          </div>
        )}
      </div>

      {ratio != null && (
        <div className="mt-2 text-[11px] text-white/55">
          Across {daily.length} day{daily.length === 1 ? "" : "s"}: predicted{" "}
          <span className="text-white/85">{totalPredicted.toFixed(1)}</span> vs actual{" "}
          <span className="text-white/85">{totalActual}</span> —{" "}
          <span className="text-white/85">{ratio.toFixed(2)}×</span>
          {ratio > 1 ? " (over-predicting)" : ratio < 1 ? " (under-predicting)" : ""}
        </div>
      )}

      {showTable && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/50">
                <th className="pb-1.5 pr-3 font-medium">Day</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Predicted</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Actual</th>
                <th className="pb-1.5 pr-3 text-right font-medium">Runs</th>
                <th className="pb-1.5 text-right font-medium">Scored</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.dayMs} className="border-b border-white/5">
                  <td className="py-1.5 pr-3 text-white/80">{fmtDay(d.dayMs)}</td>
                  <td className="py-1.5 pr-3 text-right text-white/60">{d.predictedTotal.toFixed(1)}</td>
                  <td className="py-1.5 pr-3 text-right text-white/60">{d.actualTotal}</td>
                  <td className="py-1.5 pr-3 text-right text-white/60">{d.runs}</td>
                  <td className="py-1.5 text-right text-white/60">{d.evaluatedPredictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

export const CalibrationChart = memo(function CalibrationChart({
  bins,
}: {
  bins: CalibrationPoint[];
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (bins.length === 0) return null;
    const max = niceMax(
      Math.max(0.2, ...bins.map((b) => Math.max(b.avgPredicted, b.avgActual))),
    );
    const x = (v: number) => CAL_PAD.l + (v / max) * CAL_PLOT;
    const y = (v: number) => CAL_PAD.t + CAL_PLOT - (v / max) * CAL_PLOT;
    const maxN = Math.max(...bins.map((b) => b.n));
    return { max, x, y, maxN, ticks: [0, max / 2, max] };
  }, [bins]);

  if (bins.length === 0) {
    return (
      <ChartEmpty message="No evaluated predictions yet. Once runs are scored, each dot shows a group of predictions: on the dashed line means the predicted rate matched what actually happened." />
    );
  }

  const g = geom!;
  const active = hover != null ? bins[hover] : null;

  return (
    <div>
      <div className="text-[11px] text-white/55">
        Each dot is a group of predictions. On the dashed line = predicted rate matched reality.
        Above = under-predicted, below = over-predicted.
      </div>
      <div className="relative mt-2 mx-auto" style={{ maxWidth: CAL_W }}>
        <svg viewBox={`0 0 ${CAL_W} ${CAL_H}`} className="w-full" role="img">
          {g.ticks.map((t) => (
            <g key={t}>
              <line x1={CAL_PAD.l} x2={CAL_W - CAL_PAD.r} y1={g.y(t)} y2={g.y(t)} stroke={GRID} strokeWidth={1} />
              <text x={CAL_PAD.l - 8} y={g.y(t) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {fmtNum(t)}
              </text>
              <text
                x={g.x(t)}
                y={CAL_PAD.t + CAL_PLOT + 16}
                textAnchor={t === 0 ? "start" : t === g.max ? "end" : "middle"}
                fontSize={10}
                fill={AXIS_TEXT}
              >
                {fmtNum(t)}
              </text>
            </g>
          ))}

          <line
            x1={g.x(0)}
            y1={g.y(0)}
            x2={g.x(g.max)}
            y2={g.y(g.max)}
            stroke="rgba(255,255,255,0.3)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />

          {bins.map((b, i) => (
            <circle
              key={b.bin}
              cx={g.x(b.avgPredicted)}
              cy={g.y(b.avgActual)}
              r={5 + (b.n / g.maxN) * 5}
              fill={SERIES_PREDICTED}
              fillOpacity={hover == null || hover === i ? 0.85 : 0.35}
              stroke="#121214"
              strokeWidth={2}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}

          <text
            x={CAL_PAD.l + CAL_PLOT / 2}
            y={CAL_H - 8}
            textAnchor="middle"
            fontSize={10}
            fill={AXIS_TEXT}
          >
            predicted rate
          </text>
          <text
            x={12}
            y={CAL_PAD.t + CAL_PLOT / 2}
            textAnchor="middle"
            fontSize={10}
            fill={AXIS_TEXT}
            transform={`rotate(-90 12 ${CAL_PAD.t + CAL_PLOT / 2})`}
          >
            actual rate
          </text>
        </svg>

        {active && (
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-md border border-white/10 bg-black/90 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white/85">
            <div className="font-medium">
              predicted {active.avgPredicted.toFixed(3)} → actual {active.avgActual.toFixed(3)}
            </div>
            <div className="mt-0.5 text-white/45">
              {active.n} predictions · rate {active.minPredicted.toFixed(3)}–{active.maxPredicted.toFixed(3)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
