--
-- PostgreSQL database dump
--

\restrict PcSFnnEoWLjM99FbtGyvLFCDuwdpZ0LfRaeu0GgtkMXyuzacODVoUBWRocaLVBr

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: update_job_search_vector(); Type: FUNCTION; Schema: public; Owner: stellarwork
--

CREATE FUNCTION public.update_job_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.job_search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(array_to_string(NEW.skills, ' '), '')), 'C');
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_job_search_vector() OWNER TO stellarwork;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_profiles; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.admin_profiles (
    id text NOT NULL,
    email text,
    totp_secret text,
    totp_enabled boolean DEFAULT false NOT NULL,
    backup_codes text,
    totp_attempts integer DEFAULT 0 NOT NULL,
    totp_locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.admin_profiles OWNER TO stellarwork;

--
-- Name: api_key_usage_daily; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.api_key_usage_daily (
    api_key_id uuid NOT NULL,
    usage_date date NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.api_key_usage_daily OWNER TO stellarwork;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_public_key text NOT NULL,
    label text DEFAULT 'Developer key'::text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.api_keys OWNER TO stellarwork;

--
-- Name: applications; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    freelancer_address text NOT NULL,
    proposal text NOT NULL,
    bid_amount numeric(20,7) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    referred_by text,
    currency text DEFAULT 'XLM'::text NOT NULL,
    screening_answers jsonb DEFAULT '{}'::jsonb NOT NULL,
    withdrawn_at timestamp with time zone
);


ALTER TABLE public.applications OWNER TO stellarwork;

--
-- Name: assessment_questions; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.assessment_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    skill_id uuid NOT NULL,
    question_text text NOT NULL,
    options jsonb NOT NULL,
    correct_option_index integer NOT NULL,
    difficulty text DEFAULT 'intermediate'::text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT assessment_questions_check CHECK (((correct_option_index >= 0) AND (correct_option_index < jsonb_array_length(options)))),
    CONSTRAINT assessment_questions_difficulty_check CHECK ((difficulty = ANY (ARRAY['beginner'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT assessment_questions_options_check CHECK (((jsonb_typeof(options) = 'array'::text) AND ((jsonb_array_length(options) >= 2) AND (jsonb_array_length(options) <= 6)))),
    CONSTRAINT assessment_questions_question_text_check CHECK ((length(btrim(question_text)) > 0)),
    CONSTRAINT assessment_questions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]))),
    CONSTRAINT assessment_questions_version_check CHECK ((version > 0))
);


ALTER TABLE public.assessment_questions OWNER TO stellarwork;

--
-- Name: assessment_skills; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.assessment_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    pass_score integer DEFAULT 70 NOT NULL,
    duration_seconds integer DEFAULT 900 NOT NULL,
    cooldown_days integer DEFAULT 30 NOT NULL,
    questions_per_attempt integer,
    created_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assessment_skills_cooldown_days_check CHECK ((cooldown_days >= 0)),
    CONSTRAINT assessment_skills_duration_seconds_check CHECK ((duration_seconds > 0)),
    CONSTRAINT assessment_skills_pass_score_check CHECK (((pass_score >= 0) AND (pass_score <= 100))),
    CONSTRAINT assessment_skills_questions_per_attempt_check CHECK (((questions_per_attempt IS NULL) OR (questions_per_attempt > 0))),
    CONSTRAINT assessment_skills_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


ALTER TABLE public.assessment_skills OWNER TO stellarwork;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_address text NOT NULL,
    action text NOT NULL,
    target text,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO stellarwork;

--
-- Name: availability_check_history; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.availability_check_history (
    id integer NOT NULL,
    file_id integer NOT NULL,
    cid character varying(255) NOT NULL,
    is_available boolean NOT NULL,
    check_duration_ms integer,
    error_message character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.availability_check_history OWNER TO stellarwork;

--
-- Name: availability_check_history_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.availability_check_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.availability_check_history_id_seq OWNER TO stellarwork;

--
-- Name: availability_check_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.availability_check_history_id_seq OWNED BY public.availability_check_history.id;


--
-- Name: contract_events; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.contract_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    event_type text NOT NULL,
    contract_id text,
    tx_hash text,
    ledger integer,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.contract_events OWNER TO stellarwork;

--
-- Name: dao_arbitrators; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.dao_arbitrators (
    public_key text NOT NULL,
    display_name text,
    bio text,
    votes_received integer DEFAULT 0 NOT NULL,
    disputes_resolved integer DEFAULT 0 NOT NULL,
    elected_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dao_arbitrators OWNER TO stellarwork;

--
-- Name: dao_proposals; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.dao_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    type text NOT NULL,
    proposer text NOT NULL,
    amount numeric(20,7),
    recipient text,
    status text DEFAULT 'active'::text NOT NULL,
    voting_ends_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    executed_at timestamp with time zone,
    CONSTRAINT dao_proposals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'passed'::text, 'rejected'::text, 'executed'::text]))),
    CONSTRAINT dao_proposals_type_check CHECK ((type = ANY (ARRAY['treasury'::text, 'platform'::text, 'parameter'::text, 'arbitration'::text])))
);


ALTER TABLE public.dao_proposals OWNER TO stellarwork;

--
-- Name: dao_votes; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.dao_votes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid NOT NULL,
    voter text NOT NULL,
    support boolean NOT NULL,
    weight numeric(20,7) DEFAULT 1 NOT NULL,
    tx_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dao_votes OWNER TO stellarwork;

--
-- Name: dispute_evidence; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.dispute_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    uploader_address text NOT NULL,
    file_name text NOT NULL,
    file_size integer NOT NULL,
    mime_type text NOT NULL,
    ipfs_cid text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.dispute_evidence OWNER TO stellarwork;

