"use strict";

/**
 * src/services/retainerService.test.js
 *
 * Hermetic against Postgres, following this repo's pgMock.js convention
 * (src/testUtils/pgMock.js) — but generalized into a small SQL-shape
 * interpreter rather than one branch per literal query string, because
 * retainerService's billing logic runs many interdependent, stateful
 * queries per call and pinning every one to a hand-copied literal string
 * would be both enormous and brittle against harmless rewording. Every
 * write in the service follows two shapes — `INSERT INTO t (...) VALUES
 * (...)` and `UPDATE t SET ... WHERE id = $1` — and reads are either
 * `SELECT * FROM t WHERE id = $1` or `SELECT ... FROM t WHERE <clause>`
 * with a small, fixed clause grammar. The interpreter below covers
 * exactly those shapes; anything it can't parse throws loudly rather
 * than silently returning `{ rows: [] }`, so a query this suite doesn't
 * expect fails fast instead of masquerading as "not found".
 */

const { randomUUID } = require("crypto");

// ─── Fake pool ──────────────────────────────────────────────────────────────

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function normalize(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractParenGroup(str, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth--;
      if (depth === 0) return { content: str.slice(openIdx + 1, i), end: i + 1 };
    }
  }
  throw new Error("retainerService fake pool: unbalanced parens in: " + str);
}

function evalValueExpr(expr, params) {
  expr = expr.trim();
  if (/^NOW\(\)$/i.test(expr)) return new Date().toISOString();
  if (expr === "NULL") return null;
  let m = expr.match(/^\$(\d+)(::\w+(\[\])?)?$/);
  if (m) {
    let v = params[Number(m[1]) - 1];
    if (m[2] && m[2].includes("jsonb") && typeof v === "string") v = JSON.parse(v);
    return v;
  }
  m = expr.match(/^'([^']*)'$/);
  if (m) return m[1];
  m = expr.match(/^-?\d+(\.\d+)?$/);
  if (m) return Number(expr);
  throw new Error("retainerService fake pool: unhandled INSERT value expr: " + expr);
}

// Postgres NUMERIC columns always come back from node-pg as fixed-scale
// strings (this codebase registers no custom type parser — see
// src/db/pool.js — matching how escrowService/timeTrackingService pass
// money fields straight through). Arithmetic on a NUMERIC(20,7) `_xlm`
// column therefore also comes back as a 7-decimal string in production;
// replicate that here so tests asserting on release amounts, balances
// etc. see the same shape the real driver would produce.
function formatNumericColumn(col, value) {
  if (/_xlm$/.test(col)) return Number(value).toFixed(7);
  return round(value);
}

function evalSetExpr(col, expr, params, row) {
  expr = expr.trim();
  if (/^NOW\(\)$/i.test(expr)) return new Date().toISOString();
  if (expr === "NULL") return null;
  let m = expr.match(/^\$(\d+)$/);
  if (m) return params[Number(m[1]) - 1];
  m = expr.match(/^'([^']*)'$/);
  if (m) return m[1];
  m = expr.match(/^-?\d+(\.\d+)?$/);
  if (m) return Number(expr);
  m = expr.match(/^COALESCE\(\$(\d+),\s*(\w+)\)$/i);
  if (m) {
    const v = params[Number(m[1]) - 1];
    return v != null ? v : row[m[2]];
  }
  m = expr.match(/^(\w+)\s*([+-])\s*\$(\d+)$/);
  if (m) {
    const cur = Number(row[m[1]]) || 0;
    const delta = Number(params[Number(m[3]) - 1]) || 0;
    return formatNumericColumn(col, m[2] === "+" ? cur + delta : cur - delta);
  }
  m = expr.match(/^GREATEST\(0,\s*(\w+)\s*-\s*\$(\d+)\)$/i);
  if (m) {
    const cur = Number(row[m[1]]) || 0;
    const delta = Number(params[Number(m[2]) - 1]) || 0;
    return formatNumericColumn(col, Math.max(0, cur - delta));
  }
  throw new Error("retainerService fake pool: unhandled SET value expr: " + expr);
}

