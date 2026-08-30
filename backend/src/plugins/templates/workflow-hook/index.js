/**
 * Example workflow-hook plugin.
 *
 * Fires on "job.created" (declared in plugin.json's workflowEvents), reads
 * the job back through the broker (requires the "read:jobs" permission),
 * and sends the job's client a notification for jobs above a size
 * threshold (requires "write:notifications"). Both calls go through
 * `marketpay.call(...)` — this file has no `require`, no network, no
 * filesystem access; see ../../sdk/index.d.ts for the full call surface
 * and docs/ADR-011-plugin-platform.md for why.
 *
 * `marketpay` is not a real Node global — it only exists inside the
 * sandboxed vm context this file is compiled and run in (see
 * ../../childEntry.js's `buildSandboxGlobal`). The directive below just
 * tells the linter that, since this file is never `require`'d directly.
 */
/* global marketpay */

globalThis.plugin = {
  async onEvent(payload, context) {
    if (context.hook !== "job.created") {
      return { skipped: true, reason: `unhandled hook ${context.hook}` };
    }

    const job = await marketpay.call("jobs.get", { jobId: payload.jobId });
    if (!job) {
      return { skipped: true, reason: "job not found" };
    }

    const LARGE_BUDGET_XLM = 1000;
    if (Number(job.budget) >= LARGE_BUDGET_XLM) {
      await marketpay.call("notifications.send", {
        recipientAddress: job.client_address,
        message: `Your job "${job.title}" was posted — large-budget jobs like this often attract offers within the first hour.`,
      });
      return { notified: true, jobId: job.id };
    }

    return { notified: false, jobId: job.id };
  },
};
