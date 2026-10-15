# Skyline

A living night-city dashboard for Windows. Your desktop becomes a skyline at 2 AM. Your music
floats above it, and the city's lights move with the beat.

## Install

Run **`dist\Skyline Setup 1.0.0.exe`**. It installs for your user only (no admin needed), adds
Skyline to the Start menu and the desktop, and opens it. To uninstall, go to
Settings › Apps › Installed apps › Skyline.

## What's in it

**Live photos:** real photos of cities at night that come alive. Skyline finds each photo's own
lights, then makes them twinkle and pulse with your music, and the bright parts of the city breathe with the bass.
- The photos: The View (your blue-hour picture through the window), Kanda Night, Akihabara Overhead, Midnight Avenue,
  Behind the Glass, Osaka Blue Hour, Shinjuku Deck, Seoul From the Top and Tokyo Night Flight.
- In Theme Studio you can tune brightness, colour grade, twinkle, glow, drift and framing, and add rain, snow or comets on top.
- "Use my own photo…" turns any picture into a live photo.
- The photos come from Wikimedia Commons; credits are in `renderer/img/photos/CREDITS.txt` and in Theme Studio.

**Minimal:** a clean black-and-grey look with almost no motion.

**Music:** whatever Windows says is playing (Spotify, a YouTube tab, Apple Music…).
- Play/pause, skip, seek, shuffle, repeat, system volume, and choosing which app to follow.
- A real frequency spectrum from your speakers drives the visualisers and the city: the bass
  makes the city glow breathe, the mids lift the particles, and the beat makes the lights flare.
- The album cover's colours tint the sky.
- Synced lyrics (LRCLIB), recently played, and a pop-out mini player.

**Your own songs:** add songs or whole folders on the Music page, or just drop them on the window.
- MP3, M4A, FLAC, WAV, OGG and Opus play right inside Skyline, with their titles, artists and cover art.
- They use the same player, lyrics and visualiser; your keyboard's media keys work too.
- **Spotify inside Skyline** (Music › Find a song): connect your Spotify once, then search every song, artist,
  album and playlist and play, queue, like or add to your playlists without leaving the app.
  - Setup: create a free app at developer.spotify.com, add the Redirect URI `http://127.0.0.1:43821/callback`,
    and paste its Client ID. You sign in on Spotify's own page.
  - Playing directly needs Spotify Premium; with a free account, songs open in the Spotify app instead.
  - The assistant plays Spotify too: "play Blinding Lights".
- Not connected? Find a song still searches the whole catalogue and plays songs on YouTube.

**Assistant:** the glowing mic in the side bar (Ctrl+Space, or Alt+Shift+A from anywhere).
- Click it and talk: "open Minecraft", "play Blinding Lights", "pause", "next song", "volume 40",
  "switch to Tokyo From Above", "set a timer for 25 minutes", "what's the weather?".
- Right-click it to type instead. It answers out loud (you can choose the voice or turn this off).
- Speech is understood offline by Windows' own recognizer, using the real names of your apps, games and songs.
- **Memory:** teach it how you do things. Say "remember that I use Modrinth App for Minecraft", and from
  then on "open Minecraft" opens Modrinth. Manage memories with the 🧠 button or in Settings › Assistant.
- With a Claude API key (Settings › AI), anything it doesn't know goes to Claude: questions,
  "put on something chill", several steps at once. Optional "Hey Skyline" wake word.

**Games** (left rail, Ctrl+3):
- **Search:** finds your saved games instantly.
- **AI Game Builder:** describe a game and pick its type, style and difficulty; Claude writes a real, playable browser game. Keep chatting to change it ("add a boss", "fix the jump"). There's a live preview with Play/Pause/Restart/Expand, "Fix with AI" when the game hits an error, undo for AI changes, regenerate, a code view, and export as a project folder or a single HTML file.
- **My games:** rename, duplicate, delete, export, and edit with AI.
- **Library:** browser, local and web games. "Find games on this PC" picks up Steam, Epic and game shortcuts, and they launch through their own launchers.
- **Real game art:** each game gets its real cover or logo instead of a generic file icon. Fortnite gets its Epic key art, Steam games their store art, Xbox and Store games the logo they ship with, and anything else its sharp 256 px app icon or its Wikipedia cover. "⋯ › Change picture…" lets you pick your own.
- **Find games:** searches itch.io browser games and FreeToGame. Results open on their own website after a notice; nothing is downloaded.
- **Setup:** the builder needs your own Anthropic API key (Settings › AI builder). The key is stored encrypted with Windows' protection and is only used by Skyline's background process.
- **Safety:** built games run in a sandbox with no internet and no access to your files or to Skyline.