function evalAtom(atom, params, row) {
  atom = atom.trim();
  let m = atom.match(/^(\w+)\s*=\s*\$(\d+)$/);
  if (m) return row[m[1]] === params[Number(m[2]) - 1];
  m = atom.match(/^(\w+)\s*=\s*'([^']*)'$/);
  if (m) return row[m[1]] === m[2];
  m = atom.match(/^(\w+)\s+IN\s*\(([^)]+)\)$/i);
  if (m) {
    const vals = m[2].split(",").map((s) => s.trim().replace(/^'(.*)'$/, "$1"));
    return vals.includes(row[m[1]]);
  }
  m = atom.match(/^(\w+)\s*<=\s*\$(\d+)$/);
  if (m) return new Date(row[m[1]]).getTime() <= new Date(params[Number(m[2]) - 1]).getTime();
  m = atom.match(/^(\w+)\s*>\s*\$(\d+)$/);
  if (m) return new Date(row[m[1]]).getTime() > new Date(params[Number(m[2]) - 1]).getTime();
  m = atom.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i);
  if (m) return row[m[1]] != null;
  m = atom.match(/^(\w+)\s+IS\s+NULL$/i);
  if (m) return row[m[1]] == null;
  throw new Error("retainerService fake pool: unhandled WHERE atom: " + atom);
}

function splitTopLevelAnd(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && str.slice(i, i + 5).toUpperCase() === " AND ") {
      parts.push(str.slice(start, i).trim());
      i += 5;
      start = i;
      continue;
    }
    i++;
  }
  parts.push(str.slice(start).trim());
  return parts;
}

function evalClause(clause, params, row) {
  return splitTopLevelAnd(clause).every((part) => {
    part = part.trim();
    if (part.startsWith("(") && part.endsWith(")")) {
      return part
        .slice(1, -1)
        .split(/ OR /i)
        .some((p) => evalAtom(p, params, row));
    }
    return evalAtom(part, params, row);
  });
}

