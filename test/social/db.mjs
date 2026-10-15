// A local Postgres (PGlite) with the same `auth` pieces Supabase has, running supabase/social.sql unchanged.
// Used by the SQL tests and by the local test server; never shipped with the app.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PRELUDE = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique not null, password text not null, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;

export async function openDb(dir) {
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.exec(PRELUDE);
  await db.exec(fs.readFileSync(path.join(ROOT, "supabase", "social.sql"), "utf8"));
  return db;
}

// run a query as a signed-in user (role authenticated, auth.uid() = uid), the way Supabase's API does
export async function as(db, uid, sql, params = []) {
  return db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || ""]);
    await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}

export async function newUser(db, email) {
  const r = await db.query(`insert into auth.users (email, password) values ($1, 'x') returning id`, [email]);
  return r.rows[0].id;
}
