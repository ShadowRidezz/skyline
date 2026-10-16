// The emoji picker: categories, search by name, recently used. One picker for statuses, messages and reactions.
import { esc } from "../util.js";
import { icon } from "./icons.js";
import { S } from "./state.js";

// "emoji name and search words", grouped
const DATA = {
  smileys: ["😀 grinning happy smile", "😃 smiley happy", "😄 smile happy laugh", "😁 grin beaming", "😆 laughing", "😅 sweat smile relief", "🤣 rofl rolling laughing", "😂 joy tears laughing",
    "🙂 slight smile", "🙃 upside down", "😉 wink", "😊 blush happy", "😇 innocent halo angel", "🥰 love hearts", "😍 heart eyes love", "🤩 star struck wow", "😘 kiss blow", "😋 yum tasty",
    "😛 tongue", "😜 wink tongue crazy", "🤪 zany crazy", "🤑 money", "🤗 hug", "🤭 giggle oops", "🤫 shush quiet", "🤔 thinking hmm", "🤐 zipper mouth", "🤨 raised eyebrow sus",
    "😐 neutral", "😑 expressionless", "😶 no mouth", "😏 smirk", "😒 unamused", "🙄 eye roll", "😬 grimace awkward", "😮‍💨 exhale relief", "🤥 lying", "😌 relieved",
    "😔 pensive sad", "😪 sleepy", "🤤 drool", "😴 sleeping zzz", "😷 mask sick", "🤒 thermometer sick", "🤕 hurt bandage", "🤢 nauseated", "🤮 vomit", "🥵 hot", "🥶 cold freezing",
    "🥴 woozy dizzy", "😵 dizzy dead", "🤯 mind blown exploding", "🤠 cowboy", "🥳 party celebrate", "😎 cool sunglasses", "🤓 nerd glasses", "🧐 monocle", "😕 confused", "😟 worried",
    "🙁 frown", "😮 open mouth wow", "😯 hushed", "😲 astonished shocked", "😳 flushed embarrassed", "🥺 pleading puppy eyes", "😦 frowning", "😧 anguished", "😨 fearful scared",
    "😰 anxious sweat", "😥 sad relieved", "😢 cry tear", "😭 sob crying loud", "😱 scream", "😖 confounded", "😣 persevere", "😞 disappointed", "😓 downcast sweat", "😩 weary",
    "😫 tired", "🥱 yawn bored", "😤 triumph huff", "😡 rage angry", "😠 angry mad", "🤬 cursing", "😈 smiling devil", "👿 angry devil", "💀 skull dead lol", "☠️ skull crossbones",
    "💩 poop", "🤡 clown", "👻 ghost", "👽 alien", "🤖 robot", "😺 smiley cat", "😹 cat joy", "😻 cat heart eyes", "🙈 see no evil monkey", "🙉 hear no evil", "🙊 speak no evil"],
  people: ["👋 wave hello hi bye", "🤚 raised back hand", "✋ raised hand stop", "🖖 vulcan", "👌 ok perfect", "🤌 pinched fingers", "✌️ peace victory", "🤞 fingers crossed luck",
    "🤟 love you", "🤘 rock on metal", "🤙 call me shaka", "👈 point left", "👉 point right", "👆 point up", "👇 point down", "☝️ index up", "👍 thumbs up like yes", "👎 thumbs down dislike no",
    "✊ fist", "👊 punch fist bump", "🤛 left fist", "🤜 right fist", "👏 clap applause", "🙌 raised hands hooray", "👐 open hands", "🤲 palms up", "🤝 handshake deal", "🙏 pray please thanks",
    "✍️ writing", "💅 nail polish", "💪 muscle strong flex", "🧠 brain smart", "👀 eyes looking", "👁️ eye", "👅 tongue", "👄 mouth", "🫶 heart hands", "🫡 salute",
    "🧑‍💻 technologist coder developer", "🧑‍🎓 student", "🧑‍🎤 singer", "🧑‍🍳 cook", "🥷 ninja", "🦸 superhero", "🧙 mage wizard", "🧛 vampire", "🧟 zombie", "💃 dancer dance", "🕺 man dancing"],
  nature: ["🐶 dog puppy", "🐱 cat kitten", "🐭 mouse", "🐹 hamster", "🐰 rabbit bunny", "🦊 fox", "🐻 bear", "🐼 panda", "🐨 koala", "🐯 tiger", "🦁 lion", "🐮 cow", "🐷 pig",
    "🐸 frog", "🐵 monkey", "🐔 chicken", "🐧 penguin", "🐦 bird", "🦅 eagle", "🦉 owl", "🐺 wolf", "🦄 unicorn", "🐝 bee", "🦋 butterfly", "🐢 turtle", "🐍 snake", "🐙 octopus",
    "🦈 shark", "🐬 dolphin", "🐳 whale", "🦖 t-rex dinosaur", "🐉 dragon", "🌵 cactus", "🌲 tree evergreen", "🌴 palm tree", "🍀 four leaf clover luck", "🍁 maple leaf", "🌸 cherry blossom",
    "🌹 rose", "🌻 sunflower", "🌙 moon crescent night", "⭐ star", "🌟 glowing star", "✨ sparkles", "⚡ lightning zap", "🔥 fire lit", "🌈 rainbow", "☀️ sun", "⛅ cloud sun",
    "🌧️ rain", "❄️ snowflake", "☃️ snowman", "🌊 wave ocean", "🌍 earth globe", "🪐 planet saturn", "☄️ comet"],
  food: ["🍎 apple", "🍊 orange", "🍋 lemon", "🍌 banana", "🍉 watermelon", "🍇 grapes", "🍓 strawberry", "🍒 cherries", "🍑 peach", "🥭 mango", "🍍 pineapple", "🥑 avocado",
    "🌶️ hot pepper spicy", "🌽 corn", "🥕 carrot", "🍞 bread", "🥐 croissant", "🧀 cheese", "🍳 egg cooking", "🥓 bacon", "🍔 burger", "🍟 fries", "🍕 pizza", "🌭 hot dog", "🌮 taco",
    "🌯 burrito", "🍜 ramen noodles", "🍣 sushi", "🍤 shrimp", "🍦 ice cream", "🍩 donut", "🍪 cookie", "🎂 birthday cake", "🍰 cake slice", "🧁 cupcake", "🍫 chocolate", "🍬 candy",
    "🍿 popcorn", "☕ coffee", "🍵 tea", "🧋 bubble tea boba", "🥤 soda drink", "🧃 juice", "🍺 beer", "🥂 cheers", "🧊 ice"],
  activities: ["⚽ soccer football", "🏀 basketball", "🏈 american football", "⚾ baseball", "🎾 tennis", "🏐 volleyball", "🎱 pool 8 ball", "🏓 ping pong", "🏒 hockey", "🥊 boxing",
    "🎯 bullseye target", "🎮 video game controller gaming", "🕹️ joystick arcade", "🎲 dice game", "🧩 puzzle", "♟️ chess", "🎨 art palette", "🎬 clapper movie", "🎤 microphone sing",
    "🎧 headphones music", "🎸 guitar", "🎹 piano keyboard", "🥁 drum", "🎷 saxophone", "🎺 trumpet", "🎻 violin", "🏆 trophy win", "🥇 gold medal first", "🥈 silver medal", "🥉 bronze medal",
    "🏅 medal", "🎟️ ticket", "🎪 circus", "🛹 skateboard", "🏂 snowboard", "🏄 surfing", "🚴 cycling bike", "🏋️ weight lifting gym", "🧘 yoga", "🎣 fishing", "🎉 party popper tada celebrate",
    "🎊 confetti", "🎁 gift present", "🎈 balloon"],
  travel: ["🚗 car", "🏎️ race car", "🚕 taxi", "🚌 bus", "🚓 police car", "🚑 ambulance", "🚒 fire engine", "🚲 bicycle", "🛵 scooter", "🏍️ motorcycle", "✈️ airplane", "🚀 rocket launch",
    "🛸 ufo", "🚁 helicopter", "⛵ sailboat", "🚢 ship", "🚂 train", "🗽 statue of liberty", "🗼 tokyo tower", "🏰 castle", "🏠 house home", "🏙️ cityscape city", "🌃 night city", "🌆 city dusk",
    "🌉 bridge night", "🏖️ beach", "🏝️ island", "⛰️ mountain", "🌋 volcano", "🗺️ map", "🧭 compass"],
  objects: ["⌚ watch", "📱 phone mobile", "💻 laptop computer", "⌨️ keyboard", "🖥️ desktop pc", "🖱️ mouse", "💾 floppy save", "💿 cd", "📷 camera", "🎥 movie camera", "📺 tv television",
    "📻 radio", "⏰ alarm clock", "⌛ hourglass", "💡 light bulb idea", "🔦 flashlight", "🕯️ candle", "💸 money wings", "💰 money bag", "💎 gem diamond", "🔧 wrench", "🔨 hammer", "🛠️ tools build",
    "⚙️ gear settings", "🔒 lock", "🔑 key", "🛡️ shield", "⚔️ swords", "🔮 crystal ball", "📌 pin", "📎 paperclip", "✏️ pencil", "📝 memo note", "📚 books study", "📖 book reading",
    "📅 calendar", "📈 chart up", "📉 chart down", "📦 package box", "✉️ envelope mail", "🔔 bell", "🔕 no bell mute", "🎵 music note", "🎶 notes music", "🗑️ trash"],
  symbols: ["❤️ red heart love", "🧡 orange heart", "💛 yellow heart", "💚 green heart", "💙 blue heart", "💜 purple heart", "🖤 black heart", "🤍 white heart", "🤎 brown heart",
    "💔 broken heart", "❣️ heart exclamation", "💕 two hearts", "💞 revolving hearts", "💓 beating heart", "💗 growing heart", "💖 sparkling heart", "💘 cupid", "💝 heart gift",
    "💯 hundred 100 perfect", "💢 anger", "💥 boom collision", "💫 dizzy", "💦 sweat drops", "💨 dash", "💬 speech bubble", "💭 thought bubble", "💤 zzz sleep", "✅ check done",
    "❌ cross no", "⭕ circle", "❗ exclamation", "❓ question", "‼️ double exclamation", "⚠️ warning", "🚫 prohibited", "⛔ no entry", "🔴 red circle", "🟠 orange circle", "🟡 yellow circle",
    "🟢 green circle", "🔵 blue circle", "🟣 purple circle", "⚫ black circle", "⚪ white circle", "➕ plus", "➖ minus", "✔️ check mark", "🆗 ok", "🆒 cool", "🆕 new", "🔝 top", "♻️ recycle",
    "🎵 music", "➡️ right arrow", "⬅️ left arrow", "⬆️ up arrow", "⬇️ down arrow", "🔁 repeat", "🔀 shuffle", "▶️ play", "⏸️ pause", "⏹️ stop"],
};
const CATS = [["recent", "Recent", "refresh"], ["smileys", "Smileys", "sparkle"], ["people", "People", "user"], ["nature", "Nature", "star"], ["food", "Food", "heart"],
  ["activities", "Activities", "gamepad"], ["travel", "Travel", "screen"], ["objects", "Objects", "bolt"], ["symbols", "Symbols", "diamond"]];
