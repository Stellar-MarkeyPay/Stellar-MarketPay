/**
 * src/services/referralService.js
 *
 * Manages the on-chain referral tree and multi-level bonus payouts.
 *
 * Reward tiers (mirroring contracts/marketpay-contract/src/referral.rs):
 *   Level 1 (direct referrer)  — 2.00%  (200 bps)
 *   Level 2 (referrer's ref.)  — 0.75%  ( 75 bps)
 *   Level 3 (depth-3 ancestor) — 0.25%  ( 25 bps)
 *
 * Flow:
 *   1. New user signs up via ?ref=GXXX → registerReferral() writes to
 *      referrals + referral_tree tables.
 *   2. Escrow release → processMultiLevelPayout() walks the tree up to
 *      3 levels, records each bonus in multi_level_payouts, updates
 *      referrals.status for level-1 entry.
 *   3. GET /api/referrals/:publicKey → getReferralStats() returns flat stats.
 *   4. GET /api/referrals/:publicKey/tree → getReferralTree() returns the
 *      full subtree for the visualization component.
 */
"use strict";

const pool = require("../db/pool");

// ── Reward tiers (basis points, matching Rust contract constants) ─────────────
const LEVEL_BPS = [200, 75, 25]; // index 0 = level 1
const BPS_DENOMINATOR = 10_000;
const MAX_DEPTH = 3;

// Exposed for the /info endpoint
const REFERRAL_BONUS_BPS = LEVEL_BPS[0]; // primary/direct bonus

// ISSUE-17: platform fee charged on release, mirroring PLATFORM_FEE_BPS in
// contracts/marketpay-contract/src/lib.rs. Routed entirely to the escrow's
// referrer_address when one is set; otherwise it defaults to the admin.
const PLATFORM_FEE_BPS = 100; // 1%

/**
 * Validate a Stellar G-address.
 */
function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Register a referral relationship when a new user signs up via a referral link.
 * Writes both the legacy `referrals` row and the new `referral_tree` row.
 *
 * @param {string} referrerAddress  The user who shared the link (parent).
 * @param {string} refereeAddress   The new user (child).
 * @returns {Promise<Object|null>}  The referral row or null if duplicate.
 */
