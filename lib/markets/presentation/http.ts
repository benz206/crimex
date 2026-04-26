import { AppError } from "../application/errors";

export function httpErrorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    const status =
      e.code === "UNAUTHORIZED"
        ? 401
        : e.code === "NOT_FOUND"
          ? 404
          : e.code === "VALIDATION"
            ? 400
            : e.code === "MARKET_CLOSED"
              ? 409
              : e.code === "INSUFFICIENT_FUNDS"
                ? 409
                : e.code === "BONUS_COOLDOWN"
                  ? 409
                  : e.code === "MARKET_ALREADY_RESOLVED"
                    ? 409
                    : e.code === "INVALID_MARKET_TYPE"
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
  return m[1];
}
