import { test, expect } from "@playwright/test";

// The Filters panel is desktop-only (md:block). Use a desktop viewport for all home tests.
test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Home page — crime map", () => {
  test("loads without uncaught errors or console errors", async ({ page }) => {
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      errors.push(`pageerror: ${err.message}`);
    });

    await page.goto("/", { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    expect(errors).toHaveLength(0);
  });

  test("map canvas is visible", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });
    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
  });

  test("filters panel is present", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });
    // The Filters component renders a "Time Range" label (desktop panel is md:block)
    await expect(page.getByText("Time Range")).toBeVisible({ timeout: 10_000 });
    // The Heatmap button
    await expect(page.getByRole("button", { name: "Heatmap" })).toBeVisible({ timeout: 10_000 });
    // The search input
    await expect(page.getByPlaceholder("Search Halton address/place")).toBeVisible({ timeout: 10_000 });
  });

  test("selecting a different time-range preset triggers a network request", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });
    await page.getByText("Time Range").waitFor({ timeout: 10_000 });

    // The CustomSelect button for Time Range is the second button[aria-haspopup="listbox"]
    // on the page (after Basemap). Use the label wrapper to locate it precisely.
    // The structure is: <label><span class="ui-label">Time Range</span><div><button aria-haspopup="listbox">...</div></label>
    const timeRangeLabel = page.locator("label").filter({ has: page.locator(".ui-label", { hasText: "Time Range" }) });
    // The CustomSelect inside renders a button with aria-haspopup="listbox"
    const selectBtn = timeRangeLabel.locator("button[aria-haspopup='listbox']");
    await selectBtn.waitFor({ timeout: 10_000 });
    await selectBtn.click();

    // Set up request intercept AFTER opening the menu so we catch the actual request
    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes("arcgis") ||
        req.url().includes("/api/incidents") ||
        req.url().includes("FeatureServer"),
      { timeout: 20_000 },
    );

    // Click a different preset — pick "7 days" option (role="option" in the listbox)
    await page.getByRole("option", { name: "7 days" }).click();

    const req = await requestPromise;
    expect(req).toBeTruthy();
  });

  test("heatmap button opens settings panel", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });

    const heatmapBtn = page.getByRole("button", { name: "Heatmap" });
    await heatmapBtn.waitFor({ timeout: 10_000 });

    // Clicking opens the HeatmapSettingsPanel modal
    await heatmapBtn.click();

    // The panel has "Heatmap Settings" heading
    await expect(page.getByText("Heatmap Settings")).toBeVisible({ timeout: 5_000 });

    // It has an Enabled/Disabled toggle button
    const enabledBtn = page.getByRole("button", { name: /enabled|disabled/i });
    await expect(enabledBtn).toBeVisible();

    // Enable heatmap
    const initialText = await enabledBtn.textContent();
    await enabledBtn.click();
    const newText = await enabledBtn.textContent();
    expect(newText).not.toBe(initialText);
  });

  test("sidebar shows incident tab and count", async ({ page }) => {
    await page.goto("/", { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // The right panel has tab buttons "Incidents" and "Predictions"
    // Use role="button" and exact text to avoid strict-mode violations
    const incidentsTab = page.getByRole("button", { name: "Incidents", exact: true });
    await expect(incidentsTab).toBeVisible({ timeout: 15_000 });

    // There is also a mobile button that shows "Incidents (N)" — check that count badge
    // on mobile. On desktop, the Sidebar shows the big "Incidents" heading inside.
    // The Sidebar header div with text "Incidents" (exact, inside the sidebar panel)
    const sidebarHeading = page.locator("div.text-\\[25px\\]").filter({ hasText: "Incidents" });
    await expect(sidebarHeading).toBeVisible({ timeout: 15_000 });
  });
});
