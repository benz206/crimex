import { test, expect } from "@playwright/test";

const MOBILE = { width: 375, height: 812 };

test.describe("Responsive — 375×812 viewport", () => {
  test("/ — no horizontal scrollbar and map canvas visible", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/", { timeout: 30_000 });

    // Map canvas must be visible at mobile size
    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });

    // No horizontal scrollbar: scrollWidth should not exceed clientWidth
    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHScroll).toBe(false);
  });

  test("/markets — no horizontal scrollbar", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/markets", { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Markets" })).toBeVisible({
      timeout: 10_000,
    });

    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHScroll).toBe(false);
  });

  test("/predictions — no horizontal scrollbar", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/predictions", { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: "Predictions" })).toBeVisible({
      timeout: 10_000,
    });

    const hasHScroll = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHScroll).toBe(false);
  });
});
