import { AuthCallbackClient } from "./ui";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams?: Promise<{ code?: string; redirectTo?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const code = typeof sp.code === "string" ? sp.code : null;
  const redirectTo =
    typeof sp.redirectTo === "string"
      ? sp.redirectTo
      : undefined;

  return <AuthCallbackClient code={code} redirectTo={redirectTo} />;
}
