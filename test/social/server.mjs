// A stand-in for Supabase on this PC, for testing two Skylines talking to each other:
// the same supabase/social.sql in a local Postgres (PGlite), sign-up/sign-in, the server functions,
// and a live feed that only delivers rows each person is allowed to read (like Supabase Realtime).
// node test/social/server.mjs [port]
import http from "node:http";
import crypto from "node:crypto";
import { openDb, as } from "./db.mjs";

const PORT = +(process.argv[2] || 47900);
const SECRET = crypto.randomBytes(16).toString("hex");
const db = await openDb();
const TABLES = { voice_members: "user_id", voice_signals: "id", typing_state: "user_id", servers: "id", server_members: "server_id", channels: "id", channel_messages: "id", channel_reactions: "message_id", message_reactions: "message_id", messages: "id", friend_requests: "id", friendships: "id", presence: "user_id", notifications: "id", call_signals: "id", profile_details: "user_id" };
for (const [t, pk] of Object.entries(TABLES)) {
  await db.exec(`create or replace function public.tg_${t}() returns trigger language plpgsql as $$ begin
    perform pg_notify('changes', json_build_object('table', '${t}', 'type', TG_OP, 'pk', (case when TG_OP = 'DELETE' then OLD.${pk} else NEW.${pk} end)::text)::text);
    return null; end $$;
    drop trigger if exists tg_${t} on public.${t};
    create trigger tg_${t} after insert or update or delete on public.${t} for each row execute function public.tg_${t}();`);
}

// SKY_TEST_ADMIN=<username>: that account becomes an admin as soon as it picks its username (tests of the Admin section)
if (process.env.SKY_TEST_ADMIN) await db.exec(`create or replace function public.tg_test_admin() returns trigger language plpgsql as $$ begin
    if lower(NEW.username) = lower('${process.env.SKY_TEST_ADMIN.replace(/[^A-Za-z0-9_.]/g, "")}') then insert into public.badge_makers (user_id) values (NEW.id) on conflict do nothing; end if; return null; end $$;
  drop trigger if exists tg_test_admin on public.profiles;
  create trigger tg_test_admin after insert on public.profiles for each row execute function public.tg_test_admin();`);

const sign = uid => uid + "." + crypto.createHmac("sha256", SECRET).update(uid).digest("hex").slice(0, 32);
const who = req => { const t = String(req.headers.authorization || "").replace(/^Bearer /, ""); const uid = t.split(".")[0]; return t && sign(uid) === t ? uid : null; };
const hash = pw => crypto.createHash("sha256").update("skyline-test:" + pw).digest("hex");
const clients = new Set();   // { uid, res }
const files = new Map();     // conversation files: path -> data URL

// a change happened: send it to everyone who may read that row (call signals only to their recipient)
let queue = Promise.resolve();
await db.listen("changes", payload => {
  const c = JSON.parse(payload);
  queue = queue.then(async () => {
    const pk = TABLES[c.table];
    for (const cl of clients) {
      try {
        if (c.type === "DELETE") { cl.res.write(JSON.stringify({ table: c.table, type: "DELETE", row: {}, old: { [pk]: c.pk } }) + "\n"); continue; }
        const r = await as(db, cl.uid, `select to_jsonb(t) as row from public.${c.table} t where ${pk}::text = $1`, [c.pk]);
        const row = r.rows[0] && r.rows[0].row; if (!row) continue;
        if ((c.table === "call_signals" || c.table === "voice_signals") && row.to_id !== cl.uid) continue;
        cl.res.write(JSON.stringify({ table: c.table, type: c.type, row, old: {} }) + "\n");
      } catch (e) {}
    }
  });
});

const body = req => new Promise(res => { let d = ""; req.on("data", x => d += x); req.on("end", () => { try { res(JSON.parse(d || "{}")); } catch (e) { res({}); } }); });
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/auth/signup") {
      const { email, password } = await body(req);
      const r = await db.query(`insert into auth.users (email, password) values ($1, $2) on conflict (email) do nothing returning id`, [email, hash(password)]);
      if (!r.rows[0]) return send(res, 400, { error: "email_taken" });
      const id = r.rows[0].id; return send(res, 200, { token: sign(id), user: { id, email } });
    }
    if (req.method === "POST" && url.pathname === "/auth/signin") {
      const { email, password } = await body(req);
      const r = await db.query(`select id from auth.users where email = $1 and password = $2`, [email, hash(password)]);
      if (!r.rows[0]) return send(res, 400, { error: "bad_login" });
      const id = r.rows[0].id; return send(res, 200, { token: sign(id), user: { id, email } });
    }
    const uid = who(req);
    if (url.pathname.startsWith("/rpc/") && req.method === "POST") {
      if (!uid) return send(res, 401, { error: "signed_out" });
      const fn = url.pathname.slice(5).replace(/[^a-z_]/g, ""), args = await body(req), keys = Object.keys(args).filter(k => /^p_[a-z_]+$/.test(k));
      const vals = keys.map(k => args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]);
      const r = await as(db, uid, `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, vals);
      // like PostgREST: a table/set -> array, a single row type -> object, a scalar -> the value
      const SET = ["get_friends", "get_requests", "search_users", "get_profile", "my_profile", "get_blocked", "get_messages", "get_notifications"];
      const JSONSET = ["get_messages", "search_messages", "get_pins", "get_servers", "get_members", "get_invites", "get_channel_messages", "search_channel", "get_channel_pins",
        "my_badges", "admin_badges", "admin_badge_holders", "admin_users"];
      const data = JSONSET.includes(fn) ? r.rows.map(x => x[fn]) : SET.includes(fn) ? r.rows : ["send_message", "edit_message", "send_channel_message", "cm_edit"].includes(fn) ? r.rows[0] : r.rows[0] && r.rows[0][fn] !== "" ? r.rows[0][fn] ?? null : null;
      return send(res, 200, { data });
    }
    if (req.method === "POST" && url.pathname === "/files") {
      if (!uid) return send(res, 401, { error: "signed_out" });
      const { path, type, b64 } = await body(req);
      const okw = await db.query("select public.attach_ok($1, $2, true) as ok", [path, uid]);
      if (!okw.rows[0].ok) return send(res, 403, { error: "not_allowed" });
      files.set(path, `data:${type};base64,${b64}`); return send(res, 200, { data: path });
    }
    if (req.method === "POST" && url.pathname === "/fileurls") {
      if (!uid) return send(res, 401, { error: "signed_out" });
      const { paths } = await body(req), out = {};
      for (const p of paths || []) if (files.has(p) && (await db.query("select public.attach_ok($1, $2, false) as ok", [p, uid])).rows[0].ok) out[p] = files.get(p);
      return send(res, 200, { data: out });
    }
    if (url.pathname === "/events") {
      if (!uid) return send(res, 401, { error: "signed_out" });
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" });
      res.write("\n");
      const cl = { uid, res }; clients.add(cl); req.on("close", () => clients.delete(cl));
      return;
    }
    send(res, 404, { error: "not_found" });
  } catch (e) { send(res, 400, { error: /^[a-z_]{3,32}$/.test(e.message) ? e.message : "error: " + e.message }); }
}).listen(PORT, "127.0.0.1", () => console.log("social test server on http://127.0.0.1:" + PORT));