function createFakePool() {
  const tableNames = [
    "retainer_proposals",
    "retainers",
    "retainer_periods",
    "retainer_amendments",
    "retainer_funding_events",
    "retainer_statements",
    "time_entries",
  ];
  const tables = Object.fromEntries(tableNames.map((t) => [t, new Map()]));

  function insert(text, params) {
    const tableMatch = text.match(/^INSERT INTO (\w+)\s*/i);
    const table = tableMatch[1];
    const afterKeyword = tableMatch[0].length;

    const colsOpen = text.indexOf("(", afterKeyword);
    const { content: colsStr, end: afterCols } = extractParenGroup(text, colsOpen);
    const cols = splitTopLevel(colsStr);

    const valuesIdx = text.indexOf("VALUES", afterCols);
    const valsOpen = text.indexOf("(", valuesIdx);
    const { content: valsStr } = extractParenGroup(text, valsOpen);
    const valExprs = splitTopLevel(valsStr);

    const row = {};
    cols.forEach((col, i) => {
      const value = evalValueExpr(valExprs[i], params);
      // See formatNumericColumn's comment: a NUMERIC(20,7) `_xlm` column
      // always reads back as a fixed 7-decimal string in production,
      // including for a plain literal like the `0` this codebase inserts
      // for a fresh retainer's balance_xlm.
      row[col] = /_xlm$/.test(col) && value != null ? Number(value).toFixed(7) : value;
    });
    if (!row.id) row.id = randomUUID();
    tables[table].set(row.id, row);
    return row;
  }

  function update(text, params) {
    const m = text.match(/^UPDATE (\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+id\s*=\s*\$(\d+)([\s\S]*)$/i);
    if (!m) throw new Error("retainerService fake pool: unhandled UPDATE: " + text);
    const [, table, setClause, idParamIdx, rest] = m;
    const id = params[Number(idParamIdx) - 1];
    const row = tables[table].get(id);
    if (!row) return { rows: [], rowCount: 0 };

    const guard = rest.match(/AND\s+(\w+)\s+IS\s+NULL/i);
    if (guard && row[guard[1]] != null) return { rows: [], rowCount: 0 };

    for (const assignment of splitTopLevel(setClause)) {
      const eqIdx = assignment.indexOf("=");
      const col = assignment.slice(0, eqIdx).trim();
      const expr = assignment.slice(eqIdx + 1).trim();
      row[col] = evalSetExpr(col, expr, params, row);
    }
    return { rows: [row], rowCount: 1 };
  }

  function selectGeneric(text, params) {
    const m = text.match(
      /^SELECT (\*|id) FROM (\w+) WHERE ([\s\S]+?)(?: ORDER BY (\w+) (ASC|DESC))?(?: LIMIT (\d+))?$/i
    );
    if (!m) return null;
    const [, proj, table, whereClause, orderField, orderDir, limitStr] = m;
    let rows = [...tables[table].values()].filter((row) => evalClause(whereClause, params, row));
    if (orderField) {
      rows = rows.slice().sort((a, b) => {
        const av = a[orderField];
        const bv = b[orderField];
        const cmp = av === bv ? 0 : av > bv ? 1 : -1;
        return orderDir && orderDir.toUpperCase() === "DESC" ? -cmp : cmp;
      });
    }
    if (limitStr) rows = rows.slice(0, Number(limitStr));
    if (proj === "id") rows = rows.map((r) => ({ id: r.id }));
    return { rows };
  }

  async function query(sql, params = []) {
    const text = normalize(sql);

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
    if (/^INSERT INTO/i.test(text)) return { rows: [insert(text, params)] };
    if (/^UPDATE/i.test(text)) return update(text, params);

    const idSel = text.match(/^SELECT \* FROM (\w+) WHERE id = \$1(\s+FOR UPDATE)?$/i);
    if (idSel) {
      const row = tables[idSel[1]].get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("SELECT p.*, r.client_address")) {
      const [now, lookahead] = params;
      const rows = [...tables.retainer_periods.values()]
        .filter(
          (p) =>
            p.status === "open" &&
            new Date(p.period_end).getTime() > new Date(now).getTime() &&
            new Date(p.period_end).getTime() <= new Date(lookahead).getTime() &&
            (p.upcoming_notice_sent_at == null || p.underfunding_warned_at == null)
        )
        .map((p) => {
          const r = tables.retainers.get(p.retainer_id);
          return {
            ...p,
            client_address: r.client_address,
            freelancer_address: r.freelancer_address,
            title: r.title,
            balance_xlm: r.balance_xlm,
            retainer_status: r.status,
          };
        });
      return { rows };
    }

    if (text.startsWith("SELECT to_char(date_trunc('month'")) {
      const [freelancerAddress, since] = params;
      const matches = [...tables.retainer_statements.values()].filter(
        (s) =>
          s.freelancer_address === freelancerAddress &&
          new Date(s.created_at).getTime() >= new Date(since).getTime()
      );
      const byMonth = new Map();
      for (const s of matches) {
        const month = new Date(s.created_at).toISOString().slice(0, 7);
        const cur = byMonth.get(month) || { month, released_xlm: 0, statement_count: 0 };
        cur.released_xlm = round(Number(cur.released_xlm) + Number(s.amount_released_xlm));
        cur.statement_count += 1;
        byMonth.set(month, cur);
      }
      return { rows: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)) };
    }

    const generic = selectGeneric(text, params);
    if (generic) return generic;

    throw new Error("retainerService fake pool: unhandled query: " + text);
  }

  const connect = jest.fn(async () => ({
    query,
    release: jest.fn(),
  }));

  return { query: jest.fn(query), connect, tables };
}

// ─── Test setup ─────────────────────────────────────────────────────────────

const mockPool = createFakePool();
jest.mock("../db/pool", () => ({
  query: (...args) => mockPool.query(...args),
  connect: (...args) => mockPool.connect(...args),
}));

const mockNotify = jest.fn().mockResolvedValue(null);
jest.mock("./notificationService", () => ({
  createInAppNotification: (...args) => mockNotify(...args),
}));

const retainerService = require("./retainerService");

const CLIENT = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const FREELANCER = "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

beforeEach(() => {
  for (const table of Object.values(mockPool.tables)) table.clear();
  mockNotify.mockClear();
});

function daysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Fast-path fixture: skip the proposal flow, create an active retainer + open period directly. */
async function seedRetainer(overrides = {}) {
  const proposal = await retainerService.createProposal({
    proposerAddress: CLIENT,
    counterpartyAddress: FREELANCER,
    proposerRole: "client",
    title: "Ongoing maintenance retainer",
    periodType: "monthly",
    billingModel: "fixed",
    amountXlm: 1000,
    noticePeriodDays: 14,
    ...overrides,
  });
  const { retainer, firstPeriod } = await retainerService.respondToProposal({
    proposalId: proposal.id,
    responderAddress: FREELANCER,
    decision: "accepted",
  });
  return { retainer, period: firstPeriod };
}