--
-- Name: escrows; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.escrows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    contract_id text NOT NULL,
    amount_xlm numeric(20,7) NOT NULL,
    milestones jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'funded'::text NOT NULL,
    released_at timestamp with time zone,
    timeout_at timestamp with time zone,
    guardian_address text,
    high_value_threshold numeric(20,7),
    guardian_approved boolean DEFAULT false,
    guardian_approved_at timestamp with time zone,
    release_timeout_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    referrer_address text
);


ALTER TABLE public.escrows OWNER TO stellarwork;

--
-- Name: frozen_wallets; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.frozen_wallets (
    address text NOT NULL,
    reason text,
    frozen_by text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.frozen_wallets OWNER TO stellarwork;

--
-- Name: indexer_state; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.indexer_state (
    id integer DEFAULT 1 NOT NULL,
    synced boolean DEFAULT false NOT NULL,
    last_processed_ledger integer,
    last_transaction_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT single_row CHECK ((id = 1))
);


ALTER TABLE public.indexer_state OWNER TO stellarwork;

--
-- Name: insurance_claims; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.insurance_claims (
    id integer NOT NULL,
    file_id integer NOT NULL,
    owner_address character varying(56) NOT NULL,
    claim_amount numeric(20,7) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    evidence jsonb,
    oracle_proof jsonb,
    oracle_address character varying(56),
    payout_tx_hash character varying(255),
    rejection_reason character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    proof_submitted_at timestamp without time zone,
    paid_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT valid_claim_amount CHECK ((claim_amount > (0)::numeric)),
    CONSTRAINT valid_status CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'proof_submitted'::character varying, 'approved'::character varying, 'rejected'::character varying])::text[])))
);


ALTER TABLE public.insurance_claims OWNER TO stellarwork;

--
-- Name: insurance_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.insurance_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.insurance_claims_id_seq OWNER TO stellarwork;

--
-- Name: insurance_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.insurance_claims_id_seq OWNED BY public.insurance_claims.id;


--
-- Name: insurance_premiums_paid; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.insurance_premiums_paid (
    id integer NOT NULL,
    file_id integer NOT NULL,
    owner_address character varying(56) NOT NULL,
    premium_amount numeric(20,7) NOT NULL,
    payment_tx_hash character varying(255),
    payment_status character varying(50) DEFAULT 'pending'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confirmed_at timestamp without time zone
);


ALTER TABLE public.insurance_premiums_paid OWNER TO stellarwork;

--
-- Name: insurance_premiums_paid_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.insurance_premiums_paid_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.insurance_premiums_paid_id_seq OWNER TO stellarwork;

--
-- Name: insurance_premiums_paid_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.insurance_premiums_paid_id_seq OWNED BY public.insurance_premiums_paid.id;


--
-- Name: insured_files; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.insured_files (
    id integer NOT NULL,
    cid character varying(255) NOT NULL,
    owner_address character varying(56) NOT NULL,
    file_size integer NOT NULL,
    file_value numeric(20,7) NOT NULL,
    premium numeric(20,7) NOT NULL,
    storage_type character varying(20) DEFAULT 'ipfs'::character varying NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying NOT NULL,
    availability_score numeric(5,4) DEFAULT 1.0,
    checks_total integer DEFAULT 0,
    checks_passed integer DEFAULT 0,
    last_checked timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT valid_availability CHECK (((availability_score >= (0)::numeric) AND (availability_score <= (1)::numeric))),
    CONSTRAINT valid_file_size CHECK ((file_size > 0)),
    CONSTRAINT valid_file_value CHECK ((file_value > (0)::numeric)),
    CONSTRAINT valid_premium CHECK ((premium > (0)::numeric)),
    CONSTRAINT valid_storage_type CHECK (((storage_type)::text = ANY ((ARRAY['ipfs'::character varying, 'arweave'::character varying])::text[])))
);


ALTER TABLE public.insured_files OWNER TO stellarwork;

