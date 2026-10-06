import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb } from "../src/core/db.js";

const db = initDb();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../src/db/schema.sql");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

const client = await db.connect();
try {
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  await client.query("SELECT pg_advisory_lock(hashtext('application_migrations'))");

  const state = await client.query("SELECT COUNT(*)::int AS count FROM schema_migrations");
  if (state.rows[0].count === 0) {
    const schemaSql = await readFile(schemaPath, "utf8");
    await client.query("BEGIN");
    try {
      await client.query(schemaSql);
      await client.query("COMMIT");
      console.log("bootstrap schema applied");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version=$1", [version]);
    if (applied.rowCount) continue;

    const sql = await readFile(join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT(version) DO NOTHING",
        [version]
      );
      await client.query("COMMIT");
      console.log("migration applied:", version);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} catch (error) {
  console.error("database migration failed", error);
  process.exitCode = 1;
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('application_migrations'))").catch(() => {});
  client.release();
}
