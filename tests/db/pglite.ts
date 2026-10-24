import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/**
 * In-process Postgres with a stubbed Supabase auth schema and the real migrations applied.
 * Used when Docker/local Supabase is unavailable; the SQL under test is the production SQL.
 */
export async function pgliteWithMigrations(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create table auth.users (
      id uuid primary key, aud text, role text, email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, extensions to anon, authenticated;
  `);
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  return db;
}

/** Creates a user (the signup trigger gives them an owner membership of a new org). */
export async function pgliteUser(db: PGlite): Promise<{ userId: string; orgId: string }> {
  const userId = randomUUID();
  await db.query(
    `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`,
    [userId, `u-${userId}@example.test`],
  );
  const r = await db.query<{ org_id: string }>(
    'select org_id from public.memberships where user_id = $1',
    [userId],
  );
  return { userId, orgId: r.rows[0]!.org_id };
}

/** Acts as this user for the rest of the session (auth.uid() reads this setting). */
export async function actAs(db: PGlite, userId: string): Promise<void> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
}
