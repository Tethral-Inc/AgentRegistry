let Pool: typeof import('pg').Pool;
let pool: InstanceType<typeof import('pg').Pool> | null = null;

type Environment = 'vercel' | 'lambda' | 'local';

const POOL_PRESETS: Record<Environment, Record<string, number>> = {
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

export async function getPool() {
  if (pool) return pool;

  // Lazy import pg to avoid crashing in edge runtime
  if (!Pool) {
    const pg = await import('pg');
    Pool = pg.default?.Pool ?? pg.Pool;

    // Fix pg returning INT/BIGINT as strings instead of numbers
    // OID 20 = INT8/BIGINT, OID 23 = INT4, OID 700 = FLOAT4, OID 701 = FLOAT8
    const types = pg.default?.types ?? pg.types;
    if (types) {
      types.setTypeParser(20, (val: string) => parseInt(val, 10));   // BIGINT
      types.setTypeParser(23, (val: string) => parseInt(val, 10));   // INT4
      types.setTypeParser(700, (val: string) => parseFloat(val));    // FLOAT4
      types.setTypeParser(701, (val: string) => parseFloat(val));    // FLOAT8
    }
  }

  const connectionString = process.env.COCKROACH_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('COCKROACH_CONNECTION_STRING environment variable is required');
  }

  const env = detectEnvironment();
  const preset = POOL_PRESETS[env];

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    ...preset,
  });

  pool.on('error', (err: Error) => {
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
