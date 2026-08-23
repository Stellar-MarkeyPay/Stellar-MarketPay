import type { Page, Route } from "@playwright/test";
import { Keypair, Account, TransactionBuilder, Operation, Networks } from "@stellar/stellar-sdk";

export interface MockJob {
  id: string;
  title: string;
  description: string;
  budget: string;
  currency: string;
  category: string;
  clientAddress: string;
  skills: string[];
  screeningQuestions: string[];
  status: "open" | "in_progress" | "completed" | "disputed";
  freelancerAddress?: string;
  escrowContractId?: string;
  applicantCount: number;
  createdAt: string;
}

export interface MockApplication {
  id: string;
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;
  currency: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

export interface MockTimeEntry {
  id: string;
  jobId: string;
  durationMinutes: number;
  description: string;
  createdAt: string;
}

export interface MockRating {
  id: string;
  jobId: string;
  raterAddress: string;
  ratedAddress: string;
  stars: number;
  review?: string;
  createdAt: string;
}

export interface MockProfile {
  publicKey: string;
  role: "client" | "freelancer" | "both" | "admin";
  displayName?: string;
  bio?: string;
}

export class MockBackendServer {
  private serverKeypair = Keypair.random();
  public jobs = new Map<string, MockJob>();
  public applications = new Map<string, MockApplication>();
  public timeEntries: MockTimeEntry[] = [];
  public ratings: MockRating[] = [];
  public profiles = new Map<string, MockProfile>();
  public arbitrators = new Set<string>();