async function expirePeriod(periodId) {
  const row = mockPool.tables.retainer_periods.get(periodId);
  row.period_start = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  row.period_end = new Date(Date.now() - 1000).toISOString();
}

// ─── Proposals ──────────────────────────────────────────────────────────────

describe("retainer proposals", () => {
  it("creates a pending proposal and notifies the counterparty", async () => {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Monthly retainer",
      periodType: "monthly",
      billingModel: "fixed",
      amountXlm: 500,
    });

    expect(proposal.status).toBe("pending");
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: FREELANCER, type: "retainer_proposal_received" })
    );
  });

  it("rejects a capped_hourly proposal missing hourlyRateXlm/capHours", async () => {
    await expect(
      retainerService.createProposal({
        proposerAddress: CLIENT,
        counterpartyAddress: FREELANCER,
        proposerRole: "client",
        title: "Capped retainer",
        periodType: "monthly",
        billingModel: "capped_hourly",
        amountXlm: 500,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("acceptance atomically creates the retainer and its first open period", async () => {
    const { retainer, period } = await seedRetainer();

    expect(retainer.status).toBe("active");
    expect(retainer.clientAddress).toBe(CLIENT);
    expect(retainer.freelancerAddress).toBe(FREELANCER);
    expect(retainer.balanceXlm).toBe("0.0000000");
    expect(period.periodIndex).toBe(0);
    expect(period.status).toBe("open");
    expect(period.amountXlm).toBe("1000.0000000");
  });

  it("only the counterparty can respond to a proposal", async () => {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Monthly retainer",
      periodType: "monthly",
      billingModel: "fixed",
      amountXlm: 500,
    });

    await expect(
      retainerService.respondToProposal({
        proposalId: proposal.id,
        responderAddress: CLIENT,
        decision: "accepted",
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("declining leaves no retainer behind", async () => {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Monthly retainer",
      periodType: "monthly",
      billingModel: "fixed",
      amountXlm: 500,
    });

    const { proposal: decided, retainer } = await retainerService.respondToProposal({
      proposalId: proposal.id,
      responderAddress: FREELANCER,
      decision: "declined",
      declineReason: "Rate too low",
    });

    expect(decided.status).toBe("declined");
    expect(retainer).toBeNull();
  });
});

// ─── Funding and underfunding ──────────────────────────────────────────────

describe("funding and underfunding", () => {
  it("fundRetainer increases the balance and only the client may fund it", async () => {
    const { retainer } = await seedRetainer();

    await expect(
      retainerService.fundRetainer({
        retainerId: retainer.id,
        clientAddress: FREELANCER,
        amountXlm: 100,
      })
    ).rejects.toMatchObject({ status: 403 });

    const funded = await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });
    expect(funded.balanceXlm).toBe("1000.0000000");
  });

  it("releases in full when the balance covers the period and opens the next period", async () => {
    const { retainer, period } = await seedRetainer();
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });
    await expirePeriod(period.id);

    const statement = await retainerService.releasePeriod(period.id);

    expect(statement.status).toBe("issued");
    expect(statement.amountReleasedXlm).toBe("1000.0000000");
    expect(statement.shortfallXlm).toBe("0.0000000");

    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods).toHaveLength(2);
    expect(periods[0].status).toBe("released");
    expect(periods[1].status).toBe("open");
    expect(periods[1].periodIndex).toBe(1);

    const updatedRetainer = await retainerService.getRetainer(retainer.id);
    expect(updatedRetainer.balanceXlm).toBe("0.0000000");
  });

  it("degrades predictably on underfunding: partial release, recorded shortfall, retainer stays active", async () => {
    const { retainer, period } = await seedRetainer();
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 400,
    });
    await expirePeriod(period.id);

    const statement = await retainerService.releasePeriod(period.id);

    expect(statement.status).toBe("underfunded");
    expect(statement.amountReleasedXlm).toBe("400.0000000");
    expect(statement.shortfallXlm).toBe("600.0000000");

    const updatedRetainer = await retainerService.getRetainer(retainer.id);
    expect(updatedRetainer.status).toBe("active"); // degraded, not failed silently or killed
    expect(updatedRetainer.balanceXlm).toBe("0.0000000");

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "retainer_period_underfunded" })
    );
  });

  it("warns of projected underfunding before the release happens", async () => {
    const { period } = await seedRetainer();
    // Balance stays at 0 — nothing funded. Move the period to end in 2 days
    // (inside the 3-day lookahead) without expiring it yet.
    const row = mockPool.tables.retainer_periods.get(period.id);
    row.period_end = daysFromNow(2).toISOString();

    const { notified, warned } = await retainerService.notifyUpcomingPeriods();

    expect(notified).toBe(1);
    expect(warned).toBe(1);
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: CLIENT, type: "retainer_underfunding_warning" })
    );
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: FREELANCER, type: "retainer_upcoming_charge" })
    );

    // Idempotent: running again does not re-notify the same period.
    mockNotify.mockClear();
    const second = await retainerService.notifyUpcomingPeriods();
    expect(second).toEqual({ notified: 0, warned: 0 });
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ─── Capped-hourly billing, rollover and forfeiture ────────────────────────

