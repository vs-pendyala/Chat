// ─────────────────────────────────────────────────────────
//  CONFIGURATION — fill these in after Firebase setup
//  See SETUP.md for step-by-step instructions
// ─────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  databaseURL:       "REPLACE_WITH_YOUR_DATABASE_URL",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID"
};

// The secret key — anyone who knows this can read messages.
// Share it with your friend over a private channel (text, signal, etc.)
const SECRET_KEY = "w9Xk2mP7qLrN4sT8vYdH1jFbCeGaUoZ5nQiWxRtBhMlVpKcDyEgOuAsSfJzI3w6";

// ─────────────────────────────────────────────────────────
//  FIREBASE IMPORTS
// ─────────────────────────────────────────────────────────
import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push, onChildAdded,
         serverTimestamp, onValue, set, remove }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// ─────────────────────────────────────────────────────────
//  CRYPTO HELPERS  (AES-256-GCM via WebCrypto)
// ─────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(rawKey) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(rawKey.substring(0, 32).padEnd(32, "0")),
    "AES-GCM", false, ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

async function encrypt(text, rawKey) {
  const key = await deriveKey(rawKey);
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const ct  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text));
  const buf = new Uint8Array(iv.byteLength + ct.byteLength);
  buf.set(iv, 0);
  buf.set(new Uint8Array(ct), iv.byteLength);
  return btoa(String.fromCharCode(...buf));
}

async function decrypt(b64, rawKey) {
  const key = await deriveKey(rawKey);
  const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv  = buf.slice(0, 12);
  const ct  = buf.slice(12);
  const pt  = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return dec.decode(pt);
}

