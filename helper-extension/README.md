# Sky Study Helper (Chrome extension + Skyline)

A side panel for **IXL** and **Sadlier Connect** that tutors you through the question on screen:

1. **💡 Hint**: the skill being tested, one hint, the method, and a worked example with *different* numbers. Never this question's answer.
2. **✍️ Check**: type your answer (or tap a choice letter) and press Check. Sky says if it's right; if not, what likely went wrong (without giving the answer away).
3. **📖 Full solution**: unlocks after you've checked an answer, with every step.
4. **💬 Ask Sky**: follow-up questions about the problem.
5. **🎯 Practice**: new questions on any skill (easy / medium / hard), checked as you go.
6. **📈 Progress**: your accuracy per skill, saved on your PC, with weak skills at the top.
7. **📷 Read from screen**: when math is drawn as a picture (IXL draws some symbols in its own font), Sky reads a screenshot of just the question area.

You still type and submit every answer on the site yourself.

## How it works

```
IXL / Sadlier tab ──(content script reads the visible question)──► extension side panel
side panel ──(http://127.0.0.1:47811, pairing code)──► Skyline (main/studyhelper.js) ──► Claude
```

- The AI runs through **Skyline**, using its existing connection: your Claude account signed in on this PC, or a Claude API key in Skyline. **No API key ever goes into the browser extension.**
- The Skyline helper only listens on `127.0.0.1` (this PC). It only answers the extension, and only with the **pairing code** shown in Skyline. Web pages are refused.
- Permissions: `sidePanel`, `storage`, `activeTab` (for the screenshot), and host access to `ixl.com`, `sadlierconnect.com`, `sadlier.com` and `127.0.0.1`. The extension doesn't read browsing history, other sites, passwords or anything typed into boxes.

## Install (Windows + Chrome)

1. **Skyline** must be running. You need version 1.16.0 or later.
2. In Skyline, go to the **Sky** page and click **📚 Study Helper**. Note the **pairing code** and click **📂 Open the folder**.
3. In Chrome, open `chrome://extensions` and switch on **Developer mode** (top right).
4. Click **Load unpacked** and choose that folder (`…\AppData\Local\Programs\Skyline\resources\helper-extension`).
5. Pin it: puzzle-piece icon › 📌 next to **Sky Study Helper**.
6. Open IXL or Sadlier and click the **Sky Study Helper** icon. The side panel opens. In ⚙ Settings, enter the pairing code and click **Connect**.

Edge works the same way, using `edge://extensions` instead.

**AI provider:** in Skyline, either sign in to Claude (Sky page › "Sign in to Claude") or add an Anthropic API key (Settings › AI builder). The panel tells you if neither is set up. Reading from the screen needs Claude: the offline AI on your PC can't read pictures.

## Troubleshooting

| What you see | Fix |
|---|---|
| "Skyline isn't running" | Start Skyline, then press ↻ in the panel. |
| "Pair the helper with Skyline" | ⚙ Settings › enter the code from Skyline › Connect. If you made a new code in Skyline, enter the new one. |
| "No AI" / sign-in errors | Sign in to Claude on Skyline's Sky page, or add a Claude key in Settings › AI. |
| The question isn't detected, or the text looks wrong (e.g. `�11`) | Press **📷 Read from screen**, or **✎ Fix the text** and type it. Sites change their layouts; Read from screen works on any layout. |
| "Chrome didn't allow a screenshot" | Click the Sky Study Helper icon in the toolbar once on that page, then try again. |
| Usage-limit message | Your Claude plan's limit was reached. Wait, or add an API key in Skyline. |
| Nothing updates when you go to the next question | Detection might be paused (⏸ is yellow). Click it to resume, or press ↻. |

## Tests

From the Skyline folder:

```
npx electron helper-extension/test/extract.test.js
set SKYLINE_TEST_CLAUDE=path\to\a\stand-in\claude.cmd
npx electron helper-extension/test/e2e.test.js
```

- `extract.test.js` checks question extraction on saved pages modelled on IXL (multiple choice; fill-in with a drawn minus sign) and Sadlier (vocabulary multiple choice). It also checks detection of the next question, and that passwords and typed text are never read.
- `e2e.test.js` starts Skyline's helper server with the real AI code, drives the real side panel, and checks:
  - pairing and refusals;
  - hint without spoilers, check, the solution lock, and the full solution;
  - follow-up chat, pause, and the next question;
  - read from screen, practice (including 1/2 = 0.5), progress, themes, and the error when Skyline isn't running.

**Limits:** the test pages are modelled on IXL's real page structure. Live IXL and Sadlier pages need a student login, and the sites change their layouts, so **📷 Read from screen** is the fallback that works on any layout.
