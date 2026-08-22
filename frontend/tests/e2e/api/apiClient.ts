/**
 * Thin HTTP client used by fixtures to seed state directly against the real
 * backend, instead of driving the UI. Mirrors the request shapes the app's
 * own `frontend/lib/api.ts` uses, so seeded data round-trips through the
 * same validation the real app is subject to.
 *
 * Deliberately has no method for `POST /api/escrow/:jobId/dispute-milestone`
 * — that route 500s against a real database (no migration ever creates the
 * `disputes` table it writes to). The only working dispute path is
 * `raiseDispute` + `resolveDispute` below.
 */
import axios, { type AxiosInstance } from "axios";
import type { Keypair } from "@stellar/stellar-sdk";
import { loginWithKeypair } from "./sep10";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export class ApiClient {
  private readonly http: AxiosInstance;

  constructor(
    private readonly baseURL: string,
    private readonly networkPassphrase: string
  ) {
    this.http = axios.create({ baseURL });
  }

  async loginAs(keypair: Keypair): Promise<{ token: string; publicKey: string }> {
    return loginWithKeypair(this.baseURL, this.networkPassphrase, keypair);
  }

  async createProfile(input: {
    publicKey: string;
    role: "client" | "freelancer" | "both";
    displayName?: string;
  }): Promise<void> {
    await this.http.post("/api/profiles", input);
  }

  async createJob(
    token: string,
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
  ): Promise<{ id: string; [key: string]: unknown }> {
    const { data } = await this.http.post<Envelope<{ id: string }>>("/api/jobs", input, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.data;
  }

  async applyToJob(input: {
    jobId: string;
    freelancerAddress: string;
    proposal: string;
    bidAmount: string;
    currency?: "XLM" | "USDC";
  }): Promise<{ id: string; [key: string]: unknown }> {
    const { data } = await this.http.post<Envelope<{ id: string }>>("/api/applications", input);
    return data.data;
  }

  async acceptApplication(input: { applicationId: string; clientAddress: string }): Promise<void> {
    await this.http.post(`/api/applications/${input.applicationId}/accept`, {
      clientAddress: input.clientAddress,
    });
  }

  async logTime(
    token: string,
    input: { jobId: string; durationMinutes: number; description?: string }
  ): Promise<void> {
    await this.http.post("/api/time-entries", input, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async releaseEscrow(input: {
    jobId: string;
    clientAddress: string;
    contractTxHash?: string;
  }): Promise<void> {
    await this.http.post(`/api/escrow/${input.jobId}/release`, {
      clientAddress: input.clientAddress,
      ...(input.contractTxHash ? { contractTxHash: input.contractTxHash } : {}),
    });
  }

  async rate(
    token: string,
    input: { jobId: string; ratedAddress: string; stars: number; review?: string }
  ): Promise<void> {
    await this.http.post("/api/ratings", input, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async raiseDispute(
    token: string,
    jobId: string,
    input: { reason: string; description: string }
  ): Promise<void> {
    await this.http.post(`/api/jobs/${jobId}/dispute`, input, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async resolveDispute(
    adminToken: string,
    jobId: string,
    input: { resolution: string; releaseTo: "client" | "freelancer" }
  ): Promise<void> {
    await this.http.patch(`/api/admin/disputes/${jobId}/resolve`, input, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  }

  async registerArbitrator(token: string, input: { displayName?: string; bio?: string }) {
    await this.http.post("/api/dao/arbitrators", input, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}
