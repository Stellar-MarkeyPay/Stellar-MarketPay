#!/usr/bin/env python3
"""scripts/db/seed.py - Generate a deterministic, realistic seed dataset."""

from __future__ import annotations

import argparse
import hashlib
import os
import random
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path


CATEGORIES = [
    "Smart Contracts",
    "Web Development",
    "Mobile Development",
    "UI/UX Design",
    "DevOps",
    "Data Science",
    "Blockchain Development",
    "Security Auditing",
]

SKILLS_POOL = [
    "Rust", "Soroban", "Stellar SDK", "Solidity", "React", "Next.js",
    "TypeScript", "Node.js", "Python", "Go", "Docker", "Kubernetes",
    "PostgreSQL", "Redis", "GraphQL", "Tailwind CSS", "Figma",
    "AWS", "GCP", "Azure", "Terraform", "CI/CD", "Machine Learning",
    "Data Engineering", "iOS", "Android", "Flutter", "React Native",
]

FIRST_NAMES = [
    "Aisha", "Kwame", "Chen", "Sofia", "Omar", "Yuki", "Fatima", "Diego",
    "Amara", "Lars", "Priya", "Kofi", "Elena", "Tariq", "Mei", "Jorge",
    "Zara", "Hiro", "Nia", "Rafael", "Leila", "Kai", "Ines", "Dev",
]

LAST_NAMES = [
    "Mensah", "Nakamura", "Silva", "Patel", "Osei", "Kim", "Rivera",
    "Hassan", "Johansson", "Ivanova", "Adeyemi", "Moreau", "Reyes",
    "Singh", "Andersen", "Kone", "Larsson", "Bello", "Ndegwa", "Ruiz",
]

BIO_TEMPLATES = [
    "Experienced {role} specialising in {skills}. Built {count}+ projects on Stellar.",
    "{role} focused on {skills}. passionate about decentralised finance and open source.",
    "Freelance {role} with strong background in {skills}. Delivered {count}+ successful jobs.",
    "{role} who loves {skills}. Active in the Stellar ecosystem since 2021.",
]

JOB_TITLES = [
    "Build a Soroban escrow contract for freelance payments",
    "Develop a Next.js marketplace frontend with wallet connect",
    "Audit a Stellar smart contract for reentrancy vulnerabilities",
    "Design a responsive UI for a decentralised job board",
    "Implement PostgreSQL full-text search for job listings",
    "Create a Rust service that indexes Horizon API events",
    "Set up Kubernetes blue-green deployment for Node.js API",
    "Write a Python ETL pipeline for on-chain analytics",
    "Build a real-time notification service with WebSockets",
    "Migrate a legacy Express API to TypeScript",
    "Develop a mobile app for Stellar wallet onboarding",
    "Implement ML ranking for job recommendations",
    "Create a CDN invalidation microservice",
    "Design an admin dashboard for dispute resolution",
    "Write end-to-end Playwright tests for checkout flow",
]

PROPOSAL_TEMPLATES = [
    "Hi, I have {years} years of experience with {skills} and would love to help. I recently completed a similar project on Stellar testnet.",
    "Hello! I specialise in {skills} and have delivered {count}+ jobs in this space. I can start immediately.",
    "Greetings! My background in {skills} aligns well with this job. I have a portfolio of {count}+ on-chain projects.",
    "Hi there! I am a {role} with deep expertise in {skills}. I would approach this by breaking it into milestones and delivering incrementally.",
]

MESSAGE_TEMPLATES = [
    "Hi, I have a question about the milestones. Could we adjust the second milestone deadline?",
    "Thanks for the clarification. I will start on the contract today.",
    "Can you share the Horizon network passphrase you want me to use?",
    "I have pushed the first deliverable to the repo. Let me know if the tests pass.",
    "The escrow contract has been deployed. Here is the contract ID: {contract_id}",
    "Please review the PR when you have a moment.",
    "I will need access to the staging environment to complete QA.",
    "Great work! The release transaction was confirmed on Stellar.",
]

