export type MarketSeed = {
  title: string;
  description: string;
  category: string;
  openTimeMs: number;
  closeTimeMs: number;
  threshold: number;
  baseline: number;
  city?: string;
  incidentType?: string;
};

export function buildMarketTitle(input: {
  threshold: number;
  city?: string;
  incidentType?: string;
}) {
  const typePart = input.incidentType?.trim() || "incident";
  const cityPart = input.city ? ` in ${input.city}` : "";
  return `Will ${input.threshold}+ ${typePart}${cityPart} occur in the next 24h?`;
}

export function buildMarketDescription(input: {
  baseline: number;
  threshold: number;
  city?: string;
  incidentType?: string;
}) {
  return `Baseline: ${input.baseline} incidents in the last 24h. Threshold: ${input.threshold}.${input.city ? ` City: ${input.city}.` : ""}${input.incidentType ? ` Type: ${input.incidentType}.` : ""}`;
}