describe("capped-hourly billing", () => {
  async function seedCapped() {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Capped support retainer",
      periodType: "monthly",
      billingModel: "capped_hourly",
      amountXlm: 1, // unused for capped_hourly billing
      hourlyRateXlm: 20,
      capHours: 10,
      rolloverPolicy: "rollover",
    });
    const { retainer, firstPeriod } = await retainerService.respondToProposal({
      proposalId: proposal.id,
      responderAddress: FREELANCER,
      decision: "accepted",
    });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });
    return { retainer, period: firstPeriod };
  }

  it("bills only approved hours up to the cap", async () => {
    const { retainer, period } = await seedCapped();

    const entry = await retainerService.logRetainerTime({
      retainerId: retainer.id,
      freelancerAddress: FREELANCER,
      durationMinutes: 360, // 6h
    });
    await retainerService.approveRetainerTimeEntry({
      entryId: entry.id,
      clientAddress: CLIENT,
      decision: "approved",
    });

    await expirePeriod(period.id);
    const statement = await retainerService.releasePeriod(period.id);

    expect(statement.approvedHours).toBe(6);
    expect(statement.amountDueXlm).toBe("120.0000000"); // 6h * 20 XLM
    expect(statement.rolloverHours).toBe(4); // 10 cap - 6 approved, rollover policy
    expect(statement.forfeitedHours).toBe(0);
  });

  it("forfeits unused capacity under a forfeit policy, and rolls it over under a rollover policy", async () => {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Capped support (forfeit)",
      periodType: "monthly",
      billingModel: "capped_hourly",
      amountXlm: 1,
      hourlyRateXlm: 20,
      capHours: 10,
      rolloverPolicy: "forfeit",
    });
    const { retainer, firstPeriod } = await retainerService.respondToProposal({
      proposalId: proposal.id,
      responderAddress: FREELANCER,
      decision: "accepted",
    });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });

    await expirePeriod(firstPeriod.id);
    const statement = await retainerService.releasePeriod(firstPeriod.id);

    expect(statement.forfeitedHours).toBe(10); // nothing approved, nothing rolled
    expect(statement.rolloverHours).toBe(0);

    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods[1].capHours).toBe(10);
    expect(periods[1].rolloverHoursIn).toBe(0); // forfeited, not carried
  });

  it("caps the amount due even when logged hours exceed the cap", async () => {
    const { retainer, period } = await seedCapped();

    const entry = await retainerService.logRetainerTime({
      retainerId: retainer.id,
      freelancerAddress: FREELANCER,
      durationMinutes: 900, // 15h — over the 10h cap
    });
    await retainerService.approveRetainerTimeEntry({
      entryId: entry.id,
      clientAddress: CLIENT,
      decision: "approved",
    });

    await expirePeriod(period.id);
    const statement = await retainerService.releasePeriod(period.id);

    expect(statement.approvedHours).toBe(15);
    expect(statement.amountDueXlm).toBe("200.0000000"); // capped at 10h * 20 XLM
    expect(statement.forfeitedHours).toBe(0);
    expect(statement.rolloverHours).toBe(0);
  });
});

// ─── Time approval and disputes ─────────────────────────────────────────────

