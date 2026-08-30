import type { Page } from "@playwright/test";

export class ApplicationFormDialog {
  constructor(private readonly page: Page) {}

  async fillProposal(coverLetter: string) {
    await this.page.getByLabel("Cover Letter").fill(coverLetter);
  }

  async fillBid(bidAmount: string) {
    await this.page.getByLabel("Your Bid (XLM)").fill(bidAmount);
  }

  submitButton() {
    return this.page.getByRole("button", { name: "Submit Proposal" });
  }

  async submit() {
    await this.submitButton().click();
  }

  confirmDialog() {
    return this.page.getByRole("dialog", { name: "Confirm Your Application" });
  }

  async confirm() {
    await this.page.getByRole("button", { name: "Confirm & Submit" }).click({ force: true });
  }

  async goBack() {
    await this.page.getByRole("button", { name: "Go back" }).click();
  }
}
