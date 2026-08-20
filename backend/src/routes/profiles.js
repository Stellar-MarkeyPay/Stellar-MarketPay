/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const multer = require("multer");
const { uploadFile, getGatewayUrl, MAX_FILE_SIZE } = require("../services/ipfsService");

const profileUpdateRateLimiter = createRateLimiter(5, 1); // 5 profile updates per minute
const generalProfileRateLimiter = createRateLimiter(30, 1); // 100 requests per minute for getting profiles
const cache = require("../services/cacheService");
const { edgeCacheControl, CONTENT_TYPES } = require("../middleware/edgeCacheControl");
const { coalesce } = require("../middleware/requestCoalescer");
const { surrogateKeysForProfile } = require("../services/cdn/cacheStrategy");

const {
  getProfile,
  upsertProfile,
  updateAvailability,
  getSkillEndorsements,
  endorseSkill,
  getClientSpendingAnalytics,
  listProfiles,
  getClientReputation,
  getProfileStats,
  getResponseTime,
  blockFreelancer,
  unblockFreelancer,
} = require("../services/profileService");
const {
  upsertPriceAlertPreference,
  getPriceAlertPreference,
} = require("../services/priceAlertService");

router.get("/", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { role, availability, search, limit } = req.query;
    const profiles = await listProfiles({
      role: typeof role === "string" && role.trim() ? role : undefined,
      availability:
        typeof availability === "string" && availability.trim() ? availability : undefined,
      search: typeof search === "string" && search.trim() ? search : undefined,
      limit: typeof limit === "string" ? Number(limit) : undefined,
    });
    res.json({ success: true, data: profiles });
  } catch (e) {
    next(e);
  }
});

router.get(
  "/:publicKey",
  generalProfileRateLimiter,
  edgeCacheControl(CONTENT_TYPES.SEMI_DYNAMIC, {
    surrogateKeys: (req) => surrogateKeysForProfile(req.params.publicKey),
  }),
  async (req, res, next) => {
    try {
      const key = cache.profileKey(req.params.publicKey);
      const cached = await cache.get(key);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json({ success: true, data: cached });
      }
      // Stampede protection: concurrent misses for the same profile (e.g.
      // right after an invalidation) share one origin fetch.
      const data = await coalesce(key, async () => {
        const fetched = await getProfile(req.params.publicKey);
        await cache.set(key, fetched, cache.TTL.PROFILE);
        return fetched;
      });
      res.set("X-Cache", "MISS");
      res.json({ success: true, data });
    } catch (e) {
      next(e);
    }
  }
);

router.get("/:publicKey/stats", generalProfileRateLimiter, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getProfileStats(req.params.publicKey) });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/response-time", generalProfileRateLimiter, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getResponseTime(req.params.publicKey) });
  } catch (e) {
    next(e);
  }
});

