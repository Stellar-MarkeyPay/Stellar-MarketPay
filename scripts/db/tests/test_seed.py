import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS_DIR))


class SeedDeterminismTests(unittest.TestCase):
    def test_same_seed_produces_same_profiles(self):
        from seed import make_profiles

        rng1 = __import__("random").Random(42)
        rng2 = __import__("random").Random(42)
        profiles1 = make_profiles(rng1, 10)
        profiles2 = make_profiles(rng2, 10)
        self.assertEqual(len(profiles1), len(profiles2))
        for p1, p2 in zip(profiles1, profiles2):
            self.assertEqual(p1["public_key"], p2["public_key"])
            self.assertEqual(p1["display_name"], p2["display_name"])
            self.assertEqual(p1["role"], p2["role"])

    def test_different_seed_produces_different_profiles(self):
        from seed import make_profiles

        rng1 = __import__("random").Random(42)
        rng2 = __import__("random").Random(99)
        profiles1 = make_profiles(rng1, 10)
        profiles2 = make_profiles(rng2, 10)
        self.assertNotEqual(profiles1[0]["public_key"], profiles2[0]["public_key"])

    def test_stellar_public_key_format(self):
        from seed import stellar_public_key

        rng = __import__("random").Random(42)
        key = stellar_public_key(rng)
        self.assertTrue(key.startswith("G"))
        self.assertEqual(len(key), 56)

    def test_scale_small(self):
        from seed import make_profiles, make_jobs

        rng = __import__("random").Random(42)
        profiles = make_profiles(rng, 50)
        jobs = make_jobs(rng, profiles[:25], 20)
        self.assertEqual(len(profiles), 50)
        self.assertEqual(len(jobs), 20)

    def test_scale_integer(self):
        from seed import make_profiles

        rng = __import__("random").Random(42)
        profiles = make_profiles(rng, 100)
        self.assertEqual(len(profiles), 100)

    def test_make_jobs_assigns_categories(self):
        from seed import CATEGORIES, make_jobs

        rng = __import__("random").Random(42)
        profiles = [{"public_key": "G" + "A" * 55, "role": "client"}]
        jobs = make_jobs(rng, profiles, 10)
        categories = {j["category"] for j in jobs}
        self.assertLessEqual(len(categories), len(CATEGORIES))
        self.assertTrue(all(j["category"] in CATEGORIES for j in jobs))

    def test_make_applications_respects_uniqueness(self):
        from seed import make_applications

        rng = __import__("random").Random(42)
        jobs = [{"id": "job-1", "status": "open", "budget": 100}]
        freelancers = [{"public_key": "G" + "B" * 55, "role": "freelancer"}]
        apps = make_applications(rng, jobs, freelancers)
        self.assertLessEqual(len(apps), len(freelancers))

    def test_make_escrows_various_statuses(self):
        from seed import make_escrows

        rng = __import__("random").Random(42)
        jobs = [
            {"id": "job-1", "status": "completed", "budget": 100, "freelancer_address": "G" + "B" * 55},
            {"id": "job-2", "status": "in_progress", "budget": 200, "freelancer_address": "G" + "C" * 55},
        ]
        escrows = make_escrows(rng, jobs)
        statuses = {e["status"] for e in escrows}
        self.assertTrue(statuses.issubset({"funded", "released", "refunded", "timeout_refunded"}))

    def test_make_messages_links_participants(self):
        from seed import make_messages

        rng = __import__("random").Random(42)
        jobs = [
            {
                "id": "job-1",
                "client_address": "G" + "A" * 55,
                "freelancer_address": "G" + "B" * 55,
                "created_at": __import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=1),
            }
        ]
        profiles = {}
        messages = make_messages(rng, jobs, profiles)
        for msg in messages:
            self.assertIn(msg["sender_address"], ("G" + "A" * 55, "G" + "B" * 55))
            self.assertIn(msg["receiver_address"], ("G" + "A" * 55, "G" + "B" * 55))
            self.assertNotEqual(msg["sender_address"], msg["receiver_address"])

    def test_make_ratings_requires_completed_jobs(self):
        from seed import make_ratings

        rng = __import__("random").Random(42)
        jobs = [
            {"id": "job-1", "status": "completed", "client_address": "G" + "A" * 55, "freelancer_address": "G" + "B" * 55, "skills": ["Rust", "Soroban"]},
            {"id": "job-2", "status": "open", "client_address": "G" + "C" * 55, "freelancer_address": None, "skills": ["React"]},
        ]
        ratings = make_ratings(rng, jobs, {})
        self.assertTrue(all(r["stars"] >= 1 and r["stars"] <= 5 for r in ratings))

    def test_make_notifications_attached_to_profiles(self):
        from seed import make_notifications

        rng = __import__("random").Random(42)
        profiles = [{"public_key": "G" + "A" * 55}]
        jobs = []
        notifications = make_notifications(rng, profiles, jobs)
        for n in notifications:
            self.assertEqual(n["user_address"], "G" + "A" * 55)


class SeedCLITests(unittest.TestCase):
    def test_parse_args_defaults(self):
        from seed import parse_args

        with patch.object(sys, "argv", ["seed.py"]):
            args = parse_args()
        self.assertEqual(args.seed, 42)
        self.assertEqual(args.scale, "small")
        self.assertEqual(args.database_url, "")

    def test_parse_args_custom(self):
        from seed import parse_args

        with patch.object(sys, "argv", ["seed.py", "--seed", "99", "--scale", "medium", "--database-url", "postgresql://u:p@h/d"]):
            args = parse_args()
        self.assertEqual(args.seed, 99)
        self.assertEqual(args.scale, "medium")
        self.assertEqual(args.database_url, "postgresql://u:p@h/d")

    def test_fails_without_database_url(self):
        from seed import main

        with patch.object(sys, "argv", ["seed.py"]):
            with patch.dict(os.environ, {}, clear=True):
                self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
