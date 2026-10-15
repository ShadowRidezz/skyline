// Microsoft's natural voices (Sonia, Libby, Aria...), the "Edge" voices Jarvis can use: the same free read-aloud
// service Microsoft Edge speaks with. Online; Skyline falls back to its Piper voices on this PC without internet.
const crypto = require("crypto");

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4", VER = "140.0.3485.14";
// the "Multilingual" ones are Microsoft's newest: far more conversational, with real rhythm and warmth
const VOICES = [
  ["en-US-AvaMultilingualNeural", "Ava", "Warm, expressive, caring woman (most natural)", "US"],
  ["en-US-EmmaMultilingualNeural", "Emma", "Cheerful, chatty woman", "US"],
  ["en-IE-EmilyNeural", "Emily", "Irish woman (FRIDAY vibes)", "IE"],
  ["en-GB-SoniaNeural", "Sonia", "Warm British woman", "UK"],
  ["en-GB-LibbyNeural", "Libby", "Bright young British woman", "UK"],
  ["en-AU-NatashaNeural", "Natasha", "Easygoing Australian woman", "AU"],
  ["en-US-AndrewMultilingualNeural", "Andrew", "Warm, genuine man", "US"],
  ["en-US-BrianMultilingualNeural", "Brian", "Casual, laid-back man", "US"],
];
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const id = () => crypto.randomUUID().replace(/-/g, "");
function gec() {   // the rolling access code Edge sends (changes every 5 minutes)
  let t = Math.floor(Date.now() / 1000) + 11644473600; t -= t % 300;
  return crypto.createHash("sha256").update(`${BigInt(t) * 10000000n}${TOKEN}`, "ascii").digest("hex").toUpperCase();
}

// One connection to the voice service, set up (and configured) before it's needed.
function connect() {
  const major = VER.split(".")[0], c = { at: Date.now(), dead: false, used: false };
  const ws = c.ws = new WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${id()}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-${VER}`, {
    headers: { Pragma: "no-cache", "Cache-Control": "no-cache", Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold", "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
      Cookie: "muid=" + crypto.randomBytes(16).toString("hex").toUpperCase() + ";" } });
  ws.binaryType = "arraybuffer";
  c.ready = new Promise((res, rej) => {
    ws.onopen = () => {
      ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      res(c);
    };
    ws.onerror = () => { c.dead = true; rej(new Error("Can't reach the voice service (are you online?)")); };
  });
  ws.onclose = () => { c.dead = true; if (c.onclose) c.onclose(); };
  c.ready.catch(() => {});
  return c;
}
// spare connections: taken by the next sentence, or thrown away if they sit unused too long
const spares = [];
const FRESH = 15000;
function take() {
  while (spares.length) { const c = spares.shift(); if (!c.dead && Date.now() - c.at < FRESH) return c; try { c.ws.close(); } catch (e) {} }
  return connect();
}
// get n connections ready (Skyline calls this the moment you start talking, so the reply can start at once)
function warm(n = 2) {
  for (let i = spares.length - 1; i >= 0; i--) if (spares[i].dead || Date.now() - spares[i].at >= FRESH) { try { spares[i].ws.close(); } catch (e) {} spares.splice(i, 1); }
  while (spares.length < n) spares.push(connect());
  clearTimeout(warm.t); warm.t = setTimeout(() => { for (const c of spares.splice(0)) { try { c.ws.close(); } catch (e) {} } }, FRESH);
}

// text -> mp3 bytes. speed 1 = the voice's natural pace.
async function speak(text, voice, speed = 1) {
  const rate = Math.round(Math.max(-40, Math.min(60, (speed - 1) * 100)));
  const c = await take().ready;
  if (spares.length < 1) warm(1);   // the next sentence's connection opens while this one is spoken
  return new Promise((resolve, reject) => {
    const ws = c.ws, chunks = []; let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(t); try { ws.close(); } catch (e) {} err ? reject(err) : resolve(val); };
    const t = setTimeout(() => finish(new Error("The voice service took too long")), 12000);
    ws.onmessage = e => {
      if (typeof e.data === "string") { if (/Path:turn\.end/.test(e.data)) chunks.length ? finish(null, Buffer.concat(chunks)) : finish(new Error("No audio came back")); return; }
      const b = Buffer.from(e.data), n = b.readUInt16BE(0);
      if (/Path:audio/.test(b.subarray(2, 2 + n).toString())) chunks.push(b.subarray(2 + n));
    };
    ws.onerror = () => finish(new Error("Can't reach the voice service (are you online?)"));
    c.onclose = () => finish(new Error("The voice service hung up"));
    if (c.dead) return finish(new Error("The voice service hung up"));
    ws.send(`X-RequestId:${id()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toString()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${esc(voice)}'><prosody pitch='+0Hz' rate='${rate >= 0 ? "+" : ""}${rate}%' volume='+0%'>${esc(text)}</prosody></voice></speak>`);
  });
}

module.exports = { speak, warm, EDGE_VOICES: VOICES };
