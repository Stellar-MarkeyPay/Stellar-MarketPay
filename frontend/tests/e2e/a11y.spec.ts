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
