import os
import logging
from datetime import datetime, timezone

import psycopg2
from psycopg2 import sql


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)


SOURCE_TABLES = [
    "profiles",
    "jobs",
    "job_views",
    "applications",
    "escrows",
    "ratings",
    "messages",
    "private_messages",
    "progress_updates",
    "notifications",
    "referrals",
]


def get_connection():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "localhost"),
        port=os.getenv("PGPORT", "5433"),
        database=os.getenv("PGDATABASE", "stellarwork"),
        user=os.getenv("PGUSER", "stellarwork"),
        password=os.getenv("PGPASSWORD", "stellarwork_dev"),
    )


def create_bronze_schema(conn):
    with conn.cursor() as cur:
        cur.execute(
            "CREATE SCHEMA IF NOT EXISTS bronze;"
        )

    conn.commit()


def ingest_table(conn, table_name):
    with conn.cursor() as cur:

        logging.info("Ingesting %s", table_name)

        bronze_identifier = sql.Identifier(
            "bronze",
            table_name,
        )

        source_identifier = sql.Identifier(
            "public",
            table_name,
        )

        cur.execute(
            sql.SQL(
                "DROP TABLE IF EXISTS {} CASCADE"
            ).format(bronze_identifier)
        )

        cur.execute(
            sql.SQL(
                """
                CREATE TABLE {} AS
                SELECT *
                FROM {}
                """
            ).format(
                bronze_identifier,
                source_identifier,
            )
        )

        cur.execute(
            sql.SQL(
                "ALTER TABLE {} ADD COLUMN _ingested_at TIMESTAMPTZ"
            ).format(bronze_identifier)
        )

        cur.execute(
            sql.SQL(
                """
                UPDATE {}
                SET _ingested_at = %s
                """
            ).format(bronze_identifier),
            (datetime.now(timezone.utc),),
        )

        cur.execute(
            sql.SQL(
                "SELECT COUNT(*) FROM {}"
            ).format(bronze_identifier)
        )

        row_count = cur.fetchone()[0]

        conn.commit()

        logging.info(
            "Completed %s | rows=%s",
            table_name,
            row_count,
        )

        return row_count


def main():

    logging.info("Starting Bronze ingestion")

    conn = get_connection()

    try:

        create_bronze_schema(conn)

        total_rows = 0

        for table in SOURCE_TABLES:

            try:
                rows = ingest_table(conn, table)
                total_rows += rows

            except Exception:
                conn.rollback()

                logging.exception(
                    "Failed to ingest %s",
                    table,
                )

                raise

        logging.info(
            "Bronze ingestion completed | total rows=%s",
            total_rows,
        )

    finally:
        conn.close()


if __name__ == "__main__":
    main()