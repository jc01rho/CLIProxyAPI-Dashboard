#!/usr/bin/env python3
"""
Migrate data từ Supabase sang PostgreSQL (self-hosted).

Usage:
    pip install requests psycopg2-binary
    python migrate_from_supabase.py

Yêu cầu: File .env phải có SUPABASE_URL, SUPABASE_SECRET_KEY, DB_PASSWORD
Hoặc truyền trực tiếp qua biến môi trường.
"""

import os
import sys
import json
import requests
import psycopg2
import psycopg2.extras
from pathlib import Path
from dotenv import load_dotenv

# Load .env
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
    print(f"Loaded .env from {env_path}")

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SECRET_KEY = os.getenv('SUPABASE_SECRET_KEY', '')
DB_PASSWORD = os.getenv('DB_PASSWORD', '')
DB_HOST = os.getenv('DB_HOST', 'localhost')
DB_PORT = os.getenv('DB_PORT', '5432')
DB_NAME = os.getenv('DB_NAME', 'cliproxy')
DB_USER = os.getenv('DB_USER', 'cliproxy')

DATABASE_URL = os.getenv(
    'DATABASE_URL',
    f'postgres://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}'
)


def supabase_fetch_all(table: str, select: str = '*', page_size: int = 1000) -> list:
    """Fetch all rows from a Supabase table using pagination."""
    headers = {
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': f'Bearer {SUPABASE_SECRET_KEY}',
        'Prefer': 'count=exact',
    }
    base_url = f"{SUPABASE_URL}/rest/v1/{table}"
    all_rows = []
    offset = 0

    while True:
        params = {
            'select': select,
            'offset': offset,
            'limit': page_size,
            'order': 'id.asc',
        }
        resp = requests.get(base_url, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        print(f"  Fetched {len(all_rows)} rows from {table}...")
        if len(rows) < page_size:
            break
        offset += page_size

    return all_rows


def insert_rows(cur, table: str, rows: list, jsonb_cols: set = None):
    """Insert rows into PostgreSQL table, wrapping JSONB columns."""
    if not rows:
        print(f"  No rows to insert for {table}")
        return

    jsonb_cols = jsonb_cols or set()
    cols = list(rows[0].keys())
    col_names = ', '.join(f'"{c}"' for c in cols)
    placeholders = ', '.join(['%s'] * len(cols))
    sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

    count = 0
    for row in rows:
        vals = []
        for c in cols:
            v = row.get(c)
            if c in jsonb_cols and v is not None and not isinstance(v, psycopg2.extras.Json):
                v = psycopg2.extras.Json(v)
            vals.append(v)
        cur.execute(sql, vals)
        count += 1

    print(f"  Inserted {count} rows into {table}")


def reset_sequences(cur):
    """Reset all BIGSERIAL/SERIAL sequences to max(id)+1 to avoid conflicts."""
    sequences = [
        ('usage_snapshots', 'usage_snapshots_id_seq'),
        ('model_usage', 'model_usage_id_seq'),
        ('daily_stats', 'daily_stats_id_seq'),
        ('model_pricing', 'model_pricing_id_seq'),
        ('credential_usage_summary', 'credential_usage_summary_id_seq'),
        ('credential_daily_stats', 'credential_daily_stats_id_seq'),
    ]
    for table, seq in sequences:
        cur.execute(f'SELECT COALESCE(MAX(id), 0) FROM "{table}"')
        max_id = cur.fetchone()[0]
        cur.execute(f"SELECT setval('{seq}', GREATEST(%s, 1))", (max_id,))
        print(f"  Reset {seq} to {max_id}")


def main():
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env")
        sys.exit(1)

    if not DB_PASSWORD and 'DB_PASSWORD' not in os.environ and 'DATABASE_URL' not in os.environ:
        print("ERROR: DB_PASSWORD (or DATABASE_URL) must be set in .env")
        sys.exit(1)

    print(f"\n{'='*60}")
    print("CLIProxy Dashboard — Supabase → PostgreSQL Migration")
    print(f"{'='*60}")
    print(f"Source: {SUPABASE_URL}")
    print(f"Target: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    print()

    # Connect to local PostgreSQL
    print("Connecting to PostgreSQL...")
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            # ── 1. usage_snapshots ─────────────────────────────────────────
            print("\n[1/6] Migrating usage_snapshots...")
            rows = supabase_fetch_all('usage_snapshots')
            insert_rows(cur, 'usage_snapshots', rows, jsonb_cols={'raw_data'})

            # ── 2. model_usage ─────────────────────────────────────────────
            print("\n[2/6] Migrating model_usage...")
            rows = supabase_fetch_all('model_usage')
            insert_rows(cur, 'model_usage', rows)

            # ── 3. daily_stats ─────────────────────────────────────────────
            print("\n[3/6] Migrating daily_stats...")
            rows = supabase_fetch_all('daily_stats')
            # breakdown column might not exist in Supabase schema — handle gracefully
            insert_rows(cur, 'daily_stats', rows, jsonb_cols={'breakdown'})

            # ── 4. model_pricing ───────────────────────────────────────────
            print("\n[4/6] Migrating model_pricing...")
            rows = supabase_fetch_all('model_pricing')
            insert_rows(cur, 'model_pricing', rows)

            # ── 5. credential_usage_summary ────────────────────────────────
            print("\n[5/6] Migrating credential_usage_summary...")
            rows = supabase_fetch_all('credential_usage_summary')
            insert_rows(cur, 'credential_usage_summary', rows,
                       jsonb_cols={'credentials', 'api_keys'})

            # ── 6. credential_daily_stats ──────────────────────────────────
            print("\n[6/6] Migrating credential_daily_stats...")
            try:
                rows = supabase_fetch_all('credential_daily_stats')
                insert_rows(cur, 'credential_daily_stats', rows,
                           jsonb_cols={'credentials', 'api_keys'})
            except Exception as e:
                print(f"  Skipped (table may not exist in Supabase): {e}")

            # ── Reset sequences ────────────────────────────────────────────
            print("\nResetting PostgreSQL sequences...")
            reset_sequences(cur)

        conn.commit()
        print(f"\n{'='*60}")
        print("✓ Migration completed successfully!")
        print(f"{'='*60}\n")

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: Migration failed — {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