describe("time entry approval and disputes", () => {
  it("a disputed entry does not block the rest of the period's approved hours from releasing", async () => {
    const { retainer, period } = await seedRetainer();
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });

    const entryA = await retainerService.logRetainerTime({
      retainerId: retainer.id,
      freelancerAddress: FREELANCER,
      durationMinutes: 120,
    });
    await retainerService.approveRetainerTimeEntry({
      entryId: entryA.id,
      clientAddress: CLIENT,
      decision: "approved",
    });

    const entryB = await retainerService.logRetainerTime({
      retainerId: retainer.id,
      freelancerAddress: FREELANCER,
      durationMinutes: 60,
    });
    const disputed = await retainerService.disputeRetainerTimeEntry({
      entryId: entryB.id,
      disputedBy: CLIENT,
      reason: "Not sure this work happened",
    });
    expect(disputed.approvalStatus).toBe("disputed");

    // Fixed-model retainer: the dispute doesn't change what's billed (it's
    // not hour-gated), but the period must still release on schedule.
    await expirePeriod(period.id);
    const statement = await retainerService.releasePeriod(period.id);
    expect(statement.status).toBe("issued");
    expect(statement.disputedHours).toBe(1);
  });

  it("removes hours from approved_hours when disputing an already-approved capped-hourly entry", async () => {
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Capped retainer",
      periodType: "monthly",
      billingModel: "capped_hourly",
      amountXlm: 1,
      hourlyRateXlm: 20,
      capHours: 10,
    });
    const { retainer } = await retainerService.respondToProposal({
      proposalId: proposal.id,
      responderAddress: FREELANCER,
      decision: "accepted",
    });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });

    const entry = await retainerService.logRetainerTime({
      retainerId: retainer.id,
      freelancerAddress: FREELANCER,
      durationMinutes: 300, // 5h
    });
    await retainerService.approveRetainerTimeEntry({
      entryId: entry.id,
      clientAddress: CLIENT,
      decision: "approved",
    });

    let periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods[0].approvedHours).toBe(5);

    await retainerService.disputeRetainerTimeEntry({
      entryId: entry.id,
      disputedBy: CLIENT,
      reason: "Scope unclear",
    });

    periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods[0].approvedHours).toBe(0);
    expect(periods[0].disputedHours).toBe(5);

    const resolved = await retainerService.resolveRetainerTimeEntryDispute({
      entryId: entry.id,
      resolvedBy: FREELANCER,
      decision: "approved",
    });
    expect(resolved.approvalStatus).toBe("approved");

    periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods[0].approvedHours).toBe(5);
    expect(periods[0].disputedHours).toBe(0);
  });

  it("only the retainer's freelancer can log time, and only against an active retainer", async () => {
    const { retainer } = await seedRetainer();

    await expect(
      retainerService.logRetainerTime({
        retainerId: retainer.id,
        freelancerAddress: CLIENT,
        durationMinutes: 60,
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

// ─── Amendments: price change, terms, pause/resume — with consent ─────────

describe("amendments require the counterparty's explicit acceptance", () => {
  it("a price change only takes effect after acceptance, and only for the next period", async () => {
    const { retainer, period } = await seedRetainer();

    const amendment = await retainerService.proposeAmendment({
      retainerId: retainer.id,
      proposedBy: CLIENT,
      type: "price_change",
      payload: { amountXlm: 1500 },
    });
    expect(amendment.status).toBe("pending");

    // Not yet applied.
    let current = await retainerService.getRetainer(retainer.id);
    expect(current.amountXlm).toBe("1000.0000000");

    // The proposer cannot accept their own amendment.
    await expect(
      retainerService.respondToAmendment({
        amendmentId: amendment.id,
        responderAddress: CLIENT,
        decision: "accepted",
      })
    ).rejects.toMatchObject({ status: 403 });

    const { retainer: updated } = await retainerService.respondToAmendment({
      amendmentId: amendment.id,
      responderAddress: FREELANCER,
      decision: "accepted",
    });
    expect(updated.amountXlm).toBe("1500.0000000");

    // The already-open period keeps its original, snapshotted amount.
    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods.find((p) => p.id === period.id).amountXlm).toBe("1000.0000000");
  });

  it("only one amendment may be pending at a time", async () => {
    const { retainer } = await seedRetainer();
    await retainerService.proposeAmendment({
      retainerId: retainer.id,
      proposedBy: CLIENT,
      type: "price_change",
      payload: { amountXlm: 1500 },
    });

    await expect(
      retainerService.proposeAmendment({
        retainerId: retainer.id,
        proposedBy: FREELANCER,
        type: "terms_change",
        payload: { autoRenew: false },
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("pause holds the release rather than skipping it silently, and resume restores normal billing", async () => {
    const { retainer, period } = await seedRetainer();
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });

    const pauseAmendment = await retainerService.proposeAmendment({
      retainerId: retainer.id,
      proposedBy: FREELANCER,
      type: "pause",
    });
    await retainerService.respondToAmendment({
      amendmentId: pauseAmendment.id,
      responderAddress: CLIENT,
      decision: "accepted",
    });

    let current = await retainerService.getRetainer(retainer.id);
    expect(current.status).toBe("paused");

    await expirePeriod(period.id);
    const outcome = await retainerService.releasePeriod(period.id);
    expect(outcome).toBeNull(); // held, not released

    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods[0].status).toBe("held_paused");

    current = await retainerService.getRetainer(retainer.id);
    expect(current.balanceXlm).toBe("1000.0000000"); // untouched
  });

  it("rejects the pending amendment without applying it", async () => {
    const { retainer } = await seedRetainer();
    const amendment = await retainerService.proposeAmendment({
      retainerId: retainer.id,
      proposedBy: CLIENT,
      type: "price_change",
      payload: { amountXlm: 1500 },
    });

    const { amendment: decided, retainer: updated } = await retainerService.respondToAmendment({
      amendmentId: amendment.id,
      responderAddress: FREELANCER,
      decision: "rejected",
    });

    expect(decided.status).toBe("rejected");
    expect(updated.amountXlm).toBe("1000.0000000");
    expect(updated.pendingAmendmentId).toBeNull();
  });
});

// ─── Cancellation with notice and pro-rata settlement ──────────────────────

describe("cancellation", () => {
  it("requesting cancellation starts the notice period rather than cancelling immediately", async () => {
    const { retainer } = await seedRetainer({ noticePeriodDays: 14 });

    const { retainer: updated, settlementPreview } = await retainerService.requestCancellation({
      retainerId: retainer.id,
      requestedBy: CLIENT,
      reason: "Project ending",
    });

    expect(updated.status).toBe("pending_cancellation");
    expect(new Date(updated.cancelEffectiveAt).getTime()).toBeGreaterThan(Date.now());
    expect(settlementPreview.periodId).toBe(
      (await retainerService.listPeriodsForRetainer(retainer.id))[0].id
    );
  });

  it("settles the current period pro-rata on finalization and marks the retainer cancelled", async () => {
    const { retainer, period } = await seedRetainer({ amountXlm: 3100, noticePeriodDays: 0 });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 10000,
    });

    // Backdate the period to a clean 31-day window starting 10 days ago, so
    // "10 of 31 days elapsed" gives an exact, easy-to-assert fraction.
    const row = mockPool.tables.retainer_periods.get(period.id);
    const start = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000);
    row.period_start = start.toISOString();
    row.period_end = end.toISOString();

    await retainerService.requestCancellation({ retainerId: retainer.id, requestedBy: CLIENT });
    // notice_period_days = 0, so cancel_effective_at ≈ now ≈ 10 days into the period.

    const outcome = await retainerService.finalizeCancellation(retainer.id);

    expect(outcome.retainer.status).toBe("cancelled");
    expect(outcome.statement.status).toBe("settled_prorata");
    // ~10/31 of 3100 XLM ≈ 1000 XLM — allow a small tolerance for wall-clock drift.
    expect(Number(outcome.statement.amountDueXlm)).toBeGreaterThan(950);
    expect(Number(outcome.statement.amountDueXlm)).toBeLessThan(1050);

    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods).toHaveLength(1); // no next period opened after cancellation
    expect(periods[0].status).toBe("settled_prorata");
  });

  it("finalizeCancellation is a safe no-op if the retainer is not pending cancellation", async () => {
    const { retainer } = await seedRetainer();
    const outcome = await retainerService.finalizeCancellation(retainer.id);
    expect(outcome).toBeNull();
  });
});

// ─── Auto-renewal ───────────────────────────────────────────────────────────

describe("renewal", () => {
  it("auto_renew=false ends the retainer at the natural period boundary with no further notice", async () => {
    const { retainer, period } = await seedRetainer({ autoRenew: false });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });
    await expirePeriod(period.id);

    await retainerService.releasePeriod(period.id);

    const updated = await retainerService.getRetainer(retainer.id);
    expect(updated.status).toBe("cancelled");

    const periods = await retainerService.listPeriodsForRetainer(retainer.id);
    expect(periods).toHaveLength(1); // no next period
  });
});