// ─────────────────────────────────────────────────────────
//  SNOWFALL
// ─────────────────────────────────────────────────────────
(function initSnow() {
  const canvas = document.getElementById("snow-canvas");
  const ctx    = canvas.getContext("2d");
  const CHARS  = ["❄", "✦", "❅", "·", "•"];
  let flakes   = [];

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener("resize", resize);

  for (let i = 0; i < 85; i++) {
    flakes.push({
      x:     Math.random() * window.innerWidth,
      y:     Math.random() * window.innerHeight,
      size:  0.4 + Math.random() * 1.1,
      speed: 0.22 + Math.random() * 0.45,
      drift: (Math.random() - 0.5) * 0.25,
      ch:    CHARS[Math.floor(Math.random() * CHARS.length)],
      alpha: 0.12 + Math.random() * 0.38,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    flakes.forEach(f => {
      ctx.save();
      ctx.globalAlpha = f.alpha;
      ctx.fillStyle   = "#eef2f8";
      ctx.font        = `${f.size * 13}px serif`;
      ctx.fillText(f.ch, f.x, f.y);
      ctx.restore();
      f.y += f.speed;
      f.x += f.drift;
      if (f.y > canvas.height + 20) { f.y = -20; f.x = Math.random() * canvas.width; }
      if (f.x > canvas.width  + 20)  f.x = -10;
      if (f.x < -20)                  f.x = canvas.width + 10;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

// ─────────────────────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────────────────────
const gateEl       = document.getElementById("gate");
const chatEl       = document.getElementById("chat");
const nameInput    = document.getElementById("name-input");
const keyInput     = document.getElementById("key-input");
const gateBtn      = document.getElementById("gate-btn");
const gateError    = document.getElementById("gate-error");
const messagesEl   = document.getElementById("messages");
const emptyStateEl = document.getElementById("empty-state");
const msgInput     = document.getElementById("msg-input");
const sendBtn      = document.getElementById("send-btn");
const connStatus   = document.getElementById("conn-status");
const typingEl     = document.getElementById("typing-indicator");
const logoutBtn    = document.getElementById("logout-btn");

// ─────────────────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────────────────
let myName    = "";
let db        = null;
let msgsRef   = null;
let typingRef = null;
let typingTimeout = null;
let lastDateLabel = "";

// ─────────────────────────────────────────────────────────
//  GATE
// ─────────────────────────────────────────────────────────
gateBtn.addEventListener("click", tryEnter);
keyInput.addEventListener("keydown",  e => { if (e.key === "Enter") tryEnter(); });
nameInput.addEventListener("keydown", e => { if (e.key === "Enter") keyInput.focus(); });

function tryEnter() {
  const name = nameInput.value.trim();
  const key  = keyInput.value.trim();
  gateError.textContent = "";

  if (!name) { gateError.textContent = "please enter your name"; return; }
  if (!key)  { gateError.textContent = "please enter the secret key"; return; }
  if (key !== SECRET_KEY) {
    gateError.textContent = "that key doesn't seem right ✦ try again";
    return;
  }

  myName = name;
  gateEl.style.display  = "none";
  chatEl.style.display  = "flex";
  initFirebase();
}

// ─────────────────────────────────────────────────────────
//  FIREBASE
// ─────────────────────────────────────────────────────────
function initFirebase() {
  const app = initializeApp(FIREBASE_CONFIG);
  db = getDatabase(app);

  // Use a channel name derived from the key so it's not guessable
  const channelId = btoa(SECRET_KEY).replace(/[^a-zA-Z0-9]/g, "").substring(0, 28);
  msgsRef   = ref(db, `chats/${channelId}/messages`);
  typingRef = ref(db, `chats/${channelId}/typing/${myName}`);

  // Connection status
  const connRef = ref(db, ".info/connected");
  onValue(connRef, snap => {
    if (snap.val() === true) {
      connStatus.textContent = "connected ✦";
      connStatus.classList.add("online");
    } else {
      connStatus.textContent = "reconnecting…";
      connStatus.classList.remove("online");
    }
  });

  // Listen for new messages
  onChildAdded(msgsRef, async snap => {
    const data = snap.val();
    if (!data?.ct) return;

    try {
      const plain = await decrypt(data.ct, SECRET_KEY);
      const msg   = JSON.parse(plain);
      renderMessage(msg);
    } catch {
      // wrong key or corrupted — ignore silently
    }
  });

  // Typing indicators
  const allTypingRef = ref(db, `chats/${channelId}/typing`);
  onValue(allTypingRef, snap => {
    const typing = snap.val() || {};
    const others = Object.entries(typing)
      .filter(([name, active]) => name !== myName && active)
      .map(([name]) => name);
    typingEl.textContent = others.length ? `${others[0]} is writing…` : "";
  });
}

// ─────────────────────────────────────────────────────────
//  SEND
// ─────────────────────────────────────────────────────────
sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

msgInput.addEventListener("input", () => {
  // auto-resize textarea
  msgInput.style.height = "auto";
  msgInput.style.height = Math.min(msgInput.scrollHeight, 130) + "px";

  // broadcast typing
  if (typingRef) {
    set(typingRef, true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => set(typingRef, false), 2500);
  }
});

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !msgsRef) return;

  msgInput.value = "";
  msgInput.style.height = "auto";

  // clear typing indicator
  if (typingRef) set(typingRef, false);

  const payload = JSON.stringify({ text, sender: myName, ts: Date.now() });
  const ct      = await encrypt(payload, SECRET_KEY);
  await push(msgsRef, { ct, at: serverTimestamp() });
}

// ─────────────────────────────────────────────────────────
//  RENDER MESSAGE
// ─────────────────────────────────────────────────────────
function renderMessage(msg) {
  if (emptyStateEl) emptyStateEl.remove();

  const date      = new Date(msg.ts);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric"
  });

  if (dateLabel !== lastDateLabel) {
    lastDateLabel = dateLabel;
    const chip = document.createElement("div");
    chip.className   = "date-chip";
    chip.textContent = dateLabel;
    messagesEl.appendChild(chip);
  }

  const isMine = msg.sender === myName;
  const wrap   = document.createElement("div");
  wrap.className = "msg " + (isMine ? "mine" : "theirs");

  const bubble        = document.createElement("div");
  bubble.className    = "bubble";
  bubble.textContent  = msg.text;

  const meta      = document.createElement("div");
  meta.className  = "msg-meta";
  const timeStr   = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (!isMine) {
    const nameSpan       = document.createElement("span");
    nameSpan.className   = "sender-name";
    nameSpan.textContent = msg.sender;
    meta.appendChild(nameSpan);
    meta.appendChild(document.createTextNode(" · "));
  }
  meta.appendChild(document.createTextNode(timeStr));

  if (isMine) {
    wrap.appendChild(meta);
    wrap.appendChild(bubble);
  } else {
    wrap.appendChild(bubble);
    wrap.appendChild(meta);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ─────────────────────────────────────────────────────────
//  LOGOUT
// ─────────────────────────────────────────────────────────
logoutBtn.addEventListener("click", () => {
  if (typingRef) set(typingRef, false);
  location.reload();
});
