/**
 * Stellar MarketPay Plugin SDK — type definitions (Issue #322).
 *
 * This file documents the shape of `globalThis.plugin` and the
 * `marketpay` global your plugin's `index.js` runs with inside the
 * sandbox (see ../sandbox.js and ../childEntry.js for the runtime this
 * describes). It is a types-only reference for editor/IDE support — a
 * plugin does not `import` this file; the sandbox provides `marketpay` as
 * a real global at runtime, and you assign your handler to the global
 * `plugin` variable (no `module.exports`, no `require`; both are
 * intentionally absent inside the sandbox).
 *
 * Versioned alongside the plugin API itself: `manifest.apiVersion` states
 * which shape of this file (and the broker methods below) a plugin was
 * written against. Deprecating a method here means keeping the old
 * signature working for at least one full API version cycle — see
 * docs/ADR-011-plugin-platform.md, "Versioning and deprecation policy."
 */

/** The context passed as the second argument to every hook handler. */
interface PluginEventContext {
  /** Which extension point / workflow event triggered this call, e.g. "job.created". */
  hook: string;
}

/** The shape every plugin's index.js must assign to the global `plugin`. */
interface MarketPayPlugin {
  /**
   * Called for every event your manifest subscribed to (a `workflow_hook`'s
   * `workflowEvents`, a `scheduled_task`'s tick, or a `ui_panel`/
   * `data_provider` request). Must be an async function; whatever it
   * returns is JSON-serialized back to the platform (capped — see
   * sandbox.js's `MAX_RESULT_BYTES`).
   */
  onEvent(payload: unknown, context: PluginEventContext): Promise<unknown>;
}

/** Job fields returned by `marketpay.call("jobs.get", ...)`. Requires the
 *  `read:jobs` permission. */
interface JobSummary {
  id: string;
  title: string;
  category: string;
  budget: string;
  status: string;
  created_at: string;
}

interface ApplicationSummary {
  id: string;
  freelancer_address: string;
  bid_amount: string;
  status: string;
  created_at: string;
}

interface ProfileSummary {
  public_key: string;
  display_name: string | null;
  bio: string | null;
  rating: number | null;
  completed_jobs: number;
}

interface NetworkFetchResponse {
  status: number;
  body: string;
}

/**
 * The one bridge out of the sandbox. Every call is mediated by the broker
 * (../broker.js) against the specific permission scopes your installer
 * granted at install time — a call for a scope you were not granted
 * rejects with an error, it never silently no-ops.
 */
interface MarketPaySDK {
  call(method: "jobs.get", params: { jobId: string }): Promise<JobSummary | null>;
  call(method: "applications.listForJob", params: { jobId: string }): Promise<ApplicationSummary[]>;
  call(method: "profile.get", params: { publicKey: string }): Promise<ProfileSummary | null>;
  call(
    method: "notifications.send",
    params: { recipientAddress: string; message: string }
  ): Promise<{ sent: true }>;
  /** Requires a `network:<host>` permission matching `url`'s hostname exactly.
   *  Only `https://` URLs are allowed; responses are capped at 512KB. */
  call(
    method: "network.fetch",
    params: { url: string; method?: "GET" | "POST"; body?: unknown }
  ): Promise<NetworkFetchResponse>;
}

declare global {
  // eslint-disable-next-line no-var
  var plugin: MarketPayPlugin;
  // eslint-disable-next-line no-var
  var marketpay: MarketPaySDK;
}

export type {
  MarketPayPlugin,
  MarketPaySDK,
  PluginEventContext,
  JobSummary,
  ApplicationSummary,
  ProfileSummary,
};