--
-- Name: sla_violations; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.sla_violations (
    id integer NOT NULL,
    file_id integer NOT NULL,
    owner_address character varying(56) NOT NULL,
    violation_type character varying(50),
    availability_score numeric(5,4),
    reported_by character varying(56),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.sla_violations OWNER TO stellarwork;

--
-- Name: insurance_summary; Type: VIEW; Schema: public; Owner: stellarwork
--

CREATE VIEW public.insurance_summary AS
 SELECT ( SELECT count(*) AS count
           FROM public.insured_files
          WHERE ((insured_files.status)::text = 'active'::text)) AS active_policies,
    ( SELECT count(*) AS count
           FROM public.insurance_claims
          WHERE ((insurance_claims.status)::text = 'pending'::text)) AS pending_claims,
    ( SELECT count(*) AS count
           FROM public.insurance_claims
          WHERE ((insurance_claims.status)::text = 'proof_submitted'::text)) AS submitted_proofs,
    ( SELECT count(*) AS count
           FROM public.insurance_claims
          WHERE ((insurance_claims.status)::text = 'approved'::text)) AS approved_claims,
    ( SELECT count(*) AS count
           FROM public.insurance_claims
          WHERE ((insurance_claims.status)::text = 'rejected'::text)) AS rejected_claims,
    ( SELECT COALESCE(sum(insured_files.premium), (0)::numeric) AS "coalesce"
           FROM public.insured_files
          WHERE ((insured_files.status)::text = 'active'::text)) AS total_premiums_active,
    ( SELECT COALESCE(sum(insurance_claims.claim_amount), (0)::numeric) AS "coalesce"
           FROM public.insurance_claims
          WHERE ((insurance_claims.status)::text = 'approved'::text)) AS total_payouts,
    ( SELECT avg(insured_files.availability_score) AS avg
           FROM public.insured_files
          WHERE ((insured_files.status)::text = 'active'::text)) AS avg_system_availability,
    ( SELECT count(*) AS count
           FROM public.sla_violations) AS total_violations;


ALTER VIEW public.insurance_summary OWNER TO stellarwork;

--
-- Name: insured_files_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.insured_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.insured_files_id_seq OWNER TO stellarwork;

--
-- Name: insured_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.insured_files_id_seq OWNED BY public.insured_files.id;


--
-- Name: job_drafts; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.job_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    client_address text NOT NULL,
    title text,
    description text,
    budget numeric(20,7),
    category text DEFAULT 'general'::text,
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    currency text DEFAULT 'XLM'::text NOT NULL,
    timezone text,
    visibility text DEFAULT 'public'::text NOT NULL,
    screening_questions text[] DEFAULT '{}'::text[] NOT NULL,
    deadline timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.job_drafts OWNER TO stellarwork;

--
-- Name: job_views; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.job_views (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    ip_hash text NOT NULL,
    viewed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.job_views OWNER TO stellarwork;

--
-- Name: jobs; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    budget numeric(20,7) NOT NULL,
    currency text DEFAULT 'XLM'::text NOT NULL,
    category text NOT NULL,
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    client_address text NOT NULL,
    freelancer_address text,
    escrow_contract_id text,
    applicant_count integer DEFAULT 0 NOT NULL,
    deadline timestamp with time zone,
    timezone text,
    screening_questions text[] DEFAULT '{}'::text[] NOT NULL,
    milestones jsonb DEFAULT '[]'::jsonb NOT NULL,
    dispute_reason text,
    dispute_description text,
    disputed_by text,
    disputed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    extended_count integer DEFAULT 0 NOT NULL,
    extended_until timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    share_count integer DEFAULT 0 NOT NULL,
    boosted boolean DEFAULT false NOT NULL,
    boosted_until timestamp with time zone,
    visibility text DEFAULT 'public'::text NOT NULL,
    job_search_vector tsvector,
    CONSTRAINT jobs_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text, 'invite_only'::text])))
);


ALTER TABLE public.jobs OWNER TO stellarwork;

--
-- Name: messages; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    sender_address text NOT NULL,
    receiver_address text NOT NULL,
    content text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT messages_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 2000)))
);


ALTER TABLE public.messages OWNER TO stellarwork;

--
-- Name: ml_ranking_shadow_events; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.ml_ranking_shadow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mode text NOT NULL,
    subject_key text NOT NULL,
    context_key text,
    ml_ranking jsonb DEFAULT '[]'::jsonb NOT NULL,
    baseline_ranking jsonb DEFAULT '[]'::jsonb NOT NULL,
    latency_ms integer DEFAULT 0 NOT NULL,
    fallback_used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ml_ranking_shadow_events_mode_check CHECK ((mode = ANY (ARRAY['jobs_for_freelancer'::text, 'freelancers_for_job'::text])))
);


ALTER TABLE public.ml_ranking_shadow_events OWNER TO stellarwork;

--
-- Name: multi_level_payouts; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.multi_level_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    freelancer_address text NOT NULL,
    recipient_address text NOT NULL,
    level integer NOT NULL,
    amount_xlm numeric(20,7) NOT NULL,
    contract_tx_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT multi_level_payouts_level_check CHECK (((level >= 1) AND (level <= 3)))
);


ALTER TABLE public.multi_level_payouts OWNER TO stellarwork;

--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.notification_preferences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_address text NOT NULL,
    notification_type text NOT NULL,
    channel text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_preferences_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'inapp'::text])))
);


ALTER TABLE public.notification_preferences OWNER TO stellarwork;

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_address text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    job_id uuid,
    link_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO stellarwork;

--
-- Name: oracle_proofs; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.oracle_proofs (
    id integer NOT NULL,
    claim_id integer NOT NULL,
    oracle_address character varying(56) NOT NULL,
    proof_data jsonb NOT NULL,
    proof_type character varying(50),
    verified boolean DEFAULT false,
    verification_error character varying(500),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    verified_at timestamp without time zone
);


ALTER TABLE public.oracle_proofs OWNER TO stellarwork;

--
-- Name: oracle_proofs_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.oracle_proofs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.oracle_proofs_id_seq OWNER TO stellarwork;

--
-- Name: oracle_proofs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.oracle_proofs_id_seq OWNED BY public.oracle_proofs.id;


--
-- Name: platform_fee_payouts; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.platform_fee_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    freelancer_address text NOT NULL,
    recipient_address text NOT NULL,
    recipient_type text NOT NULL,
    amount_xlm numeric(20,7) NOT NULL,
    contract_tx_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_fee_payouts_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['referrer'::text, 'admin'::text])))
);


ALTER TABLE public.platform_fee_payouts OWNER TO stellarwork;

--
-- Name: private_messages; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.private_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sender_address text NOT NULL,
    recipient_address text NOT NULL,
    sender_public_key text NOT NULL,
    recipient_public_key text NOT NULL,
    nonce text NOT NULL,
    cipher_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.private_messages OWNER TO stellarwork;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.profiles (
    public_key text NOT NULL,
    display_name text,
    bio text,
    skills text[] DEFAULT '{}'::text[] NOT NULL,
    portfolio_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    availability jsonb,
    role text DEFAULT 'both'::text NOT NULL,
    completed_jobs integer DEFAULT 0 NOT NULL,
    total_earned_xlm numeric(20,7) DEFAULT 0 NOT NULL,
    rating numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reputation_points integer DEFAULT 0 NOT NULL,
    referral_count integer DEFAULT 0 NOT NULL,
    blocked_addresses text[] DEFAULT '{}'::text[] NOT NULL,
    portfolio_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    email text,
    email_notifications_enabled boolean DEFAULT true NOT NULL,
    webhook_url text,
    webhook_secret text,
    is_kyc_verified boolean DEFAULT false NOT NULL,
    did_hash text
);


