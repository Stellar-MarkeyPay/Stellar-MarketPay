import type { Page } from "@playwright/test";

export class TimeTrackerWidget {
  constructor(private readonly page: Page) {}

  async openManualEntry() {
    await this.page.getByRole("button", { name: "+ Add manual entry" }).click();
  }

  async addManualEntry(durationMinutes: number, description: string) {
    await this.openManualEntry();
    await this.page.getByPlaceholder("e.g. 90").fill(String(durationMinutes));
    await this.page.getByPlaceholder("What did you work on?").fill(description);
    await this.page.getByRole("button", { name: "Save Entry" }).click();
  }

  totalTrackedText() {
    return this.page.getByText("Total tracked");
  }
}
