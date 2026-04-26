import type {
  PredictInput,
  PredictOutput,
  TrainInput,
  CalibrationInput,
  ModelState,
} from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";
import { groupHistorical, average } from "./utils";

// ── Snapshot types ────────────────────────────────────────────────────────────

type CategoryMap = Record<string, number>; // label → encoded int id

type TrainedSnapshot = {
  format: "lightgbm-treedump-v1";
  feature_names: string[];
  categorical: {
    incident_type: CategoryMap;
    city: CategoryMap;
  };
  trees: unknown[];
  init_score: number;
  objective: string;
  horizons: number[];
};

type TrainedModelState = {
  snapshot: TrainedSnapshot | null;
};

// ── LightGBM tree-walking ─────────────────────────────────────────────────────

function evaluateTree(node: unknown, features: number[]): number {
  if (typeof node !== "object" || node === null) return 0;

  const n = node as Record<string, unknown>;

  // Leaf node: no split_feature present (or it is null/undefined)
  if (n["split_feature"] === undefined || n["split_feature"] === null) {
    return typeof n["leaf_value"] === "number" ? n["leaf_value"] : 0;
  }

  const featureIdx = n["split_feature"] as number;
  const threshold = n["threshold"] as number | string;
  const decisionType = n["decision_type"] as string | undefined;
  const featureValue = features[featureIdx] ?? 0;

  let goLeft: boolean;
  if (decisionType === "==") {
    // Categorical split: LightGBM dump encodes the left-side category set as
    // "v1||v2||..." (or a single integer as a degenerate fallback). Go left
    // iff the feature value (rounded toward zero, since cats are int ids) is
    // in the set. Unknown categories fall through to the right child, which
    // matches LightGBM's default behavior at inference time.
    let inSet: boolean;
    if (typeof threshold === "string") {
      const target = Math.trunc(featureValue);
      inSet = false;
      for (const part of threshold.split("||")) {
        if (Number(part) === target) {
          inSet = true;
          break;
        }
      }
    } else {
      inSet = Math.trunc(featureValue) === Number(threshold);
    }
    goLeft = inSet;
  } else {
    // Default: "<="
    goLeft = featureValue <= (threshold as number);
  }

  const child = goLeft ? n["left_child"] : n["right_child"];
  return evaluateTree(child, features);
}

function evaluateForest(trees: unknown[], features: number[]): number {
  let sum = 0;
  for (const tree of trees) {
    if (typeof tree !== "object" || tree === null) continue;
    const t = tree as Record<string, unknown>;
    sum += evaluateTree(t["tree_structure"], features);
  }
  return sum;
}

// ── Cyclical encoding helpers ─────────────────────────────────────────────────
// Value ranges must match the notebook encoder: dow 0..6, hour 0..23, month 1..12.

function cyclicalSin(value: number, period: number): number {
  return Math.sin((2 * Math.PI * value) / period);
}

function cyclicalCos(value: number, period: number): number {
  return Math.cos((2 * Math.PI * value) / period);
}

// ── Feature builder ───────────────────────────────────────────────────────────

function buildFeatureVector(
  snapshot: TrainedSnapshot,
  incidentType: string,
  city: string,
  horizonHours: number,
  windowStartMs: number,
  counts: { c4w: number; c8w: number; c24h: number; c7d: number },
): number[] {
  // Local time at prediction window start (America/Toronto)
  const anchorDate = new Date(windowStartMs);
  // We can't load the zoneinfo library here — derive Toronto local time via
  // toLocaleString offset. Toronto is UTC-5 (EST) or UTC-4 (EDT). We use the
  // JS Intl API to extract the local-time parts.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    month: "numeric",
    hour12: false,
  }).formatToParts(anchorDate);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const hour = parseInt(get("hour"), 10) || 0;
  const month = anchorDate.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
    month: "numeric",
  });
  const monthNum = parseInt(month, 10) || 1;

  // Day-of-week: JS Date.getDay() is UTC; use locale weekday
  const weekdayStr = get("weekday"); // e.g. "Mon", "Tue" …
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const dow = weekdayMap[weekdayStr] ?? 0;

  // Cyclical time features
  const dow_sin = cyclicalSin(dow, 7);
  const dow_cos = cyclicalCos(dow, 7);
  const hour_sin = cyclicalSin(hour, 24);
  const hour_cos = cyclicalCos(hour, 24);
  const month_sin = cyclicalSin(monthNum, 12);
  const month_cos = cyclicalCos(monthNum, 12);

  // Historical count features (log1p)
  const log1p = (v: number) => Math.log1p(Math.max(0, v));
  const feat_4w = log1p(counts.c4w);
  const feat_8w = log1p(counts.c8w);
  const feat_24h = log1p(counts.c24h);
  const feat_7d = log1p(counts.c7d);
  const feat_horizon = log1p(horizonHours);

  // Categorical encoding: incident_type → type_id numeric, city → city_id numeric
  const typeId = snapshot.categorical.incident_type[incidentType] ?? -1;
  const cityId = snapshot.categorical.city[city] ?? -1;

  // Build numeric values for each feature_name in order
  const numericMap: Record<string, number> = {
    dow_sin,
    dow_cos,
    hour_sin,
    hour_cos,
    month_sin,
    month_cos,
    count_4w_same_dow_hour: feat_4w,
    count_8w_same_dow_hour: feat_8w,
    count_24h: feat_24h,
    count_7d: feat_7d,
    horizon_hours: feat_horizon,
    type_id: typeId,
    city_id: cityId,
  };

  return snapshot.feature_names.map((name) => numericMap[name] ?? 0);
}

