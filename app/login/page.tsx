import { LoginClient } from "./ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ redirectTo?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const redirectTo =
    typeof sp.redirectTo === "string"
      ? sp.redirectTo
      : undefined;
  return <LoginClient redirectTo={redirectTo} />;
}