REVIEW_TEMPLATES = [
    "Excellent work! Delivered ahead of schedule and the code quality is top notch.",
    "Good communication throughout. Would hire again for {skills} work.",
    "Completed the job but there were some delays. The final deliverable met requirements.",
    "Outstanding attention to detail. The smart contract passed all audit checks.",
    "Professional and responsive. Highly recommended for {skills} projects.",
]


def stellar_public_key(rng: random.Random) -> str:
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    return "G" + "".join(rng.choice(chars) for _ in range(55))


def make_profiles(rng: random.Random, count: int) -> list[dict]:
    profiles = []
    for _ in range(count):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        role = rng.choice(["client", "freelancer", "both"])
        skills = rng.sample(SKILLS_POOL, k=rng.randint(2, 6))
        bio = rng.choice(BIO_TEMPLATES).format(
            role=role,
            skills=", ".join(skills[:3]),
            count=rng.randint(5, 50),
        )
        profiles.append({
            "public_key": stellar_public_key(rng),
            "display_name": f"{first} {last}",
            "bio": bio,
            "skills": skills,
            "role": role,
            "rating": round(rng.uniform(3.0, 5.0), 2) if role != "client" else None,
            "completed_jobs": rng.randint(0, 40) if role != "client" else 0,
            "total_earned_xlm": round(rng.uniform(0, 15000), 7) if role != "client" else 0,
            "reputation_points": rng.randint(0, 500),
            "referral_count": rng.randint(0, 20),
        })
    return profiles


def make_jobs(rng: random.Random, clients: list[dict], count: int) -> list[dict]:
    jobs = []
    statuses = ["open", "open", "open", "in_progress", "completed", "cancelled"]
    for _ in range(count):
        client = rng.choice(clients)
        status = rng.choice(statuses)
        category = rng.choice(CATEGORIES)
        skills = rng.sample(SKILLS_POOL, k=rng.randint(2, 5))
        budget = round(rng.uniform(50, 5000), 7)
        jobs.append({
            "title": rng.choice(JOB_TITLES),
            "description": f"Looking for a skilled {category.lower()} professional. Skills required: {', '.join(skills)}.",
            "budget": budget,
            "currency": "XLM",
            "category": category,
            "skills": skills,
            "status": status,
            "client_address": client["public_key"],
            "freelancer_address": None,
            "escrow_contract_id": None,
            "applicant_count": 0,
            "visibility": rng.choice(["public", "public", "public", "invite_only"]),
            "created_at": datetime.utcnow() - timedelta(days=rng.randint(1, 90)),
        })
    return jobs


def make_applications(rng: random.Random, jobs: list[dict], freelancers: list[dict]) -> list[dict]:
    applications = []
    for job in jobs:
        if job["status"] in ("cancelled",):
            continue
        num_apps = rng.randint(0, min(6, len(freelancers)))
        applicants = rng.sample(freelancers, k=num_apps)
        for freelancer in applicants:
            proposal = rng.choice(PROPOSAL_TEMPLATES).format(
                years=rng.randint(2, 10),
                skills=", ".join(rng.sample(SKILLS_POOL, k=2)),
                count=rng.randint(3, 20),
                role=freelancer["role"],
            )
            status = "pending"
            if job["status"] in ("in_progress", "completed"):
                status = rng.choice(["accepted", "rejected", "pending"])
            applications.append({
                "job_id": job["id"],
                "freelancer_address": freelancer["public_key"],
                "proposal": proposal,
                "bid_amount": round(job["budget"] * rng.uniform(0.7, 1.0), 7),
                "currency": "XLM",
                "status": status,
                "screening_answers": {},
                "referred_by": None,
                "bid_commitment": None,
                "bid_nonce": None,
                "bid_revealed": False,
                "revealed_bid_amount": None,
                "revealed_at": None,
            })
            job["applicant_count"] += 1
    return applications