// ─── Scheduler orchestration ────────────────────────────────────────────────

describe("runBillingCycle", () => {
  it("releases due periods and finalizes due cancellations in one pass", async () => {
    const { retainer: r1, period: p1 } = await seedRetainer({ title: "Retainer A" });
    await retainerService.fundRetainer({
      retainerId: r1.id,
      clientAddress: CLIENT,
      amountXlm: 1000,
    });
    await expirePeriod(p1.id);

    const { retainer: r2 } = await seedRetainer({ title: "Retainer B", noticePeriodDays: 0 });
    await retainerService.requestCancellation({ retainerId: r2.id, requestedBy: CLIENT });

    const results = await retainerService.runBillingCycle();

    expect(results.periodsReleased).toBe(1);
    expect(results.cancellationsFinalized).toBe(1);

    const updatedR1 = await retainerService.getRetainer(r1.id);
    expect(updatedR1.status).toBe("active");
    const updatedR2 = await retainerService.getRetainer(r2.id);
    expect(updatedR2.status).toBe("cancelled");
  });
});

// ─── Forecast ───────────────────────────────────────────────────────────────

describe("forecast", () => {
  it("reports the projected amount due and whether the balance covers it", async () => {
    const { retainer } = await seedRetainer({ amountXlm: 800 });
    await retainerService.fundRetainer({
      retainerId: retainer.id,
      clientAddress: CLIENT,
      amountXlm: 300,
    });

    const forecast = await retainerService.getForecast(retainer.id, CLIENT);

    expect(forecast.nextPeriod.amountDueXlm).toBe("800.0000000");
    expect(forecast.nextPeriod.balanceXlm).toBe("300.0000000");
    expect(forecast.nextPeriod.willCoverInFull).toBe(false);
    expect(forecast.nextPeriod.projectedShortfallXlm).toBe("500.0000000");
  });

  it("only a participant may view the forecast", async () => {
    const { retainer } = await seedRetainer();
    const stranger = "GCCCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
    await expect(retainerService.getForecast(retainer.id, stranger)).rejects.toMatchObject({
      status: 403,
    });
  });
});

