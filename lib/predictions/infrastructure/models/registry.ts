import type { PredictionModelPort } from "../../application/ports";
import { RemoteTrainedModel } from "./remote";

type ModelFactory = () => PredictionModelPort;

const factories: [string, ModelFactory][] = [
  ["trained-v1", () => new RemoteTrainedModel()],
];

const factoryMap = new Map<string, ModelFactory>(factories);
const instanceCache = new Map<string, PredictionModelPort>();

export function getModel(id: string): PredictionModelPort | undefined {
  const cached = instanceCache.get(id);
  if (cached) return cached;
  const factory = factoryMap.get(id);
  if (!factory) return undefined;
  const instance = factory();
  instanceCache.set(id, instance);
  return instance;
}

export function listModels(): PredictionModelPort[] {
  return listModelIds().map((id) => getModel(id)!);
}

export function listModelIds(): string[] {
  return factories.map(([id]) => id);
}
