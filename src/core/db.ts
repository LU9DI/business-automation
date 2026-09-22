import pg from "pg";
const { Pool } = pg;
let pool: pg.Pool | undefined;
export function initDb() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required");
    pool = new Pool({ connectionString: url, ssl: /localhost|127\\.0\\.1/.test(url) ? false : { rejectUnauthorized: false }, max: Number(process.env.PG_POOL_MAX || 10) });
  }
  return pool;
}