const ALL = Object.entries(DATA).flatMap(([cat, list]) => list.map(x => { const i = x.indexOf(" "); return { e: x.slice(0, i), n: x.slice(i + 1), cat }; }));
export const EMOJI_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"];

const recent = () => (Array.isArray(S.settings.recentEmoji) ? S.settings.recentEmoji : []).filter(e => typeof e === "string").slice(0, 24);
export function useEmoji(e, save) {
  S.settings.recentEmoji = [e, ...recent().filter(x => x !== e)].slice(0, 24);
  if (save) save();
}

// open the picker next to `anchor`; onPick(emoji) — resolves when closed
let open = null;
export function pickEmoji(anchor, onPick, { save, keepOpen = false } = {}) {
  closeEmoji();
  const el = document.createElement("div"); el.className = "sx-emoji"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Emoji");
  let cat = recent().length ? "recent" : "smileys", q = "";
  el.innerHTML = `<div class="sx-emoji-top"><label class="sx-search sm">${icon("search")}<input placeholder="Search emoji" spellcheck="false" aria-label="Search emoji"></label></div>
    <div class="sx-emoji-cats">${CATS.map(([k, l, ic]) => `<button data-cat="${k}" title="${l}" aria-label="${l}">${icon(ic)}</button>`).join("")}</div>
    <div class="sx-emoji-grid" tabindex="-1"></div><div class="sx-emoji-foot"><span class="sx-emoji-big"></span><span class="sx-emoji-name"></span></div>`;
  document.body.appendChild(el);
  const grid = el.querySelector(".sx-emoji-grid"), input = el.querySelector("input");
  const draw = () => {
    let list;
    if (q) { const t = q.toLowerCase(); list = ALL.filter(x => x.n.includes(t) || x.e === q).slice(0, 120); }
    else if (cat === "recent") list = recent().map(e => ALL.find(x => x.e === e) || { e, n: "" });
    else list = ALL.filter(x => x.cat === cat);
    grid.innerHTML = list.length ? list.map(x => `<button data-e="${esc(x.e)}" title="${esc(x.n.split(" ")[0] || "")}" aria-label="${esc(x.n.split(" ")[0] || x.e)}">${x.e}</button>`).join("")
      : `<p class="sx-none">${q ? "No emoji found." : "Emoji you use show up here."}</p>`;
    el.querySelectorAll("[data-cat]").forEach(b => b.classList.toggle("on", !q && b.dataset.cat === cat));
  };
  draw();
  el.addEventListener("mouseover", e => { const b = e.target.closest("[data-e]"); if (!b) return; el.querySelector(".sx-emoji-big").textContent = b.dataset.e; el.querySelector(".sx-emoji-name").textContent = (ALL.find(x => x.e === b.dataset.e) || { n: "" }).n.split(" ")[0] || ""; });
  el.addEventListener("click", e => {
    e.stopPropagation();
    const c = e.target.closest("[data-cat]"); if (c) { cat = c.dataset.cat; q = ""; input.value = ""; draw(); return; }
    const b = e.target.closest("[data-e]"); if (!b) return;
    useEmoji(b.dataset.e, save); onPick(b.dataset.e);
    if (!keepOpen) closeEmoji();
  });
  input.oninput = () => { q = input.value.trim(); draw(); };
  input.onkeydown = e => { if (e.key === "Enter") { const b = grid.querySelector("[data-e]"); if (b) b.click(); } if (e.key === "Escape") { e.stopPropagation(); closeEmoji(); } };
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  let x = r.right - w, y = r.top - h - 8; if (y < 8) y = r.bottom + 8; if (x < 8) x = 8;
  el.style.left = Math.min(x, innerWidth - w - 8) + "px"; el.style.top = Math.min(y, innerHeight - h - 8) + "px";
  setTimeout(() => input.focus(), 10);
  const away = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeEmoji(); };
  const key = e => { if (e.key === "Escape") { e.stopPropagation(); closeEmoji(); } };
  document.addEventListener("mousedown", away, true); document.addEventListener("keydown", key, true);
  open = { el, off: () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", key, true); } };
}
export function closeEmoji() { if (open) { open.off(); open.el.remove(); open = null; } }
