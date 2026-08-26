import { test, expect } from "./fixtures/test";

test.describe("Job Filters URL Sync", () => {
  test("Filters state is preserved in URL, restored on reload, and navigates via history", async ({ page }) => {
    // 1. Initial load
    await page.goto("/jobs");
    const searchInput = page.locator("[data-job-search]");
    
    // 2. Apply search filter
    await searchInput.fill("Soroban");
    // Wait for debounce and URL update (debounce is 300ms)
    await page.waitForTimeout(500);
    await searchInput.press("Enter");
    
    await page.waitForURL("**/jobs?search=Soroban*");
    
    // 3. Reload page and assert state is restored from URL
    await page.reload();
    await expect(searchInput).toHaveValue("Soroban");
    expect(page.url()).toContain("search=Soroban");
    
    // 4. Apply a second filter by navigating directly (simulating shared link)
    await page.goto("/jobs?search=Rust&timezone=UTC");
    await expect(searchInput).toHaveValue("Rust");
    
    // 5. Test history (Back button)
    await page.goBack();
    // It should go back to the Soroban search
    await expect(searchInput).toHaveValue("Soroban");
    expect(page.url()).toContain("search=Soroban");
    
    // 6. Test history (Forward button)
    await page.goForward();
    await expect(searchInput).toHaveValue("Rust");
    expect(page.url()).toContain("search=Rust");
  });
});
