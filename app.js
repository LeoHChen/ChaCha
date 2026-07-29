// ChaCha — minimal charades. Static, no build step, landscape-only.
//
// Flow: category picker -> 5s "get ready" countdown -> timed round
// (swipe up = skip, down = got it) -> results screen. Everything runs
// client-side against pre-generated decks under /decks, so no network is
// needed once a round has started.

const DEFAULT_SECONDS = 120;
const TIME_OPTIONS = [60, 90, 120, 180, 240, 280];
const DIFFICULTY_OPTIONS = ["Easy", "Hard"];
const READY_COUNTDOWN = 5; // seconds of prep time before the first word
const SWIPE_THRESHOLD = 60; // px of vertical travel to count as a swipe
const CATEGORIES_URL = "categories.json";
const TIME_STORAGE_KEY = "chacha.roundSeconds";
const DIFFICULTY_STORAGE_KEY = "chacha.difficulty";

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
  // Only force landscape while a round is on screen (see styles.css).
  document.body.classList.toggle("playing", name === "game");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Settings: round length (persisted) ----
function loadRoundSeconds() {
  const saved = parseInt(localStorage.getItem(TIME_STORAGE_KEY), 10);
  return TIME_OPTIONS.includes(saved) ? saved : DEFAULT_SECONDS;
}

let roundSeconds = loadRoundSeconds();

function renderTimeOptions() {
  const box = el("time-options");
  box.innerHTML = "";
  for (const secs of TIME_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "time-btn" + (secs === roundSeconds ? " selected" : "");
    btn.textContent = `${secs}s`;
    btn.addEventListener("click", () => {
      roundSeconds = secs;
      localStorage.setItem(TIME_STORAGE_KEY, String(secs));
      renderTimeOptions();
    });
    box.appendChild(btn);
  }
}

// ---- Settings: difficulty (persisted) ----
function loadDifficulty() {
  const saved = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
  return DIFFICULTY_OPTIONS.includes(saved) ? saved : "Easy";
}

let difficulty = loadDifficulty();

function renderDifficultyOptions() {
  const box = el("difficulty-options");
  box.innerHTML = "";
  for (const level of DIFFICULTY_OPTIONS) {
    const btn = document.createElement("button");
    btn.className = "time-btn" + (level === difficulty ? " selected" : "");
    btn.textContent = level;
    btn.addEventListener("click", () => {
      difficulty = level;
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, level);
      renderDifficultyOptions();
    });
    box.appendChild(btn);
  }
}

// ---- Round state ----
const state = {
  deck: [],
  index: 0,
  score: 0,
  got: [],
  skipped: [],
  timeLeft: DEFAULT_SECONDS,
  timerId: null,
  countdownId: null,
  counting: false, // true during the pre-round "get ready" countdown
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

// Load a category's words. In Hard mode, try the "-hard" deck first and fall
// back to the normal deck if a hard one hasn't been generated yet.
async function fetchDeckWords(category) {
  const slug = slugify(category);
  const urls =
    difficulty === "Hard"
      ? [`decks/${slug}-hard.json`, `decks/${slug}.json`]
      : [`decks/${slug}.json`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) {
        const words = (await res.json()).words;
        if (Array.isArray(words) && words.length) return words;
      }
    } catch (err) {
      /* try the next url */
    }
  }
  return null;
}

async function startRound(category) {
  const words = await fetchDeckWords(category);
  if (!words) {
    alert(`Could not load "${category}". The deck may not be generated yet.`);
    return;
  }

  clearInterval(state.timerId);
  clearInterval(state.countdownId);

  state.deck = shuffle(words);
  state.index = 0;
  state.score = 0;
  state.got = [];
  state.skipped = [];
  state.timeLeft = roundSeconds;
  state.lastCategory = category;

  updateHud();
  el("timer").textContent = roundSeconds; // show full time while getting ready
  show("game");
  runReadyCountdown(() => {
    showCurrentWord();
    startTimer();
  });
}

// "Get ready" prep countdown before the first word is revealed.
function runReadyCountdown(done) {
  state.counting = true;
  const word = el("word");
  word.classList.add("countdown");
  let n = READY_COUNTDOWN;
  word.textContent = n;
  state.countdownId = setInterval(() => {
    n -= 1;
    if (n > 0) {
      word.textContent = n;
    } else {
      clearInterval(state.countdownId);
      state.countdownId = null;
      word.classList.remove("countdown");
      state.counting = false;
      done();
    }
  }, 1000);
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

// Ignore actions during the prep countdown or after time is up.
function roundActive() {
  return !state.counting && state.timeLeft > 0;
}

function markGotIt() {
  if (!roundActive()) return;
  state.got.push(currentWord());
  state.score += 1;
  updateHud();
  advance();
  showCurrentWord("flash-good");
}

function markSkip() {
  if (!roundActive()) return;
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

// Taps that start on the exit button must never be read as swipes.
function onExitButton(target) {
  return target && target.closest && target.closest("#btn-exit");
}

gameScreen.addEventListener(
  "touchstart",
  (e) => {
    if (onExitButton(e.target)) {
      touchStartY = null;
      return;
    }
    touchStartY = e.changedTouches[0].clientY;
  },
  { passive: true }
);

gameScreen.addEventListener(
  "touchend",
  (e) => {
    if (touchStartY === null || onExitButton(e.target)) return;
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

// Abort an in-progress round and return to the category picker.
function abortGame() {
  clearInterval(state.timerId);
  clearInterval(state.countdownId);
  state.countdownId = null;
  state.counting = false;
  show("menu");
}

// Single tap on the bottom Exit button aborts the round. The swipe handlers
// ignore touches that start on this button (see onExitButton), so a tap here
// never registers as skip/got-it.
el("btn-exit").addEventListener("click", (e) => {
  e.stopPropagation();
  abortGame();
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

renderDifficultyOptions();
renderTimeOptions();
loadCategories();