ALTER TABLE public.profiles OWNER TO stellarwork;

--
-- Name: progress_updates; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.progress_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    author_address text NOT NULL,
    update_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.progress_updates OWNER TO stellarwork;

--
-- Name: ratings; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    rater_address text NOT NULL,
    rated_address text NOT NULL,
    stars integer NOT NULL,
    review text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ratings_review_check CHECK ((char_length(review) <= 200)),
    CONSTRAINT ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);


ALTER TABLE public.ratings OWNER TO stellarwork;

--
-- Name: referral_payouts; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.referral_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referral_id uuid NOT NULL,
    referrer_address text NOT NULL,
    referee_address text NOT NULL,
    job_id uuid NOT NULL,
    amount_xlm numeric(20,7) NOT NULL,
    contract_tx_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.referral_payouts OWNER TO stellarwork;

--
-- Name: referral_tree; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.referral_tree (
    child_address text NOT NULL,
    parent_address text NOT NULL,
    depth integer DEFAULT 1 NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    on_chain_tx text,
    CONSTRAINT referral_tree_check CHECK ((child_address <> parent_address))
);


ALTER TABLE public.referral_tree OWNER TO stellarwork;

--
-- Name: referral_tree_stats; Type: VIEW; Schema: public; Owner: stellarwork
--

CREATE VIEW public.referral_tree_stats AS
 SELECT rt.parent_address AS referrer_address,
    count(DISTINCT rt.child_address) AS direct_referrals,
    count(DISTINCT rt2.child_address) AS level2_referrals,
    count(DISTINCT rt3.child_address) AS level3_referrals,
    COALESCE(sum(mlp.amount_xlm), (0)::numeric) AS total_tree_earned_xlm
   FROM (((public.referral_tree rt
     LEFT JOIN public.referral_tree rt2 ON ((rt2.parent_address = rt.child_address)))
     LEFT JOIN public.referral_tree rt3 ON ((rt3.parent_address = rt2.child_address)))
     LEFT JOIN public.multi_level_payouts mlp ON ((mlp.recipient_address = rt.parent_address)))
  GROUP BY rt.parent_address;


ALTER VIEW public.referral_tree_stats OWNER TO stellarwork;

--
-- Name: referrals; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.referrals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    referrer_address text NOT NULL,
    referee_address text NOT NULL,
    job_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    payout_amount numeric(20,7),
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    depth integer DEFAULT 1 NOT NULL,
    parent_address text,
    CONSTRAINT referrals_depth_check CHECK (((depth >= 1) AND (depth <= 3)))
);


ALTER TABLE public.referrals OWNER TO stellarwork;

