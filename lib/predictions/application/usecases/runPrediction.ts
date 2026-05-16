import type { IncidentDataPort, PredictionModelPort, PredictionRepo } from "../ports";
import { ValidationError } from "../errors";
import type { TriggerType } from "../../domain/types";

const PREDICTION_LOG_ENABLED = process.env.PREDICTION_DEBUG === "1";

function makeLogger(runShortId: string) {
  const t0 = Date.now();
  let lastTick = t0;
  const fmt = (ms: number) =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
  return {
    phase(name: string, extra?: Record<string, unknown>) {
      if (!PREDICTION_LOG_ENABLED) return;
      const now = Date.now();
      const sinceStart = fmt(now - t0);
      const sinceLast = fmt(now - lastTick);
      lastTick = now;
      const tag = `[run ${runShortId}] [+${sinceStart} Δ${sinceLast}]`;
      if (extra) console.log(`${tag} ▶ ${name}`, extra);
      else console.log(`${tag} ▶ ${name}`);
    },
    info(msg: string, extra?: Record<string, unknown>) {
      if (!PREDICTION_LOG_ENABLED) return;
      const tag = `[run ${runShortId}]   `;
      if (extra) console.log(`${tag}${msg}`, extra);
      else console.log(`${tag}${msg}`);
    },
    warn(msg: string, extra?: unknown) {
      if (!PREDICTION_LOG_ENABLED) return;
      const tag = `[run ${runShortId}]   `;
      if (extra !== undefined) console.warn(`${tag}${msg}`, extra);
      else console.warn(`${tag}${msg}`);
    },
    done(name: string, extra?: Record<string, unknown>) {
      if (!PREDICTION_LOG_ENABLED) return;
      const total = fmt(Date.now() - t0);
      const tag = `[run ${runShortId}] [total ${total}]`;
      if (extra) console.log(`${tag} ✓ ${name}`, extra);
      else console.log(`${tag} ✓ ${name}`);
    },
    fail(name: string, err: unknown) {
      const total = fmt(Date.now() - t0);
      const tag = `[run ${runShortId}] [total ${total}]`;
      console.error(`${tag} ✗ ${name}`, err);
    },
  };
}

