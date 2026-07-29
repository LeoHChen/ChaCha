// Deck generator for ChaCha.
//
// Reads categories.json and, for each category that does not yet have a deck
// under decks/<slug>.json, asks Claude for ~40 guessable charades words and
// writes the deck. Run in CI (see .github/workflows/generate-decks.yml) with
// ANTHROPIC_API_KEY set, or locally:
//
//   ANTHROPIC_API_KEY=sk-... node scripts/generate.mjs
//   node scripts/generate.mjs --force   # regenerate every deck
//
// The key is only ever read from the environment — it is never written into
// the static site that gets deployed to GitHub Pages.

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECKS_DIR = join(ROOT, "decks");
const WORDS_PER_DECK = 100;
// Per-category overrides for decks that should be larger than the default.
const DECK_SIZES = {
  "Chinese": 500,
  "Spanish": 300,
  "Colleges": 200,
};
// Per-category guidance so language/format categories generate correctly.
const CATEGORY_HINTS = {
  "Chinese":
    "Write EVERY item in Simplified Chinese characters (never English or pinyin). " +
    "Use everyday vocabulary for the normal deck; for hard mode use more advanced " +
    "words and common four-character idioms (成语).",
  "Spanish": "Write EVERY item in Spanish.",
  "Mix":
    "Use a varied grab-bag of well-known concepts, objects, actions, roles, or " +
    "natural phenomena that can be acted out or drawn in charades — NOT obscure " +
    "vocabulary words.",
};

const MODEL = "claude-haiku-4-5-20251001";

const force = process.argv.includes("--force");

// Turn "Food & Drink" into "food-drink" for a clean, stable filename.
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function generateWords(client, category, hard) {
  const target = DECK_SIZES[category] ?? WORDS_PER_DECK;
  const maxTokens = Math.min(8192, Math.max(2048, target * 14));
  const difficulty = hard
    ? `This is HARD MODE: choose more obscure, lesser-known, and challenging items ` +
      `that are tougher to guess or act out — deep cuts and expert-level picks rather ` +
      `than the obvious favorites. They must still be real, recognizable to fans or ` +
      `enthusiasts of the topic, and family-friendly. For language categories, use more ` +
      `advanced or less common vocabulary (and idioms where natural). `
    : `Each item must be well-known and easy to recognize. `;
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content:
          `Generate exactly ${target} words or short phrases for a game of charades ` +
          `in the category "${category}". ` +
          difficulty +
          (CATEGORY_HINTS[category] ? CATEGORY_HINTS[category] + " " : "") +
          `Each item must be fun to act out or describe and family-friendly. ` +
          `Prefer single words or two-word phrases. ` +
          `Respond with ONLY a JSON array of strings, no commentary, no code fences.`,
      },
    ],
  });

  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Be forgiving: strip any stray code fences and grab the JSON array.
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse a JSON array from model output:\n${text}`);

  const raw = JSON.parse(match[0]);
  const seen = new Set();
  const words = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const word = item.trim();
    const key = word.toLowerCase();
    if (!word || seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= target) break;
  }
  if (words.length === 0) throw new Error(`No usable words returned for "${category}"`);
  return words;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. Cannot generate decks.");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const categories = JSON.parse(await readFile(join(ROOT, "categories.json"), "utf8"));
  await mkdir(DECKS_DIR, { recursive: true });

  // Each category has a normal deck and a "-hard" deck.
  const variants = [
    { suffix: "", hard: false, label: "" },
    { suffix: "-hard", hard: true, label: " (Hard)" },
  ];

  let generated = 0;
  let failed = 0;
  for (const category of categories) {
    const slug = slugify(category);
    for (const v of variants) {
      const deckPath = join(DECKS_DIR, `${slug}${v.suffix}.json`);

      if (!force && (await exists(deckPath))) {
        console.log(`✓ ${category}${v.label} — deck already exists, skipping`);
        continue;
      }

      console.log(`… ${category}${v.label} — generating`);
      try {
        const words = await generateWords(client, category, v.hard);
        await writeFile(
          deckPath,
          JSON.stringify({ name: category + v.label, words }, null, 2) + "\n"
        );
        console.log(`✓ ${category}${v.label} — wrote ${words.length} words to decks/${slug}${v.suffix}.json`);
        generated++;
      } catch (err) {
        // Don't fail the whole run over one deck; the frontend falls back to
        // the normal deck when a hard deck is missing.
        console.error(`✗ ${category}${v.label} — failed: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(
    `\nGenerated ${generated} deck(s)` + (failed ? `, ${failed} failed.` : "." )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
