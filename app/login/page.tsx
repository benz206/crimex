import { LoginClient } from "./ui";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { redirectTo?: string };
}) {
  const redirectTo =
    typeof searchParams?.redirectTo === "string"
      ? searchParams.redirectTo
      : undefined;
  return <LoginClient redirectTo={redirectTo} />;
}
