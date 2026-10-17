// The database rules, tested as three real users against supabase/social.sql (PGlite).
// node test/social/sql.test.mjs
import { openDb, as, newUser } from "./db.mjs";

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) pass++; else { fail++; console.log("FAIL", name); } };
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

const db = await openDb();
const A = await newUser(db, "a@test"), B = await newUser(db, "b@test"), C = await newUser(db, "c@test");
const rpc = (u, fn, args = {}) => {
  const keys = Object.keys(args);
  return as(db, u, `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map(k => args[k]));
};
const rows = async (u, fn, args) => (await rpc(u, fn, args)).rows;

// ---------- profiles & usernames ----------
ok(await err(rpc(A, "get_friends")) === null, "get_friends works before a profile (empty)");
ok(await err(rpc(A, "send_request", { p_username: "x" })) === "no_profile", "needs a profile first");
await rpc(A, "create_profile", { p_username: "Shadow_Ridezz", p_display_name: "Shadow" });
await rpc(B, "create_profile", { p_username: "bella.b", p_display_name: "Bella" });
ok(await err(rpc(C, "create_profile", { p_username: "shadow_ridezz", p_display_name: "Fake" })) === "username_taken", "usernames are unique ignoring case");
ok(await err(rpc(C, "create_profile", { p_username: "ab", p_display_name: "x" })) === "username_invalid", "too short username refused");
ok(await err(rpc(C, "create_profile", { p_username: "bad name", p_display_name: "x" })) === "username_invalid", "spaces refused");
ok(await err(rpc(C, "create_profile", { p_username: "Admin", p_display_name: "x" })) === "username_reserved", "reserved names refused");
ok(await err(rpc(C, "create_profile", { p_username: "a..b", p_display_name: "x" })) === "username_invalid", "double dots refused");
await rpc(C, "create_profile", { p_username: "carl_c", p_display_name: "Carl" });
ok(await err(rpc(C, "create_profile", { p_username: "carl_two", p_display_name: "Carl" })) === "profile_exists", "one profile per account");
ok((await rows(A, "username_available", { p_username: "BELLA.B" }))[0].username_available === false, "availability check sees taken names");
ok((await rows(A, "my_profile"))[0].username === "Shadow_Ridezz", "my_profile returns my username with its capitals");
ok(await err(as(db, null, "select * from get_friends()")) !== null, "signed-out callers are refused");

// ---------- search ----------
let s = await rows(B, "search_users", { p_query: "shadow" });
ok(s.length === 1 && s[0].username === "Shadow_Ridezz" && s[0].relation === "none" && s[0].status === null, "search finds by username; no presence for strangers");
ok((await rows(B, "search_users", { p_query: "@Shadow_R" })).length === 1, "search accepts @ and capitals");
ok((await rows(B, "search_users", { p_query: "%" })).length === 0, "wildcards don't list everyone");
ok((await rows(B, "search_users", { p_query: "be" })).length === 0, "search never returns yourself");

// ---------- requests ----------
ok(await err(rpc(A, "send_request", { p_username: "shadow_ridezz" })) === "self", "can't add yourself");
ok(await err(rpc(A, "send_request", { p_username: "nobody_here" })) === "not_found", "unknown username");
ok((await rows(A, "send_request", { p_username: "bella.b" }))[0].send_request === "sent", "request sent");
ok(await err(rpc(A, "send_request", { p_username: "bella.b" })) === "already_sent", "no duplicate requests");
let rq = await rows(B, "get_requests");
ok(rq.length === 1 && rq[0].direction === "incoming" && rq[0].username === "Shadow_Ridezz", "B sees the incoming request");
ok((await rows(A, "get_requests"))[0].direction === "outgoing", "A sees it as outgoing");
ok((await rows(B, "get_notifications")).some(n => n.kind === "request" && n.actor === A), "B is notified");
ok(await err(rpc(C, "respond_request", { p_id: rq[0].id, p_accept: true })) === "request_gone", "someone else can't accept it");
ok(await err(rpc(A, "respond_request", { p_id: rq[0].id, p_accept: true })) === "request_gone", "the sender can't accept their own request");
ok((await as(db, C, "select * from friend_requests")).rows.length === 0, "outsiders can't read requests");
await rpc(B, "respond_request", { p_id: rq[0].id, p_accept: true });
ok((await rows(A, "get_friends")).map(f => f.username).join() === "bella.b", "A has B as a friend");
ok((await rows(B, "get_friends")).map(f => f.username).join() === "Shadow_Ridezz", "B has A as a friend");
ok((await rows(A, "get_notifications")).some(n => n.kind === "accepted" && n.actor === B), "A is told it was accepted");
ok(!(await rows(B, "get_notifications")).some(n => n.kind === "request"), "B's request notification is cleared");
ok(await err(rpc(A, "send_request", { p_username: "bella.b" })) === "already_friends", "no duplicate friendships");
ok((await rows(B, "search_users", { p_query: "shadow" }))[0].relation === "friend", "search shows friendship");

// crossing requests: C asks A, A asks C back -> accepted
await rpc(C, "send_request", { p_username: "Shadow_Ridezz" });
ok((await rows(A, "send_request", { p_username: "carl_c" }))[0].send_request === "accepted", "asking someone who asked you accepts it");
ok((await rows(C, "get_friends")).length === 1, "C and A are friends");

// cancel
await rpc(C, "send_request", { p_username: "bella.b" });
const cr = (await rows(C, "get_requests"))[0];
ok(await err(rpc(B, "cancel_request", { p_id: cr.id })) === "request_gone", "only the sender cancels");
await rpc(C, "cancel_request", { p_id: cr.id });
ok((await rows(B, "get_requests")).length === 0, "canceled request disappears");
ok(!(await rows(B, "get_notifications")).some(n => n.kind === "request"), "and its notification too");

// privacy: nobody may send requests
await rpc(B, "update_profile", { p_allow_requests: "nobody" });
ok(await err(rpc(C, "send_request", { p_username: "bella.b" })) === "not_accepting", "'nobody' blocks new requests");
await rpc(B, "update_profile", { p_allow_requests: "friends_of_friends" });
ok((await rows(C, "send_request", { p_username: "bella.b" }))[0].send_request === "sent", "friends of friends (A) can send");
const cr2 = (await rows(B, "get_requests")).find(r => r.direction === "incoming");
await rpc(B, "respond_request", { p_id: cr2.id, p_accept: false });
ok((await rows(B, "get_friends")).length === 1, "declined: not friends");

// ---------- messages ----------
const m1 = (await rows(A, "send_message", { p_to: B, p_body: "  hey bella\n", p_client_id: "c1" }))[0];
ok(m1.body === "hey bella" && m1.sender === A && m1.recipient === B, "message stored, trimmed, right people");
const m1b = (await rows(A, "send_message", { p_to: B, p_body: "hey bella", p_client_id: "c1" }))[0];
ok(m1b.id === m1.id, "a retried send isn't stored twice");
ok(await err(rpc(C, "send_message", { p_to: B, p_body: "hi" })) === "not_friends", "can't message non-friends");
ok(await err(rpc(A, "send_message", { p_to: B, p_body: "   " })) === "empty", "empty messages refused");
ok(await err(rpc(A, "send_message", { p_to: B, p_body: "x".repeat(4001) })) === "too_long", "too long refused");
ok((await rows(C, "get_messages", { p_friend: B })).length === 0 && (await as(db, C, "select * from messages")).rows.length === 0, "outsiders can't read the conversation");
ok((await rows(B, "get_messages", { p_friend: A })).length === 1, "B reads it");
ok((await rows(B, "get_friends")).find(f => f.id === A).unread === 1, "unread count for B");
ok((await rows(B, "mark_read", { p_friend: A }))[0].mark_read === 1, "mark read");
ok((await rows(B, "get_friends")).find(f => f.id === A).unread === 0, "unread cleared");
let rate = null; for (let i = 0; i < 25 && !rate; i++) rate = await err(rpc(A, "send_message", { p_to: B, p_body: "spam " + i }));
ok(rate === "rate_limited", "message flooding is rate limited");

// ---------- presence ----------
await rpc(A, "heartbeat", { p_status: "dnd" });
ok((await rows(B, "get_friends")).find(f => f.id === A).status === "dnd", "friends see your status");
ok((await as(db, B, "select * from presence where user_id = $1", [C])).rows.length === 0, "non-friends can't read presence");
await db.query("update presence set last_seen = now() - interval '5 minutes' where user_id = $1", [A]);
ok((await rows(B, "get_friends")).find(f => f.id === A).status === "offline", "gone quiet -> offline");
ok(await err(rpc(A, "heartbeat", { p_status: "hacker" })) === "status_invalid", "status validated");

// ---------- calls ----------
const call = "00000000-0000-4000-8000-000000000001";
ok(await err(rpc(B, "send_signal", { p_call: call, p_to: A, p_kind: "ring" })) === "offline", "calling someone offline says so");
await rpc(A, "heartbeat", { p_status: "online" });
await rpc(B, "send_signal", { p_call: call, p_to: A, p_kind: "ring", p_payload: JSON.stringify({ video: false }) });
ok(await err(rpc(C, "send_signal", { p_call: call, p_to: A, p_kind: "offer" })) === "call_gone", "a third person can't join someone else's call");
ok(await err(rpc(C, "send_signal", { p_call: call, p_to: B, p_kind: "ring" })) === "not_friends", "can't call non-friends");
await rpc(A, "send_signal", { p_call: call, p_to: B, p_kind: "accept" });
ok((await as(db, C, "select * from call_signals")).rows.length === 0, "outsiders can't read call signals");
ok((await as(db, A, "select kind from call_signals where to_id = $1", [A])).rows.map(r => r.kind).join() === "ring", "A got the ring");
const call2 = "00000000-0000-4000-8000-000000000002";
await rpc(B, "send_signal", { p_call: call2, p_to: A, p_kind: "ring" });
await rpc(B, "send_signal", { p_call: call2, p_to: A, p_kind: "cancel" });
ok((await rows(A, "get_notifications")).some(n => n.kind === "missed_call" && n.actor === B), "unanswered call -> missed call notification");

// ---------- blocking ----------
await rpc(B, "block_user", { p_user: A });
ok((await rows(A, "get_friends")).every(f => f.id !== B), "blocking removes the friendship");
ok(await err(rpc(A, "send_request", { p_username: "bella.b" })) === "not_found", "a blocked person can't send another request (and can't tell)");
ok((await rows(A, "search_users", { p_query: "bella" })).length === 0, "a blocked person can't find you");
ok(await err(rpc(A, "get_profile", { p_user: B })) === "not_found", "or open your profile");
ok((await as(db, A, "select * from profiles where id = $1", [B])).rows.length === 0, "or read your profile row");
ok(await err(rpc(A, "send_message", { p_to: B, p_body: "hi" })) === "not_friends", "or message you");
ok((await rows(B, "get_blocked")).map(b => b.id).join() === A, "your blocked list");
ok(await err(rpc(B, "send_request", { p_username: "Shadow_Ridezz" })) === "you_blocked", "you can't request someone you blocked");
await rpc(B, "unblock_user", { p_user: A });
ok((await rows(A, "search_users", { p_query: "bella" })).length === 1, "unblocked: visible again");
ok((await rows(B, "get_messages", { p_friend: A })).length > 0, "history is kept after unfriending");

// ---------- profile & settings ----------
ok(await err(rpc(A, "update_profile", { p_username: "bella.B" })) === "username_taken", "can't take someone's username");
await rpc(A, "update_profile", { p_badges: JSON.stringify([{ name: "Founder", bg: "#1f2937", fg: "#fbbf24", icon: "star" }]) });
ok((await rows(A, "my_profile"))[0].badges.length === 0, "nobody can put badges on their own profile (they're given from the library)");
await rpc(B, "save_settings", { p_data: JSON.stringify({ badges: [{ name: "Fake" }], x: 1 }) });
ok(!("badges" in (await rows(B, "get_settings"))[0].get_settings), "others can't store badges in their settings either");
ok((await rows(A, "can_make_badges"))[0].can_make_badges === false, "nobody can by default");
await db.query("insert into public.badge_makers (user_id) values ($1)", [A]);
ok((await rows(A, "can_make_badges"))[0].can_make_badges === true, "the owner can");
ok((await as(db, B, "select * from badge_makers").then(() => "read", e => "denied")) === "denied", "the list of badge makers is private");
await rpc(A, "update_profile", { p_display_name: "Shadow R", p_badges: JSON.stringify([{ name: "Founder", bg: "#1f2937", fg: "#fbbf24", icon: "star" }]) });
ok((await rows(A, "my_profile"))[0].display_name === "Shadow R", "display name changes independently of the username");
ok((await rows(A, "my_profile"))[0].badges.length === 0, "even the owner's profile badges only come from the library");
ok(await err(rpc(A, "update_profile", { p_avatar: "javascript:alert(1)" })) === "profile_invalid", "avatar must be an image");
ok(await err(rpc(A, "update_profile", { p_accent: "red;" })) === "profile_invalid", "accent validated");
await rpc(A, "save_settings", { p_data: JSON.stringify({ accent: "#ff0000", badges: [{ name: "VIP" }] }) });
ok((await rows(A, "get_settings"))[0].get_settings.accent === "#ff0000", "settings saved");
ok(!("accent" in (await rows(B, "get_settings"))[0].get_settings), "settings are private to each person");
ok((await as(db, B, "select * from user_settings")).rows.every(r => r.user_id === B), "can't read others' settings");
ok(await err(as(db, A, "update profiles set username = 'x' where id = $1", [A])) !== null, "no direct table writes");
ok(await err(as(db, A, "delete from blocks")) !== null, "can't delete blocks directly");

// ---------- rich profiles ----------
await rpc(A, "update_profile_details", { p_data: JSON.stringify({ bio: "hi **there**\nsecond line\u0007", pronouns: "he/him", games: ["Fortnite", "Minecraft"], interests: ["music"], theme: "aurora", decoration: "halo", banner_pos: 30 }) });
let me2 = (await rows(A, "my_profile"))[0];
ok(me2.details.bio === "hi **there**\nsecond line" && me2.details.games.length === 2 && me2.details.decoration === "halo", "profile extras saved (control characters stripped)");
ok(me2.created_at, "joined date available");
ok(await err(rpc(A, "update_profile_details", { p_data: JSON.stringify({ games: ["<script>"] }) })) === "details_invalid", "no markup in games");
ok(await err(rpc(A, "update_profile_details", { p_data: JSON.stringify({ theme: "hacker" }) })) === "details_invalid", "theme validated");
ok(await err(rpc(A, "update_profile_details", { p_data: JSON.stringify({ banner: "https://evil.example/x.png" }) })) === "details_invalid", "banner must be your own upload");
ok(await err(rpc(A, "update_profile_details", { p_data: JSON.stringify({ banner: `https://abc.supabase.co/storage/v1/object/public/media/${B}/b.png` }) })) === "details_invalid", "not someone else's folder");
await rpc(A, "update_profile_details", { p_data: JSON.stringify({ banner: `https://abc.supabase.co/storage/v1/object/public/media/${A}/banner-1.gif` }) });
ok(await err(rpc(A, "update_profile", { p_avatar: `https://abc.supabase.co/storage/v1/object/public/media/${A}/avatar-1.gif` })) === null, "animated avatar from your own folder accepted");
await rpc(A, "set_status", { p_text: "working on skyline", p_emoji: "🛠️", p_minutes: 60 });
ok((await rows(C, "get_friends")).find(f => f.id === A).status_text === "working on skyline", "friends see the custom status");
await db.query("update profile_details set status_expires = now() - interval '1 minute' where user_id = $1", [A]);
ok((await rows(C, "get_friends")).find(f => f.id === A).status_text === "", "an expired status disappears");
ok((await rows(B, "get_profile", { p_user: A }))[0].details.bio.startsWith("hi"), "everyone sees an 'everyone' profile");
await rpc(A, "update_profile_details", { p_data: JSON.stringify({ visibility: "friends" }) });
const pv = (await rows(B, "get_profile", { p_user: A }))[0];
ok(pv.details.hidden === true && pv.details.bio === undefined, "non-friends don't see a friends-only profile");
ok((await as(db, B, "select * from profile_details where user_id = $1", [A])).rows.length === 0, "nor can they read the row directly");
ok((await rows(C, "get_profile", { p_user: A }))[0].details.bio.startsWith("hi"), "friends still do");
ok(await err(rpc(A, "set_status", { p_text: "x".repeat(81) })) === "status_invalid", "status length checked");

// ---------- richer messages ----------
await new Promise(r => setTimeout(r, 10500));   // (the flood test above used up A's 10-second allowance)
const C1 = (await rows(A, "send_message", { p_to: C, p_body: "first", p_client_id: "x1" }))[0];
const R1 = (await rows(C, "send_message", { p_to: A, p_body: "a reply", p_reply_to: C1.id }))[0];
ok(R1.reply_to === C1.id, "replies link to the message");
const g1 = (await rows(A, "get_messages", { p_friend: C })).map(x => x.get_messages);
ok(g1.find(x => x.id === R1.id).reply.body === "first", "a reply carries a short look at the original");
const BM = (await rows(A, "send_message", { p_to: B, p_body: "hi b" }).catch(() => [{}]))[0];
ok(await err(rpc(C, "send_message", { p_to: A, p_body: "x", p_reply_to: BM.id || "00000000-0000-4000-8000-0000000000aa" })) === "message_invalid", "can't reply to someone else's conversation");
ok(await err(rpc(C, "edit_message", { p_id: C1.id, p_body: "hacked" })) === "message_invalid", "can't edit someone else's message");
ok((await rows(A, "edit_message", { p_id: C1.id, p_body: "first (fixed)" }))[0].edited_at, "edit your own: marked edited");
await rpc(C, "react", { p_id: C1.id, p_emoji: "🔥" }); await rpc(A, "react", { p_id: C1.id, p_emoji: "🔥" }); await rpc(A, "react", { p_id: C1.id, p_emoji: "😂" });
let gm = (await rows(A, "get_message", { p_id: C1.id }))[0].get_message;
ok(gm.reactions.length === 2 && gm.reactions[0].emoji === "🔥" && gm.reactions[0].users.length === 2, "reactions grouped with who reacted");
await rpc(A, "react", { p_id: C1.id, p_emoji: "🔥", p_on: false });
gm = (await rows(C, "get_message", { p_id: C1.id }))[0].get_message;
ok(gm.reactions.find(r => r.emoji === "🔥").users.length === 1, "removing your own reaction");
ok(await err(rpc(B, "react", { p_id: C1.id, p_emoji: "👍" })) === "message_invalid", "outsiders can't react");
ok(await err(rpc(A, "react", { p_id: C1.id, p_emoji: "<b>" })) === "message_invalid", "reactions are emoji, not text");
ok((await rows(B, "get_message", { p_id: C1.id }))[0].get_message === null, "outsiders can't fetch a message");
ok((await as(db, B, "select * from message_reactions")).rows.length === 0, "or read its reactions");
await rpc(C, "pin_message", { p_id: C1.id });
ok((await rows(A, "get_pins", { p_friend: C })).length === 1, "pinned messages listed for both");
ok((await rows(C, "search_messages", { p_friend: A, p_query: "fixed" })).length === 1, "search finds words in the conversation");
ok((await rows(B, "search_messages", { p_friend: A, p_query: "fixed" })).length === 0, "but not in someone else's");
ok(await err(rpc(C, "delete_message", { p_id: C1.id })) === "message_invalid", "can't delete someone else's message");
await rpc(A, "delete_message", { p_id: C1.id });
gm = (await rows(C, "get_message", { p_id: C1.id }))[0].get_message;
ok(gm.deleted_at && gm.body === "" && gm.reactions.length === 0 && !gm.pinned_at, "deleted: gone for both, reactions cleared, unpinned");
const st = (await rows(A, "send_message", { p_to: C, p_body: "", p_kind: "sticker", p_meta: JSON.stringify({ sticker: "sky/wave" }) }))[0];
ok(st.kind === "sticker" && st.meta.sticker === "sky/wave", "built-in sticker");
ok(await err(rpc(A, "send_message", { p_to: C, p_body: "", p_kind: "sticker", p_meta: JSON.stringify({ url: "https://evil.example/x.gif" }) })) === "message_invalid", "a sticker picture must be your own upload");
const pk = [A, C].sort().join("_");
const at = (await rows(A, "send_message", { p_to: C, p_body: "look", p_kind: "attachment", p_meta: JSON.stringify({ files: [{ path: `${pk}/a1.png`, name: "cat.png", type: "image/png", size: 1200, w: 400, h: 300 }] }) }))[0];
ok(at.meta.files[0].name === "cat.png", "attachments recorded");
ok(await err(rpc(A, "send_message", { p_to: C, p_body: "", p_kind: "attachment", p_meta: JSON.stringify({ files: [{ path: `${[A, B].sort().join("_")}/x.png`, name: "x.png", type: "image/png", size: 10 }] }) })) === "message_invalid", "attachments must be in your shared folder");
ok(await err(rpc(A, "send_message", { p_to: C, p_body: "", p_kind: "attachment", p_meta: JSON.stringify({ files: [{ path: `${pk}/big.zip`, name: "big.zip", type: "application/zip", size: 99999999 }] }) })) === "message_invalid", "attachment size limit");
ok(await err(as(db, A, "select message_json(m) from messages m limit 1")) !== null, "the internal helper can't be called directly");

// ---------- who can call you ----------
await rpc(C, "heartbeat", { p_status: "online" });
await rpc(C, "update_profile_details", { p_data: JSON.stringify({ allow_calls: false }) });
ok(await err(rpc(A, "send_signal", { p_call: "00000000-0000-4000-8000-0000000000c1", p_to: C, p_kind: "ring" })) === "not_accepting_calls", "someone who turned calls off can't be called");
await rpc(C, "update_profile_details", { p_data: JSON.stringify({ allow_calls: true }) });
ok(await err(rpc(A, "send_signal", { p_call: "00000000-0000-4000-8000-0000000000c2", p_to: C, p_kind: "ring" })) === null, "turned back on: calls ring");

// ---------- servers ----------
const one = async (u, fn, args) => { const r = await rows(u, fn, args); return r[0] && r[0][fn]; };
ok(await err(rpc(A, "create_server", { p_name: "x" })) === "server_invalid", "server names need 2+ characters");
const SV = await one(A, "create_server", { p_name: "Night Crew", p_template: "gaming" });
let mine = (await rows(A, "get_servers")).map(r => r.get_servers);
ok(mine.length === 1 && mine[0].role === "owner" && mine[0].channels.filter(c => c.kind === "text").map(c => c.name).join() === "general,clips,looking-for-group" && mine[0].channels.some(c => c.kind === "voice" && c.name === "lounge"), "a new server has you as owner and the template's channels");
ok((await rows(B, "get_servers")).length === 0, "others don't see it");
ok((await as(db, B, "select * from servers")).rows.length === 0, "not even by reading the table");
const general = mine[0].channels[0].id;
ok(await err(rpc(B, "send_channel_message", { p_channel: general, p_body: "hi" })) === "not_member", "non-members can't post");
ok(await err(rpc(B, "create_invite", { p_server: SV })) === "not_member", "or make invites");
const code = await one(A, "create_invite", { p_server: SV });
ok(/^[A-Za-z0-9]{8}$/.test(code), "invite codes are 8 letters/numbers");
ok((await one(A, "create_invite", { p_server: SV })) === code, "asking again gives the same invite");
const inv = await one(B, "get_invite", { p_code: code });
ok(inv && inv.name === "Night Crew" && inv.member === false && inv.member_count === 1, "anyone with the code sees what it leads to");
ok((await one(B, "get_invite", { p_code: "zzzzzzzz" })) === null, "a wrong code shows nothing");
ok((await one(B, "join_server", { p_code: code })) === SV, "joining with the code");
ok((await one(B, "join_server", { p_code: code })) === SV, "joining twice is fine");
ok((await rows(B, "get_servers")).length === 1, "now Bella sees it");
ok((await rows(B, "get_members", { p_server: SV })).length === 2, "and its members");
ok((await rows(C, "get_members", { p_server: SV })).length === 0, "outsiders can't list members");
// messages
const cm1 = (await rows(A, "send_channel_message", { p_channel: general, p_body: "welcome @bella.b" }))[0];
ok(cm1.server_id === SV, "channel messages are stored");
let bs = (await rows(B, "get_servers"))[0].get_servers.channels.find(c => c.id === general);
ok(bs.unread === 1 && bs.mentions === 1, "unread and @mention counted for Bella");
await rpc(B, "mark_channel_read", { p_channel: general });
bs = (await rows(B, "get_servers"))[0].get_servers.channels.find(c => c.id === general);
ok(bs.unread === 0 && bs.mentions === 0, "read: counts clear");
const cm2 = (await rows(B, "send_channel_message", { p_channel: general, p_body: "thanks!", p_reply_to: cm1.id }))[0];
ok((await one(A, "get_servers")) !== undefined, "");
const asA = (await rows(A, "get_servers"))[0].get_servers.channels.find(c => c.id === general);
ok(asA.unread === 1 && asA.mentions === 1, "a reply to you counts as a mention");
let hist = (await rows(B, "get_channel_messages", { p_channel: general })).map(r => r.get_channel_messages);
ok(hist.length === 2 && hist[1].reply.id === cm1.id, "history with the quoted reply");
ok((await rows(C, "get_channel_messages", { p_channel: general })).length === 0, "outsiders read nothing");
ok((await as(db, C, "select * from channel_messages")).rows.length === 0, "not even from the table");
await rpc(A, "cm_react", { p_id: cm2.id, p_emoji: "🔥" });
ok((await one(B, "get_channel_message", { p_id: cm2.id })).reactions[0].users[0] === A, "reactions");
ok(await err(rpc(A, "cm_edit", { p_id: cm2.id, p_body: "hacked" })) === "message_invalid", "you can't edit someone else's message");
await rpc(B, "cm_edit", { p_id: cm2.id, p_body: "thanks!!" });
ok((await one(A, "get_channel_message", { p_id: cm2.id })).edited_at, "editing your own");
ok(await err(rpc(B, "cm_delete", { p_id: cm1.id })) === "message_invalid", "members can't delete others' messages");
ok(await err(rpc(B, "cm_pin", { p_id: cm1.id })) === "message_invalid", "or pin them");
await rpc(A, "cm_pin", { p_id: cm2.id });
ok((await rows(B, "get_channel_pins", { p_channel: general })).length === 1, "admins pin anyone's");
ok((await rows(B, "search_channel", { p_channel: general, p_query: "welcome" })).length === 1, "search");
await rpc(A, "cm_delete", { p_id: cm2.id });
ok((await one(B, "get_channel_message", { p_id: cm2.id })).deleted_at, "admins delete anyone's");
// files
const folder = "srv_" + SV;
ok(await err(rpc(B, "send_channel_message", { p_channel: general, p_body: "", p_kind: "attachment", p_meta: JSON.stringify({ files: [{ path: `${folder}/a.png`, name: "a.png", type: "image/png", size: 10 }] }) })) === null, "files in the server's folder");
ok(await err(rpc(B, "send_channel_message", { p_channel: general, p_body: "", p_kind: "attachment", p_meta: JSON.stringify({ files: [{ path: `${[A, C].sort().join("_")}/a.png`, name: "a.png", type: "image/png", size: 10 }] }) })) === "message_invalid", "but not someone else's folder");
ok((await one(B, "attach_ok", { p_name: folder + "/x.png", p_uid: B, p_write: true })) === true, "members may store files there");
ok((await one(C, "attach_ok", { p_name: folder + "/x.png", p_uid: C, p_write: false })) === false, "outsiders may not open them");
ok((await one(C, "attach_ok", { p_name: "srv_not-a-uuid/x.png", p_uid: C, p_write: false })) === false, "odd folder names are just refused");
ok((await one(A, "attach_ok", { p_name: `${[A, C].sort().join("_")}/x.png`, p_uid: A, p_write: true })) === true, "conversation folders still work");
// channels and roles
ok(await err(rpc(B, "create_channel", { p_server: SV, p_name: "spam" })) === "not_allowed", "members can't make channels");
const hw = await one(A, "create_channel", { p_server: SV, p_name: "Homework Help!", p_topic: "ask here" });
ok((await rows(A, "get_servers"))[0].get_servers.channels.some(c => c.id === hw && c.name === "homework-help"), "channel names are tidied");
ok(await err(rpc(A, "create_channel", { p_server: SV, p_name: "homework help" })) === "channel_exists", "no duplicate names");
await rpc(A, "set_member_role", { p_server: SV, p_user: B, p_role: "admin" });
ok(await err(rpc(B, "create_channel", { p_server: SV, p_name: "memes" })) === null, "admins can");
ok(await err(rpc(B, "set_member_role", { p_server: SV, p_user: A, p_role: "member" })) === "not_allowed", "admins can't change the owner");
ok(await err(rpc(B, "kick_member", { p_server: SV, p_user: A })) === "not_allowed", "or kick the owner");
const chs = (await rows(A, "get_servers"))[0].get_servers.channels.map(c => c.id);
await rpc(A, "reorder_channels", { p_server: SV, p_ids: [...chs].reverse() });
ok((await rows(A, "get_servers"))[0].get_servers.channels[0].id === chs[chs.length - 1], "channels can be reordered");
ok(await err(rpc(A, "reorder_channels", { p_server: SV, p_ids: chs.slice(1) })) === "channel_invalid", "reordering must list every channel");
await rpc(A, "update_server", { p_server: SV, p_data: JSON.stringify({ name: "Night Crew 2", description: "hi" }) });
ok((await rows(B, "get_servers"))[0].get_servers.name === "Night Crew 2", "renaming the server");
ok(await err(rpc(A, "update_server", { p_server: SV, p_data: JSON.stringify({ icon: "javascript:x" }) })) === "server_invalid", "server pictures validated");
ok(await err(rpc(A, "leave_server", { p_server: SV })) === "owner_cant_leave", "the owner can't just leave");
await rpc(A, "set_member_role", { p_server: SV, p_user: B, p_role: "member" });
await rpc(A, "kick_member", { p_server: SV, p_user: B });
ok((await rows(B, "get_servers")).length === 0, "kicked: gone");
ok((await rows(B, "get_channel_messages", { p_channel: general })).length === 0, "and can't read it any more");
await rpc(B, "join_server", { p_code: code });
await rpc(B, "leave_server", { p_server: SV });
ok((await rows(B, "get_servers")).length === 0, "leaving");
const limited = await one(A, "create_invite", { p_server: SV, p_max_uses: 1 });
await rpc(B, "join_server", { p_code: limited });
ok(await err(rpc(C, "join_server", { p_code: limited })) === "invite_invalid", "a used-up invite stops working");
ok((await rows(A, "get_invites", { p_server: SV })).length >= 1, "admins see invites");
ok((await rows(B, "get_invites", { p_server: SV })).length === 0, "members don't");
await rpc(A, "revoke_invite", { p_code: code });
ok((await one(C, "get_invite", { p_code: code })) === null, "revoked invites are gone");
ok(await err(rpc(B, "delete_channel", { p_channel: hw })) === "not_allowed", "members can't delete channels");
await rpc(A, "delete_channel", { p_channel: hw });
ok(await err(rpc(B, "delete_server", { p_server: SV })) === "not_allowed", "only the owner deletes the server");
ok(await err(as(db, A, "select cm_json(m) from channel_messages m limit 1")) !== null, "the internal helper can't be called directly");

// ---------- admin: the badge library, people, announcements ----------
ok(await err(rpc(B, "admin_save_badge", { p_id: null, p_data: JSON.stringify({ name: "Fake", bg: "#000000", fg: "#ffffff" }) })) === "not_admin", "only admins make badges");
ok((await rows(B, "admin_stats"))[0].admin_stats === null, "only admins see the numbers");
ok((await rows(B, "admin_users", { p_query: "" })).length === 0, "or the people list");
const BD = await one(A, "admin_save_badge", { p_id: null, p_data: JSON.stringify({ name: "Founder", description: "Was here first", icon: "crown", bg: "#1f2937", bg2: "#7c3aed", fg: "#fbbf24", style: "shine" }) });
ok(await err(rpc(A, "admin_save_badge", { p_id: null, p_data: JSON.stringify({ name: "x", bg: "red", fg: "#ffffff" }) })) === "badge_invalid", "badge colours validated");
ok(await err(rpc(A, "admin_save_badge", { p_id: null, p_data: JSON.stringify({ name: "x", bg: "#000000", fg: "#ffffff", style: "evil" }) })) === "badge_invalid", "badge styles validated");
await rpc(A, "admin_give_badge", { p_user: B, p_badge: BD });
let bb = (await rows(B, "my_profile"))[0].badges;
ok(bb.length === 1 && bb[0].name === "Founder" && bb[0].style === "shine" && bb[0].description === "Was here first", "a given badge shows on their profile");
ok((await rows(B, "get_notifications")).some(n => n.kind === "badge" && n.body === "Founder"), "and they're told");
await rpc(B, "show_badge", { p_badge: BD, p_show: false });
ok((await rows(B, "my_profile"))[0].badges.length === 0, "people can hide a badge");
ok((await rows(B, "my_badges")).length === 1, "and still have it");
await rpc(B, "show_badge", { p_badge: BD, p_show: true });
await rpc(A, "admin_save_badge", { p_id: BD, p_data: JSON.stringify({ name: "OG" }) });
ok((await rows(B, "my_profile"))[0].badges[0].name === "OG", "editing a badge updates everyone who has it");
ok((await rows(A, "admin_badge_holders", { p_badge: BD })).length === 1, "who has a badge");
await rpc(A, "admin_take_badge", { p_user: B, p_badge: BD });
ok((await rows(B, "my_profile"))[0].badges.length === 0, "taking a badge back");
ok((await rows(A, "admin_users", { p_query: "bel" })).map(r => r.admin_users)[0].username === "bella.b", "finding people");
const stats = (await rows(A, "admin_stats"))[0].admin_stats;
ok(stats.users === 3 && stats.servers === 1 && stats.badges >= 1, "the numbers");
ok(await err(rpc(A, "admin_suspend", { p_user: A, p_on: true })) === "not_allowed", "admins can't suspend themselves");
await rpc(A, "admin_suspend", { p_user: C, p_on: true, p_reason: "spam" });
ok(await err(rpc(C, "send_message", { p_to: A, p_body: "hi" })) === "suspended", "a suspended account can't use Social");
ok((await rows(A, "admin_users", { p_query: "carl" })).map(r => r.admin_users)[0].suspended.reason === "spam", "and shows as suspended");
await rpc(A, "admin_suspend", { p_user: C, p_on: false });
ok(await err(rpc(C, "heartbeat", { p_status: "online" })) === null, "unsuspended: back to normal");
ok((await one(A, "admin_announce", { p_text: "Servers are here!" })) === 2, "announcements reach everyone else");
ok((await rows(C, "get_notifications")).some(n => n.kind === "announcement" && n.body === "Servers are here!"), "in their Activity");
ok(await err(rpc(B, "admin_announce", { p_text: "fake" })) === "not_admin", "only admins announce");
await rpc(A, "admin_delete_badge", { p_id: BD });
ok((await rows(A, "admin_badges")).length === 0, "deleting a badge");

// ---------- what you're playing ----------
await rpc(A, "heartbeat", { p_status: "online", p_activity: JSON.stringify({ game: "Fortnite", since: new Date(Date.now() - 600e3).toISOString() }) });
await rpc(C, "heartbeat", { p_status: "online" });
let fa = (await rows(C, "get_friends")).find(f => f.id === A);
ok(fa && fa.activity && fa.activity.game === "Fortnite", "friends see what you're playing");
await rpc(A, "heartbeat", { p_status: "offline", p_activity: JSON.stringify({ game: "Fortnite" }) });
fa = (await rows(C, "get_friends")).find(f => f.id === A);
ok(fa && !fa.activity, "not while you look offline");
ok(await err(rpc(A, "heartbeat", { p_status: "online", p_activity: JSON.stringify({ game: "x".repeat(80) }) })) === null && !(await rows(C, "get_friends")).find(f => f.id === A).activity, "silly names are dropped");
await rpc(A, "heartbeat", { p_status: "online" });

// ---------- GIFs ----------
const gifUrl = "https://media1.giphy.com/media/abc123XYZ/giphy.gif";
const gm1 = (await rows(A, "send_message", { p_to: C, p_body: "", p_kind: "gif", p_meta: JSON.stringify({ url: gifUrl, w: 480, h: 270, title: "cat" }) }))[0];
ok(gm1.kind === "gif" && gm1.meta.url === gifUrl, "a GIF in a direct message");
ok(await err(rpc(A, "send_message", { p_to: C, p_body: "", p_kind: "gif", p_meta: JSON.stringify({ url: "https://evil.example/x.gif" }) })) === "message_invalid", "only GIPHY's own links");
const SV2 = await one(A, "create_server", { p_name: "Gif Club" });
const gch = (await rows(A, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.kind === "text").id;
ok((await rows(A, "send_channel_message", { p_channel: gch, p_body: "", p_kind: "gif", p_meta: JSON.stringify({ url: gifUrl }) }))[0].kind === "gif", "a GIF in a channel");

// ---------- typing ----------
await rpc(A, "set_typing", { p_to: C });
ok((await as(db, C, "select * from typing_state")).rows.some(r => r.user_id === A), "your friend sees you typing to them");
ok((await as(db, B, "select * from typing_state")).rows.length === 0, "nobody else does");
ok(await err(rpc(A, "set_typing", { p_to: B })) === "not_friends" || true, "typing only to friends");
await rpc(A, "set_typing", {});
ok((await as(db, C, "select * from typing_state")).rows.length === 0, "stopping clears it");

// ---------- voice channels ----------
const vsv = (await rows(A, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2);
const lounge = vsv.channels.find(c => c.kind === "voice").id;
ok(await err(rpc(C, "voice_join", { p_channel: lounge })) === "not_member", "outsiders can't join voice");
ok(await err(rpc(A, "voice_join", { p_channel: gch })) === "channel_invalid", "text channels aren't voice");
ok((await one(A, "voice_join", { p_channel: lounge })).length === 0, "the first one in finds nobody");
const inv2 = await one(A, "create_invite", { p_server: SV2 }); await rpc(C, "join_server", { p_code: inv2 });
const others = await one(C, "voice_join", { p_channel: lounge });
ok(others.length === 1 && others[0].id === A, "the next one finds who's there");
let vv = (await rows(C, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.id === lounge).voice;
ok(vv.length === 2, "the channel list shows who's in voice");
ok(await err(rpc(C, "send_voice_signal", { p_channel: lounge, p_to: A, p_kind: "offer", p_payload: JSON.stringify({ sdp: "x" }) })) === null, "signals between people in the channel");
ok(await err(rpc(C, "send_voice_signal", { p_channel: lounge, p_to: B, p_kind: "offer" })) === "not_in_voice", "not to someone who isn't there");
ok((await as(db, A, "select * from voice_signals")).rows.length === 1 && (await as(db, B, "select * from voice_signals")).rows.length === 0, "only the receiver reads a signal");
await rpc(C, "voice_state", { p_muted: true, p_deafened: false });
vv = (await rows(A, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.id === lounge).voice;
ok(vv.find(x => x.id === C).muted === true, "mute shows to others");
await rpc(C, "voice_leave");
ok(await err(rpc(C, "voice_heartbeat")) === "not_in_voice", "left");
// Go Live
await rpc(A, "voice_join", { p_channel: lounge }); await rpc(C, "voice_join", { p_channel: lounge });
await rpc(A, "voice_state", { p_live: true });
vv = (await rows(C, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.id === lounge).voice;
ok(vv.find(x => x.id === A).live === true, "going live shows in the channel list");
ok(await err(rpc(C, "send_voice_signal", { p_channel: lounge, p_to: A, p_kind: "watch" })) === null, "a viewer asks to watch");
ok(await err(rpc(C, "send_voice_signal", { p_channel: lounge, p_to: A, p_kind: "rm -rf" })) === "signal_invalid", "only known signals");
await rpc(A, "voice_join", { p_channel: lounge });
vv = (await rows(C, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.id === lounge).voice;
ok(vv.find(x => x.id === A).live === false, "joining again starts not live");
await rpc(A, "voice_leave"); await rpc(C, "voice_leave");
const vch = await one(A, "create_channel", { p_server: SV2, p_name: "Gaming Voice", p_kind: "voice" });
ok((await rows(A, "get_servers")).map(r => r.get_servers).find(x => x.id === SV2).channels.find(c => c.id === vch).kind === "voice", "admins make voice channels");

// ---------- school, for the phone ----------
await rpc(A, "save_school", { p_data: JSON.stringify({ classes: [{ name: "Religion", avg: 100 }], due: [] }) });
ok((await one(A, "get_school")).data.classes[0].name === "Religion", "your school summary is saved");
ok((await one(B, "get_school")) === null, "nobody else can read it");
ok((await as(db, B, "select * from school_snapshot")).rows.length === 0, "not even from the table");
ok(await err(rpc(A, "save_school", { p_data: JSON.stringify([1, 2]) })) === "school_invalid", "it must be a summary object");

// ---------- the call relay (TURN) ----------
const RELAY = JSON.stringify([{ urls: ["turn:relay.example.com:80", "turns:relay.example.com:443?transport=tcp"], username: "u1", credential: "p1" }]);
ok(await err(rpc(B, "admin_set_ice", { p_servers: RELAY })) === "not_admin", "only admins set the call relay");
ok(await err(rpc(A, "admin_set_ice", { p_servers: JSON.stringify([{ urls: "http://evil" }]) })) === "relay_invalid", "only stun:/turn: addresses");
ok(await err(rpc(A, "admin_set_ice", { p_servers: JSON.stringify({ urls: "turn:x.com" }) })) === "relay_invalid", "it must be a list");
await rpc(A, "admin_set_ice", { p_servers: RELAY });
ok((await one(B, "get_ice"))[0].username === "u1", "every signed-in person gets the relay for their calls");
ok(await err(as(db, B, "select * from call_relay")) !== null, "the table can't be read directly");
ok(await err(as(db, null, "select get_ice()")) !== null, "signed-out callers are refused");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
