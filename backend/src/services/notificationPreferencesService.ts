import { rawQuery } from "../db/kysely";

export const NOTIFICATION_TYPES = [
  "new_application",
  "application_accepted",
  "application_rejected",
  "payment_released",
  "new_message",
  "job_expiring",
  "dispute_filed",
  "weekly_digest",
  "announcements",
  "escrow_created",
  "dispute_opened",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface ChannelPreferences {
  email: boolean;
  inapp: boolean;
  decentralized: boolean;
  [key: string]: boolean;
}

export type NotificationPreferences = Record<string, ChannelPreferences>;

export async function getPreferences(userAddress: string): Promise<NotificationPreferences> {
  try {
    const result = await rawQuery(
      `SELECT notification_type, channel, enabled FROM notification_preferences
       WHERE user_address = $1 ORDER BY notification_type, channel`,
      [userAddress]
    );

    const preferences: NotificationPreferences = {};
    NOTIFICATION_TYPES.forEach((type) => {
      preferences[type] = { email: true, inapp: true, decentralized: false };
    });

    result.rows.forEach((row: any) => {
      if (!preferences[row.notification_type]) {
        preferences[row.notification_type] = { email: true, inapp: true, decentralized: false };
      }
      preferences[row.notification_type][row.channel] = row.enabled;
    });

    return preferences;
  } catch (err) {
    console.error("Error getting notification preferences:", err);
    throw err;
  }
}

export async function updatePreference(
  userAddress: string,
  notificationType: string,
  channel: string,
  enabled: boolean
): Promise<void> {
  try {
    await rawQuery(
      `INSERT INTO notification_preferences (user_address, notification_type, channel, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_address, notification_type, channel)
       DO UPDATE SET enabled = $4, updated_at = NOW()`,
      [userAddress, notificationType, channel, enabled]
    );
  } catch (err) {
    console.error("Error updating notification preference:", err);
    throw err;
  }
}

export async function updatePreferences(
  userAddress: string,
  preferences: NotificationPreferences
): Promise<void> {
  try {
    for (const [notificationType, channels] of Object.entries(preferences)) {
      for (const [channel, enabled] of Object.entries(channels)) {
        await updatePreference(userAddress, notificationType, channel, enabled);
      }
    }
  } catch (err) {
    console.error("Error updating notification preferences:", err);
    throw err;
  }
}

export async function isNotificationEnabled(
  userAddress: string,
  notificationType: string,
  channel: string
): Promise<boolean> {
  try {
    const result = await rawQuery(
      `SELECT enabled FROM notification_preferences
       WHERE user_address = $1 AND notification_type = $2 AND channel = $3`,
      [userAddress, notificationType, channel]
    );
    if (result.rows.length === 0) {
      return channel === "decentralized" ? false : true;
    }
    return result.rows[0].enabled;
  } catch (err) {
    console.error("Error checking notification enabled:", err);
    return true;
  }
}
