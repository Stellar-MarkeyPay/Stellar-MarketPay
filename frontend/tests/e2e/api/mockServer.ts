import type { Page, Route } from "@playwright/test";

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
  updatedAt: string;
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

export interface MockState {
  jobs: MockJob[];
  applications: MockApplication[];
  timeEntries: MockTimeEntry[];
  ratings: MockRating[];
  profiles: MockProfile[];
}

export class MockBackendServer {
  private state: MockState = {
    jobs: [],
    applications: [],
    timeEntries: [],
    ratings: [],
    profiles: [],
  };

  getState(): MockState {
    return this.state;
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
    this.state.profiles.push(profile);
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
    const now = new Date().toISOString();
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
      createdAt: now,
      updatedAt: now,
    };
    this.state.jobs.unshift(job);
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
    this.state.applications.push(app);
    const job = this.state.jobs.find((j) => j.id === input.jobId);
    if (job) job.applicantCount++;
    return app;
  }

  acceptApplication(applicationId: string): MockApplication | null {
    const app = this.state.applications.find((a) => a.id === applicationId);
    if (app) {
      app.status = "accepted";
      const job = this.state.jobs.find((j) => j.id === app.jobId);
      if (job) {
        job.status = "in_progress";
        job.freelancerAddress = app.freelancerAddress;
        job.updatedAt = new Date().toISOString();
      }
      return app;
    }
    return null;
  }

  logTime(input: { jobId: string; durationMinutes: number; description?: string }): MockTimeEntry {
    const entry: MockTimeEntry = {
      id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      jobId: input.jobId,
      durationMinutes: input.durationMinutes || 60,
      description: input.description || "",
      createdAt: new Date().toISOString(),
    };
    this.state.timeEntries.push(entry);
    return entry;
  }

  releaseEscrow(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
    }
  }

  rate(input: {
    jobId: string;
    raterAddress?: string;
    ratedAddress?: string;
    stars: number;
    review?: string;
  }): MockRating {
    const rating: MockRating = {
      id: `rating-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      jobId: input.jobId,
      raterAddress: input.raterAddress || "client",
      ratedAddress: input.ratedAddress || "freelancer",
      stars: input.stars || 5,
      review: input.review,
      createdAt: new Date().toISOString(),
    };
    this.state.ratings.push(rating);
    return rating;
  }

  raiseDispute(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "disputed";
      job.updatedAt = new Date().toISOString();
    }
  }

  resolveDispute(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (job) {
      job.status = "completed";
      job.updatedAt = new Date().toISOString();
    }
  }

  registerArbitrator(_address: string): void {}

  async install(page: Page): Promise<void> {
    const target = page.context() || page;
    await target.route("**/*", async (route: Route) => {
      try {
        const req = route.request();
        const method = req.method();
        const rawUrl = req.url();

        const isMockTarget =
          rawUrl.includes("/api/") ||
          rawUrl.includes(":4000") ||
          rawUrl.includes("/faucet/") ||
          rawUrl.includes("coingecko");

        if (!isMockTarget) {
          await route.continue();
          return;
        }

        const headers = req.headers();
        const origin = headers["origin"] || "http://127.0.0.1:3000";

        const corsHeaders = {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
        };

        // CORS preflight
        if (method === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: corsHeaders,
          });
          return;
        }

        let urlObj: URL;
        try {
          urlObj = new URL(rawUrl);
        } catch {
          urlObj = new URL(rawUrl, "http://localhost:4000");
        }
        const pathname = urlObj.pathname.replace(/\/+$/, "") || "/";

        let body: any = {};
        const postData = req.postData();
        if (postData) {
          try {
            body = JSON.parse(postData);
          } catch {
            body = postData;
          }
        }

        const fulfill = async (status: number, data: any) => {
          await route.fulfill({
            status,
            contentType: "application/json",
            headers: corsHeaders,
            body: JSON.stringify(data),
          });
        };

        // ── External CoinGecko Price ─────────────────────────────────────────
        if (pathname.includes("/simple/price") || rawUrl.includes("coingecko")) {
          await fulfill(200, { stellar: { usd: 0.12 } });
          return;
        }

        // ── Auth ─────────────────────────────────────────────────────────────
        if (pathname === "/api/auth") {
          if (method === "GET") {
            await fulfill(200, { success: true, transaction: "mock-sep10-tx" });
            return;
          }
          if (method === "POST") {
            await fulfill(200, { success: true, token: "mock-jwt-token" });
            return;
          }
        }

        if (pathname === "/api/auth/refresh") {
          await fulfill(200, { success: true, token: "mock-jwt-token" });
          return;
        }

        if (pathname === "/api/auth/logout") {
          await fulfill(200, { success: true });
          return;
        }

        // ── Jobs ─────────────────────────────────────────────────────────────
        if (pathname === "/api/jobs/suggestions") {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        if (pathname === "/api/jobs/expiring") {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        if (pathname === "/api/jobs/drafts") {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        if (pathname.startsWith("/api/jobs/drafts/")) {
          await fulfill(200, { success: true, data: {} });
          return;
        }

        if (pathname.startsWith("/api/jobs/client/")) {
          const address = pathname.split("/").pop();
          const clientJobs = this.state.jobs.filter((j) => j.clientAddress === address);
          await fulfill(200, { success: true, data: clientJobs });
          return;
        }

        if (pathname.match(/^\/api\/jobs\/[^\/]+\/analytics$/)) {
          await fulfill(200, { success: true, data: { views: 10, applications: 1 } });
          return;
        }

        if (pathname.match(/^\/api\/jobs\/[^\/]+\/escrow$/)) {
          const parts = pathname.split("/");
          const jobId = parts[parts.indexOf("jobs") + 1];
          const job = this.state.jobs.find((j) => j.id === jobId);
          if (method === "PATCH") {
            if (job) {
              job.escrowContractId = body.escrowContractId || "mock-escrow-id";
              job.updatedAt = new Date().toISOString();
              await fulfill(200, { success: true, data: job });
              return;
            }
            await fulfill(404, { success: false, error: "Job not found" });
            return;
          }
          await fulfill(200, { success: true, data: { jobId, status: "funded" } });
          return;
        }

        if (pathname.match(/^\/api\/(?:jobs|escrow)\/[^\/]+\/release$/)) {
          const parts = pathname.split("/");
          const idIndex = parts.indexOf("release") - 1;
          const jobId = parts[idIndex];
          this.releaseEscrow(jobId);
          await fulfill(200, { success: true, data: { success: true } });
          return;
        }

        if (pathname.match(/^\/api\/jobs\/[^\/]+\/dispute$/)) {
          const parts = pathname.split("/");
          const jobId = parts[parts.indexOf("jobs") + 1];
          this.raiseDispute(jobId);
          await fulfill(200, { success: true, data: { success: true } });
          return;
        }

        if (pathname === "/api/jobs") {
          if (method === "GET") {
            const category = urlObj.searchParams.get("category");
            const status = urlObj.searchParams.get("status");
            let filtered = this.state.jobs;
            if (category) {
              filtered = filtered.filter(
                (j) => j.category.toLowerCase() === category.toLowerCase()
              );
            }
            if (status) {
              filtered = filtered.filter((j) => j.status === status);
            }
            await fulfill(200, {
              success: true,
              data: filtered,
              jobs: filtered,
              nextCursor: null,
            });
            return;
          }
          if (method === "POST") {
            const job = this.createJob(body);
            await fulfill(201, { success: true, data: job });
            return;
          }
        }

        if (pathname.match(/^\/api\/jobs\/[^\/]+$/)) {
          const id = pathname.split("/").pop() || "";
          const job = this.state.jobs.find((j) => j.id === id);
          if (job) {
            await fulfill(200, { success: true, data: job });
            return;
          }
          await fulfill(404, { success: false, error: "Job not found" });
          return;
        }

        // ── Applications ─────────────────────────────────────────────────────
        if (pathname.match(/^\/api\/applications\/job\/[^\/]+$/)) {
          const jobId = pathname.split("/").pop();
          const apps = this.state.applications.filter((a) => a.jobId === jobId);
          await fulfill(200, { success: true, data: apps });
          return;
        }

        if (pathname.startsWith("/api/applications/freelancer/")) {
          const address = pathname.split("/").pop();
          const apps = this.state.applications.filter((a) => a.freelancerAddress === address);
          await fulfill(200, { success: true, data: apps });
          return;
        }

        if (pathname.match(/^\/api\/applications\/[^\/]+\/accept$/)) {
          const parts = pathname.split("/");
          const appId = parts[parts.indexOf("applications") + 1];
          const app = this.acceptApplication(appId);
          if (app) {
            await fulfill(200, { success: true, data: app });
            return;
          }
          await fulfill(404, { success: false, error: "Application not found" });
          return;
        }

        if (pathname === "/api/applications" && method === "POST") {
          const app = this.applyToJob(body);
          await fulfill(201, { success: true, data: app });
          return;
        }

        // ── Time Entries ─────────────────────────────────────────────────────
        if (pathname.startsWith("/api/time-entries")) {
          if (method === "GET") {
            const jobId =
              urlObj.searchParams.get("jobId") ||
              (pathname.split("/").length > 3 ? pathname.split("/").pop() : null);
            const entries = jobId
              ? this.state.timeEntries.filter((e) => e.jobId === jobId)
              : this.state.timeEntries;
            await fulfill(200, { success: true, data: entries });
            return;
          }
          if (method === "POST") {
            const entry = this.logTime(body);
            await fulfill(201, { success: true, data: entry });
            return;
          }
        }

        // ── Ratings ──────────────────────────────────────────────────────────
        if (pathname.startsWith("/api/ratings")) {
          if (method === "GET") {
            const address = pathname.split("/").pop();
            const ratings = this.state.ratings.filter((r) => r.ratedAddress === address);
            await fulfill(200, { success: true, data: ratings });
            return;
          }
          if (method === "POST") {
            const rating = this.rate(body);
            await fulfill(201, { success: true, data: rating });
            return;
          }
        }

        // ── Escrow ───────────────────────────────────────────────────────────
        if (pathname.startsWith("/api/escrow/")) {
          const jobId = pathname.split("/").pop();
          await fulfill(200, { success: true, data: { jobId, status: "funded" } });
          return;
        }

        // ── Profiles & Reputation ────────────────────────────────────
        if (pathname.startsWith("/api/profiles/")) {
          if (pathname.endsWith("/client-reputation")) {
            await fulfill(200, {
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
            return;
          }
          if (pathname.endsWith("/stats")) {
            await fulfill(200, { success: true, data: { totalEarned: 1000, jobsCompleted: 5 } });
            return;
          }
          if (pathname.endsWith("/response-time")) {
            await fulfill(200, { success: true, data: { avgResponseTimeMinutes: 15 } });
            return;
          }
          const pk = pathname.split("/").pop();
          const profile = this.state.profiles.find((p) => p.publicKey === pk);
          await fulfill(200, {
            success: true,
            data: profile || { publicKey: pk, role: "both", displayName: "User", bio: "" },
          });
          return;
        }

        if (pathname === "/api/profiles" && method === "POST") {
          const profile = this.createProfile(body);
          await fulfill(201, { success: true, data: profile });
          return;
        }

        // ── Templates & Saved Searches ───────────────────────────────────────
        if (pathname === "/api/proposal-templates") {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        if (pathname === "/api/saved-searches") {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        // ── Referrals & Notifications ────────────────────────────────────────
        if (pathname.startsWith("/api/referrals")) {
          await fulfill(200, { success: true, data: { success: true } });
          return;
        }

        if (pathname.startsWith("/api/notifications")) {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        if (pathname.startsWith("/api/messages")) {
          await fulfill(200, { success: true, data: [] });
          return;
        }

        // ── Admin & DAO ──────────────────────────────────────────────────────
        if (pathname.match(/^\/api\/admin\/disputes\/[^\/]+\/resolve$/)) {
          const parts = pathname.split("/");
          const jobId = parts[parts.indexOf("disputes") + 1];
          this.resolveDispute(jobId);
          await fulfill(200, { success: true, data: { success: true } });
          return;
        }

        if (pathname === "/api/dao/arbitrators" && method === "POST") {
          this.registerArbitrator("arbitrator");
          await fulfill(201, { success: true, data: { success: true } });
          return;
        }

        // ── Faucet ───────────────────────────────────────────────────────────
        if (pathname.includes("/faucet/status")) {
          await fulfill(200, { success: true, data: { enabled: true } });
          return;
        }

        if (pathname.includes("/faucet/fund")) {
          await fulfill(200, { success: true, data: { funded: true } });
          return;
        }

        // ── Insights & Analytics ─────────────────────────────────────────────
        if (pathname.startsWith("/api/insights/")) {
          await fulfill(200, {
            success: true,
            data: {
              categories: [],
              clientMix: { newClients: 0, returningClients: 0, totalClients: 0 },
              skills: [],
            },
          });
          return;
        }

        // ── Strict unhandled route error (no silent success) ─────────────────
        await fulfill(404, {
          success: false,
          error: `Mock endpoint not implemented: ${method} ${pathname}`,
        });
      } catch (err) {
        console.error("[MOCK ROUTE HANDLER ERROR]:", err);
      }
    });
  }
}
