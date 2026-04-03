import { Pool, type PoolConfig } from 'pg';

let pool: Pool | null = null;

type Environment = 'vercel' | 'lambda' | 'local';

const POOL_PRESETS: Record<Environment, Partial<PoolConfig>> = {
  vercel: {
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  },
  lambda: {
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  local: {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
};

function detectEnvironment(): Environment {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return 'lambda';
  return 'local';
}

export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.COCKROACH_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COCKROACH_CONNECTION_STRING environment variable is required');
  }

  const env = detectEnvironment();
  const preset = POOL_PRESETS[env];

  const config: PoolConfig = {
    connectionString,
    ssl: { rejectUnauthorized: true },
    ...preset,
  };

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err);
  });

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
