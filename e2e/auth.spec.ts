import { test, expect } from "@playwright/test";

test.describe("Auth", () => {
  test("/login renders the sign-in UI", async ({ page }) => {
    await page.goto("/login", { timeout: 30_000 });

    // The NavBar renders an h1 with "Sign in"
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 10_000,
    });

    // When Supabase is configured, a "Continue with Google" button appears.
    // When not configured, a "Supabase not configured" message appears.
    // Either state is valid — assert at least one of them is present.
    const googleBtn = page.getByRole("button", { name: /continue with google/i });
    const notConfigured = page.getByText("Supabase not configured");

    const visible = await Promise.race([
      googleBtn.waitFor({ timeout: 8_000 }).then(() => "google"),
      notConfigured.waitFor({ timeout: 8_000 }).then(() => "unconfigured"),
    ]);

    expect(["google", "unconfigured"]).toContain(visible);
  });

  test("/profile while logged out redirects to /login", async ({ page }) => {
    // The ProfileClient calls sb.auth.getSession() and redirects to
    // /login?redirectTo=/profile if there is no session.
    // With no active session we expect to land on /login.
    await page.goto("/profile", { timeout: 30_000 });

    // Allow time for the client-side redirect to happen
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    expect(page.url()).toContain("/login");
  });
});
