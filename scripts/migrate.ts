import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initDb } from "../src/core/db.js";

const db = initDb();
const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "../migrations/20260922_acquisition_hardening.sql");
const sql = await readFile(migrationPath, "utf8");
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("database migrations applied");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("database migration failed", error);
  process.exitCode = 1;
} finally {
  client.release();
  await db.end();
}