router.post("/", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const data = await upsertProfile(req.body);
    if (req.body.publicKey) await cache.del(cache.profileKey(req.body.publicKey));
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// GET /api/profiles/:publicKey/notifications - Get notification preferences
router.get("/:publicKey/notifications", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { getUserPreferences } = require("../services/notificationService");
    const prefs = await getUserPreferences(req.params.publicKey);

    if (!prefs) {
      return res.status(404).json({ success: false, error: "Profile not found" });
    }

    res.json({
      success: true,
      data: {
        email: prefs.email,
        emailNotificationsEnabled: prefs.email_notifications_enabled,
        webhookUrl: prefs.webhook_url,
        webhookSecret: prefs.webhook_secret ? "***" : null, // Hide secret
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/profiles/:publicKey/notifications - Update notification preferences
router.post("/:publicKey/notifications", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { email, emailNotificationsEnabled, webhookUrl, webhookSecret } = req.body;

    // Update profile with notification preferences
    const updated = await upsertProfile({
      publicKey,
      email,
      emailNotificationsEnabled,
      webhookUrl,
      webhookSecret,
    });

    res.json({
      success: true,
      data: {
        email: updated.email,
        emailNotificationsEnabled: updated.emailNotificationsEnabled,
        webhookUrl: updated.webhookUrl,
        webhookSecret: updated.webhookSecret ? "***" : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/availability", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await updateAvailability(req.params.publicKey, req.body),
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/price-alerts", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const pref = await getPriceAlertPreference(req.params.publicKey);
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/price-alerts", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const pref = await upsertPriceAlertPreference({
      freelancerAddress: req.params.publicKey,
      minXlmPriceUsd: req.body.minXlmPriceUsd,
      maxXlmPriceUsd: req.body.maxXlmPriceUsd,
      emailNotificationsEnabled: req.body.emailNotificationsEnabled,
      email: req.body.email,
    });
    res.json({ success: true, data: pref });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const endorsements = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data: endorsements });
  } catch (e) {
    next(e);
  }
});

router.post("/:publicKey/endorse", profileUpdateRateLimiter, async (req, res, next) => {
  try {
    const { skill, endorserAddress } = req.body;
    await endorseSkill({
      skill,
      endorserAddress,
      recipientAddress: req.params.publicKey,
    });
    res.json({ success: true, data: null });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/spending", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientSpendingAnalytics(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

router.get("/:publicKey/client-reputation", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getClientReputation(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/profiles/:publicKey/block — block a freelancer
router.post("/:publicKey/block", verifyJWT, profileUpdateRateLimiter, async (req, res, next) => {
  try {
    if (req.user.publicKey !== req.params.publicKey) {
      return res.status(403).json({ error: "You can only manage your own block list" });
    }
    const { address } = req.body;
    const profile = await blockFreelancer(req.params.publicKey, address);
    res.json({ success: true, data: profile });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/profiles/:publicKey/block/:address — unblock a freelancer
router.delete(
  "/:publicKey/block/:address",
  verifyJWT,
  profileUpdateRateLimiter,
  async (req, res, next) => {
    try {
      if (req.user.publicKey !== req.params.publicKey) {
        return res.status(403).json({ error: "You can only manage your own block list" });
      }
      const profile = await unblockFreelancer(req.params.publicKey, req.params.address);
      res.json({ success: true, data: profile });
    } catch (e) {
      next(e);
    }
  }
);

// GET /api/profiles/:publicKey/earnings — freelancer earnings history (Issue #181)
router.get("/:publicKey/earnings", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    const { rows: payments } = await pool.query(
      `SELECT
         e.id,
         e.job_id,
         e.amount_xlm,
         e.released_at,
         j.title  AS job_title,
         j.client_address,
         j.currency
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
       ORDER BY e.released_at DESC`,
      [publicKey]
    );

    const { rows: monthly } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', e.released_at), 'YYYY-MM') AS month,
         SUM(e.amount_xlm)::numeric                             AS total_xlm
       FROM escrows e
       JOIN jobs j ON e.job_id = j.id
       WHERE j.freelancer_address = $1
         AND e.status = 'released'
         AND e.released_at >= NOW() - INTERVAL '6 months'
       GROUP BY DATE_TRUNC('month', e.released_at)
       ORDER BY DATE_TRUNC('month', e.released_at)`,
      [publicKey]
    );

    let totalXlm = 0;
    let totalUsdc = 0;
    for (const p of payments) {
      const amt = parseFloat(p.amount_xlm || 0);
      if ((p.currency || "XLM").toUpperCase() === "USDC") {
        totalUsdc += amt;
      } else {
        totalXlm += amt;
      }
    }

    res.json({
      success: true,
      data: {
        totalXlm: totalXlm.toFixed(7),
        totalUsdc: totalUsdc.toFixed(7),
        payments: payments.map((p) => ({
          id: p.id,
          jobId: p.job_id,
          jobTitle: p.job_title,
          amountXlm: p.amount_xlm,
          currency: p.currency || "XLM",
          releasedAt: p.released_at,
          clientAddress: p.client_address,
        })),
        monthly: monthly.map((m) => ({
          month: m.month,
          totalXlm: parseFloat(m.total_xlm),
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

router.post("/:publicKey/portfolio", verifyJWT, upload.single("file"), async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ error: "File is required" });

    const { rows } = await pool.query(
      "SELECT portfolio_items FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    const current = rows[0]?.portfolio_items || [];
    if (current.length >= 10)
      return res.status(400).json({ error: "Maximum 10 portfolio items allowed" });

    const uploaded = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    const item = {
      id: require("crypto").randomUUID(),
      title: req.body.title?.trim() || req.file.originalname,
      type: uploaded.mimeType.startsWith("image/") ? "image" : "pdf",
      cid: uploaded.cid,
      fileName: uploaded.fileName,
      mimeType: uploaded.mimeType,
      size: uploaded.size,
      uploadedAt: uploaded.uploadedAt,
      url: getGatewayUrl(uploaded.cid),
    };

    const updated = [...current, item];
    await pool.query(
      "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
      [publicKey, JSON.stringify(updated)]
    );

    res.json({ success: true, data: item });
  } catch (e) {
    next(e);
  }
});

// GET /api/profiles/:publicKey/endorsements — get skill endorsements
router.get("/:publicKey/endorsements", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const data = await getSkillEndorsements(req.params.publicKey);
    res.json({ success: true, data });
  } catch (e) {
    next(e);
  }
});

// POST /api/profiles/:publicKey/endorse — endorse a skill
router.post("/:publicKey/endorse", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { skill } = req.body;
    const endorserAddress = req.user.publicKey;

    if (!skill || typeof skill !== "string" || !skill.trim()) {
      return res.status(400).json({ error: "Skill name is required" });
    }

    // Validate skill exists in recipient's profile
    const { rows: profileRows } = await pool.query(
      "SELECT skills FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    if (!profileRows.length) {
      return res.status(404).json({ error: "Profile not found" });
    }
    if (!profileRows[0].skills || !profileRows[0].skills.includes(skill.trim())) {
      return res.status(400).json({ error: "Skill not found in freelancer's profile" });
    }

    // Only past clients who completed a job can endorse
    const { rows: jobRows } = await pool.query(
      `SELECT 1 FROM jobs
       WHERE client_address = $1
         AND freelancer_address = $2
         AND status = 'completed'
       LIMIT 1`,
      [endorserAddress, publicKey]
    );
    if (!jobRows.length) {
      return res.status(403).json({ error: "Only past clients with completed jobs can endorse" });
    }

    await endorseSkill({ skill: skill.trim(), endorserAddress, recipientAddress: publicKey });

    res.status(201).json({ success: true, data: { skill: skill.trim(), endorsed: true } });
  } catch (e) {
    next(e);
  }
});

router.delete("/:publicKey/portfolio/:itemId", verifyJWT, async (req, res, next) => {
  try {
    const { publicKey, itemId } = req.params;
    if (req.user.publicKey !== publicKey) return res.status(403).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      "SELECT portfolio_items FROM profiles WHERE public_key = $1",
      [publicKey]
    );
    const current = rows[0]?.portfolio_items || [];
    const nextItems = current.filter((item) => item.id !== itemId);

    if (nextItems.length === current.length)
      return res.status(404).json({ error: "Portfolio item not found" });

    await pool.query(
      "UPDATE profiles SET portfolio_items = $2::jsonb, updated_at = NOW() WHERE public_key = $1",
      [publicKey, JSON.stringify(nextItems)]
    );

    res.json({ success: true, data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});
module.exports = router;

// GET /api/profiles/:publicKey/transactions - Aggregated on-chain activity
router.get("/:publicKey/transactions", generalProfileRateLimiter, async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    const { limit = 20, cursor = 0, type, startDate, endDate } = req.query;
    const limitNum = parseInt(limit, 10) || 20;
    const offsetNum = parseInt(cursor, 10) || 0;

    // Build the WHERE clause dynamically based on type
    let extraWhere = "";
    if (type && type !== "all") {
      if (type === "sent") {
        extraWhere = "WHERE from_address = $1 AND to_address != $1";
      } else if (type === "received") {
        extraWhere = "WHERE to_address = $1 AND from_address != $1";
      } else {
        extraWhere = "WHERE market_pay_type = $4";
      }
    } else {
      extraWhere = "WHERE 1=1";
    }

    const queryParams = [publicKey, limitNum + 1, offsetNum];
    let paramIndex = 4;
    
    if (type && type !== "all" && type !== "sent" && type !== "received") {
      queryParams.push(type);
      paramIndex++;
    }
    
    if (startDate) {
      extraWhere += ` AND created_at >= $${paramIndex}`;
      queryParams.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      extraWhere += ` AND created_at <= $${paramIndex}`;
      queryParams.push(endDate);
      paramIndex++;
    }

    const query = `
      SELECT * FROM (
        -- Escrow events
        SELECT
          ce.id::text as id,
          ce.tx_hash as hash,
          ce.ledger,
          ce.created_at,
          j.client_address as from_address,
          j.freelancer_address as to_address,
          COALESCE((ce.data->>'amount')::numeric, e.amount_xlm) as amount,
          j.currency as asset,
          ce.event_type as memo,
          'escrow' as market_pay_type
        FROM contract_events ce
        JOIN jobs j ON ce.job_id = j.id::text
        LEFT JOIN escrows e ON e.job_id = j.id
        WHERE j.client_address = $1 OR j.freelancer_address = $1
        
        UNION ALL
        
        -- Referral payouts
        SELECT
          rp.id::text as id,
          rp.contract_tx_hash as hash,
          0 as ledger,
          rp.created_at,
          'PLATFORM' as from_address,
          rp.referrer_address as to_address,
          rp.amount_xlm as amount,
          'XLM' as asset,
          'referral_payout' as memo,
          'payment' as market_pay_type
        FROM referral_payouts rp
        WHERE rp.referrer_address = $1
        
        UNION ALL
        
        -- Platform fee payouts
        SELECT
          pfp.id::text as id,
          pfp.contract_tx_hash as hash,
          0 as ledger,
          pfp.created_at,
          'PLATFORM' as from_address,
          pfp.recipient_address as to_address,
          pfp.amount_xlm as amount,
          'XLM' as asset,
          'fee_payout' as memo,
          'payment' as market_pay_type
        FROM platform_fee_payouts pfp
        WHERE pfp.recipient_address = $1
      ) t
      ${extraWhere}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const { rows } = await pool.query(query, queryParams);
    
    const hasMore = rows.length > limitNum;
    if (hasMore) {
      rows.pop();
    }

    const transactions = rows.map(r => ({
      id: r.id,
      hash: r.hash || '',
      ledger: r.ledger || 0,
      created_at: r.created_at,
      from: r.from_address || '',
      to: r.to_address || '',
      amount: r.amount ? String(r.amount) : "0",
      asset: r.asset || 'XLM',
      memo: r.memo || '',
      memo_type: 'text',
      successful: true,
      marketPayType: r.market_pay_type
    }));

    res.json({ success: true, data: { transactions, hasMore, nextCursor: hasMore ? offsetNum + limitNum : null } });
  } catch (e) {
    next(e);
  }
});

