'use strict';
/*
 * @clarity/core — Home dashboard stats.
 *
 * Pure, dependency-free reductions over the games table. Run in the main process
 * (shared-ipc `get-home-stats` / `get-random-game`) so The Manager and Couch show
 * IDENTICAL numbers — single source of truth, no logic forked across the two faces.
 *
 * Phase 1 is 100% local/instant: no DB writes, no network.
 */

// Parse a leading integer out of values like "88", "12 Hours", "  6h ".
function leadingInt(v) {
    const m = String(v == null ? '' : v).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// ── Category predicates — must mirror the BACKLOG / PLAYED / INSTALLED logic in
//    both renderers so a count here always matches what the library shows. ──
function isPlayed(g)    { return g.kb_played == 1; }
function isFav(g)       { return g.FAV === 'YES'; }
function isWant(g)      { return g.WANT_TO_PLAY === 'YES'; }
function hasLaunched(g) { return !!(g.LastPlayed && g.LastPlayed > 0); }
function isBacklog(g)   { return !isPlayed(g) && !hasLaunched(g) && !isWant(g); }

// Manual stores (Others/Emulation/Physical/Apps not linked to Installer) are
// "installed" once they have a launch command; everything else uses Installed=1.
function isInstalled(g) {
    const s = (g.Store || '').toLowerCase();
    const isManual = !g.InstallerGameId && (s.includes('others') || s.includes('emulation') || s.includes('physical') || s.includes('apps'));
    return isManual ? !!g.LaunchCommand : g.Installed == 1;
}

function isPico(g) { return (g.Store || '').toLowerCase().includes('pico'); }

// Collapse a (possibly comma-joined / merged) Store string into one canonical bucket.
function storeBucket(store) {
    const s = (store || '').toLowerCase();
    if (s.includes('steam'))     return 'Steam';
    if (s.includes('gog'))       return 'GOG';
    if (s.includes('epic'))      return 'Epic';
    if (s.includes('itch'))      return 'itch.io';
    if (s.includes('flatpak'))   return 'Flatpak';
    if (s.includes('pico'))      return 'PICO-8';
    if (s.includes('emulation')) return 'Emulation';
    if (s.includes('physical'))  return 'Physical';
    if (s.includes('apps'))      return 'Apps';
    if (s.includes('others'))    return 'Others';
    return 'Other';
}

// Stable 32-bit FNV-1a hash so the "daily pick" is deterministic per date string.
function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
}

