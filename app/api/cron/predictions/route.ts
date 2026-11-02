import { GET as predictionsCronGET } from "@/app/api/predictions/cron/route";
import { GET as predictionsEvaluateGET } from "@/app/api/predictions/evaluate/route";
import { httpErrorResponse, requireCronSecret } from "@/lib/predictions/presentation/http";

type StepResult = { status: number; body: unknown };

async function callStep(
  handler: (req: Request) => Promise<Response>,
  path: string,
  auth: string,
): Promise<StepResult> {
  const childReq = new Request(`http://internal${path}`, {
    method: "GET",
    headers: { authorization: auth },
  });
  const res = await handler(childReq);
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    body = await res.text().catch(() => null);
  }
  return { status: res.status, body };
}

async function handlePredictionsCron(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);
    const auth = req.headers.get("authorization") ?? "";

    const cron = await callStep(predictionsCronGET, "/api/predictions/cron?dailyTarget=100", auth);
    const evaluate = await callStep(predictionsEvaluateGET, "/api/predictions/evaluate", auth);

    return Response.json({ ok: true, steps: { cron, evaluate } });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handlePredictionsCron(req);
}

export async function POST(req: Request) {
  return handlePredictionsCron(req);
}
