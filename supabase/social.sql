-- Skyline Social: the database for friends, requests, messages, presence, calls and notifications.
-- Paste this whole file into Supabase → SQL Editor → Run. It is safe to run again (it only adds what's missing).
--
-- Design: the app never writes to these tables directly. Every change goes through a function below that
-- checks who you are (auth.uid()), validates the input and enforces privacy, blocks and rate limits on the
-- server. Row level security only lets you read your own rows (and your friends' presence), which is also
-- what the realtime feed delivers to you.


-- a picture you uploaded: a file in your own folder of the "media" bucket, or a small inline image
create or replace function public.media_ok(p_url text, p_uid uuid) returns boolean language sql immutable as $$
  select p_url is null
      or p_url ~ ('^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/media/' || p_uid::text || '/[A-Za-z0-9._-]{1,80}$')
      or (char_length(p_url) <= 400000 and p_url ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$');
$$;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  avatar text,                                   -- a small picture (data:image/… URL), or null for initials
  accent text not null default '#6d7cff',        -- the colour behind your initials
  badges jsonb not null default '[]'::jsonb,     -- only the badges you chose to show on your profile
  allow_requests text not null default 'everyone',
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_.]{3,20}$' and username !~ '(^\.|\.$|\.\.)'),
  constraint display_name_len check (char_length(btrim(display_name)) between 1 and 32),
  constraint avatar_ok check (avatar is null or (char_length(avatar) <= 120000 and avatar ~ '^data:image/(png|jpeg|webp);base64,')),
  constraint accent_ok check (accent ~ '^#[0-9a-fA-F]{6}$'),
  constraint badges_ok check (jsonb_typeof(badges) = 'array' and jsonb_array_length(badges) <= 6 and pg_column_size(badges) <= 4000),
  constraint allow_requests_ok check (allow_requests in ('everyone', 'friends_of_friends', 'nobody'))
);
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

create table if not exists public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id)
);
create unique index if not exists friend_requests_one_pending on public.friend_requests (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index if not exists friend_requests_to on public.friend_requests (to_id, status);
create index if not exists friend_requests_from on public.friend_requests (from_id, created_at);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  a uuid not null references public.profiles (id) on delete cascade,
  b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (a < b),
  unique (a, b)
);
create index if not exists friendships_b on public.friendships (b);

create table if not exists public.presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'away', 'dnd', 'offline')),
  last_seen timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references public.profiles (id) on delete cascade,
  recipient uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  client_id text check (client_id is null or char_length(client_id) <= 64),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
alter table public.messages add column if not exists reply_to uuid references public.messages (id) on delete set null;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
alter table public.messages add column if not exists pinned_at timestamptz;
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages add column if not exists meta jsonb not null default '{}'::jsonb;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_ok;
alter table public.messages add constraint messages_body_ok check (char_length(body) <= 4000 and (char_length(body) >= 1 or kind <> 'text' or deleted_at is not null));
alter table public.messages drop constraint if exists messages_kind_ok;
alter table public.messages add constraint messages_kind_ok check (kind in ('text', 'sticker', 'attachment', 'gif'));
alter table public.messages drop constraint if exists messages_meta_ok;
alter table public.messages add constraint messages_meta_ok check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 6000);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists messages_pair on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread on public.messages (recipient, sender) where read_at is null;
create index if not exists messages_rate on public.messages (sender, created_at);

create table if not exists public.call_signals (
  id bigserial primary key,
  call_id uuid not null,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('ring', 'ringing', 'accept', 'decline', 'busy', 'cancel', 'end', 'offer', 'answer', 'ice')),
  payload jsonb,
  created_at timestamptz not null default now()
);
alter table public.call_signals drop constraint if exists call_signals_kind_check;   -- (updates older installs to the current list)
alter table public.call_signals add constraint call_signals_kind_check check (kind in ('ring', 'ringing', 'accept', 'decline', 'busy', 'cancel', 'end', 'offer', 'answer', 'ice'));
create index if not exists call_signals_to on public.call_signals (to_id, created_at);
create index if not exists call_signals_from on public.call_signals (from_id, created_at);

create table if not exists public.notifications (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('request', 'accepted', 'missed_call')),
  actor uuid references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications add column if not exists body text;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('request', 'accepted', 'missed_call', 'announcement', 'badge'));
alter table public.notifications drop constraint if exists notifications_body_ok;
alter table public.notifications add constraint notifications_body_ok check (body is null or char_length(body) <= 500);

create table if not exists public.user_settings (       -- private: your own appearance, badges and social preferences
  user_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_size check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16000)
);

-- who may make badges (for now, only the owner: add people with
--   insert into public.badge_makers select id from public.profiles where lower(username) = lower('NAME');)
create table if not exists public.badge_makers (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.badge_makers enable row level security;
revoke all on public.badge_makers from anon, authenticated;

create table if not exists public.profile_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  bio text not null default '',
  pronouns text not null default '',
  banner text,
  banner_pos int not null default 50,
  banner_zoom int not null default 100,
  background text,
  background_pos int not null default 50,
  theme text not null default 'default',
  accent2 text,
  decoration text not null default '',
  status_text text not null default '',
  status_emoji text not null default '',
  status_expires timestamptz,
  games jsonb not null default '[]'::jsonb,
  interests jsonb not null default '[]'::jsonb,
  visibility text not null default 'everyone',
  updated_at timestamptz not null default now(),
  constraint bio_len check (char_length(bio) <= 400),
  constraint pronouns_len check (char_length(pronouns) <= 40),
  constraint banner_ok check (public.media_ok(banner, user_id)),
  constraint background_ok check (public.media_ok(background, user_id)),
  constraint positions_ok check (banner_pos between 0 and 100 and background_pos between 0 and 100 and banner_zoom between 100 and 300),
  constraint theme_ok check (theme in ('default', 'midnight', 'aurora', 'ember', 'rose', 'forest', 'mono')),
  constraint accent2_ok check (accent2 is null or accent2 ~ '^#[0-9a-fA-F]{6}$'),
  constraint decoration_ok check (decoration in ('', 'halo', 'ember', 'neon', 'gold', 'frost', 'orbit', 'sakura')),
  constraint status_ok check (char_length(status_text) <= 80 and char_length(status_emoji) <= 16),
  constraint games_ok check (jsonb_typeof(games) = 'array' and jsonb_array_length(games) <= 8 and pg_column_size(games) <= 1500),
  constraint interests_ok check (jsonb_typeof(interests) = 'array' and jsonb_array_length(interests) <= 12 and pg_column_size(interests) <= 1500),
  constraint visibility_ok check (visibility in ('everyone', 'friends'))
);
alter table public.profile_details add column if not exists allow_calls boolean not null default true;
alter table public.profiles drop constraint if exists avatar_ok;
alter table public.profiles add constraint avatar_ok check (public.media_ok(avatar, id));

-- ---------- helpers ----------
create or replace function public.pair_key(x uuid, y uuid) returns text language sql immutable as $$
  select least(x, y)::text || '_' || greatest(x, y)::text;
$$;

create or replace function public.are_friends(x uuid, y uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where a = least(x, y) and b = greatest(x, y));
$$;

create or replace function public.is_blocked(x uuid, y uuid) returns boolean   -- either one blocked the other
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker = x and blocked = y) or (blocker = y and blocked = x));
$$;

create or replace function public.has_blocked(p_blocker uuid, p_blocked uuid) returns boolean   -- (runs as the owner: you can't read others' block lists)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where blocker = p_blocker and blocked = p_blocked);
$$;

create or replace function public.can_make_badges() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from badge_makers where user_id = auth.uid());
$$;

create or replace function public.shown_status(p_user uuid) returns text       -- what friends see: offline unless recently active
language sql stable security definer set search_path = public as $$
  select coalesce((select case when last_seen > now() - interval '60 seconds' then status else 'offline' end from presence where user_id = p_user), 'offline');
$$;

create or replace function public.me() returns uuid
language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in'; end if;
  return u;
end $$;

create or replace function public.require_profile() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.me();
begin
  if not exists (select 1 from profiles where id = u) then raise exception 'no_profile'; end if;
  if exists (select 1 from suspended_users where user_id = u) then raise exception 'suspended'; end if;
  return u;
end $$;

-- ---------- row level security: read only what's yours ----------
alter table public.profiles enable row level security;
alter table public.blocks enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.presence enable row level security;
alter table public.messages enable row level security;
alter table public.call_signals enable row level security;
alter table public.notifications enable row level security;
alter table public.user_settings enable row level security;
alter table public.profile_details enable row level security;
alter table public.message_reactions enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or not public.has_blocked(profiles.id, auth.uid()));
drop policy if exists blocks_read on public.blocks;
create policy blocks_read on public.blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists requests_read on public.friend_requests;
create policy requests_read on public.friend_requests for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists friendships_read on public.friendships;
create policy friendships_read on public.friendships for select to authenticated using (auth.uid() in (a, b));
drop policy if exists presence_read on public.presence;
create policy presence_read on public.presence for select to authenticated using (user_id = auth.uid() or public.are_friends(auth.uid(), user_id));
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated using (auth.uid() in (sender, recipient));
drop policy if exists signals_read on public.call_signals;
create policy signals_read on public.call_signals for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists reactions_read on public.message_reactions;
create policy reactions_read on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and auth.uid() in (m.sender, m.recipient)));
drop policy if exists details_read on public.profile_details;
create policy details_read on public.profile_details for select to authenticated
  using (user_id = auth.uid() or (not public.has_blocked(user_id, auth.uid()) and (visibility = 'everyone' or public.are_friends(auth.uid(), user_id))));
drop policy if exists settings_read on public.user_settings;
create policy settings_read on public.user_settings for select to authenticated using (user_id = auth.uid());

-- no direct writes at all: everything goes through the functions below
revoke all on public.profiles, public.blocks, public.friend_requests, public.friendships, public.presence,
  public.messages, public.call_signals, public.notifications, public.user_settings, public.profile_details, public.message_reactions from anon, authenticated;
grant select on public.profiles, public.blocks, public.friend_requests, public.friendships, public.presence,
  public.messages, public.call_signals, public.notifications, public.user_settings, public.profile_details, public.message_reactions to authenticated;

-- ---------- your profile ----------
create or replace function public.check_username(p_username text) returns void
language plpgsql immutable as $$
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_.]{3,20}$' or p_username ~ '(^\.|\.$|\.\.)' then raise exception 'username_invalid'; end if;
  if lower(p_username) ~ '^(admin|administrator|mod|moderator|support|staff|system|official|skyline|sky|root|owner|help)$' then raise exception 'username_reserved'; end if;