--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.schema_migrations (
    version integer NOT NULL,
    name text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.schema_migrations OWNER TO stellarwork;

--
-- Name: scope_sessions; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.scope_sessions (
    session_id text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    cursors jsonb DEFAULT '{}'::jsonb NOT NULL,
    finalized boolean DEFAULT false NOT NULL,
    finalized_payload jsonb,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.scope_sessions OWNER TO stellarwork;

--
-- Name: sla_violations_id_seq; Type: SEQUENCE; Schema: public; Owner: stellarwork
--

CREATE SEQUENCE public.sla_violations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.sla_violations_id_seq OWNER TO stellarwork;

--
-- Name: sla_violations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: stellarwork
--

ALTER SEQUENCE public.sla_violations_id_seq OWNED BY public.sla_violations.id;


--
-- Name: webauthn_credentials; Type: TABLE; Schema: public; Owner: stellarwork
--

CREATE TABLE public.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    public_key text NOT NULL,
    credential_id text NOT NULL,
    credential_name text DEFAULT 'Passkey'::text NOT NULL,
    public_key_cose text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.webauthn_credentials OWNER TO stellarwork;

--
-- Name: availability_check_history id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.availability_check_history ALTER COLUMN id SET DEFAULT nextval('public.availability_check_history_id_seq'::regclass);


--
-- Name: insurance_claims id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_claims ALTER COLUMN id SET DEFAULT nextval('public.insurance_claims_id_seq'::regclass);


--
-- Name: insurance_premiums_paid id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_premiums_paid ALTER COLUMN id SET DEFAULT nextval('public.insurance_premiums_paid_id_seq'::regclass);


--
-- Name: insured_files id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insured_files ALTER COLUMN id SET DEFAULT nextval('public.insured_files_id_seq'::regclass);


--
-- Name: oracle_proofs id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.oracle_proofs ALTER COLUMN id SET DEFAULT nextval('public.oracle_proofs_id_seq'::regclass);


--
-- Name: sla_violations id; Type: DEFAULT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.sla_violations ALTER COLUMN id SET DEFAULT nextval('public.sla_violations_id_seq'::regclass);


--
-- Name: admin_profiles admin_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.admin_profiles
    ADD CONSTRAINT admin_profiles_pkey PRIMARY KEY (id);


--
-- Name: api_key_usage_daily api_key_usage_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.api_key_usage_daily
    ADD CONSTRAINT api_key_usage_daily_pkey PRIMARY KEY (api_key_id, usage_date);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: applications applications_job_id_freelancer_address_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_job_id_freelancer_address_key UNIQUE (job_id, freelancer_address);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: assessment_questions assessment_questions_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_pkey PRIMARY KEY (id);


--
-- Name: assessment_skills assessment_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.assessment_skills
    ADD CONSTRAINT assessment_skills_pkey PRIMARY KEY (id);


--
-- Name: assessment_skills assessment_skills_slug_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.assessment_skills
    ADD CONSTRAINT assessment_skills_slug_key UNIQUE (slug);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: availability_check_history availability_check_history_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.availability_check_history
    ADD CONSTRAINT availability_check_history_pkey PRIMARY KEY (id);


--
-- Name: contract_events contract_events_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.contract_events
    ADD CONSTRAINT contract_events_pkey PRIMARY KEY (id);


--
-- Name: dao_arbitrators dao_arbitrators_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dao_arbitrators
    ADD CONSTRAINT dao_arbitrators_pkey PRIMARY KEY (public_key);


--
-- Name: dao_proposals dao_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dao_proposals
    ADD CONSTRAINT dao_proposals_pkey PRIMARY KEY (id);


--
-- Name: dao_votes dao_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dao_votes
    ADD CONSTRAINT dao_votes_pkey PRIMARY KEY (id);


--
-- Name: dao_votes dao_votes_proposal_id_voter_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dao_votes
    ADD CONSTRAINT dao_votes_proposal_id_voter_key UNIQUE (proposal_id, voter);


--
-- Name: dispute_evidence dispute_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_pkey PRIMARY KEY (id);


--
-- Name: escrows escrows_job_id_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.escrows
    ADD CONSTRAINT escrows_job_id_key UNIQUE (job_id);


--
-- Name: escrows escrows_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.escrows
    ADD CONSTRAINT escrows_pkey PRIMARY KEY (id);


--
-- Name: frozen_wallets frozen_wallets_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.frozen_wallets
    ADD CONSTRAINT frozen_wallets_pkey PRIMARY KEY (address);


--
-- Name: indexer_state indexer_state_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.indexer_state
    ADD CONSTRAINT indexer_state_pkey PRIMARY KEY (id);


--
-- Name: insurance_claims insurance_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_pkey PRIMARY KEY (id);


--
-- Name: insurance_premiums_paid insurance_premiums_paid_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_premiums_paid
    ADD CONSTRAINT insurance_premiums_paid_pkey PRIMARY KEY (id);


--
-- Name: insured_files insured_files_cid_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insured_files
    ADD CONSTRAINT insured_files_cid_key UNIQUE (cid);


--
-- Name: insured_files insured_files_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insured_files
    ADD CONSTRAINT insured_files_pkey PRIMARY KEY (id);


--
-- Name: job_drafts job_drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.job_drafts
    ADD CONSTRAINT job_drafts_pkey PRIMARY KEY (id);


--
-- Name: job_views job_views_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.job_views
    ADD CONSTRAINT job_views_pkey PRIMARY KEY (id);


--
-- Name: jobs jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: ml_ranking_shadow_events ml_ranking_shadow_events_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ml_ranking_shadow_events
    ADD CONSTRAINT ml_ranking_shadow_events_pkey PRIMARY KEY (id);


--
-- Name: multi_level_payouts multi_level_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.multi_level_payouts
    ADD CONSTRAINT multi_level_payouts_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_user_address_notification_type_cha_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_address_notification_type_cha_key UNIQUE (user_address, notification_type, channel);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oracle_proofs oracle_proofs_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.oracle_proofs
    ADD CONSTRAINT oracle_proofs_pkey PRIMARY KEY (id);


--
-- Name: platform_fee_payouts platform_fee_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.platform_fee_payouts
    ADD CONSTRAINT platform_fee_payouts_pkey PRIMARY KEY (id);


--
-- Name: private_messages private_messages_nonce_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.private_messages
    ADD CONSTRAINT private_messages_nonce_key UNIQUE (nonce);


--
-- Name: private_messages private_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.private_messages
    ADD CONSTRAINT private_messages_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (public_key);


--
-- Name: progress_updates progress_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.progress_updates
    ADD CONSTRAINT progress_updates_pkey PRIMARY KEY (id);


--
-- Name: ratings ratings_job_id_rater_address_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_job_id_rater_address_key UNIQUE (job_id, rater_address);


--
-- Name: ratings ratings_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_pkey PRIMARY KEY (id);


--
-- Name: referral_payouts referral_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_pkey PRIMARY KEY (id);


--
-- Name: referral_tree referral_tree_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_tree
    ADD CONSTRAINT referral_tree_pkey PRIMARY KEY (child_address);


--
-- Name: referrals referrals_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_pkey PRIMARY KEY (id);


--
-- Name: referrals referrals_referrer_address_referee_address_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_address_referee_address_key UNIQUE (referrer_address, referee_address);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: scope_sessions scope_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.scope_sessions
    ADD CONSTRAINT scope_sessions_pkey PRIMARY KEY (session_id);


--
-- Name: sla_violations sla_violations_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.sla_violations
    ADD CONSTRAINT sla_violations_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_credential_id_key; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_credential_id_key UNIQUE (credential_id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: api_keys_owner_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX api_keys_owner_idx ON public.api_keys USING btree (owner_public_key);


--
-- Name: api_keys_prefix_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX api_keys_prefix_idx ON public.api_keys USING btree (key_prefix);


--
-- Name: api_keys_revoked_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX api_keys_revoked_idx ON public.api_keys USING btree (revoked_at);


--
-- Name: applications_freelancer_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX applications_freelancer_address_idx ON public.applications USING btree (freelancer_address);


--
-- Name: applications_job_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX applications_job_created_idx ON public.applications USING btree (job_id, created_at);


--
-- Name: applications_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX applications_job_id_idx ON public.applications USING btree (job_id);


--
-- Name: assessment_questions_skill_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX assessment_questions_skill_idx ON public.assessment_questions USING btree (skill_id);


--
-- Name: assessment_questions_skill_status_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX assessment_questions_skill_status_idx ON public.assessment_questions USING btree (skill_id, status);


--
-- Name: assessment_skills_status_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX assessment_skills_status_idx ON public.assessment_skills USING btree (status);


--
-- Name: audit_logs_action_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);


--
-- Name: audit_logs_actor_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX audit_logs_actor_idx ON public.audit_logs USING btree (actor_address);


--
-- Name: audit_logs_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX audit_logs_created_idx ON public.audit_logs USING btree (created_at DESC);


--
-- Name: contract_events_created_at_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX contract_events_created_at_idx ON public.contract_events USING btree (created_at DESC);


--
-- Name: contract_events_event_type_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX contract_events_event_type_idx ON public.contract_events USING btree (event_type);


--
-- Name: contract_events_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX contract_events_job_id_idx ON public.contract_events USING btree (job_id);


--
-- Name: dao_proposals_status_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX dao_proposals_status_idx ON public.dao_proposals USING btree (status);


--
-- Name: dao_votes_proposal_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX dao_votes_proposal_idx ON public.dao_votes USING btree (proposal_id);


--
-- Name: dispute_evidence_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX dispute_evidence_job_id_idx ON public.dispute_evidence USING btree (job_id);


--
-- Name: idx_applications_freelancer_job; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_applications_freelancer_job ON public.applications USING btree (freelancer_address, job_id);


--
-- Name: idx_availability_check_created; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_availability_check_created ON public.availability_check_history USING btree (created_at DESC);


--
-- Name: idx_availability_check_file; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_availability_check_file ON public.availability_check_history USING btree (file_id);


--
-- Name: idx_insurance_claims_created_at; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insurance_claims_created_at ON public.insurance_claims USING btree (created_at DESC);


--
-- Name: idx_insurance_claims_file_id; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insurance_claims_file_id ON public.insurance_claims USING btree (file_id);


--
-- Name: idx_insurance_claims_owner; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insurance_claims_owner ON public.insurance_claims USING btree (owner_address);


--
-- Name: idx_insurance_claims_proof_submitted; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insurance_claims_proof_submitted ON public.insurance_claims USING btree (proof_submitted_at);


--
-- Name: idx_insurance_claims_status; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insurance_claims_status ON public.insurance_claims USING btree (status);


--
-- Name: idx_insured_files_created_at; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insured_files_created_at ON public.insured_files USING btree (created_at DESC);


--
-- Name: idx_insured_files_owner; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insured_files_owner ON public.insured_files USING btree (owner_address);


--
-- Name: idx_insured_files_status; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_insured_files_status ON public.insured_files USING btree (status);


--
-- Name: idx_jobs_skills_gin; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_jobs_skills_gin ON public.jobs USING gin (skills);


--
-- Name: idx_jobs_status_visibility; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_jobs_status_visibility ON public.jobs USING btree (status, visibility) WHERE ((status = 'open'::text) AND (visibility = 'public'::text));


--
-- Name: idx_notifications_user_created_at; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_notifications_user_created_at ON public.notifications USING btree (user_address, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_address, read) WHERE (read = false);


--
-- Name: idx_oracle_proofs_claim; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_oracle_proofs_claim ON public.oracle_proofs USING btree (claim_id);


--
-- Name: idx_oracle_proofs_oracle; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_oracle_proofs_oracle ON public.oracle_proofs USING btree (oracle_address);


--
-- Name: idx_oracle_proofs_verified; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_oracle_proofs_verified ON public.oracle_proofs USING btree (verified);


--
-- Name: idx_premiums_file; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_premiums_file ON public.insurance_premiums_paid USING btree (file_id);


--
-- Name: idx_premiums_owner; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_premiums_owner ON public.insurance_premiums_paid USING btree (owner_address);


--
-- Name: idx_premiums_status; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_premiums_status ON public.insurance_premiums_paid USING btree (payment_status);


--
-- Name: idx_unique_active_claim_per_file; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE UNIQUE INDEX idx_unique_active_claim_per_file ON public.insurance_claims USING btree (file_id) WHERE ((status)::text <> 'rejected'::text);


--
-- Name: idx_violations_created; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_violations_created ON public.sla_violations USING btree (created_at DESC);


--
-- Name: idx_violations_file; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_violations_file ON public.sla_violations USING btree (file_id);


--
-- Name: idx_violations_owner; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX idx_violations_owner ON public.sla_violations USING btree (owner_address);


--
-- Name: job_drafts_client_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX job_drafts_client_address_idx ON public.job_drafts USING btree (client_address);


--
-- Name: job_drafts_updated_at_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX job_drafts_updated_at_idx ON public.job_drafts USING btree (updated_at DESC);


--
-- Name: job_views_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX job_views_job_id_idx ON public.job_views USING btree (job_id, viewed_at DESC);


--
-- Name: job_views_job_ip_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX job_views_job_ip_idx ON public.job_views USING btree (job_id, ip_hash);


--
-- Name: jobs_applicant_count_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_applicant_count_idx ON public.jobs USING btree (applicant_count);


--
-- Name: jobs_budget_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_budget_idx ON public.jobs USING btree (budget);


--
-- Name: jobs_category_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_category_idx ON public.jobs USING btree (category);


--
-- Name: jobs_client_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_client_address_idx ON public.jobs USING btree (client_address);


--
-- Name: jobs_created_at_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_created_at_idx ON public.jobs USING btree (created_at DESC);


--
-- Name: jobs_deadline_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_deadline_idx ON public.jobs USING btree (deadline);


--
-- Name: jobs_description_trgm_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_description_trgm_idx ON public.jobs USING gin (lower(description) public.gin_trgm_ops);


--
-- Name: jobs_open_public_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_open_public_created_idx ON public.jobs USING btree (created_at DESC, id DESC) WHERE ((status = 'open'::text) AND (visibility = 'public'::text));


--
-- Name: jobs_search_vector_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_search_vector_idx ON public.jobs USING gin (job_search_vector);


--
-- Name: jobs_skills_gin_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_skills_gin_idx ON public.jobs USING gin (skills);


--
-- Name: jobs_status_category_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_status_category_created_idx ON public.jobs USING btree (status, category, created_at DESC, id DESC);


--
-- Name: jobs_status_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_status_idx ON public.jobs USING btree (status);


--
-- Name: jobs_title_trgm_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX jobs_title_trgm_idx ON public.jobs USING gin (lower(title) public.gin_trgm_ops);


--
-- Name: ml_ranking_shadow_events_mode_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX ml_ranking_shadow_events_mode_created_idx ON public.ml_ranking_shadow_events USING btree (mode, created_at DESC);


--
-- Name: ml_ranking_shadow_events_subject_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX ml_ranking_shadow_events_subject_idx ON public.ml_ranking_shadow_events USING btree (subject_key, created_at DESC);


--
-- Name: multi_level_payouts_freelancer_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX multi_level_payouts_freelancer_idx ON public.multi_level_payouts USING btree (freelancer_address);


--
-- Name: multi_level_payouts_job_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX multi_level_payouts_job_idx ON public.multi_level_payouts USING btree (job_id);


--
-- Name: multi_level_payouts_recipient_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX multi_level_payouts_recipient_idx ON public.multi_level_payouts USING btree (recipient_address);


--
-- Name: notification_preferences_user_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX notification_preferences_user_address_idx ON public.notification_preferences USING btree (user_address);


--
-- Name: platform_fee_payouts_job_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX platform_fee_payouts_job_idx ON public.platform_fee_payouts USING btree (job_id);


--
-- Name: platform_fee_payouts_recipient_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX platform_fee_payouts_recipient_idx ON public.platform_fee_payouts USING btree (recipient_address);


--
-- Name: private_messages_participants_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX private_messages_participants_idx ON public.private_messages USING btree (sender_address, recipient_address, created_at DESC);


--
-- Name: profiles_public_key_rating_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX profiles_public_key_rating_idx ON public.profiles USING btree (public_key, rating);


--
-- Name: progress_updates_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX progress_updates_job_id_idx ON public.progress_updates USING btree (job_id);


--
-- Name: ratings_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX ratings_job_id_idx ON public.ratings USING btree (job_id);


--
-- Name: ratings_rated_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX ratings_rated_address_idx ON public.ratings USING btree (rated_address);


--
-- Name: ratings_rated_created_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX ratings_rated_created_idx ON public.ratings USING btree (rated_address, created_at DESC);


--
-- Name: referral_payouts_referrer_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referral_payouts_referrer_idx ON public.referral_payouts USING btree (referrer_address);


--
-- Name: referral_tree_depth_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referral_tree_depth_idx ON public.referral_tree USING btree (depth);


--
-- Name: referral_tree_parent_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referral_tree_parent_idx ON public.referral_tree USING btree (parent_address);


--
-- Name: referrals_job_id_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referrals_job_id_idx ON public.referrals USING btree (job_id);


--
-- Name: referrals_parent_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referrals_parent_address_idx ON public.referrals USING btree (parent_address);


--
-- Name: referrals_referee_depth_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referrals_referee_depth_idx ON public.referrals USING btree (referee_address, depth);


--
-- Name: referrals_referrer_address_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX referrals_referrer_address_idx ON public.referrals USING btree (referrer_address);


--
-- Name: scope_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX scope_sessions_expires_at_idx ON public.scope_sessions USING btree (expires_at);


--
-- Name: webauthn_credentials_public_key_idx; Type: INDEX; Schema: public; Owner: stellarwork
--

CREATE INDEX webauthn_credentials_public_key_idx ON public.webauthn_credentials USING btree (public_key);


--
-- Name: jobs update_job_search_vector_trigger; Type: TRIGGER; Schema: public; Owner: stellarwork
--

CREATE TRIGGER update_job_search_vector_trigger BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_job_search_vector();


--
-- Name: api_key_usage_daily api_key_usage_daily_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.api_key_usage_daily
    ADD CONSTRAINT api_key_usage_daily_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;


--
-- Name: api_keys api_keys_owner_public_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_owner_public_key_fkey FOREIGN KEY (owner_public_key) REFERENCES public.profiles(public_key) ON DELETE CASCADE;


--
-- Name: applications applications_freelancer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_freelancer_address_fkey FOREIGN KEY (freelancer_address) REFERENCES public.profiles(public_key);


--
-- Name: applications applications_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: applications applications_referred_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES public.profiles(public_key);


--
-- Name: assessment_questions assessment_questions_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.assessment_questions
    ADD CONSTRAINT assessment_questions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.assessment_skills(id) ON DELETE CASCADE;


--
-- Name: availability_check_history availability_check_history_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.availability_check_history
    ADD CONSTRAINT availability_check_history_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.insured_files(id) ON DELETE CASCADE;


--
-- Name: dao_votes dao_votes_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dao_votes
    ADD CONSTRAINT dao_votes_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.dao_proposals(id) ON DELETE CASCADE;


--
-- Name: dispute_evidence dispute_evidence_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: dispute_evidence dispute_evidence_uploader_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.dispute_evidence
    ADD CONSTRAINT dispute_evidence_uploader_address_fkey FOREIGN KEY (uploader_address) REFERENCES public.profiles(public_key);


--
-- Name: escrows escrows_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.escrows
    ADD CONSTRAINT escrows_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: escrows escrows_referrer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.escrows
    ADD CONSTRAINT escrows_referrer_address_fkey FOREIGN KEY (referrer_address) REFERENCES public.profiles(public_key);


--
-- Name: frozen_wallets frozen_wallets_frozen_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.frozen_wallets
    ADD CONSTRAINT frozen_wallets_frozen_by_fkey FOREIGN KEY (frozen_by) REFERENCES public.profiles(public_key);


--
-- Name: insurance_claims insurance_claims_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_claims
    ADD CONSTRAINT insurance_claims_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.insured_files(id) ON DELETE CASCADE;


--
-- Name: insurance_premiums_paid insurance_premiums_paid_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.insurance_premiums_paid
    ADD CONSTRAINT insurance_premiums_paid_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.insured_files(id) ON DELETE CASCADE;


--
-- Name: job_views job_views_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.job_views
    ADD CONSTRAINT job_views_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: jobs jobs_client_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_client_address_fkey FOREIGN KEY (client_address) REFERENCES public.profiles(public_key);


--
-- Name: jobs jobs_disputed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_disputed_by_fkey FOREIGN KEY (disputed_by) REFERENCES public.profiles(public_key);


--
-- Name: jobs jobs_freelancer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_freelancer_address_fkey FOREIGN KEY (freelancer_address) REFERENCES public.profiles(public_key);


--
-- Name: messages messages_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;


--
-- Name: messages messages_receiver_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_receiver_address_fkey FOREIGN KEY (receiver_address) REFERENCES public.profiles(public_key);


--
-- Name: messages messages_sender_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_address_fkey FOREIGN KEY (sender_address) REFERENCES public.profiles(public_key);


--
-- Name: multi_level_payouts multi_level_payouts_freelancer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.multi_level_payouts
    ADD CONSTRAINT multi_level_payouts_freelancer_address_fkey FOREIGN KEY (freelancer_address) REFERENCES public.profiles(public_key);


--
-- Name: multi_level_payouts multi_level_payouts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.multi_level_payouts
    ADD CONSTRAINT multi_level_payouts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: multi_level_payouts multi_level_payouts_recipient_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.multi_level_payouts
    ADD CONSTRAINT multi_level_payouts_recipient_address_fkey FOREIGN KEY (recipient_address) REFERENCES public.profiles(public_key);


--
-- Name: notification_preferences notification_preferences_user_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_address_fkey FOREIGN KEY (user_address) REFERENCES public.profiles(public_key) ON DELETE CASCADE;


--
-- Name: oracle_proofs oracle_proofs_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.oracle_proofs
    ADD CONSTRAINT oracle_proofs_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.insurance_claims(id) ON DELETE CASCADE;


--
-- Name: platform_fee_payouts platform_fee_payouts_freelancer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.platform_fee_payouts
    ADD CONSTRAINT platform_fee_payouts_freelancer_address_fkey FOREIGN KEY (freelancer_address) REFERENCES public.profiles(public_key);


--
-- Name: platform_fee_payouts platform_fee_payouts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.platform_fee_payouts
    ADD CONSTRAINT platform_fee_payouts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: private_messages private_messages_recipient_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.private_messages
    ADD CONSTRAINT private_messages_recipient_address_fkey FOREIGN KEY (recipient_address) REFERENCES public.profiles(public_key);


--
-- Name: private_messages private_messages_sender_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.private_messages
    ADD CONSTRAINT private_messages_sender_address_fkey FOREIGN KEY (sender_address) REFERENCES public.profiles(public_key);


--
-- Name: progress_updates progress_updates_author_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.progress_updates
    ADD CONSTRAINT progress_updates_author_address_fkey FOREIGN KEY (author_address) REFERENCES public.profiles(public_key);


--
-- Name: progress_updates progress_updates_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.progress_updates
    ADD CONSTRAINT progress_updates_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: ratings ratings_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: ratings ratings_rated_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_rated_address_fkey FOREIGN KEY (rated_address) REFERENCES public.profiles(public_key);


--
-- Name: ratings ratings_rater_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.ratings
    ADD CONSTRAINT ratings_rater_address_fkey FOREIGN KEY (rater_address) REFERENCES public.profiles(public_key);


--
-- Name: referral_payouts referral_payouts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: referral_payouts referral_payouts_referee_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_referee_address_fkey FOREIGN KEY (referee_address) REFERENCES public.profiles(public_key);


--
-- Name: referral_payouts referral_payouts_referral_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_referral_id_fkey FOREIGN KEY (referral_id) REFERENCES public.referrals(id);


--
-- Name: referral_payouts referral_payouts_referrer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_payouts
    ADD CONSTRAINT referral_payouts_referrer_address_fkey FOREIGN KEY (referrer_address) REFERENCES public.profiles(public_key);


--
-- Name: referral_tree referral_tree_child_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_tree
    ADD CONSTRAINT referral_tree_child_address_fkey FOREIGN KEY (child_address) REFERENCES public.profiles(public_key);


--
-- Name: referral_tree referral_tree_parent_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referral_tree
    ADD CONSTRAINT referral_tree_parent_address_fkey FOREIGN KEY (parent_address) REFERENCES public.profiles(public_key);


--
-- Name: referrals referrals_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id);


--
-- Name: referrals referrals_parent_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_parent_address_fkey FOREIGN KEY (parent_address) REFERENCES public.profiles(public_key);


--
-- Name: referrals referrals_referee_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referee_address_fkey FOREIGN KEY (referee_address) REFERENCES public.profiles(public_key);


--
-- Name: referrals referrals_referrer_address_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.referrals
    ADD CONSTRAINT referrals_referrer_address_fkey FOREIGN KEY (referrer_address) REFERENCES public.profiles(public_key);


--
-- Name: sla_violations sla_violations_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.sla_violations
    ADD CONSTRAINT sla_violations_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.insured_files(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_public_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: stellarwork
--

ALTER TABLE ONLY public.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_public_key_fkey FOREIGN KEY (public_key) REFERENCES public.profiles(public_key) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict PcSFnnEoWLjM99FbtGyvLFCDuwdpZ0LfRaeu0GgtkMXyuzacODVoUBWRocaLVBr