export async function runPrediction(
  deps: {
    predictionRepo: PredictionRepo;
    incidentData: IncidentDataPort;
    model: PredictionModelPort;
  },
  input: {
    horizonHours: number;
    triggeredBy: TriggerType;
    createdBy: string | null;
    excludeRoadsideTests?: boolean;
    historicalWeeksBack?: number;
    punishmentFactor?: number;
    skipCalibration?: boolean;
  },
) {
  if (input.horizonHours < 1 || input.horizonHours > 24) {
    throw new ValidationError("horizonHours must be between 1 and 24");
  }
  if (
    input.punishmentFactor != null &&
    (!Number.isFinite(input.punishmentFactor) ||
      input.punishmentFactor < 0 ||
      input.punishmentFactor > 1)
  ) {
    throw new ValidationError("punishmentFactor must be between 0 and 1");
  }

  const now = Date.now();
  const windowStartMs = now;
  const windowEndMs = now + input.horizonHours * 60 * 60 * 1000;

  // Bootstrap log without runShortId yet
  if (PREDICTION_LOG_ENABLED) console.log(
    `[runPrediction] starting model=${deps.model.id} horizon=${input.horizonHours}h trigger=${input.triggeredBy}`,
  );

  const run = await deps.predictionRepo.createRun({
    modelId: deps.model.id,
    horizonHours: input.horizonHours,
    windowStartMs,
    windowEndMs,
    triggeredBy: input.triggeredBy,
    createdBy: input.createdBy,
  });

  const log = makeLogger(run.shortId);
  log.phase("run row created", { id: run.id, shortId: run.shortId });

  try {
    await deps.predictionRepo.updateRunStatus(run.id, "running");
    log.phase("status → running");

    const isStateful =
      typeof deps.model.setState === "function" ||
      typeof deps.model.getState === "function";

    let lockAcquired = false;
    if (isStateful) {
      log.phase("acquiring model lock");
      lockAcquired = await deps.predictionRepo.tryAcquireModelLock(
        deps.model.id,
        input.horizonHours,
      );
      log.info(`lock acquired: ${lockAcquired}`);
      if (!lockAcquired) {
        log.warn("could not acquire model lock — skipping train/save");
      }
    } else {
      log.info("model is stateless (remote inference) — skipping lock/snapshot");
    }

    const windowStart = new Date(windowStartMs);
    const weeksBack = input.historicalWeeksBack ?? 8;
    log.phase("fetching historical data", {
      hourOfDay: windowStart.getUTCHours(),
      dayOfWeek: windowStart.getUTCDay(),
      weeksBack,
    });
    const historicalData = await deps.incidentData.fetchHistorical({
      hourOfDay: windowStart.getUTCHours(),
      dayOfWeek: windowStart.getUTCDay(),
      weeksBack,
      excludeRoadsideTests: input.excludeRoadsideTests ?? true,
    });
    log.info(`historical rows fetched: ${historicalData.length}`);

    if (isStateful) {
      try {
        log.phase("loading snapshot");
        const existingState = await deps.predictionRepo.getModelStateSnapshot(
          deps.model.id,
          input.horizonHours,
        );
        if (existingState?.state && deps.model.setState) {
          deps.model.setState(existingState.state);
          log.info(`snapshot loaded (updated ${new Date(existingState.updatedAtMs).toISOString()})`);
        } else {
          log.warn(`no snapshot found for ${deps.model.id} h=${input.horizonHours} — predict will return []`);
        }

        if (!input.skipCalibration) {
          try {
            log.phase("fetching calibration data");
            const calibration = await deps.predictionRepo.getModelCalibrationData(deps.model.id);
            if (calibration.runCount >= 2) {
              log.info("applying calibration", {
                runCount: calibration.runCount,
                avgScore: calibration.avgScore,
                avgBias: calibration.avgBias,
                trend: calibration.recentTrend,
              });
              deps.model.calibrate?.({ calibration, historicalData });
            } else {
              log.info(`calibration skipped (only ${calibration.runCount} prior run(s))`);
            }
          } catch (calError) {
            log.warn("calibration failed, proceeding without", calError);
          }
        }

        if (lockAcquired && deps.model.train) {
          log.phase("training model");
          await deps.model.train({
            horizonHours: input.horizonHours,
            windowStartMs,
            windowEndMs,
            historicalData,
          });
          log.info("training done (no-op for trained-v1)");
        }

        if (lockAcquired && deps.model.getState) {
          log.phase("saving model snapshot");
          await deps.predictionRepo.saveModelStateSnapshot({
            modelId: deps.model.id,
            horizonHours: input.horizonHours,
            state: deps.model.getState(),
            source: input.triggeredBy,
            runId: run.id,
          });
          log.info("snapshot saved");
        }
      } finally {
        if (lockAcquired) {
          await deps.predictionRepo.releaseModelLock(deps.model.id, input.horizonHours);
          log.info("lock released");
        }
      }
    }

    log.phase("running model.predict()");
    const rawOutputs = await deps.model.predict({
      horizonHours: input.horizonHours,
      windowStartMs,
      windowEndMs,
      historicalData,
    });
    log.info(`model produced ${rawOutputs.length} raw output(s)`);

    const punishment = input.punishmentFactor ?? 0;
    const outputs = rawOutputs
      .map((o) => {
        const confidence = o.confidence ?? 0.5;
        const penaltyMultiplier = Math.max(0, 1 - punishment * (1 - confidence));
        const penalizedCount = Math.round(o.predictedCount * penaltyMultiplier);
        return {
          ...o,
          predictedCount: penalizedCount,
          confidence: Math.max(0, Math.min(1, confidence * (1 - punishment * 0.5))),
        };
      })
      .filter((o) => o.predictedCount > 0);
    log.info(`after punishment(${punishment}) filter: ${outputs.length} prediction(s)`);

    log.phase("inserting predictions");
    await deps.predictionRepo.insertPredictions(
      run.id,
      outputs.map((o) => ({
        runId: run.id,
        incidentType: o.incidentType,
        city: o.city,
        predictedCount: o.predictedCount,
        confidence: o.confidence,
        lat: o.lat,
        lng: o.lng,
      })),
    );

    await deps.predictionRepo.updateRunStatus(run.id, "completed");
    log.done("run completed", {
      predictionsWritten: outputs.length,
      historicalRows: historicalData.length,
    });
    return await deps.predictionRepo.getRun(run.id);
  } catch (e) {
    log.fail("run failed", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    await deps.predictionRepo.updateRunStatus(run.id, "failed", msg);
    throw e;
  }
}
