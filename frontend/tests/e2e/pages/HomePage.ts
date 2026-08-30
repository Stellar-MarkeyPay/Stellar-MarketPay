import type { Page } from "@playwright/test";

export class HomePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  heroHeading() {
    return this.page.getByRole("heading", { name: /Freelance without/i });
  }
}