def make_escrows(rng: random.Random, jobs: list[dict]) -> list[dict]:
    escrows = []
    statuses = ["funded", "released", "refunded", "timeout_refunded"]
    for job in jobs:
        if job["status"] in ("cancelled", "open") or not job.get("freelancer_address"):
            continue
        status = rng.choice(statuses) if job["status"] == "completed" else rng.choice(["funded", "released", "refunded"])
        escrows.append({
            "job_id": job["id"],
            "contract_id": f"C{hashlib.sha256(job['id'].encode()).hexdigest()[:55]}",
            "amount_xlm": job["budget"],
            "milestones": [
                {"name": "Milestone 1", "amount": str(job["budget"]), "due": "2026-09-01"},
                {"name": "Milestone 2", "amount": str(round(job["budget"] * 0.5, 7)), "due": "2026-10-01"},
            ],
            "status": status,
            "released_at": datetime.utcnow() - timedelta(days=rng.randint(1, 30)) if status in ("released", "timeout_refunded") else None,
            "timeout_at": datetime.utcnow() + timedelta(days=rng.randint(7, 60)) if status == "funded" else None,
        })
    return escrows


def make_messages(rng: random.Random, jobs: list[dict], profiles_by_key: dict[str, dict]) -> list[dict]:
    messages = []
    for job in jobs:
        if not job.get("freelancer_address"):
            continue
        participants = [job["client_address"], job["freelancer_address"]]
        for _ in range(rng.randint(1, 8)):
            sender = rng.choice(participants)
            receiver = participants[0] if sender == participants[1] else participants[1]
            messages.append({
                "job_id": job["id"],
                "sender_address": sender,
                "receiver_address": receiver,
                "content": rng.choice(MESSAGE_TEMPLATES).format(contract_id=job.get("escrow_contract_id", "C...")),
                "read": rng.choice([True, False]),
                "created_at": job["created_at"] + timedelta(hours=rng.randint(1, 72)),
            })
    return messages


def make_ratings(rng: random.Random, jobs: list[dict], profiles_by_key: dict[str, dict]) -> list[dict]:
    ratings = []
    for job in jobs:
        if job["status"] != "completed" or not job.get("freelancer_address"):
            continue
        if rng.random() < 0.7:
            stars = rng.randint(3, 5)
            review = rng.choice(REVIEW_TEMPLATES).format(skills=", ".join(job["skills"][:2]))
            ratings.append({
                "job_id": job["id"],
                "rater_address": job["client_address"],
                "rated_address": job["freelancer_address"],
                "stars": stars,
                "review": review[:200],
            })
    return ratings


def make_referrals(rng: random.Random, profiles: list[dict]) -> list[dict]:
    referrals = []
    for _ in range(rng.randint(5, 20)):
        referrer, referee = rng.sample(profiles, k=2)
        if referrer["public_key"] == referee["public_key"]:
            continue
        referrals.append({
            "referrer_address": referrer["public_key"],
            "referee_address": referee["public_key"],
            "job_id": None,
            "status": rng.choice(["pending", "paid", "ineligible"]),
            "payout_amount": round(rng.uniform(1, 50), 7) if rng.random() < 0.5 else None,
            "paid_at": datetime.utcnow() - timedelta(days=rng.randint(1, 60)) if rng.random() < 0.5 else None,
        })
    return referrals


def make_private_messages(rng: random.Random, profiles: list[dict]) -> list[dict]:
    messages = []
    for _ in range(rng.randint(20, 80)):
        sender, recipient = rng.sample(profiles, k=2)
        messages.append({
            "sender_address": sender["public_key"],
            "recipient_address": recipient["public_key"],
            "sender_public_key": stellar_public_key(rng),
            "recipient_public_key": stellar_public_key(rng),
            "nonce": hashlib.sha256(os.urandom(16)).hexdigest(),
            "cipher_text": "ENCRYPTED:" + hashlib.sha256(os.urandom(32)).hexdigest()[:32],
            "created_at": datetime.utcnow() - timedelta(minutes=rng.randint(1, 10000)),
        })
    return messages


