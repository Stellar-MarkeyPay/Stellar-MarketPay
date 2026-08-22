import type { Page } from "@playwright/test";

export class RatingFormWidget {
  constructor(private readonly page: Page) {}

  async selectStars(count: 1 | 2 | 3 | 4 | 5) {
    await this.page.getByRole("button", { name: `${count} star${count === 1 ? "" : "s"}` }).click();
  }

  async submit() {
    await this.page.getByRole("button", { name: "Submit Rating" }).click();
  }

  submittedText() {
    return this.page.getByText("Rating submitted");
  }
}
