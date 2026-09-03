'use strict';
/*
 * @clarity/core — the genre vocabulary and the classifier that fills it.
 *
 * The library's GENRE column is a free-text string from two scrapers with different
 * vocabularies ("RPG" from Steam, "Role-playing (RPG)" from IGDB) and it is far too
 * coarse to separate an ARPG from a CRPG. This module owns the curated list of genres
 * the UI filters on, plus the map from raw source tags into it.
 *
 * Pure and offline: no network, no DB. Callers fetch the raw tags (see genre-scan.js)
 * and hand them here. Keeping it that way makes the whole vocabulary testable against
 * the real library without touching either.
 *
 * SPECIFICITY is the heart of it. Community tags list the umbrella first — Baldur's
 * Gate 3's top tag is "RPG" and its 7th is "CRPG"; Dead Space 2 leads with "Horror"
 * and follows with "Survival Horror". Raw vote order therefore gives the *least*
 * useful answer. Each genre carries a weight instead, and the score is
 *
 *     (votes / most-voted-tag) × specificity
 *
 * so a precise genre outranks a vague one unless the vague one is overwhelming.
 */

// spec: 1.0 names a genre exactly · 0.55 a broad family · 0.28 an umbrella that
// should only win when nothing sharper was tagged at all.
const SPEC = { exact: 1.0, family: 0.55, umbrella: 0.28 };

// The curated vocabulary. `order` drives menus and chips; keep related genres adjacent.
const GENRES = [
    { slug: 'fps',              label: 'FPS',                 spec: SPEC.exact },
    { slug: 'tps',              label: 'Third-Person Shooter',spec: SPEC.exact },
    { slug: 'topdown-shooter',  label: 'Top-Down Shooter',    spec: SPEC.exact },
    { slug: 'shmup',            label: 'Shmup',               spec: SPEC.exact },
    { slug: 'arena-shooter',    label: 'Arena Shooter',       spec: SPEC.exact },
    { slug: 'shooter',          label: 'Shooter',             spec: SPEC.umbrella },

    { slug: 'arpg',             label: 'Action RPG',          spec: SPEC.exact },
    { slug: 'crpg',             label: 'CRPG',                spec: SPEC.exact },
    { slug: 'jrpg',             label: 'JRPG',                spec: SPEC.exact },
    { slug: 'tactical-rpg',     label: 'Tactical RPG',        spec: SPEC.exact },
    { slug: 'dungeon-crawler',  label: 'Dungeon Crawler',     spec: SPEC.exact },
    { slug: 'soulslike',        label: 'Soulslike',           spec: SPEC.exact },
    { slug: 'mmo',              label: 'MMO',                 spec: SPEC.exact },
    { slug: 'rpg',              label: 'RPG',                 spec: SPEC.umbrella },

    { slug: 'immersive-sim',    label: 'Immersive Sim',       spec: SPEC.exact },
    { slug: 'stealth',          label: 'Stealth',             spec: SPEC.exact },
    { slug: 'metroidvania',     label: 'Metroidvania',        spec: SPEC.exact },
    { slug: 'platformer',       label: 'Platformer',          spec: SPEC.exact },
    { slug: 'hack-slash',       label: 'Hack & Slash',        spec: SPEC.exact },
    { slug: 'fighting',         label: 'Fighting',            spec: SPEC.exact },
    { slug: 'beat-em-up',       label: "Beat 'em up",         spec: SPEC.exact },
    { slug: 'action-adventure', label: 'Action-Adventure',    spec: SPEC.family },
    { slug: 'action',           label: 'Action',              spec: SPEC.umbrella },

    { slug: 'survival-horror',  label: 'Survival Horror',     spec: SPEC.exact },
    { slug: 'horror',           label: 'Horror',              spec: SPEC.family },
    { slug: 'survival',         label: 'Survival',            spec: SPEC.family },
    { slug: 'roguelike',        label: 'Roguelike',           spec: SPEC.exact },

    { slug: 'point-click',      label: 'Point & Click',       spec: SPEC.exact },
    { slug: 'visual-novel',     label: 'Visual Novel',        spec: SPEC.exact },
    { slug: 'walking-sim',      label: 'Walking Sim',         spec: SPEC.exact },
    { slug: 'adventure',        label: 'Adventure',           spec: SPEC.umbrella },

    { slug: 'rts',              label: 'RTS',                 spec: SPEC.exact },
    { slug: 'turn-based-strategy', label: 'Turn-Based Strategy', spec: SPEC.exact },
    { slug: '4x',               label: '4X / Grand Strategy', spec: SPEC.exact },
    { slug: 'tower-defense',    label: 'Tower Defense',       spec: SPEC.exact },
    { slug: 'strategy',         label: 'Strategy',            spec: SPEC.umbrella },

    { slug: 'city-builder',     label: 'City Builder',        spec: SPEC.exact },
    { slug: 'management',       label: 'Management / Tycoon', spec: SPEC.exact },
    { slug: 'life-sim',         label: 'Life & Farming Sim',  spec: SPEC.exact },
    { slug: 'sandbox',          label: 'Sandbox',             spec: SPEC.family },
    { slug: 'simulation',       label: 'Simulation',          spec: SPEC.umbrella },

    { slug: 'racing',           label: 'Racing',              spec: SPEC.exact },
    { slug: 'sports',           label: 'Sports',              spec: SPEC.exact },
    { slug: 'puzzle',           label: 'Puzzle',              spec: SPEC.exact },
    { slug: 'rhythm',           label: 'Rhythm & Music',      spec: SPEC.exact },
    { slug: 'card-board',       label: 'Card & Board',        spec: SPEC.exact },
    { slug: 'party',            label: 'Party Game',          spec: SPEC.exact },
    { slug: 'arcade',           label: 'Arcade',              spec: SPEC.family },
    { slug: 'pinball',          label: 'Pinball',             spec: SPEC.exact },
];