def make_progress_updates(rng: random.Random, jobs: list[dict]) -> list[dict]:
    updates = []
    texts = [
        "Completed milestone 1 and submitted for review.",
        "Blocked by API changes. Will update once resolved.",
        "Pushed latest changes to the feature branch.",
        "Client feedback incorporated. Ready for QA.",
        "Performance optimisation reduced load time by 40%.",
    ]
    for job in jobs:
        if job["status"] != "in_progress" or not job.get("freelancer_address"):
            continue
        for _ in range(rng.randint(1, 4)):
            updates.append({
                "job_id": job["id"],
                "author_address": job["freelancer_address"],
                "update_text": rng.choice(texts),
                "created_at": job["created_at"] + timedelta(days=rng.randint(1, 14)),
            })
    return updates


def make_job_invitations(rng: random.Random, jobs: list[dict], freelancers: list[dict]) -> list[dict]:
    invitations = []
    for job in jobs:
        if job["status"] != "open":
            continue
        for _ in range(rng.randint(0, 3)):
            freelancer = rng.choice(freelancers)
            invitations.append({
                "job_id": job["id"],
                "client_address": job["client_address"],
                "freelancer_address": freelancer["public_key"],
                "status": rng.choice(["pending", "accepted", "declined"]),
            })
    return invitations


def make_notifications(rng: random.Random, profiles: list[dict], jobs: list[dict]) -> list[dict]:
    notifications = []
    types = ["application_received", "job_completed", "escrow_released", "new_message", "rating_received"]
    for profile in profiles:
        for _ in range(rng.randint(1, 5)):
            job = rng.choice(jobs) if jobs else None
            notifications.append({
                "user_address": profile["public_key"],
                "type": rng.choice(types),
                "title": f"{rng.choice(['Update', 'Notification', 'Alert'])}: {rng.choice(['Job', 'Message', 'Payment'])}",
                "body": f"You have a new update regarding {job['title'] if job else 'your account'}.",
                "read": rng.choice([True, False]),
                "job_id": job["id"] if job else None,
                "link_path": f"/jobs/{job['id']}" if job else "/dashboard",
            })
    return notifications


def insert_rows(table: str, rows: list[dict], env: dict[str, str]) -> None:
    if not rows:
        return
    columns = list(rows[0].keys())
    values_list = []
    params = []
    for row in rows:
        row_values = []
        for col in columns:
            val = row[col]
            if val is None:
                row_values.append("NULL")
            elif isinstance(val, bool):
                row_values.append("TRUE" if val else "FALSE")
            elif isinstance(val, (int, float)):
                row_values.append(str(val))
            elif isinstance(val, list):
                row_values.append(f"'{str(val).replace(chr(39), chr(39)+chr(39))}'")
            elif isinstance(val, dict):
                row_values.append(f"'{str(val).replace(chr(39), chr(39)+chr(39))}'")
            else:
                row_values.append(f"'{str(val).replace(chr(39), chr(39)+chr(39))}'")
        values_list.append("(" + ", ".join(row_values) + ")")
    sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES\n\t" + ",\n\t".join(values_list) + ";"
    subprocess.run(
        ["psql", "-U", env["PGUSER"], "-d", env["PGDATABASE"], "-c", sql],
        env={**os.environ, **env},
        check=True,
    )


