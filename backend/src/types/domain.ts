/**
 * src/types/domain.ts
 * Re-exports domain types from the shared @marketpay/shared-types package.
 * Backend and frontend consume the same definitions through this package.
 *
 * Some types are re-exported with backend-friendly aliases.
 * Backend services may define extended interfaces locally when they need
 * additional internal-only fields.
 */
export type {
  Job,
  Application,
  UserProfile,
  EscrowState,
  NotificationItem,
  Currency,
  JobStatus,
  UserRole,
  JobVisibility,
  FreelancerTier,
  JobMilestone,
  Rating,
  Message,
  TimeEntry,
  TimeInvoice,
  ReferralStats,
  ReferralTreeNode,
  JobCompletionPrediction,
  JobAnalytics,
  BulkActionResponse,
  JobInvitation,
  PortfolioFile,
  PortfolioItem,
  TokenInfo,
  TokenBalance,
  SkillEndorsement,
  SkillBadge,
  ClientSpendingAnalytics,
  ClientReputation,
} from "@marketpay/shared-types";

// Convenience aliases matching old local names
export type { UserProfile as Profile } from "@marketpay/shared-types";
export type { EscrowState as Escrow } from "@marketpay/shared-types";
export type { NotificationItem as Notification } from "@marketpay/shared-types";
