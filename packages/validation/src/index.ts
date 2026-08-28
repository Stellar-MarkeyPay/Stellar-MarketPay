import { z } from "zod";
import type {
  Job,
  CreateJobInput,
  UserProfile,
  UpsertProfileInput,
  Application,
  SubmitApplicationInput,
  JobStatus,
  UserRole,
  Currency,
  ApplicationStatus,
  TimeInvoiceStatus,
  BridgeTransfer,
} from "@marketpay/types";

export const JobStatusSchema = z.enum(["open", "in_progress", "completed", "cancelled", "disputed"]);
export const UserRoleSchema = z.enum(["client", "freelancer", "both"]);
export const CurrencySchema = z.enum(["XLM", "USDC"]);
export const ApplicationStatusSchema = z.enum(["pending", "accepted", "rejected"]);
export const TimeInvoiceStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const JobMilestoneSchema: z.ZodType<Job["milestones"][number]> = z.object({
  description: z.string(),
  amount: z.string(),
  status: z.enum(["pending", "released", "disputed"]),
  releasedAt: z.string().nullable().optional(),
  disputedAt: z.string().nullable().optional(),
  autoVerify: z.boolean().optional(),
  oracleType: z.string().nullable().optional(),
  oracleQuery: z.string().nullable().optional(),
});

export const CreateJobInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  budget: z.string(),
  currency: CurrencySchema,
  category: z.string().min(1),
  visibility: z.enum(["public", "private", "invite_only"]).optional(),
  skills: z.array(z.string()).optional(),
  deadline: z.string().optional(),
  timezone: z.string().optional(),
  screeningQuestions: z.array(z.string()).max(5).optional(),
  milestones: z.array(JobMilestoneSchema).max(10).optional(),
}) satisfies z.ZodType<CreateJobInput>;

export const JobSchema: z.ZodType<Job> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  budget: z.string(),
  currency: CurrencySchema,
  category: z.string(),
  visibility: z.enum(["public", "private", "invite_only"]).optional(),
  skills: z.array(z.string()),
  status: JobStatusSchema,
  clientAddress: z.string(),
  freelancerAddress: z.string().optional(),
  escrowContractId: z.string().optional(),
  applicantCount: z.number(),
  shareCount: z.number().optional(),
  boosted: z.boolean().optional(),
  boostedUntil: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deadline: z.string().optional(),
  timezone: z.string().optional(),
  screeningQuestions: z.array(z.string()).optional(),
  milestones: z.array(JobMilestoneSchema).optional(),
  expiresAt: z.string().optional(),
  extendedCount: z.number().optional(),
  extendedUntil: z.string().optional(),
  biddingClosedAt: z.string().nullable().optional(),
  clientReputationScore: z.number().nullable().optional(),
  disputedBy: z.string().optional(),
  disputedAt: z.string().nullable().optional(),
  disputeReason: z.string().nullable().optional(),
  disputeDescription: z.string().nullable().optional(),
});

export const UpsertProfileInputSchema = z.object({
  publicKey: z.string(),
  displayName: z.string().optional(),
  bio: z.string().optional(),
  skills: z.array(z.string()).optional(),
  portfolioItems: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        type: z.enum(["link", "image", "pdf", "github", "live", "stellar_tx", "file"]),
      })
    )
    .optional(),
  availability: z
    .object({
      status: z.enum(["available", "busy", "unavailable"]),
      availableFrom: z.string().optional(),
      availableUntil: z.string().optional(),
    })
    .nullable()
    .optional(),
  role: UserRoleSchema,
}) satisfies z.ZodType<UpsertProfileInput>;

export const UserProfileSchema: z.ZodType<UserProfile> = z.object({
  publicKey: z.string(),
  displayName: z.string().optional(),
  bio: z.string().optional(),
  skills: z.array(z.string()).optional(),
  portfolioItems: z.array(z.object({ title: z.string(), url: z.string(), type: z.string() })).optional(),
  portfolioFiles: z.array(z.object({ cid: z.string(), fileName: z.string(), mimeType: z.string(), size: z.number(), uploadedAt: z.string() })).optional(),
  availability: z.object({ status: z.string(), availableFrom: z.string().optional(), availableUntil: z.string().optional() }).nullable().optional(),
  role: UserRoleSchema,
  completedJobs: z.number(),
  totalEarnedXLM: z.string(),
  rating: z.number().optional(),
  tier: z.string().optional(),
  ratingCount: z.number().optional(),
  referralCount: z.number().optional(),
  reputationPoints: z.number().optional(),
  reputationScore: z.number().optional(),
  reputationMetrics: z.object({ avgAcceptHours: z.number(), avgReleaseHours: z.number() }).optional(),
  didHash: z.string().optional(),
  isKycVerified: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  blockedAddresses: z.array(z.string()).optional(),
});

export const SubmitApplicationInputSchema = z.object({
  jobId: z.string(),
  freelancerAddress: z.string(),
  proposal: z.string().min(1),
  bidAmount: z.string(),
  currency: CurrencySchema,
  estimatedDuration: z.string().optional(),
  screeningAnswers: z.record(z.string()).optional(),
}) satisfies z.ZodType<SubmitApplicationInput>;

export const ApplicationSchema: z.ZodType<Application> = z.object({
  id: z.string(),
  jobId: z.string(),
  freelancerAddress: z.string(),
  freelancerTier: z.string().optional(),
  proposal: z.string(),
  bidAmount: z.string(),
  currency: CurrencySchema,
  status: ApplicationStatusSchema,
  screeningAnswers: z.record(z.string()).optional(),
  estimatedDuration: z.string().optional(),
  prediction: z
    .object({
      estimatedDurationDays: z.number(),
      estimatedCompletionDate: z.string(),
      confidenceScore: z.number(),
      freelancerStats: z.object({
        completedJobs: z.number(),
        rating: z.number(),
        onTimeRate: z.number().nullable(),
      }),
    })
    .optional(),
  bidCommitment: z.string().nullable().optional(),
  bidRevealed: z.boolean().optional(),
  revealedBidAmount: z.string().nullable().optional(),
  revealedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  acceptedAt: z.string().optional(),
});

export const BridgeTransferSchema: z.ZodType<BridgeTransfer> = z.object({
  id: z.string(),
  sourceChain: z.enum(["evm", "soroban"]),
  targetChain: z.enum(["evm", "soroban"]),
  transferType: z.string(),
  nonce: z.string(),
  amount: z.string(),
  sender: z.string(),
  recipient: z.string(),
  status: z.enum(["pending", "completed", "failed", "recovering"]),
  txHash: z.string().optional(),
  failureReason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;
export type UpsertProfileInput = z.infer<typeof UpsertProfileInputSchema>;
export type SubmitApplicationInput = z.infer<typeof SubmitApplicationInputSchema>;
