import type { PredictionModelPort } from "../../application/ports";
import { BaselineModel } from "./baseline";
import { MovingAverageModel } from "./movingAverage";
import { TrendModel } from "./trend";
import { PoissonModel } from "./poisson";

const models: PredictionModelPort[] = [
  new BaselineModel(),
  new MovingAverageModel(),
  new TrendModel(),
  new PoissonModel(),
];

const modelMap = new Map<string, PredictionModelPort>(
  models.map((m) => [m.id, m]),
);

export function getModel(id: string): PredictionModelPort | undefined {
  return modelMap.get(id);
}

export function listModels(): PredictionModelPort[] {
  return [...models];
}
