import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const walletAddress = "GCFXWALLETTESTADDRESS1234567890EXAMPLEABCDEF";

const proposalText =
  "I am an experienced Stellar and Soroban engineer with several production marketplace integrations, escrow flows, and automated end-to-end test suites delivered for distributed teams. I can implement the requested contract work with careful validation, clear documentation, reliable communication, and a strong focus on security, maintainability, measurable delivery milestones, and accessible collaboration.";

const job = {
  id: "job-1",
  title: "Build a Soroban escrow contract for marketplace payouts",
  description: "Need a secure escrow contract and integration tests for release and refund paths.",
  budget: "500",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban", "Testing"],
  status: "open",
  clientAddress: "GCLIENTADDRESS1234567890EXAMPLEABCDEF",
  applicantCount: 1,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
  screeningQuestions: ["Describe your Soroban escrow experience."],
};

async function mockFreighter(page: Page) {
  await page.addInitScript((publicKey) => {
    (window as any).freighter = {
      isConnected: async () => ({ isConnected: true }),
      isAllowed: async () => ({ isAllowed: true }),
      requestAccess: async () => ({ error: null }),
      getPublicKey: async () => ({ publicKey }),
      signTransaction: async () => ({ signedTransaction: "signed-xdr" }),
    };
  }, walletAddress);
}

async function installApiMocks(page: Page) {
  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stellar: { usd: 0.12 } }),
    });
  });

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204 });
      return;
    }

    if (pathname.includes("/api/auth")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, transaction: "challenge-xdr", token: "jwt-token" }),
      });
      return;
    }

    if (pathname === "/api/jobs" || pathname === "/api/jobs/") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [job], jobs: [job], nextCursor: null }),
      });
      return;
    }

    if (pathname === "/api/jobs/recommended") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (pathname === "/api/jobs/job-1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: job }),
      });
      return;
    }

    if (pathname === "/api/applications" && request.method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { id: "app-1" } }),
      });
      return;
    }

    if (pathname.includes("/api/applications/job/job-1")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (pathname.includes("/api/profiles/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { publicKey: walletAddress, role: "both" } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
}

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockFreighter(page);
    await installApiMocks(page);
  });

  test("core pages and keyboard shortcuts modal have no axe violations", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("middlemen")).toBeVisible();
    await expectNoA11yViolations(page);

    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await expectNoA11yViolations(page);
    await page.keyboard.press("Escape");

    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Browse Jobs" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("job detail timeline and application confirmation flow have no axe violations", async ({ page }) => {
    await page.goto("/jobs/job-1");
    await expect(page.getByRole("heading", { name: job.title })).toBeVisible();
    await expectNoA11yViolations(page);

    await page.getByRole("button", { name: "Apply for this Job" }).click();
    await page.getByLabel("Cover Letter").fill(proposalText);
    await page.getByLabel("Your Bid (XLM)").fill("450");
    await page.getByLabel(/Describe your Soroban escrow experience/).fill("I have shipped Soroban escrow flows with release and refund coverage.");
    await page.getByRole("button", { name: "Submit Proposal" }).click();

    await expect(page.getByRole("dialog", { name: "Confirm Your Application" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go back" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Confirm & Submit" })).toBeFocused();
    await expectNoA11yViolations(page);
  });
});
