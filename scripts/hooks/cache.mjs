import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CACHE_SCHEMA } from "./config.mjs";
import { gitDir } from "./git.mjs";

export function sha256(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
    hash.update(String(value.length));
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function engineHash(root) {
  const directory = path.join(root, "scripts", "hooks");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".mjs"))
    .sort();
  return sha256(files.flatMap((file) => [file, readFileSync(path.join(directory, file))]));
}

export function cacheKey({ root, step, command, toolVersion, inputSignature }) {
  const engineControls = new Set([
    "MARKETPAY_HOOK_BASE",
    "MARKETPAY_HOOK_CACHE",
    "MARKETPAY_HOOK_ENFORCE_BUDGET",
    "MARKETPAY_HOOK_TEST_DELAY_MS",
    "MARKETPAY_HOOK_TIMINGS",
  ]);
  const environment = Object.entries(process.env)
    .filter(([name]) => !engineControls.has(name))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`);
  return sha256([
    CACHE_SCHEMA,
    engineHash(root),
    step,
    command,
    toolVersion,
    inputSignature,
    sha256(environment),
  ]);
}

export class ResultCache {
  constructor(root) {
    this.directory = path.join(gitDir(root), "marketpay-hooks");
    this.file = path.join(this.directory, "cache-v1.json");
    mkdirSync(this.directory, { recursive: true });
    try {
      this.data = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      this.data = { schema: CACHE_SCHEMA, entries: {} };
    }
    if (this.data.schema !== CACHE_SCHEMA) this.data = { schema: CACHE_SCHEMA, entries: {} };
  }

  has(step, key) {
    return this.data.entries[step]?.key === key;
  }

  put(step, key) {
    this.data.entries[step] = { key, savedAt: new Date().toISOString() };
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(temp, this.file);
  }
}

export function timingFile(root) {
  const directory = path.join(gitDir(root), "marketpay-hooks");
  mkdirSync(directory, { recursive: true });
  return path.join(directory, "timings.jsonl");
}

export function appendTiming(root, report) {
  if (process.env.MARKETPAY_HOOK_TIMINGS === "0") return;
  appendFileSync(timingFile(root), `${JSON.stringify(report)}\n`);
}

export function readTimings(root, limit = 10) {
  try {
    const lines = readFileSync(timingFile(root), "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
