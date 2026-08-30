import type { Page } from "@playwright/test";

export class PostJobPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/post-job");
  }

  async fillTitle(title: string) {
    await this.page.locator("input[name=title]").fill(title);
  }

  async fillDescription(description: string) {
    await this.page.locator("textarea[name=description]").fill(description);
  }

  async fillBudget(budget: string) {
    await this.page.locator("input[name=budget]").fill(budget);
  }

  async submit() {
    await this.page.getByRole("button", { name: /^Post Job$/i }).click();
  }

  postedHeading() {
    return this.page.getByText("Job Posted!");
  }

  /** Reads the posted job's UUID from the success view's "View Job" link. */
  async postedJobId(): Promise<string> {
    await this.postedHeading().waitFor();
    const href = await this.page.getByRole("link", { name: /View Job/ }).getAttribute("href");
    if (!href) throw new Error("Could not find the posted job's link on the success screen.");
    return href.replace("/jobs/", "");
  }
}
