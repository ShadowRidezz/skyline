# Skyline

A living night-city dashboard for Windows, with your music, your friends, your games and your school in one place.
Your desktop becomes a city at night, and its lights move with whatever you're listening to.

<!-- version -->**Latest version: 1.28.5**<!-- /version -->

## Get it

- **Windows:** download `Skyline-Setup-<version>.exe` from the
  [releases page](https://github.com/ShadowRidezz/skyline-releases/releases/latest) and run it. It installs for your
  user only (no admin needed). After that Skyline **updates itself**: new versions download in the background and
  install the next time it restarts.
- **iPhone and Android:** open **https://shadowridezz.github.io/skyline/** on your phone.
  - iPhone: Safari › Share › **Add to Home Screen**.
  - Android: Chrome › ⋮ › **Install app**.

  It opens like a normal app and is always the newest version. On the phone you get Home (the time and
  your city's weather with an hourly and 5-day forecast), Social (messages, friends, servers, GIFs) and
  School (your grades and homework, sent there by your PC's Skyline).

## What's in it

**Home:** clock, greeting and a daily briefing; weather with hourly and 5-day forecasts; CPU, memory, disk and
network graphs; a calendar, countdown, focus timer, tasks, a notes box, and quick links. Drag widgets by their title
to reorder them, or turn them off.

**Music:** whatever Windows says is playing (Spotify, a YouTube tab, Apple Music…).
- Play/pause, skip, seek, shuffle, repeat, volume, synced lyrics, recently played and a pop-out mini player.
- A real frequency spectrum from your speakers drives the visualisers and the city lights.
- **Your own songs:** drop in MP3, M4A, FLAC, WAV, OGG or Opus files and they play inside Skyline.
- **Spotify inside Skyline:** search and play every song, artist, album and playlist. It plays directly with
  Spotify Premium. Without Premium it works through Spicetify, or plays the song on YouTube.
- Music search remembers your recent searches. You can also share lyric cards and see a Weekly Wrapped.

**Social:** your Skyline account, with friends and messages like Discord. Forgot your password? You get a 6-digit
code by email: type it in and you're signed in, then pick a new password or just carry on.
- Direct messages with pictures, GIF search (with favorites and recents), stickers, emoji, replies and typing
  indicators. Right-click a sticker to delete it.
- **Servers** with text and voice channels, invites, and roles for the owner.
- Voice and video calls, screen sharing (full screen, high quality), and **Go Live** in voice channels.
- **Clear voice on calls:** your mic is sent at full quality (64 kbps Opus, or 128 kbps in Studio) with rumble taken
  out and a steady volume, and it holds up on a bad connection. Settings › Voice & video has the quality setting and
  a **Hear yourself** test.
- **Watch together:** watch YouTube or listen along on Spotify with a friend.
- Profiles with badges, a status, and "Playing Fortnite" style activity.
- **Share themes:** send a Theme Studio theme to a friend in a DM; they get a card and switch to it with one click.

**Games:** your whole library in one place. Steam, Epic, Xbox, browser and local games, with their real cover art.
- Play time per game (only while the game is in front), and a game stats card.
- **Clip saver:** while you play, Skyline keeps the last minute in memory. Press the clip key and the last
  30 to 60 seconds are saved to `Videos\Skyline Clips`. It's off until you turn it on.
- **Minecraft:** jump straight into your modpacks.

**School:** Google Classroom assignments and grades, a calendar, your class schedule, and study tools (flashcards,
quizzes, an assignment planner). Grade alerts and spoken homework reminders. Everything also shows on the phone app.
**Grade history** shows every change to each class average and what caused it (a low quiz, a regrade), with the
biggest drop called out.

**Money:** track what comes in and goes out, and save up for goals.

**YouTube:** search and watch without leaving Skyline.

**Sky, the assistant** (Ask Sky in the side bar, or Ctrl+Space / Alt+Shift+A from anywhere):
- Talk to it: "open Minecraft", "play Blinding Lights", "volume 40", "set a timer for 25 minutes", "what's due tomorrow?".
- It answers out loud, with a choice of voices.
- It remembers how you do things ("remember that I use Modrinth for Minecraft").
- Questions it can't answer go to Claude or ChatGPT if you've connected one.

**The look:** a calm, readable interface over a city at night: one card style, one accent colour, clear type and
line icons, the same on the PC and the phone.

**Themes:** live photos of real cities at night whose lights twinkle with your music, plus Theme Studio
for colours, effects, rain, snow, your own photos, fonts, glass styles and layouts. Themes can change by time of
day, and live weather appears in the sky.

**App:** **fast start** (the clock and your city in well under a second; the rest loads right after), tray icon
with music controls, starts with Windows if you want, a command bar (Ctrl+K), a sleep timer,
backup and restore, and ambient mode (just the city, the time and your music). Press **?** for all shortcuts.

## Privacy

Skyline's own settings and files stay on your PC, in `%APPDATA%\Skyline`. Social (messages, friends, servers) and
the school summary for the phone app are stored in Skyline's online database, and only you and the people you
talk to can read them. API keys and sign-ins are stored encrypted on your PC and never go in backups.

## Building it yourself

```
npm install
npm start               # run from source
node mobile/build.mjs   # build the phone app into docs/
.\release.ps1           # build, publish and update this page (needs GH_TOKEN)
```

- `main/`: the app shell (window, tray, updates, Social link, voice, Spotify, clips, school).
- `renderer/`: the interface; `renderer/js/social/` is Social, shared with the phone app.
- `mobile/`: the phone app's own shell; `docs/` is the built phone app that GitHub Pages serves.
- `supabase/social.sql`: the Social database. Skyline applies changes to it by itself.
