# Skyline Social: server setup

Social (friends, messages, presence and calls) needs one shared Supabase project that every Skyline connects to.

## 1. Create the project
1. Sign in at https://supabase.com and create a project (any name, nearest region).
2. **Authentication → Sign In / Providers → Email**: optionally turn off **Confirm email** so sign-up is instant.

## 2. Create the database
Open **SQL Editor**, paste all of `supabase/social.sql`, and press **Run**. It is safe to run again after updates.

It creates the tables, row-level security (each person can only read their own rows and their friends' presence),
the server functions every change goes through (validation, privacy, blocks and rate limits), and adds the
live-update tables to Supabase Realtime.

## 3. Connect Skyline
Put the project URL and the **anon / publishable** key in `main/social-config.json`:

```json
{ "url": "https://YOUR-PROJECT.supabase.co", "anonKey": "YOUR-ANON-KEY", "iceServers": [] }
```

The anon key is meant to be inside apps; everything is protected by the database rules. Never put the
**service_role / secret** key in Skyline.

## Calls across different networks (optional TURN)
Calls connect directly between PCs using public STUN servers. On some networks (strict school or office
firewalls, some mobile hotspots) a direct connection is impossible and a TURN relay is needed. Add one to
`iceServers`, for example from a TURN provider:

```json
"iceServers": [
  { "urls": ["stun:stun.l.google.com:19302"] },
  { "urls": ["turn:YOUR-TURN-HOST:443?transport=tcp"], "username": "…", "credential": "…" }
]
```

TURN credentials end up inside the app (every caller needs them), so use credentials limited to TURN.

## Testing locally
`node test/social/sql.test.mjs` checks the database rules as three users (PGlite, no Supabase needed).
`node test/social/server.mjs 47900` runs a local stand-in server; start Skyline with
`SKY_SOCIAL_TEST=http://127.0.0.1:47900` to use it.