function tally(map, key) { if (!key) return; map.set(key, (map.get(key) || 0) + 1); }
function sortedTally(map) {
    return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

// Tidy projection for tile widgets — keep the payload small (drop description blobs).
function tile(g) {
    if (!g) return null;
    return {
        id: g.id, Game: g.Game, Store: g.Store,
        CoverArt: g.CoverArt, HeroArt: g.HeroArt, Logo: g.Logo, Icon: g.Icon, Screenshot: g.Screenshot,
        GENRE: g.GENRE, RELEASED: g.RELEASED, METACRITIC: g.METACRITIC, HLTB_Main: g.HLTB_Main,
        ProtonTier: g.ProtonTier, DEV: g.DEV, Installed: g.Installed, LaunchCommand: g.LaunchCommand,
        InstallerGameId: g.InstallerGameId, FAV: g.FAV, WANT_TO_PLAY: g.WANT_TO_PLAY, kb_played: g.kb_played,
        LastPlayed: g.LastPlayed, date_added: g.date_added, SteamAppID: g.SteamAppID,
        Playtime: g.Playtime, Playtime2wk: g.Playtime2wk,
    };
}

/**
 * Build the full Home snapshot. `games` is the raw rows from `SELECT * FROM games`.
 * Returns aggregate numbers + a handful of ready-to-render game tiles.
 */
function computeHomeSnapshot(games, opts = {}) {
    games = Array.isArray(games) ? games : [];
    // Honor each face's "hide PICO-8" toggle so Home matches the library.
    if (opts.hidePico8) games = games.filter(g => !isPico(g));
    const recentImportedCount = opts.recentImportedCount || 12;
    const recentPlayedCount   = opts.recentPlayedCount   || 12;
    const hiddenGemCount      = opts.hiddenGemCount      || 12;
    const dailySeed           = opts.dailySeed || new Date().toISOString().slice(0, 10);

    const total = games.length;
    let installed = 0, played = 0, favs = 0, want = 0, backlog = 0, backlogHours = 0;
    let mcSum = 0, mcN = 0;
    const stores = new Map(), genres = new Map(), proton = new Map(), decades = new Map();

    for (const g of games) {
        if (isInstalled(g)) installed++;
        if (isPlayed(g))    played++;
        if (isFav(g))       favs++;
        if (isWant(g))      want++;
        if (isBacklog(g)) { backlog++; const h = leadingInt(g.HLTB_Main); if (h) backlogHours += h; }

        tally(stores, storeBucket(g.Store));
        (g.GENRE ? String(g.GENRE).split(',') : []).forEach(x => tally(genres, x.trim()));
        const pt = (g.ProtonTier || '').trim(); if (pt) tally(proton, pt.toUpperCase());
        const yr = leadingInt(String(g.RELEASED || '').slice(-4)); // RELEASED is a 4-digit year string
        if (yr && yr > 1950 && yr < 2100) tally(decades, `${Math.floor(yr / 10) * 10}s`);

        const mc = leadingInt(g.METACRITIC); if (mc != null && mc > 0) { mcSum += mc; mcN++; }
    }

    const recentlyImported = games.filter(g => g.date_added > 0)
        .sort((a, b) => b.date_added - a.date_added).slice(0, recentImportedCount).map(tile);

    const playedSorted = games.filter(hasLaunched).sort((a, b) => b.LastPlayed - a.LastPlayed);
    const recentlyPlayed = playedSorted.slice(0, recentPlayedCount).map(tile);
    const continuePlaying = playedSorted.length ? tile(playedSorted[0]) : null;

    // Hidden gems: installed, never launched, never marked played, Metacritic ≥ 80.
    const hiddenGems = games
        .filter(g => isInstalled(g) && !hasLaunched(g) && !isPlayed(g) && (leadingInt(g.METACRITIC) || 0) >= 80)
        .sort((a, b) => (leadingInt(b.METACRITIC) || 0) - (leadingInt(a.METACRITIC) || 0))
        .slice(0, hiddenGemCount).map(tile);

    // Daily pick: deterministic by date. Prefer the installed backlog; fall back to any game.
    // Rotate the STORE bucket round-robin per day first, then pick a game inside it — otherwise
    // whichever store dominates the backlog (Flatpak/PICO-8/Steam) would monopolise the slot.
    let dailyPick = null;
    const named = games.filter(g => g.Game && String(g.Game).trim()); // never feature a blank/placeholder row
    // Today's Pick only features the "big" store buckets (Jose's call: they're far more
    // relevant than Flatpak/PICO-8/itch/apps as a daily highlight).
    const DAILY_BUCKETS = new Set(['Steam', 'GOG', 'Epic', 'Others', 'Emulation']);
    // …and only scraped games (must have hero-worthy art — the pick is a full-bleed banner).
    const hasArt = g => !!(g.HeroArt || g.Screenshot || g.CoverArt);
    const featured = named.filter(g => DAILY_BUCKETS.has(storeBucket(g.Store)) && hasArt(g));
    const pool = featured.filter(g => isInstalled(g) && isBacklog(g));
    const finalPool = pool.length ? pool : (featured.length ? featured : named);
    if (finalPool.length) {
        const byBucket = new Map();
        for (const g of finalPool) {
            const b = storeBucket(g.Store);
            if (!byBucket.has(b)) byBucket.set(b, []);
            byBucket.get(b).push(g);
        }
        const buckets = [...byBucket.keys()].sort();
        const dayIdx = Math.floor((Date.parse(dailySeed) || 0) / 86400000); // days since epoch → cycles buckets daily
        const bucketGames = byBucket.get(buckets[((dayIdx % buckets.length) + buckets.length) % buckets.length]);
        dailyPick = tile(bucketGames[hashStr(dailySeed) % bucketGames.length]);
    }

    // Playtime (Steam-sourced; GOG/Epic/others can't be auto-timed → 0).
    const playtimeCount = opts.playtimeCount || 12;
    let totalPlaytimeMin = 0;
    for (const g of games) totalPlaytimeMin += leadingInt(g.Playtime) || 0;
    const mostPlayed = games.filter(g => (leadingInt(g.Playtime) || 0) > 0)
        .sort((a, b) => (leadingInt(b.Playtime) || 0) - (leadingInt(a.Playtime) || 0))
        .slice(0, playtimeCount).map(tile);
    const recentlyActive = games.filter(g => (leadingInt(g.Playtime2wk) || 0) > 0)
        .sort((a, b) => (leadingInt(b.Playtime2wk) || 0) - (leadingInt(a.Playtime2wk) || 0))
        .slice(0, playtimeCount).map(tile);

    // Couch Night — local/online co-op games (installed first).
    const couchNight = games.filter(g => { const c = (g.Coop || '').toLowerCase(); return c && c !== 'none'; })
        .sort((a, b) => (isInstalled(b) ? 1 : 0) - (isInstalled(a) ? 1 : 0)).slice(0, 12).map(tile);

    // Franchise Spotlight — the series you own the most of (>= 2).
    const franchiseMap = new Map();
    for (const g of games) { const f = (g.Franchise || '').trim(); if (f) { if (!franchiseMap.has(f)) franchiseMap.set(f, []); franchiseMap.get(f).push(g); } }
    let franchise = null, fBest = null;
    for (const [name, list] of franchiseMap) { if (list.length >= 2 && (!fBest || list.length > fBest.list.length)) fBest = { name, list }; }
    if (fBest) franchise = { name: fBest.name, count: fBest.list.length, games: fBest.list.slice(0, 12).map(tile) };

    // Beaten ring — share of the library marked played.
    const beatenPct = total ? Math.round(played / total * 100) : 0;

    // Throwback — deterministic daily retro pick (released before 2010, else oldest available).
    const retroPool = games.filter(g => { const y = leadingInt(String(g.RELEASED || '').slice(-4)); return y && y < 2010; });
    const tbPool = retroPool.length ? retroPool : games.filter(g => leadingInt(String(g.RELEASED || '').slice(-4)));
    const throwback = tbPool.length ? tile(tbPool[hashStr('tb' + dailySeed) % tbPool.length]) : null;

    // Wrapped / "library rewind" summary.
    const yearStartSec = Math.floor(new Date(new Date().getFullYear(), 0, 1).getTime() / 1000);
    let addedThisYear = 0;
    for (const g of games) { const da = leadingInt(g.date_added); if (da && da >= yearStartSec) addedThisYear++; }
    const genreTally = sortedTally(genres), decadeTally = sortedTally(decades);
    let protonRated = 0, protonReadyN = 0;
    for (const { label, count } of sortedTally(proton)) { protonRated += count; if (label === 'GOLD' || label === 'PLATINUM' || label === 'NATIVE') protonReadyN += count; }
    const wrapped = {
        year: new Date().getFullYear(),
        totalHours: Math.round(totalPlaytimeMin / 60),
        topPlayed: mostPlayed[0] ? { ...mostPlayed[0], hours: Math.round((leadingInt(mostPlayed[0].Playtime) || 0) / 60) } : null,
        addedThisYear, beaten: played, totalGames: total,
        topGenre: genreTally.length ? genreTally[0].label : null,
        topDecade: decadeTally.length ? decadeTally[0].label : null,
        protonReadyPct: protonRated ? Math.round(protonReadyN / protonRated * 100) : null,
    };

    return {
        counts: { total, installed, backlog, played, favs, want },
        stores: sortedTally(stores),
        genres: sortedTally(genres).slice(0, 8),
        proton: sortedTally(proton),
        decades: sortedTally(decades).sort((a, b) => a.label.localeCompare(b.label)),
        metacriticAvg: mcN ? Math.round(mcSum / mcN) : null,
        backlog: { count: backlog, hours: backlogHours },
        playtime: { totalHours: Math.round(totalPlaytimeMin / 60), totalMin: totalPlaytimeMin },
        dailyPick, continuePlaying, recentlyImported, recentlyPlayed, hiddenGems, mostPlayed, recentlyActive, wrapped,
        couchNight, franchise, beatenPct, throwback,
    };
}

/** Random pick honoring simple constraints — powers the Roulette widget. */
function pickRandom(games, c = {}) {
    let pool = Array.isArray(games) ? games.slice() : [];
    if (c.hidePico8)     pool = pool.filter(g => !isPico(g));
    if (c.installedOnly) pool = pool.filter(isInstalled);
    if (c.backlogOnly)   pool = pool.filter(isBacklog);
    if (c.favsOnly)      pool = pool.filter(isFav);
    if (c.wantOnly)      pool = pool.filter(isWant);
    if (c.store)         pool = pool.filter(g => storeBucket(g.Store) === c.store);
    if (c.genre)         pool = pool.filter(g => (g.GENRE || '').toLowerCase().includes(String(c.genre).toLowerCase()));
    if (c.maxHours)      pool = pool.filter(g => { const h = leadingInt(g.HLTB_Main); return h != null && h <= c.maxHours; });
    if (!pool.length) return null;
    return tile(pool[Math.floor(Math.random() * pool.length)]);
}

module.exports = { computeHomeSnapshot, pickRandom, isBacklog, isInstalled, isPlayed, storeBucket };
