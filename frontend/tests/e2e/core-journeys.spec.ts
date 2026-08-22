import { test, expect } from "./fixtures/test";
import { HomePage, JobsListPage, JobDetailPage, ApplicationFormDialog } from "./pages";

function uniqueJobInput(suffix: string) {
  return {
    title: `Build a Soroban escrow contract ${suffix}`,
    description:
      "Need a secure escrow contract and integration tests for release and refund paths, written for a marketplace payouts flow.",
    budget: "500",
    currency: "XLM" as const,
    category: "Smart Contracts",
    skills: ["Rust", "Soroban", "Testing"],
  };
}

test("home page loads and shows hero content and stats", async ({ page }) => {
  await page.goto("/");
  const home = new HomePage(page);
  await expect(home.heroHeading()).toBeVisible();
});

test("jobs page loads with job cards", async ({ page, apiClient, clientPage }) => {
  const jobInput = uniqueJobInput(Date.now().toString());
  await apiClient.createJob(clientPage.token, {
    ...jobInput,
    clientAddress: clientPage.publicKey,
  });

  const jobsList = new JobsListPage(page);
  await jobsList.goto();
  await expect(jobsList.heading()).toBeVisible();
  await expect(jobsList.jobCard(jobInput.title)).toBeVisible();
});

test("clicking a job card navigates to the job detail page", async ({ page, apiClient, clientPage }) => {
  const jobInput = uniqueJobInput(Date.now().toString());
  const job = await apiClient.createJob(clientPage.token, {
    ...jobInput,
    clientAddress: clientPage.publicKey,
  });

  const jobsList = new JobsListPage(page);
  await jobsList.goto();
  await jobsList.openJob(jobInput.title);

  await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}$`));
  const jobDetail = new JobDetailPage(page);
  await expect(jobDetail.heading(jobInput.title)).toBeVisible();
  await expect(jobDetail.applyButton()).toBeVisible();
});

test("application form submit is disabled when proposal is invalid", async ({
  apiClient,
  clientPage,
  freelancerPage,
}) => {
  const jobInput = uniqueJobInput(Date.now().toString());
  const job = await apiClient.createJob(clientPage.token, {
    ...jobInput,
    clientAddress: clientPage.publicKey,
  });

  const jobDetail = new JobDetailPage(freelancerPage.page);
  await jobDetail.goto(job.id);
  await jobDetail.applyButton().click();

  const applicationForm = new ApplicationFormDialog(freelancerPage.page);
  await expect(applicationForm.submitButton()).toBeDisabled();
});