  private makeJwt(payload: { publicKey: string; role?: string }): string {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      })
    ).toString("base64url");
    const signature = Buffer.from("mock-sig").toString("base64url");
    return `${header}.${body}.${signature}`;
  }

  createProfile(input: {
    publicKey: string;
    role: "client" | "freelancer" | "both" | "admin";
    displayName?: string;
    bio?: string;
  }): MockProfile {
    const profile: MockProfile = {
      publicKey: input.publicKey,
      role: input.role || "both",
      displayName: input.displayName,
      bio: input.bio,
    };
    this.profiles.set(profile.publicKey, profile);
    return profile;
  }

  createJob(input: {
    title: string;
    description: string;
    budget: string;
    currency?: "XLM" | "USDC";
    category: string;
    clientAddress: string;
    skills?: string[];
    screeningQuestions?: string[];
  }): MockJob {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const job: MockJob = {
      id,
      title: input.title || "Untitled Job",
      description: input.description || "",
      budget: input.budget || "100",
      currency: input.currency || "XLM",
      category: input.category || "General",
      clientAddress: input.clientAddress || "",
      skills: input.skills || [],
      screeningQuestions: input.screeningQuestions || [],
      status: "open",
      applicantCount: 0,
      createdAt: new Date().toISOString(),
    };
    this.jobs.set(id, job);
    return job;
  }

  applyToJob(input: {
    jobId: string;
    freelancerAddress: string;
    proposal: string;
    bidAmount: string;
    currency?: "XLM" | "USDC";
  }): MockApplication {
    const id = `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const app: MockApplication = {
      id,
      jobId: input.jobId,
      freelancerAddress: input.freelancerAddress,
      proposal: input.proposal || "",
      bidAmount: input.bidAmount || "100",
      currency: input.currency || "XLM",
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.applications.set(id, app);
    const job = this.jobs.get(input.jobId);
    if (job) job.applicantCount++;
    return app;
  }

  acceptApplication(applicationId: string): MockApplication | null {
    const app = this.applications.get(applicationId);
    if (app) {
      app.status = "accepted";
      const job = this.jobs.get(app.jobId);
      if (job) {
        job.status = "in_progress";
        job.freelancerAddress = app.freelancerAddress;
      }
      return app;
    }
    return null;
  }

  logTime(input: { jobId: string; durationMinutes: number; description?: string }): MockTimeEntry {
    const entry: MockTimeEntry = {
      id: `time-${Date.now()}`,
      jobId: input.jobId,
      durationMinutes: input.durationMinutes || 60,
      description: input.description || "",
      createdAt: new Date().toISOString(),
    };
    this.timeEntries.push(entry);
    return entry;
  }

  releaseEscrow(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.status = "completed";
  }

  rate(input: {
    jobId: string;
    raterAddress?: string;
    ratedAddress?: string;
    stars: number;
    review?: string;
  }): MockRating {
    const rating: MockRating = {
      id: `rating-${Date.now()}`,
      jobId: input.jobId,
      raterAddress: input.raterAddress || "client",
      ratedAddress: input.ratedAddress || "freelancer",
      stars: input.stars || 5,
      review: input.review,
      createdAt: new Date().toISOString(),
    };
    this.ratings.push(rating);
    return rating;
  }

  raiseDispute(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.status = "disputed";
  }

  resolveDispute(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) job.status = "completed";
  }

  registerArbitrator(address: string): void {
    this.arbitrators.add(address);
  }

  async install(page: Page): Promise<void> {
    // Intercept Coingecko
    await page.route("**/api.coingecko.com/**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stellar: { usd: 0.12 } }),
      });
    });

    // Intercept backend API calls made from the browser
    await page.route(
      (url) => url.pathname.startsWith("/api/") || url.host.includes(":4000"),
      async (route: Route) => {
        const req = route.request();
        const method = req.method();
        const url = new URL(req.url());
        const pathname = url.pathname;

        if (method === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
              "Access-Control-Allow-Credentials": "true",
            },
          });
          return;
        }

        let body: any = {};
        const postData = req.postData();
        if (postData) {
          try {
            body = JSON.parse(postData);
          } catch {
            body = {};
          }
        }

        const fulfillJson = async (status: number, data: any) => {
          await route.fulfill({
            status,
            contentType: "application/json",
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Credentials": "true",
            },
            body: JSON.stringify(data),
          });
        };

        // ── /api/auth (SEP-10) ────────────────────────────────────────────────
        if (pathname === "/api/auth") {
          if (method === "GET") {
            const account = url.searchParams.get("account") || "";
            const serverAcc = new Account(this.serverKeypair.publicKey(), "0");
            const tx = new TransactionBuilder(serverAcc, {
              fee: "100",
              networkPassphrase: Networks.TESTNET,
              timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 3600 },
            })
              .addOperation(
                Operation.manageData({
                  source: account,
                  name: `${this.serverKeypair.publicKey()} auth`,
                  value: "challenge",
                })
              )
              .build();
            tx.sign(this.serverKeypair);
            return fulfillJson(200, { transaction: tx.toXDR() });
          }

          if (method === "POST") {
            try {
              const tx: any = TransactionBuilder.fromXDR(body.transaction, Networks.TESTNET);
              const publicKey = tx.operations?.[0]?.source || tx.source || "MOCK_KEY";
              const profile = this.profiles.get(publicKey);
              const token = this.makeJwt({ publicKey, role: profile?.role || "both" });
              return fulfillJson(200, { success: true, token });
            } catch {
              const token = this.makeJwt({ publicKey: "MOCK_KEY", role: "both" });
              return fulfillJson(200, { success: true, token });
            }
          }
        }

        if (pathname === "/api/auth/refresh") {
          const token = this.makeJwt({ publicKey: "MOCK_REFRESHED", role: "both" });
          return fulfillJson(200, { success: true, token });
        }

        // ── /api/profiles ─────────────────────────────────────────────────────
        if (pathname === "/api/profiles" || pathname.startsWith("/api/profiles/")) {
          if (pathname.includes("/client-reputation")) {
            return fulfillJson(200, {
              success: true,
              data: {
                score: 4.5,
                paymentReleaseRate: 95,
                disputeRate: 2,
                completionRate: 90,
                avgTimeToReleaseHours: 24,
                responseTimeToApplicationsHours: 12,
              },
            });
          }

          if (method === "POST") {
            const profile = this.createProfile(body);
            return fulfillJson(201, { success: true, data: profile });
          }

          if (method === "GET") {
            const pk = pathname.split("/").pop() || "";
            const profile = this.profiles.get(pk) || { publicKey: pk, role: "both" };
            return fulfillJson(200, { success: true, data: profile });
          }
        }

        // ── /api/jobs ─────────────────────────────────────────────────────────
        if (pathname === "/api/jobs" && method === "GET") {
          return fulfillJson(200, { success: true, data: Array.from(this.jobs.values()) });
        }

        if (pathname === "/api/jobs" && method === "POST") {
          const job = this.createJob(body);
          return fulfillJson(201, { success: true, data: job });
        }

        const jobMatch = pathname.match(/^\/api\/jobs\/([^\/]+)$/);
        if (jobMatch && method === "GET") {
          const job = this.jobs.get(jobMatch[1]);
          if (!job) {
            return fulfillJson(404, { success: false, error: "Job not found" });
          }
          return fulfillJson(200, { success: true, data: job });
        }

        const jobEscrowMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/escrow$/);
        if (jobEscrowMatch && method === "PATCH") {
          const job = this.jobs.get(jobEscrowMatch[1]);
          if (!job) {
            return fulfillJson(404, { success: false, error: "Job not found" });
          }
          job.escrowContractId = body.escrowContractId;
          return fulfillJson(200, { success: true, data: job });
        }

        // ── /api/applications ─────────────────────────────────────────────────
        if (pathname === "/api/applications" && method === "POST") {
          const app = this.applyToJob(body);
          return fulfillJson(201, { success: true, data: app });
        }

        if (pathname === "/api/applications" && method === "GET") {
          const jobId = url.searchParams.get("jobId");
          const apps = Array.from(this.applications.values()).filter(
            (a) => !jobId || a.jobId === jobId
          );
          return fulfillJson(200, { success: true, data: apps });
        }

        const applicationsByJobMatch = pathname.match(/^\/api\/applications\/job\/([^\/]+)$/);
        if (applicationsByJobMatch && method === "GET") {
          const jobId = applicationsByJobMatch[1];
          const apps = Array.from(this.applications.values()).filter((a) => a.jobId === jobId);
          return fulfillJson(200, { success: true, data: apps });
        }

        const acceptMatch = pathname.match(/^\/api\/applications\/([^\/]+)\/accept$/);
        if (acceptMatch && method === "POST") {
          const app = this.acceptApplication(acceptMatch[1]);
          if (app) {
            return fulfillJson(200, { success: true, data: app });
          }
        }

        // ── /api/time-entries ─────────────────────────────────────────────────
        const timeEntriesByJobMatch = pathname.match(/^\/api\/time-entries\/job\/([^\/]+)$/);
        if (timeEntriesByJobMatch && method === "GET") {
          const jobId = timeEntriesByJobMatch[1];
          const entries = this.timeEntries.filter((e) => e.jobId === jobId);
          return fulfillJson(200, { success: true, data: entries });
        }

        if (pathname === "/api/time-entries") {
          if (method === "GET") {
            const jobId = url.searchParams.get("jobId");
            const entries = this.timeEntries.filter((e) => !jobId || e.jobId === jobId);
            return fulfillJson(200, { success: true, data: entries });
          }
          if (method === "POST") {
            const entry = this.logTime(body);
            return fulfillJson(201, { success: true, data: entry });
          }
        }

        // ── /api/escrow/:jobId/release ─────────────────────────────────────────
        const releaseMatch = pathname.match(/^\/api\/escrow\/([^\/]+)\/release$/);
        if (releaseMatch && method === "POST") {
          this.releaseEscrow(releaseMatch[1]);
          return fulfillJson(200, { success: true, data: { success: true } });
        }

        // ── /api/ratings ───────────────────────────────────────────────────────
        if (pathname === "/api/ratings" && method === "POST") {
          const rating = this.rate(body);
          return fulfillJson(201, { success: true, data: rating });
        }

        // ── /api/jobs/:jobId/dispute ──────────────────────────────────────────
        const disputeMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/dispute$/);
        if (disputeMatch && method === "POST") {
          this.raiseDispute(disputeMatch[1]);
          return fulfillJson(200, { success: true, data: { success: true } });
        }

        // ── /api/admin/disputes/:jobId/resolve ────────────────────────────────
        const resolveMatch = pathname.match(/^\/api\/admin\/disputes\/([^\/]+)\/resolve$/);
        if (resolveMatch && method === "PATCH") {
          this.resolveDispute(resolveMatch[1]);
          return fulfillJson(200, { success: true, data: { success: true } });
        }

        // ── /api/dao/arbitrators ──────────────────────────────────────────────
        if (pathname === "/api/dao/arbitrators" && method === "POST") {
          this.registerArbitrator("arbitrator");
          return fulfillJson(201, { success: true, data: { success: true } });
        }

        // ── /api/faucet/status ────────────────────────────────────────────────
        if (pathname.includes("/faucet/status")) {
          return fulfillJson(200, { success: true, data: { enabled: true } });
        }

        // ── Fallback ──────────────────────────────────────────────────────────
        return fulfillJson(200, { success: true, data: [] });
      }
    );
  }
}
