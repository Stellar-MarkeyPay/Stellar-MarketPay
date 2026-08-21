import { expect, test, type Page } from "@playwright/test";
import { CLIENT_ADDRESS, FREELANCER_ADDRESS } from "./helpers/marketplaceState";

const JOB_ID = "job-escrow";

const inProgressJob = {
  id: JOB_ID,
  title: "Optimistic escrow payout",
  description: "Client can release, refund, or start work against locked escrow.",
  budget: "250",
  currency: "XLM",
  category: "Smart Contracts",
  skills: ["Rust", "Soroban"],
  status: "in_progress",
  clientAddress: CLIENT_ADDRESS,
  freelancerAddress: FREELANCER_ADDRESS,
  escrowContractId: "CMOCKCONTRACTID",
  applicantCount: 1,
  createdAt: "2026-01-12T10:00:00.000Z",
  updatedAt: "2026-01-12T10:00:00.000Z",
};

async function mockConnectedClient(page: Page, signMode: "reject" | "approve") {
  await page.addInitScript(
    ({ publicKey, mode }) => {
      localStorage.setItem("smp_wallet_public_key", publicKey);
      (window as any).__signCalls = 0;
      (window as any).freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        requestAccess: async () => ({ error: null }),
        getPublicKey: async () => ({ publicKey }),
        signTransaction: async () => {
          (window as any).__signCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 400));
          if (mode === "reject") {
            throw new Error("User declined");
          }
          return { signedTransaction: "signed-xdr" };
        },
      };
    },
    { publicKey: CLIENT_ADDRESS, mode: signMode }
  );
}

async function installEscrowApiMocks(page: Page, getJob: () => typeof inProgressJob) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (url.includes(`/api/jobs/${JOB_ID}`) && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: getJob() }),
      });
      return;
    }

    if (url.includes(`/api/applications/job/${JOB_ID}`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      });
      return;
    }

    if (url.includes("/api/escrow/") && method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, message: "ok" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route("https://api.coingecko.com/**", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify({ stellar: { usd: 0.12 } }) });
  });
}

test("rejected escrow signature rolls the UI back and explains the failure", async ({ page }) => {
  await mockConnectedClient(page, "reject");
  await installEscrowApiMocks(page, () => inProgressJob);
  await page.goto(`/jobs/${JOB_ID}`);

  await expect(page.getByRole("heading", { name: inProgressJob.title })).toBeVisible();
  await expect(page.getByText("In Progress", { exact: true })).toBeVisible();

  const release = page.getByRole("button", { name: "Release Escrow" });
  await expect(release).toBeEnabled();
  await release.click();
  await release.click({ force: true });

  await expect(page.getByRole("button", { name: "Releasing..." })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refund Escrow" })).toBeDisabled();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("escrow-progress")).toBeVisible();

  await expect(page.getByTestId("escrow-error")).toHaveText(/Transaction signing rejected/i);
  await expect(page.getByText("In Progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Release Escrow" })).toBeEnabled();

  const signCalls = await page.evaluate(() => (window as any).__signCalls);
  expect(signCalls).toBe(1);
});

test("successful escrow release shows explorer progress once a hash exists", async ({ page }) => {
  let released = false;
  await mockConnectedClient(page, "approve");
  await installEscrowApiMocks(page, () =>
    released ? { ...inProgressJob, status: "completed" } : inProgressJob
  );
  await page.goto(`/jobs/${JOB_ID}`);

  await page.getByRole("button", { name: "Release Escrow" }).click();
  released = true;

  const explorer = page.getByTestId("escrow-explorer-link");
  await expect(explorer).toBeVisible();
  await expect(explorer).toHaveAttribute("href", /stellar\.expert\/explorer\/testnet\/tx\//);
  await expect(page.getByTestId("escrow-success")).toHaveText(/Escrow released successfully/i);
});
