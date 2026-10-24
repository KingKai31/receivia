import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { DATABASE_URL } from './helpers';
import { actAs as pgliteActAs, pgliteUser, pgliteWithMigrations } from './pglite';

/**
 * One test database for the service-style DB suites: in-process PGlite by default, or the real
 * Postgres in DATABASE_URL when REMOTE_DB=1 (npm run test:db:remote). The remote variant creates its
 * own users and orgs and deletes them again on close, so nothing but audit_log rows is left behind.
 */
export const REMOTE = process.env.REMOTE_DB === '1';

const int8AsNumber = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    oid === 20 ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format as 'text'),
};

interface RemoteDb {
  query: pg.Client['query'];
  close: () => Promise<void>;
  __users: string[];
  __client: pg.Client;
}

export async function openDb(): Promise<PGlite> {
  if (!REMOTE) return pgliteWithMigrations();
  const client = new pg.Client({
    connectionString: DATABASE_URL,
    types: int8AsNumber as unknown as pg.ClientConfig['types'],
  });
  await client.connect();
  const db: RemoteDb = {
    query: client.query.bind(client) as pg.Client['query'],
    __users: [],
    __client: client,
    close: async () => {
      try {
        for (const id of db.__users) {
          await client.query(`select set_config('request.jwt.claim.sub', '', false)`);
          const orgs = await client.query(
            'select org_id from public.memberships where user_id = $1',
            [id],
          );
          for (const o of orgs.rows)
            await client.query('delete from public.orgs where id = $1', [o.org_id]);
          await client.query('delete from auth.users where id = $1', [id]);
        }
        await client.query(`delete from public.rate_limits where key like 'ip:%'`);
      } finally {
        await client.end();
      }
    },
  };
  return db as unknown as PGlite;
}

export async function newUser(db: PGlite): Promise<{ userId: string; orgId: string }> {
  if (!REMOTE) return pgliteUser(db);
  const remote = db as unknown as RemoteDb;
  const userId = randomUUID();
  await remote.__client.query(
    `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`,
    [userId, `s4-test-${userId}@example.test`],
  );
  remote.__users.push(userId);
  const r = await remote.__client.query(
    'select org_id from public.memberships where user_id = $1',
    [userId],
  );
  return { userId, orgId: r.rows[0].org_id };
}

export async function actAs(db: PGlite, userId: string): Promise<void> {
  if (!REMOTE) return pgliteActAs(db, userId);
  await (db as unknown as RemoteDb).__client.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [userId],
  );
}
