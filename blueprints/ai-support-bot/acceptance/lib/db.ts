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
  return execFileSync("psql", [DATABASE_URL, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The needle goes into SQL as hex, so any characters a token or password may contain are safe. */
function hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** Every base table in every schema except the system ones (the product may use its own, or a job queue's). */
function tables(): { schema: string; table: string }[] {
  return psql(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg\\_%'
     ORDER BY 1, 2`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [schema, table] = line.split("\t");
      return { schema, table };
    });
}

/**
 * Tables (other than those `skipTable` filters out, which is given the bare table name) that have a row
 * containing `needle`: as text, in a JSON value, or as the bytes of a bytea column (which Postgres
 * renders as hex). Tables outside `public` come back as `schema.table`.
 */
export function whereStored(needle: string, skipTable: (table: string) => boolean = () => false): string[] {
  const n = hex(needle);
  const parts = tables()
    .filter(({ table }) => !skipTable(table))
    .map(({ schema, table }) => {
      const label = (schema === "public" ? table : `${schema}.${table}`).replace(/'/g, "''");
      return `SELECT '${label}' AS hit FROM ${ident(schema)}.${ident(table)} t, LATERAL (SELECT row_to_json(t)::text AS j) r
              WHERE strpos(r.j, convert_from(decode('${n}', 'hex'), 'UTF8')) > 0 OR strpos(r.j, '${n}') > 0`;
    });
  if (!parts.length) return [];
  return [...new Set(psql(parts.join(" UNION ALL ")).split("\n").filter(Boolean))];
}

/**
 * Password hashes found in the database, by what they are:
 *  - `accepted`: argon2id (`$argon2id$…`), or bcrypt (`$2a$`, `$2b$`, `$2y$`) with cost 12 or more;
 *  - `weakBcrypt`: bcrypt with cost 0–11.
 * A value is a hash only if a JSON string starts with it; rows are counted, not values.
 */
export function passwordHashes(): { accepted: number; weakBcrypt: number } {
  const accepted = '"\\$argon2id\\$|"\\$2[aby]\\$(1[2-9]|[2-3][0-9])\\$';
  const weak = '"\\$2[aby]\\$(0[0-9]|1[01])\\$';
  const parts = tables().map(({ schema, table }) => `SELECT row_to_json(t)::text AS j FROM ${ident(schema)}.${ident(table)} t`);
  if (!parts.length) return { accepted: 0, weakBcrypt: 0 };
  const [a, w] = psql(
    `SELECT count(*) FILTER (WHERE j ~ '${accepted}'), count(*) FILTER (WHERE j ~ '${weak}') FROM (${parts.join(" UNION ALL ")}) rows`,
  )
    .split("\t")
    .map(Number);
  return { accepted: a, weakBcrypt: w };
}
