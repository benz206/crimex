import { test, expect } from "@playwright/test";

function collectErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

test.describe("Navigation", () => {
  // The full NavBar with aria-label="Primary" is on interior pages (Markets, Predictions, Login, Profile).
  // The home page uses HomeOverlayNav which only has a "Crime Map" link.

  test("home page has Crime Map nav link", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });
    // HomeOverlayNav renders a "Crime Map" link
    await expect(page.getByRole("link", { name: "Crime Map" })).toBeVisible({ timeout: 10_000 });
  });

  test("navigate to /markets from home via desktop panel link", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { timeout: 30_000 });

    // On desktop, the left panel has Markets and Predictions links
    await page.getByRole("link", { name: "Markets" }).first().click();

    await page.waitForURL("**/markets", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("navigate to /predictions from home via desktop panel link", async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { timeout: 30_000 });

    // The desktop left panel has a "Predictions" link
    await page.getByRole("link", { name: "Predictions" }).first().click();

    await page.waitForURL("**/predictions", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Predictions" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("navigate to /login via Sign in link on markets page", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/markets", { timeout: 30_000 });

    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("link", { name: "Sign in" }).click();

    await page.waitForURL("**/login", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("markets nav bar links work — navigate to predictions", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/markets", { timeout: 30_000 });

    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("link", { name: "Predictions" }).click();

    await page.waitForURL("**/predictions", { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Predictions" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("direct visit to /markets", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/markets", { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("direct visit to /predictions", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/predictions", { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Predictions" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("direct visit to /login", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/login", { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible({
      timeout: 10_000,
    });
    expect(errors.filter((e) => !e.includes("favicon"))).toHaveLength(0);
  });

  test("visiting /markets/this-id-does-not-exist does not crash", async ({ page }) => {
    const response = await page.goto("/markets/this-id-does-not-exist", {
      timeout: 30_000,
    });
    // Accept 200 (graceful state) or 404
    expect([200, 404]).toContain(response?.status());
    const body = await page.locator("body").textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });

  test("visiting /predictions/this-id-does-not-exist does not crash", async ({ page }) => {
    const response = await page.goto("/predictions/this-id-does-not-exist", {
      timeout: 30_000,
    });
    expect([200, 404]).toContain(response?.status());
    const body = await page.locator("body").textContent();
    expect(body?.trim().length).toBeGreaterThan(0);
  });
});
