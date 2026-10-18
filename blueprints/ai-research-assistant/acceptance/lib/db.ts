// Look at what the product stored. Used only by the tests that check secrets at rest.
// Talks to the database the runner created for this run (ACCEPTANCE_DATABASE_URL) through `psql`,
// which the suite already requires, so no driver is added. Reads only.
//
// Each scan is ONE statement over every table, not one query per column: the tests around it hold
// HTTP connections that the server closes after a few idle seconds, so a slow scan would make the
// next request fail for reasons that have nothing to do with the product.

import { execFileSync } from "node:child_process";

const DATABASE_URL = process.env.ACCEPTANCE_DATABASE_URL;

function psql(sql: string): string {
  if (!DATABASE_URL) throw new Error("ACCEPTANCE_DATABASE_URL is not set; run the suite through run.mjs");
  return execFileSync("psql", [DATABASE_URL, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Values that go into SQL literals are checked, not escaped: only plain token/email/password characters. */
function literal(value: string): string {
  if (!/^[A-Za-z0-9_\-.~+/=%@:$ ]+$/.test(value)) throw new Error(`refusing to put ${JSON.stringify(value.slice(0, 8))}… into SQL`);
  return `'${value}'`;
}

function tables(): string[] {
  return psql(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)
    .split("\n")
    .filter(Boolean);
}

/** Tables (other than those `skipTable` filters out) that have a row containing `needle` as stored text. */
export function whereStored(needle: string, skipTable: (table: string) => boolean = () => false): string[] {
  const parts = tables()
    .filter((table) => !skipTable(table))
    .map((table) => `SELECT '${table.replace(/'/g, "''")}' AS hit FROM ${ident(table)} t WHERE strpos(row_to_json(t)::text, ${literal(needle)}) > 0`);
  if (!parts.length) return [];
  return [...new Set(psql(parts.join(" UNION ALL ")).split("\n").filter(Boolean))];
}

/**
 * Number of stored values that are password hashes in a format this blueprint accepts:
 * argon2id (`$argon2id$…`) or bcrypt (`$2a$`, `$2b$`, `$2y$` followed by the cost). A value is a
 * hash only if a JSON string starts with it.
 */
export function countAcceptedPasswordHashes(): number {
  const pattern = '"\\$argon2id\\$|"\\$2[aby]\\$[0-9]{2}\\$';
  const parts = tables().map((table) => `SELECT 1 FROM ${ident(table)} t WHERE row_to_json(t)::text ~ '${pattern}'`);
  if (!parts.length) return 0;
  return Number(psql(`SELECT count(*) FROM (${parts.join(" UNION ALL ")}) hits`));
}