async function registerReferral(referrerAddress, refereeAddress) {
  validatePublicKey(referrerAddress);
  validatePublicKey(refereeAddress);

  if (referrerAddress === refereeAddress) {
    const e = new Error("Referrer and referee cannot be the same address");
    e.status = 400;
    throw e;
  }

  // ── Cycle detection ────────────────────────────────────────────────────────
  // Walk up the existing tree from referrerAddress for MAX_DEPTH steps.
  // If we encounter refereeAddress in the chain, reject.
  let cursor = referrerAddress;
  for (let i = 0; i < MAX_DEPTH + 1; i++) {
    const { rows } = await pool.query(
      "SELECT parent_address FROM referral_tree WHERE child_address = $1 LIMIT 1",
      [cursor],
    );
    if (!rows.length) break;
    cursor = rows[0].parent_address;
    if (cursor === refereeAddress) {
      const e = new Error("Registering this referral would create a cycle");
      e.status = 400;
      throw e;
    }
  }

  // ── Compute child's depth ─────────────────────────────────────────────────
  const { rows: parentRows } = await pool.query(
    "SELECT depth FROM referral_tree WHERE child_address = $1 LIMIT 1",
    [referrerAddress],
  );
  const parentDepth = parentRows.length ? parentRows[0].depth : 0;
  const childDepth = parentDepth + 1;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Legacy referrals table ────────────────────────────────────────────────
    const { rows: refRows } = await client.query(
      `INSERT INTO referrals (referrer_address, referee_address, status, depth, parent_address)
       VALUES ($1, $2, 'pending', 1, $1)
       ON CONFLICT (referrer_address, referee_address) DO NOTHING
       RETURNING *`,
      [referrerAddress, refereeAddress],
    );

    // ── referral_tree table ───────────────────────────────────────────────────
    await client.query(
      `INSERT INTO referral_tree (child_address, parent_address, depth)
       VALUES ($1, $2, $3)
       ON CONFLICT (child_address) DO NOTHING`,
      [refereeAddress, referrerAddress, childDepth],
    );

    if (refRows.length > 0) {
      // Increment referral_count on the referrer's profile
      await client.query(
        `UPDATE profiles
         SET referral_count = referral_count + 1, updated_at = NOW()
         WHERE public_key = $1`,
        [referrerAddress],
      );
    }

    await client.query("COMMIT");
    return refRows.length ? refRows[0] : null;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23503") return null; // FK violation = no profile yet
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up the direct referrer (level-1 parent) for a given address.
 */
async function getReferrerForReferee(refereeAddress) {
  const { rows } = await pool.query(
    `SELECT parent_address FROM referral_tree WHERE child_address = $1 LIMIT 1`,
    [refereeAddress],
  );
  return rows.length ? rows[0].parent_address : null;
}

// ── Multi-level payout processing ─────────────────────────────────────────────

/**
 * Walk the referral tree from `refereeAddress` up to MAX_DEPTH levels and
 * record bonus payouts for each ancestor.
 *
 * Called from the escrow release route after the on-chain release_escrow()
 * transaction is confirmed.  The actual token transfers happen on-chain;
 * this function records the audit trail in the database.
 *
 * @param {string} jobId              UUID of the completed job.
 * @param {string} refereeAddress     The freelancer who just completed the job.
 * @param {string} amountXlm          The full escrow release amount (string).
 * @param {string} [contractTxHash]   On-chain tx hash.
 * @returns {Promise<Array<{recipient, level, bonusXlm}>>}  Payouts recorded.
 */
async function processMultiLevelPayout(jobId, refereeAddress, amountXlm, contractTxHash) {
  validatePublicKey(refereeAddress);

  // Only pay out on the referee's FIRST completed job
  const { rows: prevJobs } = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM escrows e
     JOIN jobs j ON j.id = e.job_id
     WHERE j.freelancer_address = $1
       AND e.status = 'released'
       AND j.id != $2`,
    [refereeAddress, jobId],
  );
  if (parseInt(prevJobs[0].cnt, 10) > 0) return [];

  const escrowAmount = parseFloat(amountXlm);
  if (isNaN(escrowAmount) || escrowAmount <= 0) return [];

  // Walk up the tree
  const ancestors = [];
  let cursor = refereeAddress;
  for (let level = 1; level <= MAX_DEPTH; level++) {
    const { rows } = await pool.query(
      "SELECT parent_address FROM referral_tree WHERE child_address = $1 LIMIT 1",
      [cursor],
    );
    if (!rows.length) break;
    const parentAddr = rows[0].parent_address;
    const bps = LEVEL_BPS[level - 1];
    const bonusXlm = ((escrowAmount * bps) / BPS_DENOMINATOR).toFixed(7);
    ancestors.push({ recipient: parentAddr, level, bonusXlm });
    cursor = parentAddr;
  }

  if (!ancestors.length) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const { recipient, level, bonusXlm } of ancestors) {
      // Write multi_level_payouts audit row
      await client.query(
        `INSERT INTO multi_level_payouts
           (job_id, freelancer_address, recipient_address, level, amount_xlm, contract_tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [jobId, refereeAddress, recipient, level, bonusXlm, contractTxHash || null],
      );

      // For the direct (level-1) referral, also update the legacy referrals row
      if (level === 1) {
        await client.query(
          `UPDATE referrals
           SET status = 'paid',
               payout_amount = $1,
               job_id = $2,
               paid_at = NOW()
           WHERE referrer_address = $3
             AND referee_address = $4
             AND status = 'pending'`,
          [bonusXlm, jobId, recipient, refereeAddress],
        );

        // Legacy payout audit row
        const { rows: refRow } = await client.query(
          "SELECT id FROM referrals WHERE referrer_address = $1 AND referee_address = $2 LIMIT 1",
          [recipient, refereeAddress],
        );
        if (refRow.length) {
          await client.query(
            `INSERT INTO referral_payouts
               (referral_id, referrer_address, referee_address, job_id, amount_xlm, contract_tx_hash)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [refRow[0].id, recipient, refereeAddress, jobId, bonusXlm, contractTxHash || null],
          );
        }
      }

      // Reputation bonus for each ancestor (+5 for direct, +2 for deeper)
      const repBonus = level === 1 ? 5 : 2;
      await client.query(
        `UPDATE profiles
         SET reputation_points = reputation_points + $1, updated_at = NOW()
         WHERE public_key = $2`,
        [repBonus, recipient],
      );
    }

    await client.query("COMMIT");
    return ancestors;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ISSUE-17: record the audit trail for the on-chain platform fee split.
 *
 * Mirrors release_escrow_core() in the Soroban contract: the multi-level
 * referral tree takes priority (handled by processMultiLevelPayout); only
 * when the freelancer has no tree registration does the contract charge the
 * 1% platform fee, routing it to the escrow's referrer_address or, absent
 * one, to the admin.
 *
 * @returns {Promise<{recipient: string, type: 'referrer'|'admin', feeXlm: string}|null>}
 */
async function processPlatformFeePayout(jobId, freelancerAddress, amountXlm, contractTxHash) {
  validatePublicKey(freelancerAddress);

  const escrowAmount = parseFloat(amountXlm);
  if (isNaN(escrowAmount) || escrowAmount <= 0) return null;

  const { rows: escrowRows } = await pool.query(
    "SELECT referrer_address FROM escrows WHERE job_id = $1",
    [jobId],
  );
  const referrerAddress = escrowRows.length ? escrowRows[0].referrer_address : null;

  const adminAddress = process.env.ADMIN_PUBLIC_KEY || null;
  const recipient = referrerAddress || adminAddress;
  if (!recipient) return null;

  const feeXlm = ((escrowAmount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR).toFixed(7);
  const recipientType = referrerAddress ? "referrer" : "admin";

  await pool.query(
    `INSERT INTO platform_fee_payouts
       (job_id, freelancer_address, recipient_address, recipient_type, amount_xlm, contract_tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [jobId, freelancerAddress, recipient, recipientType, feeXlm, contractTxHash || null],
  );

  return { recipient, type: recipientType, feeXlm };
}

/**
 * Back-compat shim: called from the old escrow release path.
 *
 * Mirrors the contract's branch: if the freelancer has a multi-level tree
 * registration at all, that path owns the payout (even if this particular
 * release doesn't trigger one, e.g. not the referee's first job — same as
 * on-chain, which always takes the tree branch once registered). Only when
 * there is no tree registration does the ISSUE-17 platform fee split apply.
 */
async function processReferralPayout(jobId, refereeAddress, amountXlm, contractTxHash) {
  const hasTreeParent = await getReferrerForReferee(refereeAddress);
  if (hasTreeParent) {
    const payouts = await processMultiLevelPayout(jobId, refereeAddress, amountXlm, contractTxHash);
    const direct = payouts.find((p) => p.level === 1);
    return direct ? { referrer: direct.recipient, bonusXlm: direct.bonusXlm } : null;
  }

  const feePayout = await processPlatformFeePayout(jobId, refereeAddress, amountXlm, contractTxHash);
  if (!feePayout) return null;
  return { referrer: feePayout.type === "referrer" ? feePayout.recipient : null, bonusXlm: feePayout.feeXlm };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Get flat referral stats and history for a given public key (as referrer).
 */
async function getReferralStats(publicKey) {
  validatePublicKey(publicKey);

  // Summary counts (legacy referrals table)
  const { rows: summary } = await pool.query(
    `SELECT
       COUNT(*)                                          AS total_referrals,
       COUNT(*) FILTER (WHERE status = 'paid')          AS paid_referrals,
       COUNT(*) FILTER (WHERE status = 'pending')       AS pending_referrals,
       COALESCE(SUM(payout_amount) FILTER (WHERE status = 'paid'), 0) AS total_earned_xlm
     FROM referrals
     WHERE referrer_address = $1`,
    [publicKey],
  );

  // Multi-level earnings from multi_level_payouts
  const { rows: treeEarnings } = await pool.query(
    `SELECT COALESCE(SUM(amount_xlm), 0) AS tree_total_xlm,
            COUNT(*) AS tree_payout_count
     FROM multi_level_payouts
     WHERE recipient_address = $1`,
    [publicKey],
  );

  // ISSUE-17: platform fee earnings (escrows released with this user set as
  // the per-escrow referrer, where the freelancer had no tree registration)
  const { rows: feeEarnings } = await pool.query(
    `SELECT COALESCE(SUM(amount_xlm), 0) AS fee_total_xlm,
            COUNT(*) AS fee_payout_count
     FROM platform_fee_payouts
     WHERE recipient_address = $1 AND recipient_type = 'referrer'`,
    [publicKey],
  );

  // Per-referee detail (direct children only)
  const { rows: referees } = await pool.query(
    `SELECT
       r.id,
       r.referee_address,
       r.status,
       r.payout_amount,
       r.paid_at,
       r.created_at,
       p.display_name AS referee_display_name,
       j.title        AS job_title
     FROM referrals r
     LEFT JOIN profiles p ON p.public_key = r.referee_address
     LEFT JOIN jobs j     ON j.id = r.job_id
     WHERE r.referrer_address = $1
     ORDER BY r.created_at DESC`,
    [publicKey],
  );

  // Payout history (legacy)
  const { rows: payouts } = await pool.query(
    `SELECT
       rp.id,
       rp.referee_address,
       rp.job_id,
       rp.amount_xlm,
       rp.contract_tx_hash,
       rp.created_at,
       j.title AS job_title
     FROM referral_payouts rp
     JOIN jobs j ON j.id = rp.job_id
     WHERE rp.referrer_address = $1
     ORDER BY rp.created_at DESC`,
    [publicKey],
  );

  const s = summary[0];
  const te = treeEarnings[0];
  const fe = feeEarnings[0];
  return {
    totalReferrals: parseInt(s.total_referrals, 10),
    paidReferrals: parseInt(s.paid_referrals, 10),
    pendingReferrals: parseInt(s.pending_referrals, 10),
    totalEarnedXlm: parseFloat(s.total_earned_xlm).toFixed(7),
    treeEarnedXlm: parseFloat(te.tree_total_xlm).toFixed(7),
    treePayoutCount: parseInt(te.tree_payout_count, 10),
    platformFeeEarnedXlm: parseFloat(fe.fee_total_xlm).toFixed(7),
    platformFeePayoutCount: parseInt(fe.fee_payout_count, 10),
    bonusBps: REFERRAL_BONUS_BPS,
    levelBps: LEVEL_BPS,
    platformFeeBps: PLATFORM_FEE_BPS,
    referees: referees.map((r) => ({
      id: r.id,
      refereeAddress: r.referee_address,
      refereeDisplayName: r.referee_display_name || null,
      status: r.status,
      payoutAmount: r.payout_amount ? parseFloat(r.payout_amount).toFixed(7) : null,
      paidAt: r.paid_at || null,
      jobTitle: r.job_title || null,
      createdAt: r.created_at,
    })),
    payouts: payouts.map((p) => ({
      id: p.id,
      refereeAddress: p.referee_address,
      jobId: p.job_id,
      jobTitle: p.job_title,
      amountXlm: parseFloat(p.amount_xlm).toFixed(7),
      contractTxHash: p.contract_tx_hash || null,
      createdAt: p.created_at,
    })),
  };
}

/**
 * Get the full referral subtree rooted at `publicKey` for visualization.
 * Returns a JSON-serialisable tree suitable for D3 / recharts TreeMap.
 *
 * Each node:
 *   { address, displayName, depth, children: [...], earnedXlm }
 *
 * Depth-limited to MAX_DEPTH to avoid runaway queries.
 *
 * @param {string} publicKey  Root of the subtree (the user viewing their dashboard).
 * @returns {Promise<Object>}
 */
async function getReferralTree(publicKey) {
  validatePublicKey(publicKey);

  // Fetch the entire subtree using a recursive CTE capped at MAX_DEPTH
  const { rows } = await pool.query(
    `WITH RECURSIVE subtree AS (
       -- Seed: direct children of the root
       SELECT
         rt.child_address,
         rt.parent_address,
         rt.depth,
         p.display_name,
         1 AS rel_level
       FROM referral_tree rt
       LEFT JOIN profiles p ON p.public_key = rt.child_address
       WHERE rt.parent_address = $1

       UNION ALL

       -- Recursive step: children of the children (capped at MAX_DEPTH)
       SELECT
         rt2.child_address,
         rt2.parent_address,
         rt2.depth,
         p2.display_name,
         st.rel_level + 1
       FROM referral_tree rt2
       LEFT JOIN profiles p2 ON p2.public_key = rt2.child_address
       JOIN subtree st ON st.child_address = rt2.parent_address
       WHERE st.rel_level < $2
     )
     SELECT
       s.child_address,
       s.parent_address,
       s.rel_level,
       s.display_name,
       COALESCE(SUM(mlp.amount_xlm), 0) AS earned_xlm
     FROM subtree s
     LEFT JOIN multi_level_payouts mlp
       ON mlp.recipient_address = $1
       AND mlp.freelancer_address = s.child_address
     GROUP BY s.child_address, s.parent_address, s.rel_level, s.display_name
     ORDER BY s.rel_level, s.child_address`,
    [publicKey, MAX_DEPTH],
  );

  // ── Build the tree structure ───────────────────────────────────────────────
  const nodeMap = new Map();
  const root = {
    address: publicKey,
    displayName: null,
    depth: 0,
    earnedXlm: "0.0000000",
    children: [],
  };
  nodeMap.set(publicKey, root);

  for (const row of rows) {
    const node = {
      address: row.child_address,
      displayName: row.display_name || null,
      depth: row.rel_level,
      earnedXlm: parseFloat(row.earned_xlm).toFixed(7),
      children: [],
    };
    nodeMap.set(row.child_address, node);
  }

  // Attach children to parents
  for (const row of rows) {
    const parent = nodeMap.get(row.parent_address);
    const child = nodeMap.get(row.child_address);
    if (parent && child) {
      parent.children.push(child);
    }
  }

  // Fill in the root's displayName
  const { rows: rootProfile } = await pool.query(
    "SELECT display_name FROM profiles WHERE public_key = $1",
    [publicKey],
  );
  if (rootProfile.length) root.displayName = rootProfile[0].display_name;

  return root;
}

module.exports = {
  registerReferral,
  getReferrerForReferee,
  processReferralPayout,
  processMultiLevelPayout,
  processPlatformFeePayout,
  getReferralStats,
  getReferralTree,
  REFERRAL_BONUS_BPS,
  PLATFORM_FEE_BPS,
  LEVEL_BPS,
  MAX_DEPTH,
};
