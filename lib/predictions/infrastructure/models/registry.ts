import type { PredictionModelPort } from "../../application/ports";
import { BaselineModel } from "./baseline";

const models: PredictionModelPort[] = [new BaselineModel()];

const modelMap = new Map<string, PredictionModelPort>(
  models.map((m) => [m.id, m]),
);

export function getModel(id: string): PredictionModelPort | undefined {
  return modelMap.get(id);
}

export function listModels(): PredictionModelPort[] {
  return [...models];
}
