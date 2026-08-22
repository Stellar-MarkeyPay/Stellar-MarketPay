import { test as base, expect, type Browser, type Page } from "@playwright/test";
import type { Keypair } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE } from "@/lib/stellar";
import { ApiClient } from "../api/apiClient";
import { ADMIN, randomPersonaKeypair } from "../api/personas";
import { sharedMockServer } from "../api/mockServer";
import { installFreighterStub } from "./walletStub";

export interface Persona {
  page: Page;
  keypair: Keypair;
  publicKey: string;
  /** Real backend JWT — usable for direct apiClient seeding as this persona. */
  token: string;
}

interface Fixtures {
  apiClient: ApiClient;
  clientPage: Persona;
  freelancerPage: Persona;
  arbitratorPage: Persona;
  adminPage: Persona;
}

function apiBaseURL(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
}

async function makePersona(
  browser: Browser,
  api: ApiClient,
  opts: { keypair: Keypair; role?: "client" | "freelancer" | "both" }
): Promise<Persona> {
  const publicKey = opts.keypair.publicKey();
  if (opts.role) {
    await api.createProfile({ publicKey, role: opts.role });
  }
  const { token } = await api.loginAs(opts.keypair);

  const context = await browser.newContext();
  const page = await context.newPage();
  await installFreighterStub(page, opts.keypair, NETWORK_PASSPHRASE);

  return { page, keypair: opts.keypair, publicKey, token };
}

export const test = base.extend<Fixtures>({
  apiClient: async ({}, use) => {
    await sharedMockServer.start();
    await use(new ApiClient(apiBaseURL(), NETWORK_PASSPHRASE));
  },

  clientPage: async ({ browser, apiClient }, use) => {
    const persona = await makePersona(browser, apiClient, {
      keypair: randomPersonaKeypair(),
      role: "client",
    });
    await use(persona);
    await persona.page.close();
  },

  freelancerPage: async ({ browser, apiClient }, use) => {
    const persona = await makePersona(browser, apiClient, {
      keypair: randomPersonaKeypair(),
      role: "freelancer",
    });
    await use(persona);
    await persona.page.close();
  },

  arbitratorPage: async ({ browser, apiClient }, use) => {
    const persona = await makePersona(browser, apiClient, {
      keypair: randomPersonaKeypair(),
      role: "both",
    });
    await apiClient.registerArbitrator(persona.token, {});
    await use(persona);
    await persona.page.close();
  },

  adminPage: async ({ browser, apiClient }, use) => {
    // ADMIN is a fixed keypair (see api/personas.ts) whose public key is
    // baked into the backend's ADMIN_WALLET_ADDRESSES at boot — it needs no
    // profile row for its JWT to carry role: "admin".
    const persona = await makePersona(browser, apiClient, { keypair: ADMIN });
    await use(persona);
    await persona.page.close();
  },
});

export { expect };
