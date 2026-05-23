import { AppError } from "../application/errors";

export function assertAdmin(email: string | null | undefined): void {
  const allowList = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!email || !allowList.includes(email.toLowerCase())) {
    throw new AppError("UNAUTHORIZED", "Admin access required");
  }
}