def main(args: argparse.Namespace | None = None) -> int:
    if args is None:
        args = parse_args()

    seed = args.seed
    scale = args.scale
    database_url = args.database_url or os.environ.get("DATABASE_URL", "")

    if not database_url:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1

    # Parse database URL for psql env
    # postgresql://user:pass@host:port/db
    env = {"PGDATABASE": "stellarwork", "PGUSER": "stellarwork", "PGPASSWORD": "stellarwork_dev", "PGHOST": "localhost", "PGPORT": "5432"}
    if database_url.startswith("postgresql://"):
        parts = database_url.replace("postgresql://", "").split("@")
        if len(parts) == 2:
            userpass = parts[0].split(":")
            hostport_db = parts[1].split("/")
            env["PGUSER"] = userpass[0]
            env["PGPASSWORD"] = userpass[1] if len(userpass) > 1 else ""
            hostport = hostport_db[0].split(":")
            env["PGHOST"] = hostport[0]
            if len(hostport) > 1:
                env["PGPORT"] = hostport[1]
            if len(hostport_db) > 1:
                env["PGDATABASE"] = hostport_db[1]

    scale_map = {
        "small": {"profiles": 50, "jobs": 20},
        "medium": {"profiles": 200, "jobs": 100},
        "large": {"profiles": 1000, "jobs": 500},
    }
    if scale in scale_map:
        counts = scale_map[scale]
        profile_count = counts["profiles"]
        job_count = counts["jobs"]
    else:
        try:
            profile_count = int(scale)
            job_count = max(1, profile_count // 5)
        except ValueError:
            print(f"Invalid scale: {scale}. Use small, medium, large, or an integer.", file=sys.stderr)
            return 1

    rng = random.Random(seed)
    print(f"Seeding database with scale={scale} (profiles={profile_count}, jobs={job_count}) using seed={seed}")

    profiles = make_profiles(rng, profile_count)
    profiles_by_key = {p["public_key"]: p for p in profiles}
    clients = [p for p in profiles if p["role"] in ("client", "both")]
    freelancers = [p for p in profiles if p["role"] in ("freelancer", "both")]

    print(f"  Generated {len(profiles)} profiles ({len(clients)} clients, {len(freelancers)} freelancers)")

    jobs = make_jobs(rng, clients, job_count)
    for job in jobs:
        job["id"] = str(uuid.uuid4())
    print(f"  Generated {len(jobs)} jobs")

    applications = make_applications(rng, jobs, freelancers)
    print(f"  Generated {len(applications)} applications")

    # Assign freelancers to in_progress/completed jobs
    for job in jobs:
        if job["status"] in ("in_progress", "completed") and freelancers:
            job["freelancer_address"] = rng.choice(freelancers)["public_key"]

    escrows = make_escrows(rng, jobs)
    print(f"  Generated {len(escrows)} escrows")

    messages = make_messages(rng, jobs, profiles_by_key)
    print(f"  Generated {len(messages)} messages")

    ratings = make_ratings(rng, jobs, profiles_by_key)
    print(f"  Generated {len(ratings)} ratings")

    referrals = make_referrals(rng, profiles)
    print(f"  Generated {len(referrals)} referrals")

    private_messages = make_private_messages(rng, profiles)
    print(f"  Generated {len(private_messages)} private messages")

    progress_updates = make_progress_updates(rng, jobs)
    print(f"  Generated {len(progress_updates)} progress updates")

    job_invitations = make_job_invitations(rng, jobs, freelancers)
    print(f"  Generated {len(job_invitations)} job invitations")

    notifications = make_notifications(rng, profiles, jobs)
    print(f"  Generated {len(notifications)} notifications")

    # Insert in dependency order
    insert_rows("profiles", profiles, env)
    print("  Inserted profiles")

    insert_rows("jobs", jobs, env)
    print("  Inserted jobs")

    insert_rows("applications", applications, env)
    print("  Inserted applications")

    insert_rows("escrows", escrows, env)
    print("  Inserted escrows")

    insert_rows("messages", messages, env)
    print("  Inserted messages")

    insert_rows("ratings", ratings, env)
    print("  Inserted ratings")

    insert_rows("referrals", referrals, env)
    print("  Inserted referrals")

    insert_rows("private_messages", private_messages, env)
    print("  Inserted private messages")

    insert_rows("progress_updates", progress_updates, env)
    print("  Inserted progress updates")

    insert_rows("job_invitations", job_invitations, env)
    print("  Inserted job invitations")

    insert_rows("notifications", notifications, env)
    print("  Inserted notifications")

    print("\nSeeding complete")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a deterministic seed dataset")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility (default: 42)")
    parser.add_argument("--scale", default="small", help="Dataset size: small, medium, large, or integer (default: small)")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""), help="PostgreSQL connection string")
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
