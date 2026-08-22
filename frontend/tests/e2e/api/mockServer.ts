/**
 * In-memory mock API server for E2E tests.
 * Runs on port 4000 to serve frontend requests and API client seeding
 * during Playwright runs, ensuring isolated, fast, and DB-free execution.
 */
import http from "http";
import { Keypair, Account, TransactionBuilder, Operation, Networks } from "@stellar/stellar-sdk";

interface MockJob {
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
  applicantCount: number;
  createdAt: string;
}

interface MockApplication {
  id: string;
  jobId: string;
  freelancerAddress: string;
  proposal: string;
  bidAmount: string;
  currency: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
}

interface MockTimeEntry {
  id: string;
  jobId: string;
  durationMinutes: number;
  description: string;
  createdAt: string;
}

interface MockRating {
  id: string;
  jobId: string;
  raterAddress: string;
  ratedAddress: string;
  stars: number;
  review?: string;
  createdAt: string;
}

interface MockProfile {
  publicKey: string;
  role: "client" | "freelancer" | "both" | "admin";
  displayName?: string;
  bio?: string;
}

export class MockBackendServer {
  private server: http.Server | null = null;
  private serverKeypair = Keypair.random();
  private jobs = new Map<string, MockJob>();
  private applications = new Map<string, MockApplication>();
  private timeEntries: MockTimeEntry[] = [];
  private ratings: MockRating[] = [];
  private profiles = new Map<string, MockProfile>();
  private arbitrators = new Set<string>();

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

  start(port = 4000): Promise<void> {
    if (this.server) return Promise.resolve();

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Handle CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With"
        );
        res.setHeader("Access-Control-Allow-Credentials", "true");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const pathname = url.pathname;
        const method = req.method || "GET";

