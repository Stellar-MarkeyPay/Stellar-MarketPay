#!/usr/bin/env node
/**
 * src/plugins/cli.js
 *
 * Local plugin development harness (Issue #322: "provide a testing harness
 * so a plugin can be tested without a live marketplace"). Loads a plugin
 * directory's manifest + source, validates and security-scans it exactly
 * as submission would, then runs it in the real sandbox — same
 * `sandbox.js`, same `childEntry.js`, same resource limits — against
 * either fixture data (default; no network, no database) or `--live`,
 * which requires a `DATABASE_URL` and calls the real broker/database, for
 * testing against real data before submitting.
 *
 * Usage (from backend/):
 *   node src/plugins/cli.js run <plugin-dir> --hook <name> --payload '<json>' [--live]
 *   node src/plugins/cli.js scan <plugin-dir>
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateManifest } = require("./manifest");
const { scanSource } = require("./securityScan");
const { runPlugin } = require("./sandbox");

/** Fixture responses for offline (`--live` not passed) local testing —
 *  edit these to exercise your plugin's logic against representative data
 *  without needing a database. */
const FIXTURES = {
  "jobs.get": ({ jobId }) => ({
    id: jobId || "fixture-job-1",
    title: "Build a Soroban escrow dashboard",
    category: "Smart Contracts",
    budget: "1500.0000000",
    status: "open",
    client_address: "GFIXTURECLIENT1234567890123456789012345678901234567890",
    created_at: new Date().toISOString(),
  }),
  "applications.listForJob": () => [
    {
      id: "fixture-app-1",
      freelancer_address: "GFIXTUREFREELANCER1",
      bid_amount: "1400.0000000",
      status: "pending",
      created_at: new Date().toISOString(),
    },
  ],
  "profile.get": ({ publicKey }) => ({
    public_key: publicKey || "GFIXTUREUSER1",
    display_name: "Fixture User",
    bio: "A stubbed profile for local plugin testing.",
    rating: 4.8,
    completed_jobs: 12,
  }),
  "notifications.send": (params) => {
    console.log(
      `  [fixture] would send notification to ${params.recipientAddress}: "${params.message}"`
    );
    return { sent: true };
  },
  "network.fetch": () => {
    throw new Error(
      "network.fetch is not stubbed offline — rerun with --live and a granted network:<host> permission"
    );
  },
};

function loadPluginDir(dir) {
  const manifestPath = path.join(dir, "plugin.json");
  const sourcePath = path.join(dir, "index.js");
  if (!fs.existsSync(manifestPath)) throw new Error(`missing plugin.json in ${dir}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`missing index.js in ${dir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const source = fs.readFileSync(sourcePath, "utf8");
  return { manifest, source };
}

function validateAndScan(manifest, source) {
  const { valid, errors } = validateManifest(manifest);
  if (!valid) {
    console.error("Manifest validation failed:");
    for (const err of errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  const scan = scanSource(source);
  if (!scan.passed) {
    console.error("Security scan failed:");
    for (const finding of scan.findings) {
      console.error(
        `  - [${finding.kind}]${finding.line ? ` line ${finding.line}:` : ""} ${finding.message}`
      );
    }
    process.exit(1);
  }
  console.log(`Manifest OK. Security scan passed (${manifest.id}@${manifest.version}).`);
  return { manifest, scan };
}

async function runOffline(source, hookName, payload) {
  return runPlugin({
    source,
    hookName,
    payload,
    pluginId: "local-dev",
    onBrokerCall: async (method, params) => {
      const fixture = FIXTURES[method];
      if (!fixture) throw new Error(`unrecognized method "${method}" (add a fixture in cli.js)`);
      console.log(`  [broker] ${method}(${JSON.stringify(params)})`);
      return fixture(params);
    },
  });
}

async function runLive(source, hookName, payload) {
  if (!process.env.DATABASE_URL) {
    throw new Error("--live requires DATABASE_URL to be set");
  }
  const { createBroker } = require("./broker");
  const broker = createBroker({
    pluginId: "local-dev",
    pluginName: "Local Dev",
    grantedScopes: ["read:jobs", "read:applications", "read:profile", "write:notifications"],
  });
  return runPlugin({
    source,
    hookName,
    payload,
    pluginId: "local-dev",
    onBrokerCall: (method, params) => broker(method, params),
  });
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--hook") args.hook = argv[++i];
    else if (arg === "--payload") args.payload = argv[++i];
    else if (arg === "--live") args.live = true;
    else args._.push(arg);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, dir] = args._;

  if (!command || !dir) {
    console.error(
      "Usage: node src/plugins/cli.js <run|scan> <plugin-dir> [--hook name] [--payload json] [--live]"
    );
    process.exit(1);
  }

  const { manifest, source } = loadPluginDir(path.resolve(dir));
  validateAndScan(manifest, source);

  if (command === "scan") return; // validation/scan output above is the whole point

  if (command === "run") {
    const hookName = args.hook || "manual.test";
    const payload = args.payload ? JSON.parse(args.payload) : {};
    console.log(
      `Running "${manifest.id}" for hook "${hookName}" (${args.live ? "live" : "offline/fixtures"})...`
    );
    const result = args.live
      ? await runLive(source, hookName, payload)
      : await runOffline(source, hookName, payload);
    console.log("Result:", JSON.stringify(result, null, 2));
    return;
  }

  console.error(`Unknown command "${command}"`);
  process.exit(1);
}

main().catch((err) => {
  console.error("Plugin run failed:", err.message);
  process.exit(1);
});
