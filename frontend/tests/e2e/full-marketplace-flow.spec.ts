import { test, expect } from "./fixtures/test";
import {
  PostJobPage,
  JobDetailPage,
  ApplicationFormDialog,
  TimeTrackerWidget,
  RatingFormWidget,
} from "./pages";

const PROPOSAL_TEXT =
  "I am an experienced Stellar and Soroban engineer with many completed marketplace integrations, escrow flows, and Playwright test suites delivered for production teams. I have deep expertise in building decentralized applications on the Stellar network and writing comprehensive end-to-end tests that ensure high reliability and security for smart contract systems. My background includes building full-stack dApps using Next.js, TypeScript, and Rust for Soroban contracts. I am very interested in this project and confident that I can deliver high-quality results within the specified timeline and budget. I look forward to discussing the technical details with your team and starting our collaboration soon to bring this marketplace vision to life with robust escrow logic.";

test.describe("full marketplace flow", () => {
  test.slow();

  test("should complete the full hire-to-pay lifecycle", async ({ clientPage, freelancerPage }) => {
    // ── Client posts a job through the real UI ──────────────────────────────
    const postJob = new PostJobPage(clientPage.page);
    await postJob.goto();
    await postJob.fillTitle("Build marketplace escrow integration tests");
    await postJob.fillDescription(
      "Need an end to end Playwright flow covering posting, escrow funding, applications, progress updates, release, and ratings."
    );
    await postJob.fillBudget("50");
    await postJob.submit();
    await expect(postJob.postedHeading()).toBeVisible({ timeout: 20000 });
    const jobId = await postJob.postedJobId();

    // ── Freelancer applies ───────────────────────────────────────────────────
    const jobDetailAsFreelancer = new JobDetailPage(freelancerPage.page);
    await jobDetailAsFreelancer.goto(jobId);
    await jobDetailAsFreelancer.applyButton().click();

    const applicationForm = new ApplicationFormDialog(freelancerPage.page);
    await applicationForm.fillProposal(PROPOSAL_TEXT);
    await applicationForm.submit();
    await applicationForm.confirm();
    await expect(jobDetailAsFreelancer.applicationSubmittedText()).toBeVisible();

    // ── Client accepts the proposal ─────────────────────────────────────────
    const jobDetailAsClient = new JobDetailPage(clientPage.page);
    await jobDetailAsClient.goto(jobId);
    await jobDetailAsClient.acceptProposal();
    await expect(jobDetailAsClient.inProgressBadge()).toBeVisible();

    // ── Freelancer logs time ─────────────────────────────────────────────────
    await jobDetailAsFreelancer.goto(jobId);
    const timeTracker = new TimeTrackerWidget(freelancerPage.page);
    await timeTracker.addManualEntry(120, "Implemented escrow release flow and ratings UI.");
    await expect(timeTracker.totalTrackedText()).toBeVisible();

    // ── Client releases escrow ───────────────────────────────────────────────
    await jobDetailAsClient.goto(jobId);
    await jobDetailAsClient.releaseEscrow();
    await expect(jobDetailAsClient.ratingPrompt()).toBeVisible();

    const clientRating = new RatingFormWidget(clientPage.page);
    await clientRating.selectStars(5);
    await clientRating.submit();
    await expect(clientRating.submittedText()).toBeVisible();

    // ── Freelancer rates the client back ─────────────────────────────────────
    await jobDetailAsFreelancer.goto(jobId);
    const freelancerRating = new RatingFormWidget(freelancerPage.page);
    await freelancerRating.selectStars(5);
    await freelancerRating.submit();
    await expect(freelancerRating.submittedText()).toBeVisible();
  });
});
