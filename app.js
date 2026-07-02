// ChaCha — minimal charades. Static, no build step, landscape-only.
//
// Flow: category picker -> 60s timed round (swipe up = skip, down = got it)
// -> results screen. Everything runs client-side against pre-generated decks
// under /decks, so no network is needed once a round has started.

const ROUND_SECONDS = 60;
const SWIPE_THRESHOLD = 60; // px of vertical travel to count as a swipe
const CATEGORIES_URL = "categories.json";

const el = (id) => document.getElementById(id);

const screens = {
  menu: el("screen-menu"),
  game: el("screen-game"),
  end: el("screen-end"),
};

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function show(name) {
  for (const [key, node] of Object.entries(screens)) {
    node.classList.toggle("hidden", key !== name);
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Round state ----
const state = {
  deck: [],
  index: 0,
  score: 0,
  got: [],
  skipped: [],
  timeLeft: ROUND_SECONDS,
  timerId: null,
  lastCategory: null,
};

async function loadCategories() {
  const res = await fetch(CATEGORIES_URL, { cache: "no-cache" });
  const categories = await res.json();
  const list = el("category-list");
  list.innerHTML = "";
  for (const category of categories) {
    const btn = document.createElement("button");
    btn.className = "category-btn";
    btn.textContent = category;
    btn.addEventListener("click", () => startRound(category));
    list.appendChild(btn);
  }
}

async function startRound(category) {
  let words;
  try {
    const res = await fetch(`decks/${slugify(category)}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`deck missing (${res.status})`);
    words = (await res.json()).words;
  } catch (err) {
    alert(`Could not load "${category}". The deck may not be generated yet.`);
    return;
  }

  state.deck = shuffle(words);
  state.index = 0;
  state.score = 0;
  state.got = [];
  state.skipped = [];
  state.timeLeft = ROUND_SECONDS;
  state.lastCategory = category;

  updateHud();
  showCurrentWord();
  show("game");
  startTimer();
}

function startTimer() {
  clearInterval(state.timerId);
  el("timer").textContent = state.timeLeft;
  state.timerId = setInterval(() => {
    state.timeLeft -= 1;
    el("timer").textContent = Math.max(0, state.timeLeft);
    if (state.timeLeft <= 0) endRound();
  }, 1000);
}

function updateHud() {
  el("score").textContent = `✅ ${state.score}`;
  el("skipped").textContent = `⏭️ ${state.skipped.length}`;
}

function currentWord() {
  return state.deck[state.index % state.deck.length];
}

function showCurrentWord(flashClass) {
  const word = el("word");
  word.textContent = currentWord();
  if (flashClass) {
    word.classList.add(flashClass);
    setTimeout(() => word.classList.remove(flashClass), 150);
  }
}

function advance() {
  state.index += 1;
  // Reshuffle and keep going if the deck runs dry before the timer ends.
  if (state.index >= state.deck.length) {
    state.deck = shuffle(state.deck);
    state.index = 0;
  }
}

function markGotIt() {
  if (state.timeLeft <= 0) return;
  state.got.push(currentWord());
  state.score += 1;
  updateHud();
  advance();
  showCurrentWord("flash-good");
}

function markSkip() {
  if (state.timeLeft <= 0) return;
  state.skipped.push(currentWord());
  updateHud();
  advance();
  showCurrentWord("flash-skip");
}

function endRound() {
  clearInterval(state.timerId);
  el("final-score").textContent = state.score;
  fillList("got-list", state.got);
  fillList("skipped-list", state.skipped);
  show("end");
}

function fillList(id, items) {
  const ul = el(id);
  ul.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "—";
    ul.appendChild(li);
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
}

// ---- Input: swipe + keyboard fallback ----
let touchStartY = null;

const gameScreen = screens.game;

gameScreen.addEventListener(
  "touchstart",
  (e) => {
    touchStartY = e.changedTouches[0].clientY;
  },
  { passive: true }
);

gameScreen.addEventListener(
  "touchend",
  (e) => {
    if (touchStartY === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartY = null;
    if (Math.abs(dy) < SWIPE_THRESHOLD) return;
    if (dy < 0) markSkip(); // swipe up
    else markGotIt(); // swipe down
  },
  { passive: true }
);

// Desktop testing: arrow keys mirror the swipes.
document.addEventListener("keydown", (e) => {
  if (screens.game.classList.contains("hidden")) return;
  if (e.key === "ArrowUp") markSkip();
  else if (e.key === "ArrowDown") markGotIt();
});

el("btn-again").addEventListener("click", () => startRound(state.lastCategory));
el("btn-menu").addEventListener("click", () => show("menu"));

// Best-effort orientation lock (only works in fullscreen on supported browsers).
function tryLockLandscape() {
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock("landscape").catch(() => {});
  }
}
document.addEventListener("click", tryLockLandscape, { once: true });

loadCategories();
