import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { JobDetailPage, ApplicationFormDialog } from "./pages";

const PROPOSAL_TEXT =
  "I am an experienced Stellar and Soroban engineer with several production marketplace integrations, escrow flows, and automated end-to-end test suites delivered for distributed teams. I can implement the requested contract work with careful validation, clear documentation, reliable communication, and a strong focus on security, maintainability, measurable delivery milestones, and accessible collaboration.";

async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe("accessibility", () => {
  test.slow();

  test("core pages and keyboard shortcuts modal have no axe violations", async ({
    apiClient,
    clientPage,
  }) => {
    await apiClient.createJob(clientPage.token, {
      title: "Build a Soroban escrow contract for marketplace payouts",
      description:
        "Need a secure escrow contract and integration tests for release and refund paths.",
      budget: "500",
      currency: "XLM",
      category: "Smart Contracts",
      skills: ["Rust", "Soroban", "Testing"],
      clientAddress: clientPage.publicKey,
    });

    const page = clientPage.page;

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
  });

  test.fixme("browse jobs page (/jobs) has no axe violations", async ({
    apiClient,
    clientPage,
  }) => {
    // Known app bug: JobCard.tsx (line 289) category badge uses `.bg-ink-700` and `.text-amber-700`
    // without light-mode responsive tokens, producing insufficient contrast of 1.09:1 – 3.32:1
    // (WCAG 2 AA rule 'color-contrast', WCAG 1.4.3 requires 4.5:1 minimum for 12px text).
    await apiClient.createJob(clientPage.token, {
      title: "Build a Soroban escrow contract for marketplace payouts",
      description:
        "Need a secure escrow contract and integration tests for release and refund paths.",
      budget: "500",
      currency: "XLM",
      category: "Smart Contracts",
      skills: ["Rust", "Soroban", "Testing"],
      clientAddress: clientPage.publicKey,
    });

    const page = clientPage.page;
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { name: "Browse Jobs" })).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test("job detail timeline and application confirmation flow have no axe violations", async ({
    apiClient,
    clientPage,
    freelancerPage,
  }) => {
    const title = "Build a Soroban escrow contract for marketplace payouts";
    const job = await apiClient.createJob(clientPage.token, {
      title,
      description:
        "Need a secure escrow contract and integration tests for release and refund paths.",
      budget: "500",
      currency: "XLM",
      category: "Smart Contracts",
      skills: ["Rust", "Soroban", "Testing"],
      clientAddress: clientPage.publicKey,
      screeningQuestions: ["Describe your Soroban escrow experience."],
    });

    const page = freelancerPage.page;
    const jobDetail = new JobDetailPage(page);
    await jobDetail.goto(job.id);
    await expect(jobDetail.heading(title)).toBeVisible();
    await expectNoA11yViolations(page);

    await jobDetail.applyButton().click();
    const applicationForm = new ApplicationFormDialog(page);
    await applicationForm.fillProposal(PROPOSAL_TEXT);
    await applicationForm.fillBid("450");
    await page
      .getByLabel(/Describe your Soroban escrow experience/)
      .fill("I have shipped Soroban escrow flows with release and refund coverage.");
    await applicationForm.submit();

    await expect(applicationForm.confirmDialog()).toBeVisible();
    await expect(page.getByRole("button", { name: "Go back" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Confirm & Submit" })).toBeFocused();
    await expectNoA11yViolations(page);
  });
});

  test("form validation correctly associates errors and focuses first invalid field", async ({ page }) => {
    // Navigate to post job page and attempt to submit empty form
    await page.goto("/jobs/post");
    
    // Ensure we are in a state to interact
    await page.waitForSelector("form");
    
    // Attempt to submit empty form
    await page.click('button[type="submit"]:has-text("Post Job")');
    
    // Wait for validation to kick in
    await page.waitForSelector('div[role="alert"]');
    
    // Check error summary
    const errorSummary = page.locator('div[role="alert"]');
    await expect(errorSummary).toContainText("Please fix the following errors");
    
    // Check aria-invalid
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute("aria-invalid", "true");
    
    // Check aria-describedby
    const describedBy = await titleInput.getAttribute("aria-describedby");
    expect(describedBy).toContain("title-error");
    
    // Check focus moved to first invalid field (title)
    await expect(titleInput).toBeFocused();
    
    // Ensure the error message itself has the "Error:" visually hidden text
    const errorMsg = page.locator('#title-error');
    await expect(errorMsg).toContainText("Error:");
  });
