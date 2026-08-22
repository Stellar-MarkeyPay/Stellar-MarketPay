import type { Page } from "@playwright/test";

export class JobsListPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/jobs");
  }

  heading() {
    return this.page.getByRole("heading", { name: "Browse Jobs" });
  }

  jobCard(title: string) {
    return this.page.getByRole("heading", { name: title }).first();
  }

  async openJob(title: string) {
    await this.jobCard(title).click();
  }
}