// ─── Reporting ──────────────────────────────────────────────────────────────

describe("reporting", () => {
  it("reports the freelancer's current monthly run-rate across active retainers", async () => {
    await seedRetainer({ title: "Retainer A", amountXlm: 600, periodType: "monthly" });
    await seedRetainer({ title: "Retainer B", amountXlm: 700, periodType: "weekly" });

    const report = await retainerService.getFreelancerRecurringRevenue(FREELANCER);

    expect(report.activeRetainerCount).toBe(2);
    // 600 (monthly) + 700 * 52/12 (weekly normalized) ≈ 3633.33
    expect(report.currentMonthlyRunRateXlm).toBeCloseTo(600 + (700 * 52) / 12, 1);
  });

  it("reports the client's committed monthly spend across active retainers", async () => {
    await seedRetainer({ title: "Retainer A", amountXlm: 600 });
    const proposal = await retainerService.createProposal({
      proposerAddress: CLIENT,
      counterpartyAddress: FREELANCER,
      proposerRole: "client",
      title: "Retainer C (capped)",
      periodType: "monthly",
      billingModel: "capped_hourly",
      amountXlm: 1,
      hourlyRateXlm: 25,
      capHours: 20,
    });
    await retainerService.respondToProposal({
      proposalId: proposal.id,
      responderAddress: FREELANCER,
      decision: "accepted",
    });

    const report = await retainerService.getClientCommittedSpend(CLIENT);

    expect(report.retainers).toHaveLength(2);
    // 600 (fixed) + 25*20 (capped ceiling) = 1100
    expect(report.committedMonthlySpendXlm).toBe(1100);
  });
});
