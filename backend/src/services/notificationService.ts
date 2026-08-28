import type {
  Database,
  ProfileTable,
  JobTable,
  ApplicationTable,
  JobViewTable,
  PrivateMessageTable,
  EscrowTable,
  ProgressUpdateTable,
  RatingTable,
  MessageTable,
  ReferralTable,
  ReferralPayoutTable,
  ScopeSessionTable,
  WebauthnCredentialTable,
  DisputeEvidenceTable,
  TimeEntryTable,
  TimeInvoiceTable,
  JobInvitationTable,
} from "../db/types";
import { db, rawQuery } from "../db/kysely";
import pool from "../db/pool";
/**
 * src/services/notificationService.ts
 * Email and webhook notification service for escrow state changes
 */
import axios from "axios";
import crypto from "crypto";

const MAX_RETRIES = 3;

interface CustomError extends Error {
  status?: number;
}

/**
 * Event types that trigger notifications
 */
export const EVENT_TYPES = {
  ESCROW_CREATED: "escrow_created",
  WORK_STARTED: "work_started",
  ESCROW_RELEASED: "escrow_released",
  REFUND_ISSUED: "refund_issued",
  DISPUTE_OPENED: "dispute_opened",
  APPLICATION_RECEIVED: "application_received",
  APPLICATION_ACCEPTED: "application_accepted",
  APPLICATION_REJECTED: "application_rejected",
  NEW_MESSAGE: "new_message",
  JOB_COMPLETED: "job_completed",
  JOB_INVITED: "job_invited",
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

const DECENTRALIZED_EVENT_TYPES = new Set<string>([
  EVENT_TYPES.ESCROW_CREATED,
  EVENT_TYPES.DISPUTE_OPENED,
]);

export interface InAppNotification {
  id: string;
  userAddress: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  jobId: string | null;
  linkPath: string;
  createdAt: string;
}

interface NotificationContent {
  title: string;
  body: string;
  linkPath: string;
}

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

type SendEmailFn = (params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => Promise<void>;

// ── Helpers ──────────────────────────────────────────────────────────

function getPushRecipient(address: string): string {
  return process.env.PUSH_RECIPIENT_CHAIN
    ? `${process.env.PUSH_RECIPIENT_CHAIN}:${address}`
    : `eip155:1:${address}`;
}

function rowToInAppNotification(row: any): InAppNotification {
  return {
    id: row.id,
    userAddress: row.user_address,
    type: row.type,
    title: row.title,
    body: row.body,
    read: row.read,
    jobId: row.job_id,
    linkPath: row.link_path || (row.job_id ? `/jobs/${row.job_id}` : "/notifications"),
    createdAt: row.created_at,
  };
}

function clampLimit(value: any, fallback: number = 20, max: number = 50): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function shortAddress(address: string | undefined): string {
  if (!address || address.length < 12) return address || "A user";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ── Public API ───────────────────────────────────────────────────────

export async function sendDecentralizedPush({
  recipientAddress,
  eventType,
  jobId,
  payload,
}: {
  recipientAddress: string;
  eventType: string;
  jobId: string;
  payload: any;
}): Promise<boolean> {
  if (!DECENTRALIZED_EVENT_TYPES.has(eventType)) return true;

  const { isNotificationEnabled } = require("./notificationPreferencesService");
  const enabled = await isNotificationEnabled(recipientAddress, eventType, "decentralized");
  if (!enabled) return true;

  const channel = process.env.PUSH_CHANNEL_ADDRESS;
  const signerPrivateKey = process.env.PUSH_CHANNEL_PRIVATE_KEY;
  if (!channel || !signerPrivateKey) {
    console.warn("[notifications] Push Protocol channel is not configured");
    return false;
  }

  const content = generateInAppContent(eventType, { ...payload, jobId });
  const sdkEndpoint =
    process.env.PUSH_SDK_RELAY_URL || "https://backend-staging.epns.io/apis/v1/payloads";
  await axios.post(
    sdkEndpoint,
    {
      channel,
      signer: signerPrivateKey,
      recipients: [getPushRecipient(recipientAddress)],
      env: process.env.PUSH_ENV || "staging",
      notification: { title: content.title, body: content.body },
      payload: {
        title: content.title,
        body: content.body,
        cta: `${process.env.FRONTEND_URL || "http://localhost:3000"}${content.linkPath}`,
        category: eventType,
      },
    },
    { timeout: 10000 }
  );

  return true;
}

export async function queueDecentralizedNotification({
  recipientAddress,
  eventType,
  jobId,
  payload,
}: {
  recipientAddress: string;
  eventType: string;
  jobId: string;
  payload: any;
}): Promise<any | null> {
  if (!DECENTRALIZED_EVENT_TYPES.has(eventType)) return null;
  return queueNotification({
    recipientAddress,
    notificationType: "decentralized",
    eventType,
    jobId,
    payload,
  });
}

export async function queueNotification({
  recipientAddress,
  notificationType,
  eventType,
  jobId,
  payload,
}: {
  recipientAddress: string;
  notificationType: string;
  eventType: string;
  jobId: string;
  payload: any;
}): Promise<any> {
  const { rows } = await rawQuery<any>(
    `INSERT INTO notification_queue 
      (recipient_address, notification_type, event_type, job_id, payload, status, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', NOW())
     RETURNING *`,
    [recipientAddress, notificationType, eventType, jobId, JSON.stringify(payload)]
  );

  return rows[0];
}

export async function createInAppNotification(
  {
    userAddress,
    type,
    title,
    body,
    jobId = null,
    linkPath = null,
  }: {
    userAddress: string;
    type: string;
    title: string;
    body: string;
    jobId?: string | null;
    linkPath?: string | null;
  },
  queryRunner: any = pool
): Promise<InAppNotification | null> {
  if (!userAddress) return null;

  const { rows } = await queryRunner.query(
    `INSERT INTO notifications
      (user_address, type, title, body, read, job_id, link_path, created_at)
     VALUES ($1, $2, $3, $4, FALSE, $5, $6, NOW())
     RETURNING *`,
    [userAddress, type, title, body, jobId, linkPath]
  );

  return rowToInAppNotification(rows[0]);
}

export async function listInAppNotifications(
  userAddress: string,
  { limit = 20, cursor = null as string | null } = {}
): Promise<{
  notifications: InAppNotification[];
  unreadCount: number;
  nextCursor: string | null;
}> {
  const safeLimit = clampLimit(limit);
  const params: any[] = [userAddress];
  let cursorClause = "";

  if (cursor) {
    params.push(cursor);
    cursorClause = `AND created_at < $${params.length}`;
  }

  params.push(safeLimit);
  const limitPlaceholder = `$${params.length}`;

  const [{ rows }, unreadResult] = await Promise.all([
    rawQuery<any>(
      `SELECT *
       FROM notifications
       WHERE user_address = $1
         ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limitPlaceholder}`,
      params
    ),
    rawQuery<any>(
      `SELECT COUNT(*)::int AS count
       FROM notifications
       WHERE user_address = $1 AND read = FALSE`,
      [userAddress]
    ),
  ]);

  return {
    notifications: rows.map(rowToInAppNotification),
    unreadCount: unreadResult.rows[0]?.count || 0,
    nextCursor: rows.length === safeLimit ? rows[rows.length - 1].created_at : null,
  };
}

export async function markInAppNotificationRead(
  id: string,
  userAddress: string
): Promise<InAppNotification> {
  const { rows } = await rawQuery<any>(
    `UPDATE notifications
     SET read = TRUE
     WHERE id = $1 AND user_address = $2
     RETURNING *`,
    [id, userAddress]
  );

  if (!rows.length) {
    const e = new Error("Notification not found") as CustomError;
    e.status = 404;
    throw e;
  }

  return rowToInAppNotification(rows[0]);
}

export async function markAllInAppNotificationsRead(
  userAddress: string
): Promise<{ updatedCount: number | null }> {
  const { rowCount } = await rawQuery<any>(
    `UPDATE notifications
     SET read = TRUE
     WHERE user_address = $1 AND read = FALSE`,
    [userAddress]
  );

  return { updatedCount: rowCount };
}

export async function createJobNotification(
  {
    userAddress,
    type,
    title,
    body,
    jobId,
    linkPath,
  }: {
    userAddress: string;
    type: string;
    title: string;
    body: string;
    jobId: string;
    linkPath?: string;
  },
  queryRunner: any = pool
): Promise<InAppNotification | null> {
  return createInAppNotification(
    {
      userAddress,
      type,
      title,
      body,
      jobId,
      linkPath: linkPath || `/jobs/${jobId}`,
    },
    queryRunner
  );
}

export async function getUserPreferences(publicKey: string): Promise<any | null> {
  const { rows } = await rawQuery<ProfileTable>(
    `SELECT email, email_notifications_enabled, webhook_url, webhook_secret
     FROM profiles
     WHERE public_key = $1`,
    [publicKey]
  );

  return rows[0] || null;
}

async function sendEmail(
  { to, subject, text, html }: { to: string; subject: string; text: string; html: string },
  sendEmailFn?: SendEmailFn
): Promise<boolean> {
  if (!sendEmailFn) {
    console.warn("[notifications] Email transport not configured");
    return false;
  }

  try {
    await sendEmailFn({ to, subject, text, html });
    return true;
  } catch (error: any) {
    console.error("[notifications] Email send failed:", error.message);
    return false;
  }
}

async function sendWebhook({
  url,
  secret,
  payload,
}: {
  url: string;
  secret?: string;
  payload: any;
}): Promise<boolean> {
  try {
    const timestamp = Date.now();
    const body = JSON.stringify(payload);

    // Generate HMAC signature
    const signature = crypto
      .createHmac("sha256", secret || "")
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const response = await axios.post(url, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Timestamp": timestamp.toString(),
      },
      timeout: 10000, // 10 second timeout
    });

    return response.status >= 200 && response.status < 300;
  } catch (error: any) {
    console.error("[notifications] Webhook send failed:", error.message);
    return false;
  }
}

export function generateEmailContent(eventType: string, data: any): EmailContent {
  const { jobTitle, jobId, amount, currency } = data;
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const jobUrl = `${baseUrl}/jobs/${jobId}`;

  const templates: Record<string, EmailContent> = {
    [EVENT_TYPES.ESCROW_CREATED]: {
      subject: `Escrow Created: ${jobTitle}`,
      text: `Your escrow for "${jobTitle}" has been created.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe funds are now locked in a smart contract.`,
      html: `<h2>Escrow Created</h2><p>Your escrow for "<strong>${jobTitle}</strong>" has been created.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The funds are now locked in a smart contract.</p>`,
    },
    [EVENT_TYPES.WORK_STARTED]: {
      subject: `Work Started: ${jobTitle}`,
      text: `Work has started on "${jobTitle}".\n\nJob: ${jobUrl}\n\nThe freelancer has been assigned and can now begin work.`,
      html: `<h2>Work Started</h2><p>Work has started on "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p><p>The freelancer has been assigned and can now begin work.</p>`,
    },
    [EVENT_TYPES.ESCROW_RELEASED]: {
      subject: `Payment Released: ${jobTitle}`,
      text: `Payment for "${jobTitle}" has been released.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe escrow has been released to the freelancer.`,
      html: `<h2>Payment Released</h2><p>Payment for "<strong>${jobTitle}</strong>" has been released.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The escrow has been released to the freelancer.</p>`,
    },
    [EVENT_TYPES.REFUND_ISSUED]: {
      subject: `Refund Issued: ${jobTitle}`,
      text: `A refund for "${jobTitle}" has been issued.\n\nAmount: ${amount} ${currency}\nJob: ${jobUrl}\n\nThe escrow has been refunded to the client.`,
      html: `<h2>Refund Issued</h2><p>A refund for "<strong>${jobTitle}</strong>" has been issued.</p><p><strong>Amount:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job</a></p><p>The escrow has been refunded to the client.</p>`,
    },
    [EVENT_TYPES.DISPUTE_OPENED]: {
      subject: `Dispute Opened: ${jobTitle}`,
      text: `A dispute has been opened for "${jobTitle}".\n\nJob: ${jobUrl}\n\nPlease review the dispute and provide any necessary information.`,
      html: `<h2>Dispute Opened</h2><p>A dispute has been opened for "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p><p>Please review the dispute and provide any necessary information.</p>`,
    },
    [EVENT_TYPES.APPLICATION_ACCEPTED]: {
      subject: `Application Accepted: ${jobTitle}`,
      text: `Your application for "${jobTitle}" has been accepted!\n\nJob: ${jobUrl}\n\nYou can now start working on this job.`,
      html: `<h2>Application Accepted</h2><p>Your application for "<strong>${jobTitle}</strong>" has been accepted!</p><p><a href="${jobUrl}">View Job</a></p><p>You can now start working on this job.</p>`,
    },
    [EVENT_TYPES.JOB_COMPLETED]: {
      subject: `Job Completed: ${jobTitle}`,
      text: `The job "${jobTitle}" has been completed.\n\nJob: ${jobUrl}\n\nThank you for using Stellar MarketPay!`,
      html: `<h2>Job Completed</h2><p>The job "<strong>${jobTitle}</strong>" has been completed.</p><p><a href="${jobUrl}">View Job</a></p><p>Thank you for using Stellar MarketPay!</p>`,
    },
    [EVENT_TYPES.JOB_INVITED]: {
      subject: `You've been invited to apply: ${jobTitle}`,
      text: `A client has invited you to apply to their job: "${jobTitle}".\n\nBudget: ${amount} ${currency}\nJob: ${jobUrl}\n\nView the job and apply directly from the link above.`,
      html: `<h2>Job Invitation</h2><p>A client has invited you to apply to their job: "<strong>${jobTitle}</strong>".</p><p><strong>Budget:</strong> ${amount} ${currency}</p><p><a href="${jobUrl}">View Job &amp; Apply</a></p>`,
    },
  };

  return (
    templates[eventType] || {
      subject: `Notification: ${jobTitle}`,
      text: `An event occurred for "${jobTitle}".\n\nJob: ${jobUrl}`,
      html: `<h2>Notification</h2><p>An event occurred for "<strong>${jobTitle}</strong>".</p><p><a href="${jobUrl}">View Job</a></p>`,
    }
  );
}

export function generateInAppContent(eventType: string, data: any): NotificationContent {
  const { jobTitle, jobId, amount, currency, actorAddress } = data;
  const jobLabel = jobTitle || "this job";
  const amountLabel = amount ? ` (${amount} ${currency || "XLM"})` : "";

  const templates: Record<string, { title: string; body: string }> = {
    [EVENT_TYPES.ESCROW_CREATED]: {
      title: "Escrow created",
      body: `Escrow was created for "${jobLabel}"${amountLabel}.`,
    },
    [EVENT_TYPES.WORK_STARTED]: {
      title: "Work started",
      body: `Work has started on "${jobLabel}".`,
    },
    [EVENT_TYPES.ESCROW_RELEASED]: {
      title: "Payment released",
      body: `Payment was released for "${jobLabel}"${amountLabel}.`,
    },
    [EVENT_TYPES.REFUND_ISSUED]: {
      title: "Refund issued",
      body: `A refund was issued for "${jobLabel}"${amountLabel}.`,
    },
    [EVENT_TYPES.DISPUTE_OPENED]: {
      title: "Dispute filed",
      body: `A dispute was filed for "${jobLabel}".`,
    },
    [EVENT_TYPES.APPLICATION_RECEIVED]: {
      title: "New application received",
      body: `${shortAddress(actorAddress)} applied to "${jobLabel}".`,
    },
    [EVENT_TYPES.APPLICATION_ACCEPTED]: {
      title: "Application accepted",
      body: `Your application for "${jobLabel}" was accepted.`,
    },
    [EVENT_TYPES.APPLICATION_REJECTED]: {
      title: "Application rejected",
      body: `Your application for "${jobLabel}" was not selected.`,
    },
    [EVENT_TYPES.NEW_MESSAGE]: {
      title: "New message",
      body: `${shortAddress(actorAddress)} sent you a message about "${jobLabel}".`,
    },
    [EVENT_TYPES.JOB_COMPLETED]: {
      title: "Job completed",
      body: `"${jobLabel}" was marked complete.`,
    },
  };

  return {
    ...(templates[eventType] || {
      title: "New notification",
      body: `There is an update for "${jobLabel}".`,
    }),
    linkPath: jobId ? `/jobs/${jobId}` : "/notifications",
  };
}

export async function processPendingNotifications(
  sendEmailFn?: SendEmailFn
): Promise<{ sent: number; failed: number; total: number }> {
  const { rows: pending } = await rawQuery<any>(
    `SELECT * FROM notification_queue
     WHERE status = 'pending' AND retry_count < $1
     ORDER BY created_at ASC
     LIMIT 50`,
    [MAX_RETRIES]
  );

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    try {
      const prefs = await getUserPreferences(notification.recipient_address);

      if (!prefs) {
        await rawQuery<any>(
          `UPDATE notification_queue
           SET status = 'failed', error_message = 'User not found', last_attempt_at = NOW()
           WHERE id = $1`,
          [notification.id]
        );
        failed++;
        continue;
      }

      let success = false;

      if (notification.notification_type === "email") {
        if (!prefs.email_notifications_enabled || !prefs.email) {
          await rawQuery<any>(
            `UPDATE notification_queue
             SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
             WHERE id = $1`,
            [notification.id]
          );
          sent++;
          continue;
        }

        const emailContent = generateEmailContent(notification.event_type, notification.payload);

        success = await sendEmail(
          {
            to: prefs.email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          },
          sendEmailFn
        );
      } else if (notification.notification_type === "decentralized") {
        success = await sendDecentralizedPush({
          recipientAddress: notification.recipient_address,
          eventType: notification.event_type,
          jobId: notification.job_id,
          payload: notification.payload,
        });
      } else if (notification.notification_type === "webhook") {
        if (!prefs.webhook_url) {
          await rawQuery<any>(
            `UPDATE notification_queue
             SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
             WHERE id = $1`,
            [notification.id]
          );
          sent++;
          continue;
        }

        const webhookPayload = {
          event: notification.event_type,
          jobId: notification.job_id,
          timestamp: new Date().toISOString(),
          data: notification.payload,
        };

        success = await sendWebhook({
          url: prefs.webhook_url,
          secret: prefs.webhook_secret,
          payload: webhookPayload,
        });
      }

      if (success) {
        await rawQuery<any>(
          `UPDATE notification_queue
           SET status = 'sent', sent_at = NOW(), last_attempt_at = NOW()
           WHERE id = $1`,
          [notification.id]
        );
        sent++;
      } else {
        const newRetryCount = notification.retry_count + 1;
        const newStatus = newRetryCount >= MAX_RETRIES ? "failed" : "pending";

        await rawQuery<any>(
          `UPDATE notification_queue
           SET status = $1, retry_count = $2, last_attempt_at = NOW(),
               error_message = 'Delivery failed'
           WHERE id = $3`,
          [newStatus, newRetryCount, notification.id]
        );
        failed++;
      }
    } catch (error: any) {
      console.error(
        `[notifications] Error processing notification ${notification.id}:`,
        error.message
      );

      const newRetryCount = notification.retry_count + 1;
      const newStatus = newRetryCount >= MAX_RETRIES ? "failed" : "pending";

      await rawQuery<any>(
        `UPDATE notification_queue
         SET status = $1, retry_count = $2, last_attempt_at = NOW(),
             error_message = $3
         WHERE id = $4`,
        [newStatus, newRetryCount, error.message, notification.id]
      );
      failed++;
    }
  }

  return { sent, failed, total: pending.length };
}

export async function notifyEscrowEvent({
  eventType,
  jobId,
  clientAddress,
  freelancerAddress,
  data,
}: {
  eventType: string;
  jobId: string;
  clientAddress: string;
  freelancerAddress?: string;
  data: any;
}): Promise<void> {
  const recipients = [clientAddress];
  if (freelancerAddress) recipients.push(freelancerAddress);

  for (const recipient of recipients) {
    const inAppContent = generateInAppContent(eventType, { ...data, jobId });
    await createInAppNotification({
      userAddress: recipient,
      type: eventType,
      title: inAppContent.title,
      body: inAppContent.body,
      jobId,
      linkPath: inAppContent.linkPath,
    });

    // Queue email notification
    await queueNotification({
      recipientAddress: recipient,
      notificationType: "email",
      eventType,
      jobId,
      payload: data,
    });

    await queueDecentralizedNotification({
      recipientAddress: recipient,
      eventType,
      jobId,
      payload: data,
    });

    // Queue webhook notification
    await queueNotification({
      recipientAddress: recipient,
      notificationType: "webhook",
      eventType,
      jobId,
      payload: data,
    });
  }

  console.log(`[notifications] Queued ${eventType} notifications for job ${jobId}`);
}
