import type { PredictionModelPort } from "../../application/ports";
import { BaselineModel } from "./baseline";
import { MovingAverageModel } from "./movingAverage";
import { TrendModel } from "./trend";
import { PoissonModel } from "./poisson";
import { EnsembleModel } from "./ensemble";

type ModelFactory = () => PredictionModelPort;

function createSubModels(): PredictionModelPort[] {
  return [
    new BaselineModel(),
    new MovingAverageModel(),
    new TrendModel(),
    new PoissonModel(),
  ];
}

const factories: [string, ModelFactory][] = [
  ["baseline-v1", () => new BaselineModel()],
  ["moving-average-v1", () => new MovingAverageModel()],
  ["trend-v1", () => new TrendModel()],
  ["poisson-v1", () => new PoissonModel()],
  ["ensemble-v1", () => new EnsembleModel(createSubModels())],
];

const factoryMap = new Map<string, ModelFactory>(factories);

export function getModel(id: string): PredictionModelPort | undefined {
  const factory = factoryMap.get(id);
  return factory?.();
}

export function listModels(): PredictionModelPort[] {
  return factories.map(([, f]) => f());
}

export function listModelIds(): string[] {
  return factories.map(([id]) => id);
}