const BY_SLUG = new Map(GENRES.map(g => [g.slug, g]));

// Raw source tag → slug. Keys are matched case- and punctuation-insensitively (see
// normTag), so one entry covers "Shoot 'Em Up", "Shoot 'em up" and "SHOOT EM UP".
// Sources mixed on purpose: Steam community tags, IGDB genres/themes, and the words
// the existing GENRE column already holds all funnel through this one table.
const TAG_MAP = {
    // ── shooters ────────────────────────────────────────────────────────────
    'fps': 'fps',
    'first person shooter': 'fps',
    'first-person shooter': 'fps',
    'boomer shooter': 'fps',
    'tactical shooter': 'fps',
    'hero shooter': 'fps',
    'looter shooter': 'fps',
    'military shooter': 'fps',
    'arena shooter': 'arena-shooter',
    'third person shooter': 'tps',
    'third-person shooter': 'tps',
    'cover shooter': 'tps',
    'top down shooter': 'topdown-shooter',
    'top-down shooter': 'topdown-shooter',
    'twin stick shooter': 'topdown-shooter',
    'shoot em up': 'shmup',
    "shoot 'em up": 'shmup',
    'shmup': 'shmup',
    'bullet hell': 'shmup',
    'danmaku': 'shmup',
    'scrolling shooter': 'shmup',
    'space sim': 'simulation',
    'shooter': 'shooter',
    'on-rails shooter': 'shooter',
    'light gun': 'shooter',

    // ── role-playing ────────────────────────────────────────────────────────
    'action rpg': 'arpg',
    'arpg': 'arpg',
    'action roguelike': 'roguelike',
    'looter': 'arpg',
    'crpg': 'crpg',
    'party-based rpg': 'crpg',
    'party based rpg': 'crpg',
    'isometric rpg': 'crpg',
    'jrpg': 'jrpg',
    'turn-based rpg': 'jrpg',
    'tactical rpg': 'tactical-rpg',
    'turn-based tactics': 'tactical-rpg',
    'dungeon crawler': 'dungeon-crawler',
    'dungeon crawl': 'dungeon-crawler',
    'blobber': 'dungeon-crawler',
    'souls-like': 'soulslike',
    'soulslike': 'soulslike',
    'souls like': 'soulslike',
    'mmorpg': 'mmo',
    'massively multiplayer': 'mmo',
    'mmo': 'mmo',
    'rpg': 'rpg',
    'role playing': 'rpg',
    'role-playing': 'rpg',
    'role-playing (rpg)': 'rpg',
    'roleplaying': 'rpg',

    // ── action ──────────────────────────────────────────────────────────────
    'immersive sim': 'immersive-sim',
    'stealth': 'stealth',
    'metroidvania': 'metroidvania',
    'platformer': 'platformer',
    '2d platformer': 'platformer',
    '3d platformer': 'platformer',
    'precision platformer': 'platformer',
    'cinematic platformer': 'platformer',
    'puzzle platformer': 'platformer',
    'hack and slash': 'hack-slash',
    'hack & slash': 'hack-slash',
    "hack and slash/beat 'em up": 'hack-slash',
    'character action game': 'hack-slash',
    'fighting': 'fighting',
    '2d fighter': 'fighting',
    '3d fighter': 'fighting',
    'arena fighter': 'fighting',
    "beat 'em up": 'beat-em-up',
    'beat em up': 'beat-em-up',
    'brawler': 'beat-em-up',
    'run and gun': 'beat-em-up',
    "run 'n' gun": 'beat-em-up',
    'action-adventure': 'action-adventure',
    'action adventure': 'action-adventure',
    'action': 'action',

    // ── horror & survival ───────────────────────────────────────────────────
    'survival horror': 'survival-horror',
    'psychological horror': 'horror',
    'horror': 'horror',
    'lovecraftian': 'horror',
    'survival': 'survival',
    'open world survival craft': 'survival',
    'crafting': 'survival',
    'roguelike': 'roguelike',
    'roguelite': 'roguelike',
    'rogue-like': 'roguelike',
    'rogue-lite': 'roguelike',
    'traditional roguelike': 'roguelike',
    'roguelike deckbuilder': 'roguelike',

    // ── adventure & narrative ───────────────────────────────────────────────
    'point & click': 'point-click',
    'point and click': 'point-click',
    'point-and-click': 'point-click',
    'hidden object': 'puzzle',
    'visual novel': 'visual-novel',
    'interactive fiction': 'visual-novel',
    'choose your own adventure': 'visual-novel',
    'kinetic novel': 'visual-novel',
    'dating sim': 'visual-novel',
    'text-based': 'visual-novel',
    'walking simulator': 'walking-sim',
    'adventure': 'adventure',

    // ── strategy ────────────────────────────────────────────────────────────
    'rts': 'rts',
    'real time strategy': 'rts',
    'real-time strategy': 'rts',
    'real time tactics': 'rts',
    'real-time tactics': 'rts',
    'turn-based strategy': 'turn-based-strategy',
    'turn based strategy': 'turn-based-strategy',
    'wargame': 'turn-based-strategy',
    'grand strategy': '4x',
    '4x': '4x',
    'tower defense': 'tower-defense',
    'tower defence': 'tower-defense',
    'auto battler': 'strategy',
    'strategy': 'strategy',
    'tactical': 'strategy',

    // ── building, management, simulation ────────────────────────────────────
    'city builder': 'city-builder',
    'base building': 'city-builder',
    'colony sim': 'city-builder',
    'building': 'city-builder',
    'management': 'management',
    'tycoon': 'management',
    'economy': 'management',
    'business sim': 'management',
    'resource management': 'management',
    'farming sim': 'life-sim',
    'life sim': 'life-sim',
    'agriculture': 'life-sim',
    'sandbox': 'sandbox',
    'simulation': 'simulation',
    'simulator': 'simulation',
    'flight': 'simulation',
    'automobile sim': 'racing',

    // ── everything else ─────────────────────────────────────────────────────
    'racing': 'racing',
    'driving': 'racing',
    'arcade racing': 'racing',
    'motorbike': 'racing',
    'sports': 'sports',
    'football': 'sports',
    'soccer': 'sports',
    'basketball': 'sports',
    'baseball': 'sports',
    'golf': 'sports',
    'skateboarding': 'sports',
    'fishing': 'sports',
    'puzzle': 'puzzle',
    'physics-based puzzle': 'puzzle',
    'match 3': 'puzzle',
    'logic': 'puzzle',
    'word game': 'puzzle',
    'rhythm': 'rhythm',
    'music': 'rhythm',
    'card game': 'card-board',
    'board game': 'card-board',
    'deckbuilding': 'card-board',
    'card battler': 'card-board',
    'tabletop': 'card-board',
    'party game': 'party',
    'arcade': 'arcade',
    'pinball': 'pinball',
    'quiz/trivia': 'party',
    'quiz': 'party',
};

