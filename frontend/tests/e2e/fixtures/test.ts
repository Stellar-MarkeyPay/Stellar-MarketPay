import { test as base, expect, type Page, type Browser } from "@playwright/test";
import type { Keypair } from "@stellar/stellar-sdk";
import { randomPersonaKeypair, ADMIN } from "../api/personas";
import { ApiClient } from "../api/apiClient";
import { MockBackendServer } from "../api/mockServer";
import { installFreighterStub } from "./walletStub";

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

export interface Persona {
  page: Page;
  keypair: Keypair;
  publicKey: string;
  token: string;
}

interface Fixtures {
  mockServer: MockBackendServer;
  apiClient: ApiClient;
  clientPage: Persona;
  freelancerPage: Persona;
  arbitratorPage: Persona;
  adminPage: Persona;
}

async function makePersona(
  browser: Browser,
  mockServer: MockBackendServer,
  api: ApiClient,
  opts: { keypair: Keypair; role?: "client" | "freelancer" | "both" | "admin" }
): Promise<Persona> {
  const publicKey = opts.keypair.publicKey();
  if (opts.role) {
    await api.createProfile({ publicKey, role: opts.role });
  }
  const { token } = await api.loginAs(opts.keypair);

  const context = await browser.newContext();
  const page = await context.newPage();
  await mockServer.install(page);
  await installFreighterStub(page, opts.keypair, NETWORK_PASSPHRASE);

  return { page, keypair: opts.keypair, publicKey, token };
}

export const test = base.extend<Fixtures>({
  mockServer: async ({ page }, use) => {
    const server = new MockBackendServer();
    await server.install(page);
    await use(server);
  },

  apiClient: async ({ mockServer }, use) => {
    await use(new ApiClient(mockServer, NETWORK_PASSPHRASE));
  },

  clientPage: async ({ browser, mockServer, apiClient }, use) => {
    const persona = await makePersona(browser, mockServer, apiClient, {
      keypair: randomPersonaKeypair(),
      role: "client",
    });
    await use(persona);
    await persona.page.context().close();
  },

  freelancerPage: async ({ browser, mockServer, apiClient }, use) => {
    const persona = await makePersona(browser, mockServer, apiClient, {
      keypair: randomPersonaKeypair(),
      role: "freelancer",
    });
    await use(persona);
    await persona.page.context().close();
  },

  arbitratorPage: async ({ browser, mockServer, apiClient }, use) => {
    const persona = await makePersona(browser, mockServer, apiClient, {
      keypair: randomPersonaKeypair(),
    });
    await use(persona);
    await persona.page.context().close();
  },

  adminPage: async ({ browser, mockServer, apiClient }, use) => {
    const persona = await makePersona(browser, mockServer, apiClient, {
      keypair: ADMIN,
      role: "admin",
    });
    await use(persona);
    await persona.page.context().close();
  },
});

export { expect };
