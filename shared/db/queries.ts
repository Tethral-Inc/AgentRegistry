import { getPool } from './pool.js';

export async function query<T>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rows as T[];
  } finally {
    client.release();
  }
}

export async function queryOne<T>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(
  text: string,
  params?: unknown[],
): Promise<number> {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}
