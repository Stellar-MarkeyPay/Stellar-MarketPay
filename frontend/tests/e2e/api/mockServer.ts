import type { Page } from "@playwright/test";
import { Keypair } from "@stellar/stellar-sdk";

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
    this.state.jobs.push(job);
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
    this.state.timeEntries.push(entry);
    return entry;
  }

  releaseEscrow(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
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
    this.state.ratings.push(rating);
    return rating;
  }

  raiseDispute(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (job) job.status = "disputed";
  }

  resolveDispute(jobId: string): void {
    const job = this.state.jobs.find((j) => j.id === jobId);
    if (job) job.status = "completed";
  }

  registerArbitrator(_address: string): void {}

  async install(page: Page): Promise<void> {
    // 1. Install browser-level XHR/fetch persistent interceptor
    await page.addInitScript((initialState: MockState) => {
      const STORAGE_KEY = "__MARKETPLACE_MOCK_STATE__";

      function getState(): MockState {
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (raw) return JSON.parse(raw);
        } catch {}
        return initialState;
      }

      function persistState(state: MockState) {
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch {}
      }

      persistState(initialState);

      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url) {
        (this as any).__url = typeof url === "string" ? url : (url as any).href;
        (this as any).__method = method;
        return origOpen.apply(this, arguments as any);
      };

      XMLHttpRequest.prototype.send = function (body) {
        const url = (this as any).__url || "";
        const method = (this as any).__method || "GET";

        if (url.includes("/api/") || url.includes(":4000")) {
          const mockState = getState();
          let pathname = url;
          try {
            pathname = new URL(url, window.location.origin).pathname;
          } catch {}

          let responseData: any = { success: true, data: [] };
          let status = 200;

          if (pathname.includes("/api/auth")) {
            responseData = {
              success: true,
              transaction: "mock-sep10-tx",
              token: "mock-jwt-token",
            };
          } else if (pathname === "/api/jobs" || pathname === "/api/jobs/") {
            if (method === "GET") {
              responseData = {
                success: true,
                data: mockState.jobs,
                jobs: mockState.jobs,
                nextCursor: null,
              };
            } else if (method === "POST") {
              const b = typeof body === "string" ? JSON.parse(body) : body || {};
              const job: MockJob = {
                id: `job-${mockState.jobs.length + 1}`,
                title: b.title || "Untitled Job",
                description: b.description || "",
                budget: b.budget || "100",
                currency: b.currency || "XLM",
                category: b.category || "General",
                clientAddress: b.clientAddress || "",
                skills: b.skills || [],
                screeningQuestions: b.screeningQuestions || [],
                status: "open",
                applicantCount: 0,
                createdAt: new Date().toISOString(),
              };
              mockState.jobs.unshift(job);
              persistState(mockState);
              responseData = { success: true, data: job };
              status = 201;
            }
          } else if (pathname.startsWith("/api/jobs/") && !pathname.includes("/escrow")) {
            const id = pathname.split("/").pop() || "";
            const job = mockState.jobs.find((j) => j.id === id) || mockState.jobs[0];
            if (job) {
              responseData = { success: true, data: job };
            } else {
              responseData = { success: false, error: "Job not found" };
              status = 404;
            }
          } else if (pathname.includes("/escrow") && method === "PATCH") {
            const parts = pathname.split("/");
            const jobId = parts[parts.indexOf("jobs") + 1];
            const job = mockState.jobs.find((j) => j.id === jobId);
            if (job) {
              const b = typeof body === "string" ? JSON.parse(body) : body || {};
              job.escrowContractId = b.escrowContractId || "mock-escrow-id";
              persistState(mockState);
              responseData = { success: true, data: job };
            }
          } else if (pathname === "/api/applications" && method === "POST") {
            const b = typeof body === "string" ? JSON.parse(body) : body || {};
            const app: MockApplication = {
              id: `app-${mockState.applications.length + 1}`,
              jobId: b.jobId,
              freelancerAddress: b.freelancerAddress,
              proposal: b.proposal,
              bidAmount: b.bidAmount,
              currency: b.currency || "XLM",
              status: "pending",
              createdAt: new Date().toISOString(),
            };
            mockState.applications.push(app);
            const job = mockState.jobs.find((j) => j.id === b.jobId);
            if (job) job.applicantCount++;
            persistState(mockState);
            responseData = { success: true, data: app };
            status = 201;
          } else if (pathname.includes("/api/applications/job/")) {
            const jobId = pathname.split("/").pop();
            responseData = {
              success: true,
              data: mockState.applications.filter((a) => a.jobId === jobId),
            };
          } else if (pathname.match(/\/api\/applications\/[^\/]+\/accept/)) {
            const parts = pathname.split("/");
            const appId = parts[parts.indexOf("applications") + 1];
            const app = mockState.applications.find((a) => a.id === appId);
            if (app) {
              app.status = "accepted";
              const job = mockState.jobs.find((j) => j.id === app.jobId);
              if (job) {
                job.status = "in_progress";
                job.freelancerAddress = app.freelancerAddress;
              }
              persistState(mockState);
              responseData = { success: true, data: app };
            }
          } else if (pathname.includes("/api/time-entries")) {
            if (method === "GET") {
              const urlObj = new URL(url, window.location.origin);
              const jobId = urlObj.searchParams.get("jobId") || pathname.split("/").pop();
              responseData = {
                success: true,
                data: mockState.timeEntries.filter((e) => e.jobId === jobId),
              };
            } else if (method === "POST") {
              const b = typeof body === "string" ? JSON.parse(body) : body || {};
              const entry: MockTimeEntry = {
                id: `time-${mockState.timeEntries.length + 1}`,
                jobId: b.jobId,
                durationMinutes: b.durationMinutes || 60,
                description: b.description || "",
                createdAt: new Date().toISOString(),
              };
              mockState.timeEntries.push(entry);
              persistState(mockState);
              responseData = { success: true, data: entry };
              status = 201;
            }
          } else if (pathname.includes("/api/escrow/") && pathname.endsWith("/release")) {
            const parts = pathname.split("/");
            const jobId = parts[parts.indexOf("escrow") + 1];
            const job = mockState.jobs.find((j) => j.id === jobId);
            if (job) {
              job.status = "completed";
              persistState(mockState);
            }
            responseData = { success: true, data: { success: true } };
          } else if (pathname === "/api/ratings" && method === "POST") {
            const b = typeof body === "string" ? JSON.parse(body) : body || {};
            const rating: MockRating = {
              id: `rating-${mockState.ratings.length + 1}`,
              jobId: b.jobId,
              raterAddress: b.raterAddress || "unknown",
              ratedAddress: b.ratedAddress,
              stars: b.stars || 5,
              review: b.review,
              createdAt: new Date().toISOString(),
            };
            mockState.ratings.push(rating);
            persistState(mockState);
            responseData = { success: true, data: rating };
            status = 201;
          } else if (pathname.includes("/api/profiles/")) {
            if (pathname.includes("/client-reputation")) {
              responseData = {
                success: true,
                data: {
                  score: 4.5,
                  paymentReleaseRate: 95,
                  disputeRate: 2,
                  completionRate: 90,
                  avgTimeToReleaseHours: 24,
                  responseTimeToApplicationsHours: 12,
                },
              };
            } else {
              const pk = pathname.split("/").pop();
              responseData = { success: true, data: { publicKey: pk, role: "both" } };
            }
          } else if (pathname.includes("/faucet/status")) {
            responseData = { success: true, data: { enabled: true } };
          }

          const xhr = this;
          setTimeout(() => {
            Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
            Object.defineProperty(xhr, "status", { value: status, configurable: true });
            Object.defineProperty(xhr, "responseText", {
              value: JSON.stringify(responseData),
              configurable: true,
            });
            xhr.dispatchEvent(new Event("readystatechange"));
            xhr.dispatchEvent(new Event("load"));
            xhr.dispatchEvent(new Event("loadend"));
          }, 0);
          return;
        }

        return origSend.apply(this, arguments as any);
      };
    }, this.state);

    // 2. Install Playwright route interceptor as fallback/network-level layer
    await page.route("**/api.coingecko.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ stellar: { usd: 0.12 } }),
      });
    });

    await page.route(
      (url) => url.pathname.startsWith("/api/") || url.host.includes(":4000"),
      async (route) => {
        const req = route.request();
        if (req.method() === "OPTIONS") {
          await route.fulfill({
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
            },
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
          body: JSON.stringify({ success: true, data: [] }),
        });
      }
    );
  }
}