end $$;

create or replace function public.username_available(p_username text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.me();
  perform public.check_username(p_username);
  return not exists (select 1 from profiles where lower(username) = lower(p_username) and id <> auth.uid());
end $$;

create or replace function public.create_profile(p_username text, p_display_name text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.me();
begin
  if exists (select 1 from profiles where id = u) then raise exception 'profile_exists'; end if;
  perform public.check_username(p_username);
  if exists (select 1 from profiles where lower(username) = lower(p_username)) then raise exception 'username_taken'; end if;
  insert into profiles (id, username, display_name, accent)
    values (u, p_username, btrim(coalesce(nullif(btrim(p_display_name), ''), p_username)),
            (array['#6d7cff','#3fb6a8','#e0795b','#c46ad8','#4f9bea','#d4a63c','#58b368','#e05c86'])[1 + (abs(hashtext(u::text)) % 8)]);
  insert into presence (user_id, status, last_seen) values (u, 'online', now());
  insert into user_settings (user_id) values (u);
exception when unique_violation then raise exception 'username_taken';
end $$;

create or replace function public.update_profile(p_display_name text default null, p_username text default null, p_avatar text default null,
  p_clear_avatar boolean default false, p_accent text default null, p_badges jsonb default null, p_allow_requests text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if p_username is not null then
    perform public.check_username(p_username);
    if exists (select 1 from profiles where lower(username) = lower(p_username) and id <> u) then raise exception 'username_taken'; end if;
  end if;
  update profiles set
    display_name = coalesce(nullif(btrim(p_display_name), ''), display_name),
    username = coalesce(p_username, username),
    avatar = case when p_clear_avatar then null else coalesce(p_avatar, avatar) end,
    accent = coalesce(p_accent, accent),
    allow_requests = coalesce(p_allow_requests, allow_requests)
  where id = u;
exception when unique_violation then raise exception 'username_taken';
         when check_violation then raise exception 'profile_invalid';
end $$;

drop function if exists public.my_profile();
create or replace function public.my_profile() returns table (id uuid, username text, display_name text, avatar text, accent text, badges jsonb, allow_requests text, status text,
  created_at timestamptz, details jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar, p.accent, p.badges, p.allow_requests, coalesce(pr.status, 'online'), p.created_at,
         coalesce((select to_jsonb(d) - 'user_id' from profile_details d where d.user_id = p.id), '{}'::jsonb)
  from profiles p left join presence pr on pr.user_id = p.id where p.id = auth.uid();
$$;

create or replace function public.get_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select data from user_settings where user_id = auth.uid()), '{}'::jsonb);
$$;

create or replace function public.save_settings(p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 16000 then raise exception 'settings_invalid'; end if;
  if not public.can_make_badges() then p_data := p_data - 'badges'; end if;
  insert into user_settings (user_id, data, updated_at) values (u, p_data, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now();
end $$;

-- the profile extras: only the keys you send change; everything is checked here
create or replace function public.update_profile_details(p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); d profile_details%rowtype; list jsonb; x text;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 8000 then raise exception 'details_invalid'; end if;
  insert into profile_details (user_id) values (u) on conflict do nothing;
  select * into d from profile_details where user_id = u for update;
  if p_data ? 'bio' then d.bio := left(regexp_replace(coalesce(p_data->>'bio', ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), 400); end if;
  if p_data ? 'pronouns' then d.pronouns := left(btrim(regexp_replace(coalesce(p_data->>'pronouns', ''), '[\x00-\x1F\x7F]', '', 'g')), 40); end if;
  if p_data ? 'banner' then d.banner := nullif(p_data->>'banner', ''); end if;
  if p_data ? 'banner_pos' then d.banner_pos := (p_data->>'banner_pos')::int; end if;
  if p_data ? 'banner_zoom' then d.banner_zoom := (p_data->>'banner_zoom')::int; end if;
  if p_data ? 'background' then d.background := nullif(p_data->>'background', ''); end if;
  if p_data ? 'background_pos' then d.background_pos := (p_data->>'background_pos')::int; end if;
  if p_data ? 'theme' then d.theme := coalesce(p_data->>'theme', 'default'); end if;
  if p_data ? 'accent2' then d.accent2 := nullif(p_data->>'accent2', ''); end if;
  if p_data ? 'decoration' then d.decoration := coalesce(p_data->>'decoration', ''); end if;
  if p_data ? 'visibility' then d.visibility := coalesce(p_data->>'visibility', 'everyone'); end if;
  if p_data ? 'allow_calls' then d.allow_calls := coalesce((p_data->>'allow_calls')::boolean, true); end if;
  foreach x in array array['games', 'interests'] loop
    if p_data ? x then
      list := p_data->x;
      if jsonb_typeof(list) <> 'array' or exists (select 1 from jsonb_array_elements(list) e where jsonb_typeof(e) <> 'string'
          or char_length(btrim(e #>> '{}')) not between 1 and (case when x = 'games' then 40 else 24 end) or (e #>> '{}') ~ '[\x00-\x1F\x7F<>]') then raise exception 'details_invalid'; end if;
      if x = 'games' then d.games := list; else d.interests := list; end if;
    end if;
  end loop;
  update profile_details set bio = d.bio, pronouns = d.pronouns, banner = d.banner, banner_pos = d.banner_pos, banner_zoom = d.banner_zoom,
    background = d.background, background_pos = d.background_pos, theme = d.theme, accent2 = d.accent2, decoration = d.decoration,
    visibility = d.visibility, games = d.games, interests = d.interests, allow_calls = d.allow_calls, updated_at = now() where user_id = u;
exception when check_violation or invalid_text_representation or numeric_value_out_of_range then raise exception 'details_invalid';
end $$;

-- your custom status: a short line and an emoji, cleared by itself after a while if you like (separate from Online / Away / DND)
create or replace function public.set_status(p_text text, p_emoji text default '', p_minutes int default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if char_length(coalesce(p_text, '')) > 80 or char_length(coalesce(p_emoji, '')) > 16 or (p_minutes is not null and p_minutes not between 1 and 10080) then raise exception 'status_invalid'; end if;
  insert into profile_details (user_id) values (u) on conflict do nothing;
  update profile_details set status_text = btrim(regexp_replace(coalesce(p_text, ''), '[\x00-\x1F\x7F]', '', 'g')), status_emoji = coalesce(p_emoji, ''),
    status_expires = case when p_minutes is null then null else now() + make_interval(mins => p_minutes) end, updated_at = now()
  where user_id = u;
end $$;

-- ---------- presence ----------
alter table public.presence add column if not exists activity jsonb;
-- you're here (every ~20 s), and what you're playing, if you share it: { "game": "Fortnite", "since": "<time>" }
drop function if exists public.heartbeat(text);
create or replace function public.heartbeat(p_status text default 'online', p_activity jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); a jsonb := null;
begin
  if p_status not in ('online', 'away', 'dnd', 'offline') then raise exception 'status_invalid'; end if;
  if p_activity is not null and p_status <> 'offline' and jsonb_typeof(p_activity) = 'object' and char_length(coalesce(p_activity->>'game', '')) between 1 and 60 then
    a := jsonb_build_object('game', p_activity->>'game', 'since', coalesce((p_activity->>'since')::timestamptz, now()));
  end if;
  insert into presence (user_id, status, last_seen, activity) values (u, p_status, now(), a)
    on conflict (user_id) do update set status = excluded.status, last_seen = now(), activity = excluded.activity;
exception when invalid_datetime_format or datetime_field_overflow then raise exception 'status_invalid';
end $$;
-- what someone's playing, as others see it: nothing when they look offline
create or replace function public.shown_activity(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.shown_status(p_user) <> 'offline' then (select activity from presence where user_id = p_user) end;
$$;

-- ---------- finding people ----------
create or replace function public.relation(me uuid, other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when me = other then 'self'
    when exists (select 1 from blocks where blocker = me and blocked = other) then 'blocked'
    when public.are_friends(me, other) then 'friend'
    when exists (select 1 from friend_requests where from_id = me and to_id = other and status = 'pending') then 'outgoing'
    when exists (select 1 from friend_requests where from_id = other and to_id = me and status = 'pending') then 'incoming'
    else 'none' end;
$$;

create or replace function public.search_users(p_query text)
returns table (id uuid, username text, display_name text, avatar text, accent text, badges jsonb, relation text, status text)
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_profile(); q text := lower(btrim(coalesce(p_query, '')));
begin
  q := regexp_replace(q, '^@', '');
  if char_length(q) < 2 or char_length(q) > 32 then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.id, p.username, p.display_name, p.avatar, p.accent, p.badges, public.relation(u, p.id),
           case when public.are_friends(u, p.id) then public.shown_status(p.id) else null end
    from profiles p
    where p.id <> u and not public.is_blocked(u, p.id)
      and (lower(p.username) like q || '%' or lower(p.display_name) like q || '%')
    order by (lower(p.username) = replace(q, '\_', '_')) desc, (lower(p.username) like q || '%') desc, lower(p.username)
    limit 20;
end $$;

-- what you may see of someone's profile extras (their visibility setting; an expired custom status is gone)
create or replace function public.details_for(p_user uuid, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when d.user_id is null then '{}'::jsonb
    when p_user = p_viewer or d.visibility = 'everyone' or public.are_friends(p_viewer, p_user) then
      (to_jsonb(d) - 'user_id' - 'updated_at' - 'status_expires') || jsonb_build_object(
        'status_text', case when d.status_expires is null or d.status_expires > now() then d.status_text else '' end,
        'status_emoji', case when d.status_expires is null or d.status_expires > now() then d.status_emoji else '' end,
        'status_expires', case when d.status_expires > now() then d.status_expires end)
    else jsonb_build_object('decoration', d.decoration, 'hidden', true) end
  from (select p_user as id) x left join profile_details d on d.user_id = x.id;
$$;

drop function if exists public.get_profile(uuid);
create or replace function public.get_profile(p_user uuid)
returns table (id uuid, username text, display_name text, avatar text, accent text, badges jsonb, relation text, status text, friends_since timestamptz,
  created_at timestamptz, details jsonb)
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if exists (select 1 from blocks where blocker = p_user and blocked = u) then raise exception 'not_found'; end if;
  return query
    select p.id, p.username, p.display_name, p.avatar, p.accent, p.badges, public.relation(u, p.id),
           case when public.are_friends(u, p.id) or p.id = u then public.shown_status(p.id) else null end,
           (select f.created_at from friendships f where f.a = least(u, p.id) and f.b = greatest(u, p.id)),
           p.created_at, public.details_for(p.id, u)
    from profiles p where p.id = p_user;
end $$;

-- ---------- friend requests ----------
create or replace function public.send_request(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); t profiles%rowtype; rev uuid;
begin
  select * into t from profiles where lower(username) = lower(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''));
  if t.id is null or exists (select 1 from blocks where blocker = t.id and blocked = u) then raise exception 'not_found'; end if;
  if t.id = u then raise exception 'self'; end if;
  if exists (select 1 from blocks where blocker = u and blocked = t.id) then raise exception 'you_blocked'; end if;
  if public.are_friends(u, t.id) then raise exception 'already_friends'; end if;
  if exists (select 1 from friend_requests where from_id = u and to_id = t.id and status = 'pending') then raise exception 'already_sent'; end if;
  -- they already asked you: sending one back just accepts it
  select id into rev from friend_requests where from_id = t.id and to_id = u and status = 'pending';
  if rev is not null then perform public.respond_request(rev, true); return 'accepted'; end if;
  if t.allow_requests = 'nobody' then raise exception 'not_accepting'; end if;
  if t.allow_requests = 'friends_of_friends' and not exists (
      select 1 from friendships f1 join friendships f2 on (case when f1.a = u then f1.b else f1.a end) = (case when f2.a = t.id then f2.b else f2.a end)
      where u in (f1.a, f1.b) and t.id in (f2.a, f2.b)) then raise exception 'not_accepting'; end if;
  if (select count(*) from friend_requests where from_id = u and created_at > now() - interval '1 hour') >= 30 then raise exception 'rate_limited'; end if;
  insert into friend_requests (from_id, to_id) values (u, t.id);
  insert into notifications (user_id, kind, actor) values (t.id, 'request', u);
  return 'sent';
exception when unique_violation then raise exception 'already_sent';
end $$;

create or replace function public.respond_request(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); r friend_requests%rowtype;
begin
  select * into r from friend_requests where id = p_id for update;
  if r.id is null or r.to_id <> u or r.status <> 'pending' then raise exception 'request_gone'; end if;
  if p_accept and public.is_blocked(r.from_id, u) then raise exception 'request_gone'; end if;
  update friend_requests set status = case when p_accept then 'accepted' else 'declined' end, updated_at = now() where id = p_id;
  if p_accept then
    insert into friendships (a, b) values (least(r.from_id, u), greatest(r.from_id, u)) on conflict do nothing;
    insert into notifications (user_id, kind, actor) values (r.from_id, 'accepted', u);
  end if;
  delete from notifications where user_id = u and kind = 'request' and actor = r.from_id;
end $$;

create or replace function public.cancel_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); r friend_requests%rowtype;
begin
  select * into r from friend_requests where id = p_id for update;
  if r.id is null or r.from_id <> u or r.status <> 'pending' then raise exception 'request_gone'; end if;
  update friend_requests set status = 'canceled', updated_at = now() where id = p_id;
  delete from notifications where user_id = r.to_id and kind = 'request' and actor = u;
end $$;

create or replace function public.get_requests()
returns table (id uuid, direction text, user_id uuid, username text, display_name text, avatar text, accent text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, case when r.to_id = auth.uid() then 'incoming' else 'outgoing' end, p.id, p.username, p.display_name, p.avatar, p.accent, r.created_at
  from friend_requests r join profiles p on p.id = case when r.to_id = auth.uid() then r.from_id else r.to_id end
  where r.status = 'pending' and auth.uid() in (r.from_id, r.to_id)
  order by r.created_at desc;
$$;

-- ---------- friends ----------
drop function if exists public.get_friends();
create or replace function public.get_friends()
returns table (id uuid, username text, display_name text, avatar text, accent text, badges jsonb, status text, last_seen timestamptz,
               unread int, last_message_at timestamptz, friends_since timestamptz, status_text text, status_emoji text, decoration text, activity jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar, p.accent, p.badges, public.shown_status(p.id),
         (select pr.last_seen from presence pr where pr.user_id = p.id),
         (select count(*)::int from messages m where m.recipient = auth.uid() and m.sender = p.id and m.read_at is null),
         (select max(m.created_at) from messages m where least(m.sender, m.recipient) = least(auth.uid(), p.id) and greatest(m.sender, m.recipient) = greatest(auth.uid(), p.id)),
         f.created_at,
         coalesce((select case when d.status_expires is null or d.status_expires > now() then d.status_text else '' end from profile_details d where d.user_id = p.id), ''),
         coalesce((select case when d.status_expires is null or d.status_expires > now() then d.status_emoji else '' end from profile_details d where d.user_id = p.id), ''),
         coalesce((select d.decoration from profile_details d where d.user_id = p.id), ''),
         public.shown_activity(p.id)
  from friendships f join profiles p on p.id = case when f.a = auth.uid() then f.b else f.a end
  where auth.uid() in (f.a, f.b)
  order by lower(p.display_name);
$$;

create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  delete from friendships where a = least(u, p_user) and b = greatest(u, p_user);
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if p_user = u then raise exception 'self'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'not_found'; end if;
  insert into blocks (blocker, blocked) values (u, p_user) on conflict do nothing;
  delete from friendships where a = least(u, p_user) and b = greatest(u, p_user);
  update friend_requests set status = 'canceled', updated_at = now()
    where status = 'pending' and ((from_id = u and to_id = p_user) or (from_id = p_user and to_id = u));
  delete from notifications where (user_id = u and actor = p_user) or (user_id = p_user and actor = u);
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  delete from blocks where blocker = u and blocked = p_user;
end $$;

create or replace function public.get_blocked() returns table (id uuid, username text, display_name text, avatar text, accent text)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.avatar, p.accent from blocks b join profiles p on p.id = b.blocked
  where b.blocker = auth.uid() order by b.created_at desc;
$$;

-- ---------- messages ----------
drop function if exists public.send_message(uuid, text, text);
drop function if exists public.send_message(uuid, text, text, uuid, text, jsonb);
-- a message: text, a sticker, or attachments (files already uploaded into your shared folder), optionally replying to one
create or replace function public.send_message(p_to uuid, p_body text, p_client_id text default null, p_reply_to uuid default null,
  p_kind text default 'text', p_meta jsonb default null) returns public.messages
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m messages%rowtype; b text := btrim(coalesce(p_body, ''), E' \n\r\t'); meta jsonb := '{}'::jsonb; a jsonb; k text := coalesce(p_kind, 'text');
begin
  if k not in ('text', 'sticker', 'attachment', 'gif') then raise exception 'message_invalid'; end if;
  if k = 'text' and char_length(b) = 0 then raise exception 'empty'; end if;
  if char_length(b) > 4000 then raise exception 'too_long'; end if;
  if not public.are_friends(u, p_to) or public.is_blocked(u, p_to) then raise exception 'not_friends'; end if;
  if (select count(*) from messages where sender = u and created_at > now() - interval '10 seconds') >= 20 then raise exception 'rate_limited'; end if;
  if p_reply_to is not null and not exists (select 1 from messages r where r.id = p_reply_to and least(r.sender, r.recipient) = least(u, p_to) and greatest(r.sender, r.recipient) = greatest(u, p_to)) then raise exception 'message_invalid'; end if;
  if k = 'sticker' then   -- a built-in sticker (pack/name) or one of your own uploaded pictures
    if p_meta ? 'sticker' and (p_meta->>'sticker') ~ '^[a-z0-9]{1,20}/[a-z0-9_-]{1,32}$' then meta := jsonb_build_object('sticker', p_meta->>'sticker');
    elsif p_meta ? 'url' and public.media_ok(p_meta->>'url', u) and (p_meta->>'url') is not null then meta := jsonb_build_object('url', p_meta->>'url');
    else raise exception 'message_invalid'; end if;
  elsif k = 'gif' then   -- a GIF from GIPHY: only its own picture links
    if coalesce(p_meta->>'url', '') !~ '^https://media[0-9]?\.giphy\.com/media/[A-Za-z0-9/_.-]{1,200}$' then raise exception 'message_invalid'; end if;
    meta := jsonb_build_object('url', p_meta->>'url', 'w', least(greatest(coalesce((p_meta->>'w')::int, 0), 0), 2000), 'h', least(greatest(coalesce((p_meta->>'h')::int, 0), 0), 2000), 'title', left(coalesce(p_meta->>'title', ''), 100));
  elsif k = 'attachment' then   -- files in the two of you's folder, with a name, size and type
    if jsonb_typeof(p_meta->'files') <> 'array' or jsonb_array_length(p_meta->'files') not between 1 and 6 then raise exception 'message_invalid'; end if;
    for a in select * from jsonb_array_elements(p_meta->'files') loop
      if coalesce(a->>'path', '') !~ ('^' || public.pair_key(u, p_to) || '/[A-Za-z0-9._-]{1,80}$')
         or char_length(coalesce(a->>'name', '')) not between 1 and 120 or coalesce(a->>'type', '') !~ '^[a-z]+/[a-z0-9.+-]{1,60}$'
         or coalesce((a->>'size')::bigint, -1) not between 1 and 26214400 then raise exception 'message_invalid'; end if;
    end loop;
    meta := jsonb_build_object('files', (select jsonb_agg(jsonb_build_object('path', e->>'path', 'name', e->>'name', 'type', e->>'type', 'size', (e->>'size')::bigint,
      'w', case when e ? 'w' then least(greatest((e->>'w')::int, 0), 20000) end, 'h', case when e ? 'h' then least(greatest((e->>'h')::int, 0), 20000) end)) from jsonb_array_elements(p_meta->'files') e));
  end if;
  if p_client_id is not null then   -- the same message sent twice (a retry after a dropped connection) is stored once
    select * into m from messages where sender = u and client_id = p_client_id and created_at > now() - interval '1 day';
    if m.id is not null then return m; end if;
  end if;
  insert into messages (sender, recipient, body, client_id, reply_to, kind, meta) values (u, p_to, b, left(p_client_id, 64), p_reply_to, k, meta) returning * into m;
  return m;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'message_invalid';
end $$;

-- your own messages: change the words, or delete (it shows as deleted for both of you)
create or replace function public.edit_message(p_id uuid, p_body text) returns public.messages
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m messages%rowtype; b text := btrim(coalesce(p_body, ''), E' \n\r\t');
begin
  select * into m from messages where id = p_id for update;
  if m.id is null or m.sender <> u or m.deleted_at is not null or m.kind <> 'text' then raise exception 'message_invalid'; end if;
  if char_length(b) = 0 then raise exception 'empty'; end if;
  if char_length(b) > 4000 then raise exception 'too_long'; end if;
  if b = m.body then return m; end if;
  update messages set body = b, edited_at = now() where id = p_id returning * into m;
  return m;
end $$;

create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m messages%rowtype;
begin
  select * into m from messages where id = p_id for update;
  if m.id is null or m.sender <> u then raise exception 'message_invalid'; end if;
  delete from message_reactions where message_id = p_id;
  update messages set body = '', meta = '{}'::jsonb, deleted_at = now(), pinned_at = null where id = p_id;
end $$;

-- reactions: one of each emoji per person, up to 20 different ones on a message
create or replace function public.react(p_id uuid, p_emoji text, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m messages%rowtype;
begin
  select * into m from messages where id = p_id;
  if m.id is null or u not in (m.sender, m.recipient) or m.deleted_at is not null then raise exception 'message_invalid'; end if;
  if char_length(coalesce(p_emoji, '')) not between 1 and 16 or p_emoji ~ '[A-Za-z0-9<>&"]' then raise exception 'message_invalid'; end if;
  if p_on then
    if public.is_blocked(m.sender, m.recipient) then raise exception 'not_friends'; end if;
    if (select count(distinct emoji) from message_reactions where message_id = p_id and emoji <> p_emoji) >= 20 then raise exception 'rate_limited'; end if;
    insert into message_reactions (message_id, user_id, emoji) values (p_id, u, p_emoji) on conflict do nothing;
  else
    delete from message_reactions where message_id = p_id and user_id = u and emoji = p_emoji;
  end if;
end $$;

create or replace function public.pin_message(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m messages%rowtype;
begin
  select * into m from messages where id = p_id for update;
  if m.id is null or u not in (m.sender, m.recipient) or m.deleted_at is not null then raise exception 'message_invalid'; end if;
  update messages set pinned_at = case when p_on then now() end where id = p_id;
end $$;

-- a message as the app shows it: with its reactions and a short look at the message it replies to
create or replace function public.message_json(m public.messages) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(m) || jsonb_build_object(
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('emoji', e, 'users', us) order by first) from (
        select emoji as e, jsonb_agg(user_id order by created_at) as us, min(created_at) as first from message_reactions where message_id = m.id group by emoji) r), '[]'::jsonb),
    'reply', (select jsonb_build_object('id', r.id, 'sender', r.sender, 'kind', r.kind, 'deleted', r.deleted_at is not null, 'body', left(r.body, 160)) from messages r where r.id = m.reply_to));
$$;

drop function if exists public.get_messages(uuid, timestamptz, int);
create or replace function public.get_messages(p_friend uuid, p_before timestamptz default null, p_limit int default 60)
returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.message_json(x) from (
    select * from messages
    where least(sender, recipient) = least(auth.uid(), p_friend) and greatest(sender, recipient) = greatest(auth.uid(), p_friend)
      and auth.uid() is not null and (p_before is null or created_at < p_before)
    order by created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) x order by x.created_at;
$$;

-- one message (after an edit, a reaction...), only if it's in your conversation
create or replace function public.get_message(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.message_json(m) from messages m where m.id = p_id and auth.uid() in (m.sender, m.recipient);
$$;

-- searching a conversation, and its pinned messages
create or replace function public.search_messages(p_friend uuid, p_query text) returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if char_length(q) < 2 or char_length(q) > 80 then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query select public.message_json(m) from messages m
    where least(m.sender, m.recipient) = least(auth.uid(), p_friend) and greatest(m.sender, m.recipient) = greatest(auth.uid(), p_friend)
      and auth.uid() is not null and m.deleted_at is null and m.body ilike '%' || q || '%'
    order by m.created_at desc limit 50;
end $$;

create or replace function public.get_pins(p_friend uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.message_json(m) from messages m
  where least(m.sender, m.recipient) = least(auth.uid(), p_friend) and greatest(m.sender, m.recipient) = greatest(auth.uid(), p_friend)
    and auth.uid() is not null and m.pinned_at is not null
  order by m.pinned_at desc limit 50;
$$;

create or replace function public.mark_read(p_friend uuid) returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); n int;
begin
  update messages set read_at = now() where recipient = u and sender = p_friend and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- calls (signalling for a direct WebRTC connection) ----------
create or replace function public.send_signal(p_call uuid, p_to uuid, p_kind text, p_payload jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if p_kind not in ('ring', 'ringing', 'accept', 'decline', 'busy', 'cancel', 'end', 'offer', 'answer', 'ice') then raise exception 'signal_invalid'; end if;
  if p_payload is not null and pg_column_size(p_payload) > 16000 then raise exception 'signal_invalid'; end if;
  if not public.are_friends(u, p_to) or public.is_blocked(u, p_to) then raise exception 'not_friends'; end if;
  if p_kind = 'ring' then
    if exists (select 1 from profile_details d where d.user_id = p_to and d.allow_calls = false) then raise exception 'not_accepting_calls'; end if;
    if public.shown_status(p_to) = 'offline' then raise exception 'offline'; end if;
    if (select count(*) from call_signals where from_id = u and kind = 'ring' and created_at > now() - interval '1 minute') >= 6 then raise exception 'rate_limited'; end if;
  elsif not exists (   -- every other signal belongs to a call that one of you started with the other
      select 1 from call_signals where call_id = p_call and kind = 'ring' and ((from_id = u and to_id = p_to) or (from_id = p_to and to_id = u))
        and created_at > now() - interval '6 hours') then raise exception 'call_gone';
  end if;
  if (select count(*) from call_signals where from_id = u and created_at > now() - interval '1 minute') >= 400 then raise exception 'rate_limited'; end if;
  insert into call_signals (call_id, from_id, to_id, kind, payload) values (p_call, u, p_to, p_kind, p_payload);
  -- an unanswered call the caller gave up on: the other person sees a missed call
  if p_kind = 'cancel' and not exists (select 1 from call_signals where call_id = p_call and kind in ('accept', 'decline', 'busy')) then
    insert into notifications (user_id, kind, actor) values (p_to, 'missed_call', u);
  end if;
  delete from call_signals where created_at < now() - interval '1 day' and (from_id = u or to_id = u);
end $$;

-- ---------- notifications ----------
drop function if exists public.get_notifications();
create or replace function public.get_notifications()
returns table (id bigint, kind text, actor uuid, username text, display_name text, avatar text, accent text, created_at timestamptz, read_at timestamptz, body text)
language sql stable security definer set search_path = public as $$
  select n.id, n.kind, n.actor, p.username, p.display_name, p.avatar, p.accent, n.created_at, n.read_at, n.body
  from notifications n left join profiles p on p.id = n.actor
  where n.user_id = auth.uid() order by n.created_at desc limit 50;
$$;

create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  update notifications set read_at = now() where user_id = u and read_at is null;
  delete from notifications where user_id = u and created_at < now() - interval '30 days';
end $$;

-- ---------- servers: a place for a group of friends, with text channels ----------
-- Members are the owner, admins (manage channels, invites and members) and everyone else.
-- You only ever see servers you're in; you get in with an invite code.
create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text,
  description text not null default '',
  owner uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint server_name_ok check (char_length(btrim(name)) between 2 and 50),
  constraint server_desc_ok check (char_length(description) <= 300),
  constraint server_icon_ok check (icon is null or char_length(icon) <= 400000)
);
create table if not exists public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index if not exists server_members_user on public.server_members (user_id);
create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_-]{1,32}$'),
  topic text not null default '' check (char_length(topic) <= 200),
  kind text not null default 'text',
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.channels drop constraint if exists channels_kind_check;
alter table public.channels drop constraint if exists channels_kind_ok;
alter table public.channels add constraint channels_kind_ok check (kind in ('text', 'voice'));
create index if not exists channels_server on public.channels (server_id, position);
-- who's in a voice channel right now (one at a time; gone after 45 s without a heartbeat)
create table if not exists public.voice_members (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  server_id uuid not null references public.servers (id) on delete cascade,
  muted boolean not null default false,
  deafened boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists voice_members_ch on public.voice_members (channel_id);
-- signals between two people in the same voice channel (offer / answer / ice), like call_signals
create table if not exists public.voice_signals (
  id bigserial primary key,
  channel_id uuid not null references public.channels (id) on delete cascade,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'ice', 'bye')),
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists voice_signals_to on public.voice_signals (to_id, created_at);
-- typing: one row per person, where they're typing (a friend or a channel), refreshed every few seconds
create table if not exists public.typing_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  to_user uuid references public.profiles (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete cascade,
  server_id uuid references public.servers (id) on delete cascade,
  at timestamptz not null default now()
);
create table if not exists public.channel_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  server_id uuid not null references public.servers (id) on delete cascade,
  sender uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  client_id text check (client_id is null or char_length(client_id) <= 64),
  reply_to uuid references public.channel_messages (id) on delete set null,
  kind text not null default 'text',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  pinned_at timestamptz,
  constraint cm_body_ok check (char_length(body) <= 4000 and (char_length(body) >= 1 or kind <> 'text' or deleted_at is not null)),
  constraint cm_meta_ok check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 6000)
);
alter table public.channel_messages drop constraint if exists channel_messages_kind_check;
alter table public.channel_messages drop constraint if exists cm_kind_ok;
alter table public.channel_messages add constraint cm_kind_ok check (kind in ('text', 'sticker', 'attachment', 'gif'));
create index if not exists channel_messages_ch on public.channel_messages (channel_id, created_at desc);
create index if not exists channel_messages_rate on public.channel_messages (sender, created_at);
create table if not exists public.channel_reactions (
  message_id uuid not null references public.channel_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create table if not exists public.channel_reads (       -- how far you've read in each channel (for unread counts)
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);
create table if not exists public.server_invites (
  code text primary key check (code ~ '^[A-Za-z0-9]{8}$'),
  server_id uuid not null references public.servers (id) on delete cascade,
  created_by uuid not null references public.profiles (id) on delete cascade,
  uses int not null default 0,
  max_uses int check (max_uses is null or max_uses between 1 and 1000),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists server_invites_server on public.server_invites (server_id);

create or replace function public.is_member(p_server uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members where server_id = p_server and user_id = p_user);
$$;
create or replace function public.server_role(p_server uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from server_members where server_id = p_server and user_id = p_user;
$$;
create or replace function public.require_member(p_server uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if not public.is_member(p_server, u) then raise exception 'not_member'; end if;
  return u;
end $$;
create or replace function public.require_admin(p_server uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if coalesce(public.server_role(p_server, u), '') not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  return u;
end $$;
-- "Homework Help!" -> "homework-help"
create or replace function public.channel_name(p text) returns text language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', '-', 'g'), '[^a-z0-9_-]', '', 'g'), '-'), 32);
$$;

alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_messages enable row level security;
alter table public.channel_reactions enable row level security;
alter table public.channel_reads enable row level security;
alter table public.server_invites enable row level security;
drop policy if exists servers_read on public.servers;
create policy servers_read on public.servers for select to authenticated using (public.is_member(id, auth.uid()));
drop policy if exists server_members_read on public.server_members;
create policy server_members_read on public.server_members for select to authenticated using (user_id = auth.uid() or public.is_member(server_id, auth.uid()));
drop policy if exists channels_read on public.channels;
create policy channels_read on public.channels for select to authenticated using (public.is_member(server_id, auth.uid()));
drop policy if exists channel_messages_read on public.channel_messages;
create policy channel_messages_read on public.channel_messages for select to authenticated using (public.is_member(server_id, auth.uid()));
drop policy if exists channel_reactions_read on public.channel_reactions;
create policy channel_reactions_read on public.channel_reactions for select to authenticated
  using (exists (select 1 from public.channel_messages m where m.id = message_id and public.is_member(m.server_id, auth.uid())));
drop policy if exists channel_reads_read on public.channel_reads;
create policy channel_reads_read on public.channel_reads for select to authenticated using (user_id = auth.uid());
drop policy if exists server_invites_read on public.server_invites;
create policy server_invites_read on public.server_invites for select to authenticated using (public.is_member(server_id, auth.uid()));
revoke all on public.servers, public.server_members, public.channels, public.channel_messages, public.channel_reactions, public.channel_reads, public.server_invites from anon, authenticated;
grant select on public.servers, public.server_members, public.channels, public.channel_messages, public.channel_reactions, public.channel_reads, public.server_invites to authenticated;

-- making a server: you're its owner; a template gives it a few channels to start with
create or replace function public.create_server(p_name text, p_icon text default null, p_template text default 'friends') returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); s uuid; n text := btrim(coalesce(p_name, '')); chs text[];
begin
  if char_length(n) not between 2 and 50 then raise exception 'server_invalid'; end if;
  if p_icon is not null and not public.media_ok(p_icon, u) then raise exception 'server_invalid'; end if;
  if (select count(*) from servers where owner = u) >= 25 or (select count(*) from server_members where user_id = u) >= 100 then raise exception 'too_many_servers'; end if;
  if (select count(*) from servers where owner = u and created_at > now() - interval '1 hour') >= 5 then raise exception 'rate_limited'; end if;
  insert into servers (name, icon, owner) values (n, p_icon, u) returning id into s;
  insert into server_members (server_id, user_id, role) values (s, u, 'owner');
  chs := case p_template when 'gaming' then array['general', 'clips', 'looking-for-group'] when 'study' then array['general', 'homework-help', 'resources']
    when 'friends' then array['general', 'memes', 'music'] else array['general'] end;
  insert into channels (server_id, name, position) select s, c, i::int from unnest(chs) with ordinality as t(c, i);
  insert into channels (server_id, name, position, kind) values (s, 'lounge', 100, 'voice');
  return s;
end $$;

-- your servers, each with its channels and how much you haven't read (and how often you were @mentioned or replied to)
create or replace function public.get_servers() returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); tag text;
begin
  if u is null then return; end if;
  select '@' || lower(username) into tag from profiles where id = u;
  return query
  select jsonb_build_object('id', s.id, 'name', s.name, 'icon', s.icon, 'description', s.description, 'owner', s.owner, 'role', m.role, 'joined_at', m.joined_at,
    'member_count', (select count(*) from server_members x where x.server_id = s.id),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'topic', c.topic, 'kind', c.kind, 'position', c.position,
        'unread', (select count(*) from (select 1 from channel_messages cm where cm.channel_id = c.id and cm.sender <> u and cm.deleted_at is null
                    and cm.created_at > coalesce(r.read_at, m.joined_at) limit 100) z),
        'mentions', (select count(*) from (select 1 from channel_messages cm where cm.channel_id = c.id and cm.sender <> u and cm.deleted_at is null
                    and cm.created_at > coalesce(r.read_at, m.joined_at)
                    and (position(tag in lower(cm.body)) > 0 or exists (select 1 from channel_messages p where p.id = cm.reply_to and p.sender = u)) limit 100) z),
        'last_at', (select max(cm.created_at) from channel_messages cm where cm.channel_id = c.id),
        'voice', case when c.kind = 'voice' then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username, 'avatar', p.avatar, 'accent', p.accent,
            'muted', v.muted, 'deafened', v.deafened) order by v.joined_at) from voice_members v join profiles p on p.id = v.user_id
            where v.channel_id = c.id and v.last_seen > now() - interval '45 seconds'), '[]'::jsonb) end) order by c.position, c.created_at)
      from channels c left join channel_reads r on r.channel_id = c.id and r.user_id = u where c.server_id = s.id), '[]'::jsonb))
  from server_members m join servers s on s.id = m.server_id where m.user_id = u order by m.joined_at;
end $$;

-- who's in a server: role, presence, and the profile bits a member list shows
create or replace function public.get_members(p_server uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar', p.avatar, 'accent', p.accent, 'badges', p.badges,
      'role', m.role, 'joined_at', m.joined_at, 'status', public.shown_status(p.id), 'details', public.details_for(p.id, auth.uid()),
      'friend', public.are_friends(auth.uid(), p.id), 'activity', public.shown_activity(p.id))
  from server_members m join profiles p on p.id = m.user_id
  where m.server_id = p_server and public.is_member(p_server, auth.uid())
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, lower(p.display_name);
$$;

-- admins change the name, picture and description (only the keys sent change)
create or replace function public.update_server(p_server uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin(p_server); s servers%rowtype;
begin
  select * into s from servers where id = p_server for update;
  if p_data ? 'name' then s.name := btrim(coalesce(p_data->>'name', '')); end if;
  if p_data ? 'description' then s.description := btrim(coalesce(p_data->>'description', '')); end if;
  if p_data ? 'icon' then
    if p_data->>'icon' is not null and p_data->>'icon' is distinct from s.icon and not public.media_ok(p_data->>'icon', u) then raise exception 'server_invalid'; end if;
    s.icon := p_data->>'icon';
  end if;
  if char_length(s.name) not between 2 and 50 or char_length(s.description) > 300 then raise exception 'server_invalid'; end if;
  update servers set name = s.name, description = s.description, icon = s.icon where id = p_server;
end $$;

create or replace function public.delete_server(p_server uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if coalesce(public.server_role(p_server, u), '') <> 'owner' then raise exception 'not_allowed'; end if;
  delete from servers where id = p_server;
end $$;

create or replace function public.leave_server(p_server uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_member(p_server);
begin
  if public.server_role(p_server, u) = 'owner' then raise exception 'owner_cant_leave'; end if;
  delete from channel_reads where user_id = u and channel_id in (select id from channels where server_id = p_server);
  delete from server_members where server_id = p_server and user_id = u;
end $$;

-- admins remove members (the owner can't be removed; only the owner removes admins)
create or replace function public.kick_member(p_server uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin(p_server); r text := public.server_role(p_server, p_user);
begin
  if r is null or p_user = u then raise exception 'not_allowed'; end if;
  if r = 'owner' or (r = 'admin' and public.server_role(p_server, u) <> 'owner') then raise exception 'not_allowed'; end if;
  delete from channel_reads where user_id = p_user and channel_id in (select id from channels where server_id = p_server);
  delete from server_members where server_id = p_server and user_id = p_user;
end $$;

-- the owner makes members admins, or back
create or replace function public.set_member_role(p_server uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if coalesce(public.server_role(p_server, u), '') <> 'owner' or p_user = u or p_role not in ('admin', 'member') then raise exception 'not_allowed'; end if;
  if public.server_role(p_server, p_user) is null then raise exception 'not_member'; end if;
  update server_members set role = p_role where server_id = p_server and user_id = p_user;
end $$;

-- ---------- channels ----------
drop function if exists public.create_channel(uuid, text, text);
create or replace function public.create_channel(p_server uuid, p_name text, p_topic text default '', p_kind text default 'text') returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin(p_server); n text := public.channel_name(p_name); c uuid;
begin
  if coalesce(p_kind, 'text') not in ('text', 'voice') then raise exception 'channel_invalid'; end if;
  if n = '' or char_length(coalesce(p_topic, '')) > 200 then raise exception 'channel_invalid'; end if;
  if exists (select 1 from channels where server_id = p_server and name = n) then raise exception 'channel_exists'; end if;
  if (select count(*) from channels where server_id = p_server) >= 50 then raise exception 'too_many_channels'; end if;
  insert into channels (server_id, name, topic, position, kind) values (p_server, n, btrim(coalesce(p_topic, '')),
    coalesce((select max(position) + 1 from channels where server_id = p_server), 0), coalesce(p_kind, 'text')) returning id into c;
  return c;
end $$;

create or replace function public.update_channel(p_channel uuid, p_name text default null, p_topic text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c channels%rowtype; u uuid; n text;
begin
  select * into c from channels where id = p_channel; if c.id is null then raise exception 'not_member'; end if;
  u := public.require_admin(c.server_id);
  n := case when p_name is null then c.name else public.channel_name(p_name) end;
  if n = '' or char_length(coalesce(p_topic, c.topic)) > 200 then raise exception 'channel_invalid'; end if;
  if n <> c.name and exists (select 1 from channels where server_id = c.server_id and name = n) then raise exception 'channel_exists'; end if;
  update channels set name = n, topic = btrim(coalesce(p_topic, c.topic)) where id = p_channel;
end $$;

create or replace function public.delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c channels%rowtype; u uuid;
begin
  select * into c from channels where id = p_channel; if c.id is null then raise exception 'not_member'; end if;
  u := public.require_admin(c.server_id);
  if (select count(*) from channels where server_id = c.server_id) <= 1 then raise exception 'last_channel'; end if;
  delete from channels where id = p_channel;
end $$;

-- the channels in a new order (all of them, top to bottom)
create or replace function public.reorder_channels(p_server uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin(p_server);
begin
  if p_ids is null or cardinality(p_ids) <> (select count(*) from channels where server_id = p_server)
     or exists (select 1 from unnest(p_ids) x where x not in (select id from channels where server_id = p_server))
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'channel_invalid'; end if;
  update channels c set position = t.i - 1 from unnest(p_ids) with ordinality as t(id, i) where c.id = t.id;
end $$;

-- ---------- invites ----------
create or replace function public.create_invite(p_server uuid, p_max_uses int default null, p_hours int default null) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_member(p_server); v_code text; tries int := 0;
begin
  if p_max_uses is not null and p_max_uses not between 1 and 1000 then raise exception 'invite_invalid'; end if;
  if p_hours is not null and p_hours not between 1 and 720 then raise exception 'invite_invalid'; end if;
  -- the same kind of invite you made before, still good: share that one again
  select i.code into v_code from server_invites i where i.server_id = p_server and i.created_by = u and i.max_uses is not distinct from p_max_uses
    and ((p_hours is null and i.expires_at is null) or (p_hours is not null and i.expires_at > now() + make_interval(hours => p_hours) - interval '1 hour'))
    and (i.max_uses is null or i.uses < i.max_uses) order by i.created_at desc limit 1;
  if v_code is not null then return v_code; end if;
  if (select count(*) from server_invites where created_by = u and created_at > now() - interval '1 hour') >= 20 then raise exception 'rate_limited'; end if;
  delete from server_invites where server_id = p_server and ((expires_at is not null and expires_at < now()) or (max_uses is not null and uses >= max_uses));
  if (select count(*) from server_invites where server_id = p_server) >= 50 then raise exception 'too_many_invites'; end if;
  loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 1 + floor(random() * 56)::int, 1), '') from generate_series(1, 8));
    exit when not exists (select 1 from server_invites where server_invites.code = v_code);
    tries := tries + 1; if tries > 10 then raise exception 'rate_limited'; end if;
  end loop;
  insert into server_invites (code, server_id, created_by, max_uses, expires_at) values (v_code, p_server, u, p_max_uses, case when p_hours is not null then now() + make_interval(hours => p_hours) end);
  return v_code;
end $$;

-- what an invite leads to (anyone signed in who has the code can look), or null if it's no good any more
create or replace function public.get_invite(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', i.code, 'server_id', s.id, 'name', s.name, 'icon', s.icon, 'description', s.description,
      'member_count', (select count(*) from server_members m where m.server_id = s.id),
      'online', (select count(*) from server_members m where m.server_id = s.id and public.shown_status(m.user_id) <> 'offline'),
      'member', public.is_member(s.id, auth.uid()))
  from server_invites i join servers s on s.id = i.server_id
  where auth.uid() is not null and i.code = p_code and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses);
$$;

create or replace function public.join_server(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); i server_invites%rowtype;
begin
  select * into i from server_invites where code = p_code for update;
  if i.code is null or (i.expires_at is not null and i.expires_at <= now()) or (i.max_uses is not null and i.uses >= i.max_uses) then raise exception 'invite_invalid'; end if;
  if public.is_member(i.server_id, u) then return i.server_id; end if;
  if (select count(*) from server_members where user_id = u) >= 100 then raise exception 'too_many_servers'; end if;
  if (select count(*) from server_members where server_id = i.server_id) >= 500 then raise exception 'server_full'; end if;
  insert into server_members (server_id, user_id) values (i.server_id, u);
  update server_invites set uses = uses + 1 where code = p_code;
  return i.server_id;
end $$;

create or replace function public.get_invites(p_server uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', i.code, 'uses', i.uses, 'max_uses', i.max_uses, 'expires_at', i.expires_at, 'created_at', i.created_at,
      'by', jsonb_build_object('id', p.id, 'display_name', p.display_name, 'username', p.username))
  from server_invites i join profiles p on p.id = i.created_by
  where i.server_id = p_server and coalesce(public.server_role(p_server, auth.uid()), '') in ('owner', 'admin')
    and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)
  order by i.created_at desc;
$$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); i server_invites%rowtype;
begin
  select * into i from server_invites where code = p_code;
  if i.code is null then return; end if;
  if i.created_by <> u and coalesce(public.server_role(i.server_id, u), '') not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  delete from server_invites where code = p_code;
end $$;

-- ---------- channel messages (the same kinds as direct messages) ----------
create or replace function public.send_channel_message(p_channel uuid, p_body text, p_client_id text default null, p_reply_to uuid default null,
  p_kind text default 'text', p_meta jsonb default null) returns public.channel_messages
language plpgsql security definer set search_path = public as $$
declare c channels%rowtype; u uuid; m channel_messages%rowtype; b text := btrim(coalesce(p_body, ''), E' \n\r\t'); meta jsonb := '{}'::jsonb; a jsonb; k text := coalesce(p_kind, 'text');
begin
  select * into c from channels where id = p_channel; if c.id is null then raise exception 'not_member'; end if;
  u := public.require_member(c.server_id);
  if k not in ('text', 'sticker', 'attachment', 'gif') then raise exception 'message_invalid'; end if;
  if k = 'text' and char_length(b) = 0 then raise exception 'empty'; end if;
  if char_length(b) > 4000 then raise exception 'too_long'; end if;
  if (select count(*) from channel_messages where sender = u and created_at > now() - interval '10 seconds') >= 20 then raise exception 'rate_limited'; end if;
  if p_reply_to is not null and not exists (select 1 from channel_messages r where r.id = p_reply_to and r.channel_id = p_channel) then raise exception 'message_invalid'; end if;
  if k = 'sticker' then
    if p_meta ? 'sticker' and (p_meta->>'sticker') ~ '^[a-z0-9]{1,20}/[a-z0-9_-]{1,32}$' then meta := jsonb_build_object('sticker', p_meta->>'sticker');
    elsif p_meta ? 'url' and public.media_ok(p_meta->>'url', u) and (p_meta->>'url') is not null then meta := jsonb_build_object('url', p_meta->>'url');
    else raise exception 'message_invalid'; end if;
  elsif k = 'gif' then   -- a GIF from GIPHY: only its own picture links
    if coalesce(p_meta->>'url', '') !~ '^https://media[0-9]?\.giphy\.com/media/[A-Za-z0-9/_.-]{1,200}$' then raise exception 'message_invalid'; end if;
    meta := jsonb_build_object('url', p_meta->>'url', 'w', least(greatest(coalesce((p_meta->>'w')::int, 0), 0), 2000), 'h', least(greatest(coalesce((p_meta->>'h')::int, 0), 0), 2000), 'title', left(coalesce(p_meta->>'title', ''), 100));
  elsif k = 'attachment' then   -- files in the server's folder
    if jsonb_typeof(p_meta->'files') <> 'array' or jsonb_array_length(p_meta->'files') not between 1 and 6 then raise exception 'message_invalid'; end if;
    for a in select * from jsonb_array_elements(p_meta->'files') loop
      if coalesce(a->>'path', '') !~ ('^srv_' || c.server_id::text || '/[A-Za-z0-9._-]{1,80}$')
         or char_length(coalesce(a->>'name', '')) not between 1 and 120 or coalesce(a->>'type', '') !~ '^[a-z]+/[a-z0-9.+-]{1,60}$'
         or coalesce((a->>'size')::bigint, -1) not between 1 and 26214400 then raise exception 'message_invalid'; end if;
    end loop;
    meta := jsonb_build_object('files', (select jsonb_agg(jsonb_build_object('path', e->>'path', 'name', e->>'name', 'type', e->>'type', 'size', (e->>'size')::bigint,
      'w', case when e ? 'w' then least(greatest((e->>'w')::int, 0), 20000) end, 'h', case when e ? 'h' then least(greatest((e->>'h')::int, 0), 20000) end)) from jsonb_array_elements(p_meta->'files') e));
  end if;
  if p_client_id is not null then
    select * into m from channel_messages where sender = u and client_id = p_client_id and created_at > now() - interval '1 day';
    if m.id is not null then return m; end if;
  end if;
  insert into channel_messages (channel_id, server_id, sender, body, client_id, reply_to, kind, meta)
    values (p_channel, c.server_id, u, b, left(p_client_id, 64), p_reply_to, k, meta) returning * into m;
  insert into channel_reads (user_id, channel_id, read_at) values (u, p_channel, now()) on conflict (user_id, channel_id) do update set read_at = now();
  return m;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'message_invalid';
end $$;

create or replace function public.cm_edit(p_id uuid, p_body text) returns public.channel_messages
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m channel_messages%rowtype; b text := btrim(coalesce(p_body, ''), E' \n\r\t');
begin
  select * into m from channel_messages where id = p_id for update;
  if m.id is null or m.sender <> u or m.deleted_at is not null or m.kind <> 'text' or not public.is_member(m.server_id, u) then raise exception 'message_invalid'; end if;
  if char_length(b) = 0 then raise exception 'empty'; end if;
  if char_length(b) > 4000 then raise exception 'too_long'; end if;
  if b = m.body then return m; end if;
  update channel_messages set body = b, edited_at = now() where id = p_id returning * into m;
  return m;
end $$;

-- your own messages; admins can delete anyone's
create or replace function public.cm_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m channel_messages%rowtype;
begin
  select * into m from channel_messages where id = p_id for update;
  if m.id is null or (m.sender <> u and coalesce(public.server_role(m.server_id, u), '') not in ('owner', 'admin')) or not public.is_member(m.server_id, u) then raise exception 'message_invalid'; end if;
  delete from channel_reactions where message_id = p_id;
  update channel_messages set body = '', meta = '{}'::jsonb, deleted_at = now(), pinned_at = null where id = p_id;
end $$;

create or replace function public.cm_react(p_id uuid, p_emoji text, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m channel_messages%rowtype;
begin
  select * into m from channel_messages where id = p_id;
  if m.id is null or not public.is_member(m.server_id, u) or m.deleted_at is not null then raise exception 'message_invalid'; end if;
  if char_length(coalesce(p_emoji, '')) not between 1 and 16 or p_emoji ~ '[A-Za-z0-9<>&"]' then raise exception 'message_invalid'; end if;
  if p_on then
    if (select count(distinct emoji) from channel_reactions where message_id = p_id and emoji <> p_emoji) >= 20 then raise exception 'rate_limited'; end if;
    insert into channel_reactions (message_id, user_id, emoji) values (p_id, u, p_emoji) on conflict do nothing;
  else
    delete from channel_reactions where message_id = p_id and user_id = u and emoji = p_emoji;
  end if;
end $$;

-- pinning: admins, or whoever wrote the message
create or replace function public.cm_pin(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); m channel_messages%rowtype;
begin
  select * into m from channel_messages where id = p_id for update;
  if m.id is null or m.deleted_at is not null or not public.is_member(m.server_id, u)
     or (m.sender <> u and coalesce(public.server_role(m.server_id, u), '') not in ('owner', 'admin')) then raise exception 'message_invalid'; end if;
  update channel_messages set pinned_at = case when p_on then now() end where id = p_id;
end $$;

create or replace function public.cm_json(m public.channel_messages) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(m) || jsonb_build_object(
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('emoji', e, 'users', us) order by first) from (
        select emoji as e, jsonb_agg(user_id order by created_at) as us, min(created_at) as first from channel_reactions where message_id = m.id group by emoji) r), '[]'::jsonb),
    'reply', (select jsonb_build_object('id', r.id, 'sender', r.sender, 'kind', r.kind, 'deleted', r.deleted_at is not null, 'body', left(r.body, 160)) from channel_messages r where r.id = m.reply_to));
$$;

create or replace function public.get_channel_messages(p_channel uuid, p_before timestamptz default null, p_limit int default 60) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.cm_json(x) from (
    select m.* from channel_messages m
    where m.channel_id = p_channel and public.is_member(m.server_id, auth.uid()) and (p_before is null or m.created_at < p_before)
    order by m.created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) x order by x.created_at;
$$;

create or replace function public.get_channel_message(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select public.cm_json(m) from channel_messages m where m.id = p_id and public.is_member(m.server_id, auth.uid());
$$;

create or replace function public.search_channel(p_channel uuid, p_query text) returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_query, ''));
begin
  if char_length(q) < 2 or char_length(q) > 80 then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query select public.cm_json(m) from channel_messages m
    where m.channel_id = p_channel and public.is_member(m.server_id, auth.uid()) and m.deleted_at is null and m.body ilike '%' || q || '%'
    order by m.created_at desc limit 50;
end $$;

create or replace function public.get_channel_pins(p_channel uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.cm_json(m) from channel_messages m
  where m.channel_id = p_channel and public.is_member(m.server_id, auth.uid()) and m.pinned_at is not null
  order by m.pinned_at desc limit 50;
$$;

create or replace function public.mark_channel_read(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c channels%rowtype; u uuid;
begin
  select * into c from channels where id = p_channel; if c.id is null then return; end if;
  u := public.require_member(c.server_id);
  insert into channel_reads (user_id, channel_id, read_at) values (u, p_channel, now()) on conflict (user_id, channel_id) do update set read_at = now();
end $$;

-- who may add or open a file in the private "attachments" bucket: the two people of a conversation folder
-- (adding only while friends), or the members of a server's folder (srv_<server>)
create or replace function public.attach_ok(p_name text, p_uid uuid, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare f text := split_part(coalesce(p_name, ''), '/', 1); a text; b text;
begin
  if p_uid is null then return false; end if;
  if f ~ '^srv_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return public.is_member(substr(f, 5)::uuid, p_uid); end if;
  if f !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  a := split_part(f, '_', 1); b := split_part(f, '_', 2);
  if p_uid::text not in (a, b) then return false; end if;
  return not p_write or public.are_friends(a::uuid, b::uuid);
exception when others then return false;
end $$;

-- ---------- admin: Skyline's owner (the people in badge_makers) ----------
-- Badges live in a library only admins edit; admins give them to people. What shows on a profile is
-- copied into profiles.badges (the badges the person chose to show, newest six), so every screen keeps working.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from badge_makers where user_id = auth.uid());
$$;
create or replace function public.require_admin_user() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  return u;
end $$;

create table if not exists public.badge_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  icon text not null default '',
  bg text not null,
  bg2 text,
  fg text not null,
  border text,
  style text not null default 'solid',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint badge_name_ok check (char_length(btrim(name)) between 1 and 24),
  constraint badge_desc_ok check (char_length(description) <= 100),
  constraint badge_icon_ok check (icon ~ '^[a-zA-Z]{0,16}$'),
  constraint badge_colors_ok check (bg ~ '^#[0-9a-fA-F]{6}$' and fg ~ '^#[0-9a-fA-F]{6}$' and (bg2 is null or bg2 ~ '^#[0-9a-fA-F]{6}$') and (border is null or border ~ '^#[0-9a-fA-F]{6}$')),
  constraint badge_style_ok check (style in ('solid', 'gradient', 'shine', 'glow'))
);
create table if not exists public.user_badges (
  user_id uuid not null references public.profiles (id) on delete cascade,
  badge_id uuid not null references public.badge_catalog (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  hidden boolean not null default false,
  primary key (user_id, badge_id)
);
create table if not exists public.suspended_users (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 200),
  by_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.badge_catalog enable row level security;
alter table public.user_badges enable row level security;
alter table public.suspended_users enable row level security;
drop policy if exists badge_catalog_read on public.badge_catalog;
create policy badge_catalog_read on public.badge_catalog for select to authenticated using (true);
drop policy if exists user_badges_read on public.user_badges;
create policy user_badges_read on public.user_badges for select to authenticated using (user_id = auth.uid());
revoke all on public.badge_catalog, public.user_badges, public.suspended_users from anon, authenticated;
grant select on public.badge_catalog, public.user_badges to authenticated;



-- the badge as profiles show it
create or replace function public.badge_json(b public.badge_catalog) returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', b.id, 'name', b.name, 'description', nullif(b.description, ''), 'icon', b.icon, 'bg', b.bg, 'bg2', b.bg2, 'fg', b.fg, 'border', b.border, 'style', b.style));
$$;
-- copy someone's shown badges onto their profile
create or replace function public.refresh_badges(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update profiles set badges = coalesce((select jsonb_agg(x.j order by x.granted_at) from (
      select public.badge_json(b) as j, ub.granted_at from user_badges ub join badge_catalog b on b.id = ub.badge_id
      where ub.user_id = p_user and not ub.hidden order by ub.granted_at desc limit 6) x), '[]'::jsonb)
  where id = p_user;
$$;

-- badges made the old way (one person's own list) move into the library once, still given to that person
do $$ declare p record; e jsonb; bid uuid; begin
  if not exists (select 1 from badge_catalog) then
    for p in select id, badges from profiles where jsonb_typeof(badges) = 'array' and jsonb_array_length(badges) > 0 loop
      for e in select * from jsonb_array_elements(p.badges) loop
        begin
          insert into badge_catalog (name, icon, bg, fg, border, created_by)
            values (left(btrim(coalesce(e->>'name', 'Badge')), 24), coalesce(nullif(e->>'icon', ''), ''), coalesce(e->>'bg', '#1f2433'), coalesce(e->>'fg', '#e9d58f'), nullif(e->>'border', ''), p.id)
            returning id into bid;
          insert into user_badges (user_id, badge_id, granted_by) values (p.id, bid, p.id) on conflict do nothing;
        exception when others then null;
        end;
      end loop;
      perform public.refresh_badges(p.id);
    end loop;
  end if;
end $$;


-- your badges (everyone): which you have, and which you show
create or replace function public.my_badges() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.badge_json(b) || jsonb_build_object('hidden', ub.hidden, 'granted_at', ub.granted_at)
  from user_badges ub join badge_catalog b on b.id = ub.badge_id where ub.user_id = auth.uid() order by ub.granted_at;
$$;
create or replace function public.show_badge(p_badge uuid, p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  update user_badges set hidden = not p_show where user_id = u and badge_id = p_badge;
  perform public.refresh_badges(u);
end $$;

-- the library
create or replace function public.admin_badges() returns setof jsonb
language sql stable security definer set search_path = public as $$
  select public.badge_json(b) || jsonb_build_object('holders', (select count(*) from user_badges ub where ub.badge_id = b.id), 'created_at', b.created_at)
  from badge_catalog b where public.is_admin() order by b.created_at;
$$;
create or replace function public.admin_save_badge(p_id uuid, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user(); b badge_catalog%rowtype; id_ uuid; h uuid;
begin
  if p_id is not null then select * into b from badge_catalog where id = p_id for update; if b.id is null then raise exception 'badge_invalid'; end if; end if;
  b.name := btrim(coalesce(p_data->>'name', b.name, ''));
  b.description := btrim(coalesce(p_data->>'description', b.description, ''));
  b.icon := coalesce(p_data->>'icon', b.icon, '');
  b.bg := coalesce(p_data->>'bg', b.bg); b.fg := coalesce(p_data->>'fg', b.fg);
  if p_data ? 'bg2' then b.bg2 := nullif(p_data->>'bg2', ''); end if;
  if p_data ? 'border' then b.border := nullif(p_data->>'border', ''); end if;
  b.style := coalesce(p_data->>'style', b.style, 'solid');
  if p_id is null then
    if (select count(*) from badge_catalog) >= 200 then raise exception 'badge_invalid'; end if;
    insert into badge_catalog (name, description, icon, bg, bg2, fg, border, style, created_by) values (b.name, b.description, b.icon, b.bg, b.bg2, b.fg, b.border, b.style, u) returning id into id_;
  else
    update badge_catalog set name = b.name, description = b.description, icon = b.icon, bg = b.bg, bg2 = b.bg2, fg = b.fg, border = b.border, style = b.style where id = p_id;
    id_ := p_id;
    for h in select user_id from user_badges where badge_id = p_id loop perform public.refresh_badges(h); end loop;
  end if;
  return id_;
exception when check_violation or not_null_violation then raise exception 'badge_invalid';
end $$;
create or replace function public.admin_delete_badge(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user(); hs uuid[];
begin
  select array_agg(user_id) into hs from user_badges where badge_id = p_id;
  delete from badge_catalog where id = p_id;
  if hs is not null then perform public.refresh_badges(x) from unnest(hs) x; end if;
end $$;
create or replace function public.admin_give_badge(p_user uuid, p_badge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user();
begin
  if not exists (select 1 from profiles where id = p_user) or not exists (select 1 from badge_catalog where id = p_badge) then raise exception 'badge_invalid'; end if;
  insert into user_badges (user_id, badge_id, granted_by) values (p_user, p_badge, u) on conflict do nothing;
  if found and p_user <> u then insert into notifications (user_id, kind, actor, body) values (p_user, 'badge', u, (select name from badge_catalog where id = p_badge)); end if;
  perform public.refresh_badges(p_user);
end $$;
create or replace function public.admin_take_badge(p_user uuid, p_badge uuid) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user();
begin
  delete from user_badges where user_id = p_user and badge_id = p_badge;
  perform public.refresh_badges(p_user);
end $$;
create or replace function public.admin_badge_holders(p_badge uuid) returns setof jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar', p.avatar, 'accent', p.accent, 'granted_at', ub.granted_at)
  from user_badges ub join profiles p on p.id = ub.user_id where ub.badge_id = p_badge and public.is_admin() order by ub.granted_at desc;
$$;

-- people: find anyone, see their badges and whether they're suspended
create or replace function public.admin_users(p_query text default '') returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := lower(btrim(coalesce(p_query, '')));
begin
  if not public.is_admin() then return; end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name, 'avatar', p.avatar, 'accent', p.accent,
      'created_at', p.created_at, 'status', public.shown_status(p.id), 'admin', exists (select 1 from badge_makers m where m.user_id = p.id),
      'suspended', (select jsonb_build_object('reason', s.reason, 'at', s.created_at) from suspended_users s where s.user_id = p.id),
      'badges', coalesce((select jsonb_agg(ub.badge_id) from user_badges ub where ub.user_id = p.id), '[]'::jsonb),
      'friends', (select count(*) from friendships f where p.id in (f.a, f.b)))
    from profiles p
    where q = '' or lower(p.username) like '%' || q || '%' or lower(p.display_name) like '%' || q || '%'
    order by (select last_seen from presence where user_id = p.id) desc nulls last, p.created_at desc limit 60;
end $$;

create or replace function public.admin_suspend(p_user uuid, p_on boolean, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user();
begin
  if p_user = u or exists (select 1 from badge_makers where user_id = p_user) then raise exception 'not_allowed'; end if;
  if p_on then
    insert into suspended_users (user_id, reason, by_id) values (p_user, left(btrim(coalesce(p_reason, '')), 200), u)
      on conflict (user_id) do update set reason = excluded.reason, by_id = u, created_at = now();
    update presence set status = 'offline' where user_id = p_user;
  else
    delete from suspended_users where user_id = p_user;
  end if;
end $$;

-- the numbers: how many people, how many online, how busy it's been
create or replace function public.admin_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'users', (select count(*) from profiles),
    'new_week', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'online', (select count(*) from presence where last_seen > now() - interval '60 seconds' and status <> 'offline'),
    'active_day', (select count(*) from presence where last_seen > now() - interval '1 day'),
    'friendships', (select count(*) from friendships),
    'messages_day', (select count(*) from messages where created_at > now() - interval '1 day') + (select count(*) from channel_messages where created_at > now() - interval '1 day'),
    'messages', (select count(*) from messages) + (select count(*) from channel_messages),
    'servers', (select count(*) from servers),
    'calls_day', (select count(*) from call_signals where kind = 'accept' and created_at > now() - interval '1 day'),
    'suspended', (select count(*) from suspended_users),
    'badges', (select count(*) from badge_catalog)) end;
$$;

-- a message from Skyline to everyone (shows in their Activity, and as a notification)
create or replace function public.admin_announce(p_text text) returns int
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_admin_user(); t text := btrim(coalesce(p_text, '')); n int;
begin
  if char_length(t) not between 2 and 500 then raise exception 'announcement_invalid'; end if;
  if (select count(*) from notifications where actor = u and kind = 'announcement' and created_at > now() - interval '1 day') >= (select count(*) * 5 from profiles) then raise exception 'rate_limited'; end if;
  insert into notifications (user_id, kind, actor, body) select p.id, 'announcement', u, t from profiles p where p.id <> u;
  get diagnostics n = row_count;
  return n;
end $$;


-- ---------- voice channels ----------
create or replace function public.voice_join(p_channel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c channels%rowtype; u uuid;
begin
  select * into c from channels where id = p_channel; if c.id is null or c.kind <> 'voice' then raise exception 'channel_invalid'; end if;
  u := public.require_member(c.server_id);
  delete from voice_members where last_seen < now() - interval '45 seconds';
  if (select count(*) from voice_members where channel_id = p_channel and user_id <> u) >= 10 then raise exception 'voice_full'; end if;
  insert into voice_members (user_id, channel_id, server_id) values (u, p_channel, c.server_id)
    on conflict (user_id) do update set channel_id = excluded.channel_id, server_id = excluded.server_id, muted = false, deafened = false, joined_at = now(), last_seen = now();
  -- the people already there (you connect to each of them)
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.user_id, 'muted', v.muted, 'deafened', v.deafened)) from voice_members v where v.channel_id = p_channel and v.user_id <> u), '[]'::jsonb);
end $$;
create or replace function public.voice_leave() returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  delete from voice_members where user_id = u;
  delete from voice_signals where (from_id = u or to_id = u) and created_at < now() - interval '1 minute';
end $$;
create or replace function public.voice_state(p_muted boolean, p_deafened boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  update voice_members set muted = coalesce(p_muted, muted), deafened = coalesce(p_deafened, deafened), last_seen = now() where user_id = u;
  if not found then raise exception 'not_in_voice'; end if;
end $$;
create or replace function public.voice_heartbeat() returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  update voice_members set last_seen = now() where user_id = u;
  if not found then raise exception 'not_in_voice'; end if;
end $$;
create or replace function public.send_voice_signal(p_channel uuid, p_to uuid, p_kind text, p_payload jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile();
begin
  if p_kind not in ('offer', 'answer', 'ice', 'bye') then raise exception 'signal_invalid'; end if;
  if p_payload is not null and pg_column_size(p_payload) > 16000 then raise exception 'signal_invalid'; end if;
  if not exists (select 1 from voice_members where user_id = u and channel_id = p_channel)
     or not exists (select 1 from voice_members where user_id = p_to and channel_id = p_channel and last_seen > now() - interval '45 seconds') then raise exception 'not_in_voice'; end if;
  if (select count(*) from voice_signals where from_id = u and created_at > now() - interval '1 minute') >= 600 then raise exception 'rate_limited'; end if;
  insert into voice_signals (channel_id, from_id, to_id, kind, payload) values (p_channel, u, p_to, p_kind, p_payload);
end $$;

-- ---------- typing ----------
create or replace function public.set_typing(p_to uuid default null, p_channel uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := public.require_profile(); sv uuid;
begin
  if p_to is null and p_channel is null then delete from typing_state where user_id = u; return; end if;
  if p_channel is not null then
    select server_id into sv from channels where id = p_channel and kind = 'text';
    if sv is null or not public.is_member(sv, u) then raise exception 'not_member'; end if;
    insert into typing_state (user_id, to_user, channel_id, server_id, at) values (u, null, p_channel, sv, now())
      on conflict (user_id) do update set to_user = null, channel_id = excluded.channel_id, server_id = excluded.server_id, at = now();
  else
    if not public.are_friends(u, p_to) or public.is_blocked(u, p_to) then raise exception 'not_friends'; end if;
    insert into typing_state (user_id, to_user, channel_id, server_id, at) values (u, p_to, null, null, now())
      on conflict (user_id) do update set to_user = excluded.to_user, channel_id = null, server_id = null, at = now();
  end if;
end $$;

alter table public.voice_members enable row level security;
alter table public.voice_signals enable row level security;
alter table public.typing_state enable row level security;
drop policy if exists voice_members_read on public.voice_members;
create policy voice_members_read on public.voice_members for select to authenticated using (public.is_member(server_id, auth.uid()));
drop policy if exists voice_signals_read on public.voice_signals;
create policy voice_signals_read on public.voice_signals for select to authenticated using (to_id = auth.uid());
drop policy if exists typing_read on public.typing_state;
create policy typing_read on public.typing_state for select to authenticated
  using (to_user = auth.uid() or (server_id is not null and public.is_member(server_id, auth.uid())));
revoke all on public.voice_members, public.voice_signals, public.typing_state from anon, authenticated;
grant select on public.voice_members, public.voice_signals, public.typing_state to authenticated;

-- only signed-in users can call any of this
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('are_friends','is_blocked','has_blocked','can_make_badges','shown_status','me','require_profile','check_username','username_available',
             'create_profile','update_profile','my_profile','get_settings','save_settings','heartbeat','relation','search_users','get_profile','send_request',
             'respond_request','cancel_request','get_requests','get_friends','remove_friend','block_user','unblock_user','get_blocked','send_message',
             'get_messages','mark_read','send_signal','get_notifications','mark_notifications_read','media_ok','details_for','update_profile_details','set_status','pair_key','edit_message','delete_message','react','pin_message','get_message','search_messages','get_pins',
             'create_server','get_servers','get_members','update_server','delete_server','leave_server','kick_member','set_member_role','create_channel','update_channel',
             'delete_channel','reorder_channels','create_invite','get_invite','join_server','get_invites','revoke_invite','send_channel_message','cm_edit','cm_delete','cm_react',
             'cm_pin','get_channel_messages','get_channel_message','search_channel','get_channel_pins','mark_channel_read','is_member','server_role','require_member','require_admin',
             'channel_name','attach_ok','is_admin','require_admin_user','my_badges','show_badge','admin_badges','admin_save_badge','admin_delete_badge','admin_give_badge',
             'admin_take_badge','admin_badge_holders','admin_users','admin_suspend','admin_stats','admin_announce',
             'shown_activity','voice_join','voice_leave','voice_state','voice_heartbeat','send_voice_signal','set_typing')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

-- internal helper: only the functions above use it
revoke all on function public.message_json(public.messages) from public, anon, authenticated;
revoke all on function public.cm_json(public.channel_messages) from public, anon, authenticated;
revoke all on function public.refresh_badges(uuid) from public, anon, authenticated;
revoke all on function public.badge_json(public.badge_catalog) from public, anon, authenticated;

-- live updates: these tables feed Supabase Realtime (each person only receives rows they're allowed to read)
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'friend_requests', 'friendships', 'presence', 'call_signals', 'notifications', 'profile_details', 'message_reactions',
      'servers', 'server_members', 'channels', 'channel_messages', 'channel_reactions', 'voice_members', 'voice_signals', 'typing_state'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;


-- pictures you upload (avatars, banners, backgrounds): anyone can view them by link, only you can add or remove your own
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('media', 'media', true, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
      on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists skyline_media_insert on storage.objects';
    execute $p$create policy skyline_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists skyline_media_update on storage.objects';
    execute $p$create policy skyline_media_update on storage.objects for update to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute 'drop policy if exists skyline_media_delete on storage.objects';
    execute $p$create policy skyline_media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  end if;
end $$;

-- files you send: private. A conversation's folder is only for the two of you; a server's folder is for its members.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('attachments', 'attachments', false, 26214400, array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'application/pdf', 'text/plain', 'application/zip'])
      on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists skyline_attach_insert on storage.objects';
    execute $p$create policy skyline_attach_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'attachments' and public.attach_ok(name, auth.uid(), true))$p$;
    execute 'drop policy if exists skyline_attach_read on storage.objects';
    execute $p$create policy skyline_attach_read on storage.objects for select to authenticated
      using (bucket_id = 'attachments' and public.attach_ok(name, auth.uid(), false))$p$;
  end if;
end $$;