**Home:** clock (4 styles), greeting, weather with hourly and 5-day forecast, CPU, memory,
disk and network graphs, calendar, focus timer, tasks, notes, and quick links with real site
icons. Drag widgets by their title to reorder them.

**Theme Studio** (Settings):
- Hover a theme to see it move. Save, Save As New, Rename, Duplicate, Reset, Delete,
  Import/Export (.skytheme files), "Surprise me" palettes, and undo/redo (Ctrl+Z / Ctrl+Y).
- Every colour and effect is adjustable, and you can use your own background picture
  (blur, brightness, contrast, opacity, overlay).

**Interface** (Settings):
- **Motion:** Off, Subtle or Full; startup "lights on" intro; rolling clock digits; 3D tilt.
- **Look:** fonts (Modern, Tech, Mono, Elegant, Playful), roundness, interface size, and Clear, Frosted or Solid glass. The side bar can show labels.
- **Accent:** from the theme, from the album art you're listening to, or your own colour.
- **Home:** layouts (Classic, Centered, Focus) and music player styles (Card, Vinyl, Compact).
- **Effects:** cursor glow, sparkle trail, and interface sounds.
- **Interactive sky:** click the background for a shooting star, double-click for fireworks.

**Motion everywhere:** pages drift in, a light indicator glides along the side bar, and cards cascade in and tilt toward the cursor. Glass panels catch a light that follows your mouse, and buttons ripple. Stats count up, themes crossfade, lyrics fill in karaoke-style, the player pulses on the beat, and new games celebrate with confetti.

**Automation:** themes by time of day; live weather in the sky (if it rains outside, it rains in
Skyline); reduce animations; and a smoothness choice of 24, 30 or 60 fps.

**App:** tray icon with music controls and a theme picker, open at Windows sign-in (optionally
straight to the tray), close to tray, and a global shortcut (Alt+Shift+S by default). Press
**?** in Skyline for all keyboard shortcuts.

**Ambient mode** (moon button or A) leaves only the city, the time and your music, with the
current lyric line floating above the skyline. F11 makes it full screen.

Skyline pauses its animation whenever its window is hidden or minimised, or a full-screen game
or video is in front. It runs at low priority otherwise.

## Privacy

Everything stays on your PC, in `%APPDATA%\Skyline`. Skyline only goes online for:
- weather (Open-Meteo: just the city you pick);
- lyrics (LRCLIB: the song's title and artist);
- each quick link's own site, to fetch its icon;
- game covers (Steam's store, Wikipedia: just the game's name);
- "Find a song" (Apple's iTunes Search: what you type) and YouTube when you play a song there;
- the assistant's "ask Claude" answers, only when you've added an API key.

Your voice never leaves the PC: speech is recognised by Windows itself.

The visualiser analyses your speakers' sound in memory. Nothing is recorded.

## Building it yourself

```
npm install
npm start            # run from source
npm run dist         # build dist\Skyline Setup <version>.exe
npm run icon         # re-render the icons from renderer/img/icon.svg
```

Testing without a window: `npx electron . --shot=steps.json --out=folder` renders offscreen,
runs each step's JavaScript and saves screenshots.

- `main/`: the app shell (window, tray, sign-in, shortcut, mini player, lyrics, site icons) and
  `helper.ps1`, the Windows helper for media, volume, the speaker level, network and
  full-screen detection.
- `renderer/`: the interface. `js/scene/engine.js` draws the scenes, in a worker for the live
  background; `studio.js` is Theme Studio, `music.js` the player and audio analysis, and
  `widgets.js` the home screen.
