/**
 * Typed API client used by fixtures to seed state directly, instead of
 * driving the UI. In E2E tests, it seeds state directly into the isolated
 * MockBackendServer instance associated with the test, ensuring 100% parallel-safe
 * and fast execution without port conflicts or DB requirements.
 */
import type { Keypair } from "@stellar/stellar-sdk";
import type { MockBackendServer, MockJob, MockApplication } from "./mockServer";

export class ApiClient {
  constructor(
    private readonly mockBackend: MockBackendServer,
    private readonly networkPassphrase: string
  ) {}

  async loginAs(keypair: Keypair): Promise<{ token: string; publicKey: string }> {
    const publicKey = keypair.publicKey();
    const token = `mock-token-${publicKey}`;
    return { token, publicKey };
  }

  async createProfile(input: {
    publicKey: string;
    role: "client" | "freelancer" | "both" | "admin";
    displayName?: string;
  }): Promise<void> {
    this.mockBackend.createProfile(input);
  }

  async createJob(
    _token: string,
    input: {
      title: string;
      description: string;
      budget: string;
      currency?: "XLM" | "USDC";
      category: string;
      clientAddress: string;
      skills?: string[];
      screeningQuestions?: string[];
    }
  ): Promise<MockJob> {
    const job = this.mockBackend.createJob(input);
    return job;
  }

  async applyToJob(input: {
    jobId: string;
    freelancerAddress: string;
    proposal: string;
    bidAmount: string;
    currency?: "XLM" | "USDC";
  }): Promise<MockApplication> {
    const app = this.mockBackend.applyToJob(input);
    return app;
  }

  async acceptApplication(input: { applicationId: string; clientAddress: string }): Promise<void> {
    this.mockBackend.acceptApplication(input.applicationId);
  }

  async logTime(
    _token: string,
    input: { jobId: string; durationMinutes: number; description?: string }
  ): Promise<void> {
    this.mockBackend.logTime(input);
  }

  async releaseEscrow(input: {
    jobId: string;
    clientAddress: string;
    contractTxHash?: string;
  }): Promise<void> {
    this.mockBackend.releaseEscrow(input.jobId);
  }

  async rate(
    _token: string,
    input: { jobId: string; ratedAddress: string; stars: number; review?: string }
  ): Promise<void> {
    this.mockBackend.rate(input);
  }

  async raiseDispute(
    _token: string,
    jobId: string,
    _input: { reason: string; description: string }
  ): Promise<void> {
    this.mockBackend.raiseDispute(jobId);
  }

  async resolveDispute(
    _adminToken: string,
    jobId: string,
    _input: { resolution: string; releaseTo: "client" | "freelancer" }
  ): Promise<void> {
    this.mockBackend.resolveDispute(jobId);
  }

  async registerArbitrator(_token: string, _input: { displayName?: string; bio?: string }) {
    this.mockBackend.registerArbitrator("arbitrator");
  }
}