// ── Derive historical count approximations from IncidentAggregate[] ───────────

type CountApprox = { c4w: number; c8w: number; c24h: number; c7d: number };

function deriveCountApproximations(
  historicalData: import("../../domain/types").IncidentAggregate[],
  incidentType: string,
  city: string,
): CountApprox {
  const matching = historicalData.filter(
    (agg) =>
      agg.incidentType === incidentType &&
      (agg.city ?? "") === city,
  );

  if (matching.length === 0) {
    return { c4w: 0, c8w: 0, c24h: 0, c7d: 0 };
  }

  // Sort by periodMs ascending so we can take "last N" weeks
  const sorted = [...matching].sort(
    (a, b) => (a.periodMs ?? 0) - (b.periodMs ?? 0),
  );
  const totalCount = sorted.reduce((s, a) => s + a.count, 0);

  // Approximate: use total over all available weeks for 8w window, half for 4w
  // This is a defensive approximation when bucketing details aren't available.
  const c8w = totalCount;
  const c4w = Math.round(totalCount / 2);
  // Use the most recent week as proxy for 7-day window; 24h ≈ 1/7 of that
  const lastWeekCount = sorted[sorted.length - 1]?.count ?? 0;
  const c7d = lastWeekCount;
  const c24h = Math.round(lastWeekCount / 7);

  return { c4w, c8w, c24h, c7d };
}

// ── TrainedModel class ────────────────────────────────────────────────────────

let _noSnapshotWarned = false;

export class TrainedModel implements PredictionModelPort {
  readonly id = "trained-v1";

  private state: TrainedModelState = { snapshot: null };

  getState(): ModelState {
    return { snapshot: this.state.snapshot } as ModelState;
  }

  setState(state: ModelState): void {
    const raw = state["snapshot"];
    if (raw === null || raw === undefined) {
      this.state = { snapshot: null };
      return;
    }
    if (typeof raw !== "object") {
      this.state = { snapshot: null };
      return;
    }
    const s = raw as Record<string, unknown>;
    if (s["format"] !== "lightgbm-treedump-v1") {
      this.state = { snapshot: null };
      return;
    }
    this.state = { snapshot: raw as TrainedSnapshot };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async train(_input: TrainInput): Promise<void> {
    // NO-OP: training happens offline in the Kaggle notebook.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  calibrate(_input: CalibrationInput): void {
    // NO-OP: calibration happens offline.
  }

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const { snapshot } = this.state;

    if (snapshot === null) {
      if (!_noSnapshotWarned) {
        console.warn(
          "trained-v1 model has no snapshot — run the Kaggle notebook and upload.",
        );
        _noSnapshotWarned = true;
      }
      return [];
    }

    const groups = groupHistorical(input.historicalData);
    const results: PredictOutput[] = [];

    for (const [key, g] of groups) {
      if (g.counts.length === 0) continue;

      const parts = key.split("||");
      const incidentType = parts[0] ?? "";
      const city = parts[1] ?? "";

      const counts = deriveCountApproximations(
        input.historicalData,
        incidentType,
        city,
      );

      const features = buildFeatureVector(
        snapshot,
        incidentType,
        city,
        input.horizonHours,
        input.windowStartMs,
        counts,
      );

      const rawScore =
        evaluateForest(snapshot.trees, features) + snapshot.init_score;

      // Poisson objective: link = exp(raw_score)
      const predictedCountFloat = Math.exp(rawScore);
      const predictedCount = Math.max(0, Math.round(predictedCountFloat));

      // Confidence heuristic mirroring confidenceFromCounts style
      const meanCount =
        g.counts.reduce((a, b) => a + b, 0) / g.counts.length;
      const confidence =
        1 / (1 + Math.abs(rawScore - Math.log(meanCount + 1e-6)));

      const lat = average(g.lats);
      const lng = average(g.lngs);

      if (predictedCount < 1) continue;

      results.push({
        incidentType,
        city: city || null,
        predictedCount,
        confidence: Math.min(1, Math.max(0, confidence)),
        lat,
        lng,
      });
    }

    return results;
  }
}
