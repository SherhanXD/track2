import { Pool, PoolClient } from 'pg';
import { SCHEMA } from './schema';

const raw = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '';
const g = globalThis as unknown as { _pool?: Pool; _ready?: Promise<void> };

function config() {
  if (!raw) throw new Error('DATABASE_URL is not set');
  const u = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  u.searchParams.delete('sslmode'); // we set ssl ourselves below
  return {
    connectionString: u.toString(),
    max: 3,
    ssl: local ? false : { rejectUnauthorized: false },
  };
}

export function pool(): Pool {
  if (!g._pool) g._pool = new Pool(config());
  return g._pool;
}

export async function ready(): Promise<void> {
  if (!g._ready) {
    g._ready = pool().query(SCHEMA).then(() => undefined).catch((e) => {
      g._ready = undefined;
      throw e;
    });
  }
  return g._ready;
}

export async function q<T = Record<string, any>>(text: string, params: unknown[] = []): Promise<T[]> {
  await ready();
  return (await pool().query(text, params)).rows as T[];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ready();
  const c = await pool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