// "Shoot 'Em Up" / "shoot em up" / "SHOOT-EM-UP" all collapse to one key.
function normTag(t) {
    return String(t || '')
        .toLowerCase()
        .replace(/[’`´]/g, "'")
        .replace(/[_/]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// A handful of genres are only ever implied by a *combination* of tags — no source
// ships a "CRPG" tag for every CRPG. Each rule fires when `all` are present, adding a
// synthetic tag scored as a fraction of the strongest tag that triggered it.
const COMBO_RULES = [
    { all: ['rpg', 'turn-based combat'],  add: 'crpg',            share: 0.8 },
    { all: ['rpg', 'isometric'],          add: 'crpg',            share: 0.7 },
    { all: ['rpg', 'dungeons & dragons'], add: 'crpg',            share: 0.9 },
    { all: ['rpg', 'loot'],               add: 'arpg',            share: 0.7 },
    { all: ['rpg', 'hack and slash'],     add: 'arpg',            share: 0.9 },
    { all: ['rpg', 'anime'],              add: 'jrpg',            share: 0.6 },
    { all: ['exploration', 'story rich', 'walking simulator'], add: 'walking-sim', share: 1 },
];
// Deliberately absent: "First-Person" + "Shooter" ⇒ FPS. Perspective is a descriptor,
// not a genre — that rule called Red Dead Redemption 2 an FPS, and across the library
// it caught exactly one game that the explicit "FPS" tag had not already caught.

/*
 * Score a game's raw tags into the vocabulary.
 *
 *   tags  — { 'Action RPG': 35022, … } (SteamSpy) or an array of names (IGDB, GENRE
 *           column); an array is treated as descending-priority with synthetic votes.
 *
 * Returns { primary, genres: [{ slug, label, score }] } sorted best-first, or
 * { primary: null, genres: [] } when nothing in the vocabulary was recognised.
 */
function classify(tags) {
    const votes = new Map();          // normalised tag → votes
    if (Array.isArray(tags)) {
        // No vote data: rank by the order the source listed them, which is already
        // meaningful for IGDB genres and for the old comma-joined GENRE strings.
        tags.forEach((t, i) => { if (t) votes.set(normTag(t), Math.max(1, tags.length - i)); });
    } else if (tags && typeof tags === 'object') {
        for (const [t, v] of Object.entries(tags)) votes.set(normTag(t), Number(v) || 0);
    }
    if (!votes.size) return { primary: null, genres: [] };

    const max = Math.max(...votes.values()) || 1;

    for (const rule of COMBO_RULES) {
        if (!rule.all.every(t => votes.has(normTag(t)))) continue;
        const strongest = Math.max(...rule.all.map(t => votes.get(normTag(t)) || 0));
        const synthetic = strongest * rule.share;
        // Only ever raises a genre's score; a real tag that already scored higher wins.
        const key = `__combo__${rule.add}`;
        votes.set(key, Math.max(votes.get(key) || 0, synthetic));
    }

    const scores = new Map();         // slug → score
    for (const [tag, v] of votes) {
        const slug = tag.startsWith('__combo__') ? tag.slice(9) : TAG_MAP[tag];
        const def = slug && BY_SLUG.get(slug);
        if (!def) continue;
        const score = (v / max) * def.spec;
        if (score > (scores.get(slug) || 0)) scores.set(slug, score);
    }
    if (!scores.size) return { primary: null, genres: [] };

    const genres = [...scores.entries()]
        .map(([slug, score]) => ({ slug, label: BY_SLUG.get(slug).label, score: Math.round(score * 1000) / 1000 }))
        .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

    // Secondary genres are worth keeping — a game really can be an FPS *and* horror —
    // but a tag that barely registered is noise, and noise here is worse than silence:
    // it files a platformer under Racing because eleven people tagged it that way. Both
    // an absolute floor and a share of the primary, measured on the real library at
    // ~2.2 genres per game: a primary plus about one secondary that earns its place.
    const cut = Math.max(0.3, genres[0].score * 0.35);
    const kept = genres.filter(g => g.score >= cut);
    return { primary: genres[0].slug, genres: kept.length ? kept : [genres[0]] };
}

// The comma-joined GENRE column, as a last resort for games no source can identify.
function classifyGenreString(s) {
    const parts = String(s || '').split(',').map(x => x.trim()).filter(Boolean);
    return parts.length ? classify(parts) : { primary: null, genres: [] };
}

function labelOf(slug) { return BY_SLUG.get(slug)?.label || ''; }

module.exports = { GENRES, TAG_MAP, SPEC, classify, classifyGenreString, labelOf, normTag };
