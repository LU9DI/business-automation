import pg from "pg";
const { Pool } = pg;

let pool: pg.Pool | undefined;
let shuttingDown = false;

const positiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

export function initDb() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");

    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: true },
      max: positiveInt(process.env.PG_POOL_MAX, 5),
      connectionTimeoutMillis: positiveInt(process.env.PG_CONNECT_TIMEOUT_MS, 10000),
      idleTimeoutMillis: positiveInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
      maxUses: positiveInt(process.env.PG_MAX_USES, 5000),
      allowExitOnIdle: false,
    });

    pool.on("error", (error) => {
      console.error(JSON.stringify({ event: "db.pool_error", error: error.message }));
    });
  }

  return pool;
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await initDb().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb() {
  if (!pool || shuttingDown) return;
  shuttingDown = true;
  const current = pool;
  pool = undefined;
  await current.end();
  shuttingDown = false;
}
