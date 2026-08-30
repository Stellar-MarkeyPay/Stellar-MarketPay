const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const notificationPreferencesService = require("../services/notificationPreferencesService");
const {
  listInAppNotifications,
  markInAppNotificationRead,
  markAllInAppNotificationsRead,
} = require("../services/notificationService");
const pool = require("../db/pool");

// ─── Authenticated preference endpoints ───────────────────────────────────────

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     description: >
 *       Returns the full list of supported notification types along with the
 *       authenticated user's per-channel preferences. Any notification type
 *       that has no stored row defaults to `{ email: true, inapp: true,
 *       decentralized: false }`.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Preferences retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     notificationTypes:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example:
 *                         - new_application
 *                         - application_accepted
 *                         - application_rejected
 *                         - payment_released
 *                         - new_message
 *                         - job_expiring
 *                         - dispute_filed
 *                         - weekly_digest
 *                         - announcements
 *                         - escrow_created
 *                         - dispute_opened
 *                     preferences:
 *                       type: object
 *                       description: Map of notification type to per-channel enabled flags
 *                       additionalProperties:
 *                         type: object
 *                         properties:
 *                           email:
 *                             type: boolean
 *                           inapp:
 *                             type: boolean
 *                           decentralized:
 *                             type: boolean
 *                       example:
 *                         new_message:
 *                           email: true
 *                           inapp: true
 *                           decentralized: false
 *                         weekly_digest:
 *                           email: false
 *                           inapp: true
 *                           decentralized: false
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const preferences = await notificationPreferencesService.getPreferences(req.user.publicKey);
    res.json({
      success: true,
      data: {
        notificationTypes: notificationPreferencesService.NOTIFICATION_TYPES,
        preferences,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/notifications/preferences:
 *   patch:
 *     summary: Update notification preferences
 *     description: >
 *       Persists the given per-type, per-channel preference flags for the
 *       authenticated user (one upsert per type/channel pair) and returns the
 *       full, updated preference map.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - preferences
 *             properties:
 *               preferences:
 *                 type: object
 *                 description: Map of notification type to the channel flags to update
 *                 additionalProperties:
 *                   type: object
 *                   additionalProperties:
 *                     type: boolean
 *           example:
 *             preferences:
 *               weekly_digest:
 *                 email: false
 *               new_message:
 *                 email: true
 *                 inapp: true
 *                 decentralized: false
 *     responses:
 *       200:
 *         description: Preferences updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       email:
 *                         type: boolean
 *                       inapp:
 *                         type: boolean
 *                       decentralized:
 *                         type: boolean
 *             example:
 *               success: true
 *               data:
 *                 weekly_digest:
 *                   email: false
 *                   inapp: true
 *                   decentralized: false
 *                 new_message:
 *                   email: true
 *                   inapp: true
 *                   decentralized: false
 *       400:
 *         description: The `preferences` field is missing or is not an object
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid preferences format
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.patch("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== "object") {
      const err = new Error("Invalid preferences format");
      err.status = 400;
      throw err;
    }

    await notificationPreferencesService.updatePreferences(req.user.publicKey, preferences);

    const updated = await notificationPreferencesService.getPreferences(req.user.publicKey);
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: List in-app notifications
 *     description: >
 *       Returns the authenticated user's in-app notifications, newest first,
 *       along with their current unread count. Supports cursor pagination on
 *       `created_at`.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of notifications to return (clamped to 1-50)
 *         example: 20
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Return notifications created before this ISO timestamp (from the previous page's `nextCursor`)
 *         example: "2026-08-01T12:00:00.000Z"
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           userAddress:
 *                             type: string
 *                           type:
 *                             type: string
 *                           title:
 *                             type: string
 *                           body:
 *                             type: string
 *                           read:
 *                             type: boolean
 *                           jobId:
 *                             type: string
 *                             format: uuid
 *                             nullable: true
 *                           linkPath:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     unreadCount:
 *                       type: integer
 *                       example: 3
 *                     nextCursor:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Pass as `cursor` to fetch the next page, or null if this is the last page
 *             example:
 *               success: true
 *               data:
 *                 notifications:
 *                   - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                     userAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                     type: new_message
 *                     title: New message
 *                     body: GHC3...PDBX sent you a message about "Build a Stellar wallet UI".
 *                     read: false
 *                     jobId: 9c6c2c1e-df3a-4b0a-9e2a-9f2a6c1d5b3e
 *                     linkPath: /jobs/9c6c2c1e-df3a-4b0a-9e2a-9f2a6c1d5b3e
 *                     createdAt: "2026-08-20T09:15:00.000Z"
 *                 unreadCount: 1
 *                 nextCursor: null
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/", verifyJWT, async (req, res, next) => {
  try {
    const result = await listInAppNotifications(req.user.publicKey, {
      limit: req.query.limit,
      cursor: req.query.cursor,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     description: Marks every currently-unread in-app notification for the authenticated user as read.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     updatedCount:
 *                       type: integer
 *                       description: Number of notifications that were flipped from unread to read
 *                       example: 4
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.patch("/read-all", verifyJWT, async (req, res, next) => {
  try {
    const result = await markAllInAppNotificationsRead(req.user.publicKey);
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     description: Marks the given notification as read, scoped to the authenticated user's own notifications.
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Notification ID
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Notification marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     userAddress:
 *                       type: string
 *                     type:
 *                       type: string
 *                     title:
 *                       type: string
 *                     body:
 *                       type: string
 *                     read:
 *                       type: boolean
 *                       example: true
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                       nullable: true
 *                     linkPath:
 *                       type: string
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 userAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 type: new_message
 *                 title: New message
 *                 body: GHC3...PDBX sent you a message about "Build a Stellar wallet UI".
 *                 read: true
 *                 jobId: 9c6c2c1e-df3a-4b0a-9e2a-9f2a6c1d5b3e
 *                 linkPath: /jobs/9c6c2c1e-df3a-4b0a-9e2a-9f2a6c1d5b3e
 *                 createdAt: "2026-08-20T09:15:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Notification not found (or does not belong to the authenticated user)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Notification not found
 */
router.patch("/:id/read", verifyJWT, async (req, res, next) => {
  try {
    const notification = await markInAppNotificationRead(req.params.id, req.user.publicKey);
    res.json({ success: true, data: notification });
  } catch (e) {
    next(e);
  }
});

// ─── Token-based unsubscribe (no auth required) ───────────────────────────────

/**
 * GET /api/notifications/unsubscribe?token=<uuid>
 *
 * Looks up the profile by digest_unsubscribe_token, disables the weekly_digest
 * email preference, then returns an HTML confirmation page.  No login required —
 * the token acts as a bearer credential for this single action.
 */
/**
 * @swagger
 * /api/notifications/unsubscribe:
 *   get:
 *     summary: One-click weekly digest unsubscribe
 *     description: >
 *       Looks up the profile by its `digest_unsubscribe_token`, disables the
 *       `weekly_digest` email preference for that profile, rotates the token
 *       so the link cannot be reused, and renders a self-contained HTML
 *       confirmation page. No login is required — the token itself acts as
 *       the bearer credential for this single action. Intended to be opened
 *       directly from a link in an email client.
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: The profile's `digest_unsubscribe_token`
 *         example: 8f14e45f-ceea-467e-b3d1-6a0a1f5c3b9e
 *     responses:
 *       200:
 *         description: Weekly digest emails disabled; HTML confirmation page rendered
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *             example: "<!DOCTYPE html><html><body><div class=\"card\"><h1>You've been unsubscribed</h1><p>You will no longer receive weekly job digest emails from Stellar MarketPay.</p></div></body></html>"
 *       400:
 *         description: The `token` query parameter is missing or empty; HTML error page rendered
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *             example: "<!DOCTYPE html><html><body><div class=\"card\"><h1>Invalid link</h1><p>The unsubscribe link is missing or invalid. Please use the link from your email.</p></div></body></html>"
 *       404:
 *         description: No profile matches the given token (already used or invalid); HTML error page rendered
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *             example: "<!DOCTYPE html><html><body><div class=\"card\"><h1>Invalid link</h1><p>This unsubscribe link has already been used or is no longer valid.</p></div></body></html>"
 *       500:
 *         description: Unexpected server error while processing the request; HTML error page rendered
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *             example: "<!DOCTYPE html><html><body><div class=\"card\"><h1>Invalid link</h1><p>Something went wrong. Please try again later.</p></div></body></html>"
 */
router.get("/unsubscribe", async (req, res) => {
  const { token } = req.query;

  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  // Helper: render a self-contained HTML page (works in any browser opened
  // via an email client link)
  function htmlPage(success, message) {
    const color = success ? "#22c55e" : "#ef4444";
    const icon = success ? "✓" : "✗";
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Unsubscribe — Stellar MarketPay</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0f172a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#1e293b;border-radius:16px;padding:48px 40px;max-width:480px;
          width:100%;text-align:center;box-shadow:0 25px 50px rgba(0,0,0,.5)}
    .icon{font-size:52px;color:${color};margin-bottom:20px}
    h1{color:#f1f5f9;font-size:22px;font-weight:700;margin-bottom:12px}
    p{color:#94a3b8;font-size:15px;line-height:1.6;margin-bottom:28px}
    a{display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
      font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px}
    a:hover{background:#1d4ed8}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${success ? "You've been unsubscribed" : "Invalid link"}</h1>
    <p>${message}</p>
    <a href="${baseUrl}">Back to Stellar MarketPay</a>
  </div>
</body>
</html>`;
  }

  // Validate token presence
  if (!token || typeof token !== "string" || token.trim() === "") {
    return res
      .status(400)
      .type("html")
      .send(
        htmlPage(
          false,
          "The unsubscribe link is missing or invalid. Please use the link from your email."
        )
      );
  }

  try {
    // Look up the profile by unsubscribe token
    const { rows } = await pool.query(
      "SELECT public_key FROM profiles WHERE digest_unsubscribe_token = $1",
      [token.trim()]
    );

    if (!rows.length) {
      return res
        .status(404)
        .type("html")
        .send(
          htmlPage(false, "This unsubscribe link has already been used or is no longer valid.")
        );
    }

    const { public_key } = rows[0];

    // Persist opt-out in notification_preferences
    await notificationPreferencesService.updatePreference(
      public_key,
      "weekly_digest",
      "email",
      false
    );

    // Rotate the token so the link can only be used once
    await pool.query(
      "UPDATE profiles SET digest_unsubscribe_token = gen_random_uuid() WHERE public_key = $1",
      [public_key]
    );

    return res
      .status(200)
      .type("html")
      .send(
        htmlPage(
          true,
          "You will no longer receive weekly job digest emails from Stellar MarketPay. " +
            "You can re-enable them at any time from your notification preferences."
        )
      );
  } catch (err) {
    console.error("[unsubscribe] Error processing request:", err.message);
    return res
      .status(500)
      .type("html")
      .send(htmlPage(false, "Something went wrong. Please try again later."));
  }
});

module.exports = router;
