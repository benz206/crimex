import { GET as ingestGET } from "@/app/api/incidents/ingest/route";
import { GET as generateSeedsGET } from "@/app/api/markets/auto/generate-seeds/route";
import { GET as seedGET } from "@/app/api/markets/auto/seed/route";
import { GET as resolveAdminGET } from "@/app/api/markets/auto/resolve-admin/route";
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

async function handleDailyCron(req: Request): Promise<Response> {
  try {
    requireCronSecret(req);
    const auth = req.headers.get("authorization") ?? "";

    const ingest = await callStep(ingestGET, "/api/incidents/ingest?lookbackDays=2", auth);
    const generateSeeds = await callStep(generateSeedsGET, "/api/markets/auto/generate-seeds", auth);
    const seed = await callStep(seedGET, "/api/markets/auto/seed", auth);
    const resolve = await callStep(resolveAdminGET, "/api/markets/auto/resolve-admin", auth);

    return Response.json({ ok: true, steps: { ingest, generateSeeds, seed, resolve } });
  } catch (e) {
    return httpErrorResponse(e);
  }
}

export async function GET(req: Request) {
  return handleDailyCron(req);
}

export async function POST(req: Request) {
  return handleDailyCron(req);
}
