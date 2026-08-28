import { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export interface Database {
  profiles: ProfileTable;
  jobs: JobTable;
  applications: ApplicationTable;
  job_views: JobViewTable;
  private_messages: PrivateMessageTable;
  escrows: EscrowTable;
  progress_updates: ProgressUpdateTable;
  ratings: RatingTable;
  messages: MessageTable;
  referrals: ReferralTable;
  referral_payouts: ReferralPayoutTable;
  scope_sessions: ScopeSessionTable;
  webauthn_credentials: WebauthnCredentialTable;
  dispute_evidence: DisputeEvidenceTable;
  time_entries: TimeEntryTable;
  time_invoices: TimeInvoiceTable;
  job_invitations: JobInvitationTable;
}

export interface ProfileTable {
  [key: string]: any;
  public_key: string;
  display_name: string | null;
  bio: string | null;
  skills: string[];
  portfolio_items: any;
  availability: any;
  role: string;
  completed_jobs: number;
  total_earned_xlm: string; // numeric
  rating: string | null; // numeric
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  reputation_points: number;
  referral_count: number;
  blocked_addresses: string[];
  email: string | null;
  last_login_at: Date | null;
  digest_unsubscribe_token: Generated<string>;
}

export interface JobTable {
  [key: string]: any;
  id: Generated<string>;
  title: string;
  description: string;
  budget: string; // numeric
  currency: string;
  category: string;
  skills: string[];
  status: string;
  client_address: string;
  freelancer_address: string | null;
  escrow_contract_id: string | null;
  applicant_count: number;
  deadline: Date | null;
  timezone: string | null;
  screening_questions: string[];
  milestones: any;
  dispute_reason: string | null;
  dispute_description: string | null;
  disputed_by: string | null;
  disputed_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  expires_at: Date | null;
  extended_count: number;
  extended_until: Date | null;
  view_count: number;
  share_count: number;
  boosted: boolean;
  boosted_until: Date | null;
  visibility: string;
  bidding_closed_at: Date | null;
}

export interface ApplicationTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  freelancer_address: string;
  proposal: string;
  bid_amount: string; // numeric
  status: string;
  accepted_at: Date | null;
  created_at: Generated<Date>;
  referred_by: string | null;
  currency: string;
  screening_answers: any;
  withdrawn_at: Date | null;
  bid_commitment: string | null;
  bid_nonce: string | null;
  bid_revealed: boolean;
  revealed_bid_amount: string | null;
  revealed_at: Date | null;
}

export interface JobViewTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  ip_hash: string;
  viewed_at: Generated<Date>;
}

export interface PrivateMessageTable {
  [key: string]: any;
  id: Generated<string>;
  sender_address: string;
  recipient_address: string;
  sender_public_key: string;
  recipient_public_key: string;
  nonce: string;
  cipher_text: string;
  created_at: Generated<Date>;
}

export interface EscrowTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  contract_id: string;
  amount_xlm: string; // numeric
  milestones: any;
  status: string;
  released_at: Date | null;
  timeout_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProgressUpdateTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  author_address: string;
  update_text: string;
  created_at: Generated<Date>;
}

export interface RatingTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  rater_address: string;
  rated_address: string;
  stars: number;
  review: string | null;
  created_at: Generated<Date>;
}

export interface MessageTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  sender_address: string;
  receiver_address: string;
  content: string;
  read: boolean;
  created_at: Generated<Date>;
}

export interface ReferralTable {
  [key: string]: any;
  id: Generated<string>;
  referrer_address: string;
  referee_address: string;
  job_id: string | null;
  status: string;
  payout_amount: string | null;
  paid_at: Date | null;
  created_at: Generated<Date>;
}

export interface ReferralPayoutTable {
  [key: string]: any;
  id: Generated<string>;
  referral_id: string;
  referrer_address: string;
  referee_address: string;
  job_id: string;
  amount_xlm: string;
  contract_tx_hash: string | null;
  created_at: Generated<Date>;
}

export interface ScopeSessionTable {
  [key: string]: any;
  session_id: string;
  content: string;
  cursors: any;
  finalized: boolean;
  finalized_payload: any | null;
  expires_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface WebauthnCredentialTable {
  [key: string]: any;
  id: Generated<string>;
  public_key: string;
  credential_id: string;
  credential_name: string;
  public_key_cose: string;
  counter: number;
  transports: string[];
  created_at: Generated<Date>;
}

export interface DisputeEvidenceTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  uploader_address: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  ipfs_cid: string;
  created_at: Generated<Date>;
}

export interface TimeEntryTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  freelancer_address: string;
  duration_minutes: number;
  description: string | null;
  started_at: Date | null;
  created_at: Generated<Date>;
}

export interface TimeInvoiceTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  freelancer_address: string;
  client_address: string;
  total_minutes: number;
  hourly_rate_xlm: string;
  total_amount_xlm: string;
  status: string;
  entry_ids: string[];
  contract_tx_hash: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface JobInvitationTable {
  [key: string]: any;
  id: Generated<string>;
  job_id: string;
  client_address: string;
  freelancer_address: string;
  status: string;
  created_at: Generated<Date>;
}
