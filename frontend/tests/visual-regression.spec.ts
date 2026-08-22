import { test, expect } from "@playwright/test";

test.describe("Visual Regression Tests", () => {
  test("home page visual layout matches baseline in dark mode", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("homepage-dark.png", {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: "disabled",
    });
  });

  test("job listings visual layout matches baseline in mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/jobs");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("jobs-mobile.png", {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: "disabled",
    });
  });

  test("post job form layout matches baseline", async ({ page }) => {
    await page.goto("/post-job");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("post-job-dark.png", {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: "disabled",
    });
  });
});
