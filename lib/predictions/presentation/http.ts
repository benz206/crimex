import { timingSafeEqual } from "node:crypto";
import { AppError } from "../application/errors";
import { getServiceRoleServerClient } from "@/lib/supabase";

export function httpErrorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    const status =
      e.code === "UNAUTHORIZED"
        ? 401
        : e.code === "NOT_FOUND"
          ? 404
          : e.code === "VALIDATION"
            ? 400
            : 500;
    return Response.json({ error: e.code, message: e.message }, { status });
  }
  const msg = e instanceof Error ? e.message : "Unknown error";
  return Response.json({ error: "INTERNAL", message: msg }, { status: 500 });
}

export function requireBearerToken(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new AppError("UNAUTHORIZED", "Missing bearer token");
  return m[1]!;
}

export function requireCronSecret(req: Request): void {
  const secret = process.env.PREDICTIONS_CRON_SECRET;
  if (!secret) throw new AppError("VALIDATION", "Cron secret not configured");
  const provided = requireBearerToken(req);
  const secretBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(provided);
  if (
    secretBuf.length !== providedBuf.length ||
    !timingSafeEqual(secretBuf, providedBuf)
  ) {
    throw new AppError("UNAUTHORIZED", "Invalid cron secret");
  }
}

export async function requireSupabaseUser(
  req: Request,
): Promise<{ userId: string; email: string | null }> {
  const token = requireBearerToken(req);
  const { data } = await getServiceRoleServerClient().auth.getUser(token);
  if (!data.user) throw new AppError("UNAUTHORIZED", "Invalid token");
  return { userId: data.user.id, email: data.user.email ?? null };
}