        let body: any = {};
        if (["POST", "PUT", "PATCH"].includes(method)) {
          const raw = await new Promise<string>((resBody) => {
            let data = "";
            req.on("data", (chunk) => (data += chunk));
            req.on("end", () => resBody(data));
          });
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = {};
            }
          }
        }

        const json = (status: number, data: any) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
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
            return json(200, { transaction: tx.toXDR() });
          }

          if (method === "POST") {
            try {
              const tx: any = TransactionBuilder.fromXDR(body.transaction, Networks.TESTNET);
              const publicKey = tx.operations?.[0]?.source || tx.source || "MOCK_KEY";
              const profile = this.profiles.get(publicKey);
              const token = this.makeJwt({ publicKey, role: profile?.role || "both" });
              return json(200, { success: true, token });
            } catch {
              const token = this.makeJwt({ publicKey: "MOCK_KEY", role: "both" });
              return json(200, { success: true, token });
            }
          }
        }

        if (pathname === "/api/auth/refresh") {
          const token = this.makeJwt({ publicKey: "MOCK_REFRESHED", role: "both" });
          return json(200, { success: true, token });
        }

        // ── /api/profiles ─────────────────────────────────────────────────────
        if (pathname === "/api/profiles" || pathname.startsWith("/api/profiles/")) {
          if (pathname.includes("/client-reputation")) {
            return json(200, {
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
            const profile: MockProfile = {
              publicKey: body.publicKey,
              role: body.role || "both",
              displayName: body.displayName,
              bio: body.bio,
            };
            this.profiles.set(profile.publicKey, profile);
            return json(201, { success: true, data: profile });
          }

          if (method === "GET") {
            const pk = pathname.split("/").pop() || "";
            const profile = this.profiles.get(pk) || { publicKey: pk, role: "both" };
            return json(200, { success: true, data: profile });
          }
        }

        // ── /api/jobs ─────────────────────────────────────────────────────────
        if (pathname === "/api/jobs" && method === "GET") {
          return json(200, { success: true, data: Array.from(this.jobs.values()) });
        }

        if (pathname === "/api/jobs" && method === "POST") {
          const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const job: MockJob = {
            id,
            title: body.title || "Untitled Job",
            description: body.description || "",
            budget: body.budget || "100",
            currency: body.currency || "XLM",
            category: body.category || "General",
            clientAddress: body.clientAddress || "",
            skills: body.skills || [],
            screeningQuestions: body.screeningQuestions || [],
            status: "open",
            applicantCount: 0,
            createdAt: new Date().toISOString(),
          };
          this.jobs.set(id, job);
          return json(201, { success: true, data: job });
        }

        const jobMatch = pathname.match(/^\/api\/jobs\/([^\/]+)$/);
        if (jobMatch && method === "GET") {
          const job = this.jobs.get(jobMatch[1]);
          if (!job) {
            return json(404, { success: false, error: "Job not found" });
          }
          return json(200, { success: true, data: job });
        }

        // ── /api/applications ─────────────────────────────────────────────────
        if (pathname === "/api/applications" && method === "POST") {
          const id = `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          const app: MockApplication = {
            id,
            jobId: body.jobId,
            freelancerAddress: body.freelancerAddress,
            proposal: body.proposal || "",
            bidAmount: body.bidAmount || "100",
            currency: body.currency || "XLM",
            status: "pending",
            createdAt: new Date().toISOString(),
          };
          this.applications.set(id, app);
          const job = this.jobs.get(body.jobId);
          if (job) job.applicantCount++;
          return json(201, { success: true, data: app });
        }

        if (pathname === "/api/applications" && method === "GET") {
          const jobId = url.searchParams.get("jobId");
          const apps = Array.from(this.applications.values()).filter(
            (a) => !jobId || a.jobId === jobId
          );
          return json(200, { success: true, data: apps });
        }

        const acceptMatch = pathname.match(/^\/api\/applications\/([^\/]+)\/accept$/);
        if (acceptMatch && method === "POST") {
          const app = this.applications.get(acceptMatch[1]);
          if (app) {
            app.status = "accepted";
            const job = this.jobs.get(app.jobId);
            if (job) {
              job.status = "in_progress";
              job.freelancerAddress = app.freelancerAddress;
            }
            return json(200, { success: true, data: app });
          }
        }

        // ── /api/time-entries ─────────────────────────────────────────────────
        if (pathname === "/api/time-entries") {
          if (method === "GET") {
            const jobId = url.searchParams.get("jobId");
            const entries = this.timeEntries.filter((e) => !jobId || e.jobId === jobId);
            return json(200, { success: true, data: entries });
          }
          if (method === "POST") {
            const entry: MockTimeEntry = {
              id: `time-${Date.now()}`,
              jobId: body.jobId,
              durationMinutes: body.durationMinutes || 60,
              description: body.description || "",
              createdAt: new Date().toISOString(),
            };
            this.timeEntries.push(entry);
            return json(201, { success: true, data: entry });
          }
        }

        // ── /api/escrow/:jobId/release ─────────────────────────────────────────
        const releaseMatch = pathname.match(/^\/api\/escrow\/([^\/]+)\/release$/);
        if (releaseMatch && method === "POST") {
          const job = this.jobs.get(releaseMatch[1]);
          if (job) job.status = "completed";
          return json(200, { success: true, data: { success: true } });
        }

        // ── /api/ratings ───────────────────────────────────────────────────────
        if (pathname === "/api/ratings" && method === "POST") {
          const rating: MockRating = {
            id: `rating-${Date.now()}`,
            jobId: body.jobId,
            raterAddress: body.raterAddress || "client",
            ratedAddress: body.ratedAddress || "freelancer",
            stars: body.stars || 5,
            review: body.review,
            createdAt: new Date().toISOString(),
          };
          this.ratings.push(rating);
          return json(201, { success: true, data: rating });
        }

        // ── /api/jobs/:jobId/dispute ──────────────────────────────────────────
        const disputeMatch = pathname.match(/^\/api\/jobs\/([^\/]+)\/dispute$/);
        if (disputeMatch && method === "POST") {
          const job = this.jobs.get(disputeMatch[1]);
          if (job) job.status = "disputed";
          return json(200, { success: true, data: { success: true } });
        }

        // ── /api/admin/disputes/:jobId/resolve ────────────────────────────────
        const resolveMatch = pathname.match(/^\/api\/admin\/disputes\/([^\/]+)\/resolve$/);
        if (resolveMatch && method === "PATCH") {
          const job = this.jobs.get(resolveMatch[1]);
          if (job) job.status = "completed";
          return json(200, { success: true, data: { success: true } });
        }

        // ── /api/dao/arbitrators ──────────────────────────────────────────────
        if (pathname === "/api/dao/arbitrators" && method === "POST") {
          this.arbitrators.add("arbitrator");
          return json(201, { success: true, data: { success: true } });
        }

        // ── /api/faucet/status ────────────────────────────────────────────────
        if (pathname.includes("/faucet/status")) {
          return json(200, { success: true, data: { enabled: true } });
        }

        // ── Fallback ──────────────────────────────────────────────────────────
        return json(200, { success: true, data: [] });
      });

      this.server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          // A server is already running on this port; reuse it
          resolve();
        } else {
          reject(err);
        }
      });

      this.server.listen(port, "127.0.0.1", () => {
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export const sharedMockServer = new MockBackendServer();
