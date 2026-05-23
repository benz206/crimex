import type { PredictInput, PredictOutput } from "../../domain/types";
import type { PredictionModelPort } from "../../application/ports";

export class RemoteTrainedModel implements PredictionModelPort {
  readonly id = "trained-v1";
  readonly trainable = false;

  async predict(input: PredictInput): Promise<PredictOutput[]> {
    const baseUrl = process.env.PREDICT_SERVICE_URL;
    const apiKey = process.env.PREDICT_SERVICE_API_KEY;

    if (!baseUrl) {
      console.warn("PREDICT_SERVICE_URL not set — RemoteTrainedModel returning []");
      return [];
    }

    const url = `${baseUrl.replace(/\/$/, "")}/predict`;
    console.log(
      `[RemoteTrainedModel] → POST ${url} h=${input.horizonHours}h rows=${input.historicalData.length}`,
    );
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify({
        horizonHours: input.horizonHours,
        windowStartMs: input.windowStartMs,
        windowEndMs: input.windowEndMs,
        historicalData: input.historicalData,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `predict service ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as { predictions?: PredictOutput[]; ms?: number };
    const predictions = data.predictions ?? [];
    console.log(
      `[RemoteTrainedModel] ← ${predictions.length} prediction(s) (service=${data.ms ?? "?"}ms)`,
    );
    return predictions;
  }
}
