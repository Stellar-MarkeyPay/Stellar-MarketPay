import type { Page } from "@playwright/test";

export class JobDetailPage {
  constructor(private readonly page: Page) {}

  async goto(jobId: string) {
    await this.page.goto(`/jobs/${jobId}`);
  }

  heading(title: string) {
    return this.page.getByRole("heading", { name: title });
  }

  applyButton() {
    return this.page.getByRole("button", { name: "Apply for this Job" });
  }

  applicationSubmittedText() {
    return this.page.getByText("Application submitted");
  }

  async acceptProposal() {
    await this.page.getByRole("button", { name: "Accept Proposal" }).click();
  }

  inProgressBadge() {
    return this.page.getByText("In Progress");
  }

  async releaseEscrow() {
    await this.page.getByRole("button", { name: "Release Escrow" }).click();
  }

  ratingPrompt() {
    return this.page.getByText("Rate your experience working together");
  }
}
