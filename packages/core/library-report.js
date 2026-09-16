'use strict';
/*
 * @clarity/core, the library report.
 *
 * Pure reductions over the games table, like home-stats.js, and built ON home-stats.js: the
 * installed / backlog / store rules are imported from there, never restated, so a number in
 * the report is always the number the Home dashboard shows for the same library.
 *
 * The report is a catalogue of SECTIONS. Each one says whether it has anything to show
 * (`available`), and the UI lets the user pick any subset. A section with no data is
 * offered greyed out rather than hidden, so a light player can see what a report grows into.
 *
 * Written for a heavy player first. Playtime, recent play and achievements are the headline
 * sections; the library-shape sections (stores, decades, studios) are there for everyone.
 *
 * ⚠️ Hours come from Steam. Clarity does not time GOG, Epic, itch or emulator sessions, so
 * every playtime figure here is Steam playtime, and the section data says so (`source`) so
 * the template can label it instead of implying it covers the whole library.
 */

const hs = require('./home-stats.js');
const genres = require('./genres.js');

const DAY = 86400000;
const num = v => hs.leadingInt(v) || 0;
const clean = s => String(s == null ? '' : s).trim();

// Screenshot holds several paths joined by "|"; the first is the one worth showing.
const firstShot = v => clean(v).split('|').map(clean).find(Boolean) || '';

// ScreenScraper-style trademark glyphs read as noise at poster size.
const titleOf = g => clean(g.Game).replace(/[™®©]/g, '').trim();

function yearOf(g) {
    const y = hs.leadingInt(String(g.RELEASED || '').slice(-4));
    return y && y > 1950 && y < 2100 ? y : null;
}

function tile(g, extra = {}) {
    return {
        id: g.id,
        title: titleOf(g),
        store: hs.storeBucket(g.Store),
        cover: clean(g.CoverArt),
        hero: clean(g.HeroArt),
        logo: clean(g.Logo),
        shot: firstShot(g.Screenshot),
        year: yearOf(g),
        genre: genres.labelOf(clean(g.PrimaryGenre)) || '',
        ...extra,
    };
}

function tallyList(map, limit) {
    const list = [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
    return limit ? list.slice(0, limit) : list;
}
const bump = (map, key, by = 1) => { if (key) map.set(key, (map.get(key) || 0) + by); };

// The order sections appear in, in the picker and in a document export.
const SECTION_ORDER = [
    'overview', 'mostPlayed', 'recent', 'genres', 'achievements', 'stores', 'backlog',
    'ratings', 'decades', 'studios', 'franchises', 'linux', 'favourites', 'growth', 'storage', 'emulatte',
];

/**
 * @param {object[]} rows          SELECT * FROM games
 * @param {object}   opts
 * @param {object[]} [opts.achievements]  SELECT app_id, name, date_unlocked, image_unlocked FROM achievements
 * @param {object}   [opts.emulatte]      { games: [{system_id,last_played,fav}], systems: [{id,name,short_name}] } or null
 * @param {boolean}  [opts.hidePico8]
 * @param {number}   [opts.recentDays=30]
 * @param {number}   [opts.now=Date.now()]
 */
function buildReport(rows, opts = {}) {
    const now = opts.now || Date.now();
    const recentDays = opts.recentDays || 30;
    // The same rows the library view shows: named, not the literal "null", not user-hidden.
    let games = (Array.isArray(rows) ? rows : []).filter(g => clean(g.Game) && g.Game !== 'null' && num(g.Hidden) !== 1);
    if (opts.hidePico8) games = games.filter(g => !hs.isPico(g));

    const sections = {};

    // ── Overview ────────────────────────────────────────────────────────────
    const storeMap = new Map();
    let installed = 0, playtimeMin = 0, played = 0, favs = 0, want = 0, multiStore = 0;
    let achUnlocked = 0, achTotal = 0, diskBytes = 0, mcSum = 0, mcN = 0;
    for (const g of games) {
        bump(storeMap, hs.storeBucket(g.Store));
        if (clean(g.Store).includes(',')) multiStore++;
        if (hs.isInstalled(g)) installed++;
        const pt = num(g.Playtime); playtimeMin += pt;
        if (pt > 0 || hs.hasLaunched(g) || hs.isPlayed(g)) played++;
        if (hs.isFav(g)) favs++;
        if (hs.isWant(g)) want++;
        achUnlocked += num(g.AchUnlocked); achTotal += num(g.AchTotal);
        if (hs.isInstalled(g)) diskBytes += num(g.DiskSize);
        const mc = hs.leadingInt(g.METACRITIC); if (mc) { mcSum += mc; mcN++; }
    }
    sections.overview = {
        available: games.length > 0,
        games: games.length, installed, played, favourites: favs, wantToPlay: want,
        stores: storeMap.size, hours: Math.round(playtimeMin / 60),
        achievements: achUnlocked, metacriticAvg: mcN ? Math.round(mcSum / mcN) : null,
        diskBytes, source: 'steam',
    };

    // ── Most played (all time) ──────────────────────────────────────────────
    const byPlaytime = games.filter(g => num(g.Playtime) > 0).sort((a, b) => num(b.Playtime) - num(a.Playtime));
    sections.mostPlayed = {
        available: byPlaytime.length > 0,
        totalHours: Math.round(playtimeMin / 60),
        gamesWithHours: byPlaytime.length,
        topShare: playtimeMin ? Math.round(num(byPlaytime[0]?.Playtime) / playtimeMin * 100) : 0,
        games: byPlaytime.slice(0, 10).map(g => tile(g, { hours: Math.round(num(g.Playtime) / 60), minutes: num(g.Playtime) })),
        source: 'steam',
    };

    // ── Recently played ─────────────────────────────────────────────────────
    const byLast = games.filter(hs.hasLaunched).sort((a, b) => b.LastPlayed - a.LastPlayed);
    const windowStart = now - recentDays * DAY;
    const inWindow = byLast.filter(g => g.LastPlayed >= windowStart);
    const twoWeeks = games.filter(g => num(g.Playtime2wk) > 0).sort((a, b) => num(b.Playtime2wk) - num(a.Playtime2wk));
    const twoWeekMin = twoWeeks.reduce((s, g) => s + num(g.Playtime2wk), 0);
    sections.recent = {
        available: byLast.length > 0 || twoWeeks.length > 0,
        days: recentDays,
        playedInWindow: inWindow.length,
        twoWeekHours: Math.round(twoWeekMin / 60 * 10) / 10,
        // Steam's two-week figure is the best "most played lately" signal there is; when a
        // library has none, recency alone orders the list.
        games: (twoWeeks.length ? twoWeeks : byLast).slice(0, 8).map(g => tile(g, {
            lastPlayed: hs.hasLaunched(g) ? g.LastPlayed : null,
            daysAgo: hs.hasLaunched(g) ? Math.max(0, Math.floor((now - g.LastPlayed) / DAY)) : null,
            recentHours: Math.round(num(g.Playtime2wk) / 60 * 10) / 10,
        })),
        orderedBy: twoWeeks.length ? 'twoWeekHours' : 'lastPlayed',
    };

    // ── Genres ──────────────────────────────────────────────────────────────
    const gCount = new Map(), gHours = new Map();
    for (const g of games) {
        const label = genres.labelOf(clean(g.PrimaryGenre));
        if (!label) continue;
        bump(gCount, label);
        bump(gHours, label, num(g.Playtime));
    }
    const hoursList = tallyList(gHours).filter(x => x.value > 0).slice(0, 8).map(x => ({ label: x.label, value: Math.round(x.value / 60) }));
    const lead = (hoursList[0] || tallyList(gCount, 1)[0] || {}).label;
    const leadArt = lead ? games.filter(g => genres.labelOf(clean(g.PrimaryGenre)) === lead && (g.CoverArt || g.HeroArt))
        .sort((a, b) => num(b.Playtime) - num(a.Playtime) || (hs.leadingInt(b.METACRITIC) || 0) - (hs.leadingInt(a.METACRITIC) || 0))
        .slice(0, 9).map(g => tile(g)) : [];
    sections.genres = {
        lead: lead || null,
        leadArt,
        available: gCount.size > 0,
        classified: [...gCount.values()].reduce((a, b) => a + b, 0),
        byCount: tallyList(gCount, 8),
        byHours: hoursList,
        topByHours: hoursList[0] || null,
        distinct: gCount.size,
    };

    // ── Achievements ────────────────────────────────────────────────────────
    const withAch = games.filter(g => num(g.AchTotal) > 0);
    const started = withAch.filter(g => num(g.AchUnlocked) > 0);
    const startedUnlocked = started.reduce((s, g) => s + num(g.AchUnlocked), 0);
    const startedTotal = started.reduce((s, g) => s + num(g.AchTotal), 0);
    const perfect = withAch.filter(g => num(g.AchUnlocked) >= num(g.AchTotal)).sort((a, b) => num(b.AchTotal) - num(a.AchTotal));
    const progress = withAch.filter(g => num(g.AchUnlocked) > 0)
        .map(g => ({ g, pct: Math.round(num(g.AchUnlocked) / num(g.AchTotal) * 100) }))
        .sort((a, b) => b.pct - a.pct || num(b.g.AchUnlocked) - num(a.g.AchUnlocked));
    // Unlock rows are keyed "steam_<appid>" or by the installer id ("gog_<id>"); map both.
    const byKey = new Map();
    for (const g of games) {
        if (clean(g.SteamAppID)) byKey.set('steam_' + clean(g.SteamAppID).replace(/\.0+$/, ''), g);
        if (clean(g.InstallerGameId)) byKey.set(clean(g.InstallerGameId), g);
    }
    const unlocks = (opts.achievements || [])
        .filter(a => clean(a.date_unlocked) && clean(a.date_unlocked) !== '0' && byKey.has(clean(a.app_id)))
        .map(a => ({ a, t: Date.parse(a.date_unlocked) }))
        .filter(x => Number.isFinite(x.t))
        .sort((x, y) => y.t - x.t);
    const yearStart = new Date(new Date(now).getFullYear(), 0, 1).getTime();
    sections.achievements = {
        available: achUnlocked > 0 || unlocks.length > 0,
        unlocked: achUnlocked, total: achTotal,
        // Across games actually started. Dividing by every achievement in every owned game makes
        // a normal library read as 2% complete, which says nothing about how anyone plays.
        completion: startedTotal ? Math.round(startedUnlocked / startedTotal * 100) : 0,
        gamesStarted: started.length,
        gamesTracked: withAch.length,
        perfectCount: perfect.length,
        perfect: perfect.slice(0, 6).map(g => tile(g, { unlocked: num(g.AchUnlocked), total: num(g.AchTotal) })),
        closest: progress.filter(x => x.pct < 100).slice(0, 5).map(x => tile(x.g, { pct: x.pct, unlocked: num(x.g.AchUnlocked), total: num(x.g.AchTotal) })),
        thisYear: unlocks.filter(x => x.t >= yearStart).length,
        latest: unlocks.slice(0, 5).map(x => ({ name: clean(x.a.name), date: x.t, icon: clean(x.a.image_unlocked), game: tile(byKey.get(clean(x.a.app_id))) })),
        source: 'steam+gog',
    };

    // ── Stores (Clarity's "systems") ────────────────────────────────────────
    sections.stores = {
        available: storeMap.size > 0,
        list: tallyList(storeMap),
        multiStore,
        pico8Hidden: !!opts.hidePico8,
    };

    // ── Backlog ─────────────────────────────────────────────────────────────
    const backlog = games.filter(hs.isBacklog);
    const wantList = games.filter(hs.isWant);
    const hltb = g => hs.leadingInt(g.HLTB_Main);
    const quickWins = backlog.filter(g => hs.isInstalled(g) && hltb(g)).sort((a, b) => hltb(a) - hltb(b)).slice(0, 5);
    sections.backlog = {
        available: backlog.length > 0 || wantList.length > 0,
        neverPlayed: backlog.length,
        neverPlayedPct: games.length ? Math.round(backlog.length / games.length * 100) : 0,
        backlogHours: backlog.reduce((s, g) => s + (hltb(g) || 0), 0),
        wantToPlay: wantList.length,
        wantHours: wantList.reduce((s, g) => s + (hltb(g) || 0), 0),
        quickWins: quickWins.map(g => tile(g, { hltb: hltb(g) })),
    };

    // ── Ratings ─────────────────────────────────────────────────────────────
    const rated = games.map(g => ({ g, mc: hs.leadingInt(g.METACRITIC) })).filter(x => x.mc && x.mc <= 100);
    const bands = [['90+', 90, 101], ['80s', 80, 90], ['70s', 70, 80], ['60s', 60, 70], ['Under 60', 0, 60]]
        .map(([label, lo, hi]) => ({ label, value: rated.filter(x => x.mc >= lo && x.mc < hi).length }));
    sections.ratings = {
        available: rated.length > 0,
        rated: rated.length,
        average: rated.length ? Math.round(rated.reduce((s, x) => s + x.mc, 0) / rated.length) : null,
        bands,
        best: rated.sort((a, b) => b.mc - a.mc || titleOf(a.g).localeCompare(titleOf(b.g))).slice(0, 6).map(x => tile(x.g, { score: x.mc })),
    };

    // ── Decades ─────────────────────────────────────────────────────────────
    const decadeMap = new Map();
    const dated = games.map(g => ({ g, y: yearOf(g) })).filter(x => x.y);
    for (const { y } of dated) bump(decadeMap, `${Math.floor(y / 10) * 10}s`);
    dated.sort((a, b) => a.y - b.y);
    sections.decades = {
        available: dated.length > 0,
        dated: dated.length,
        list: [...decadeMap.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => a.label.localeCompare(b.label)),
        oldest: dated[0] ? tile(dated[0].g) : null,
        newest: dated.length ? tile(dated[dated.length - 1].g) : null,
        span: dated.length ? dated[dated.length - 1].y - dated[0].y : 0,
    };

    // ── Studios ─────────────────────────────────────────────────────────────
    const devCount = new Map(), devHours = new Map();
    for (const g of games) {
        // DEV can list several studios; the first is the lead.
        const d = clean(String(g.DEV || '').split(/[,;]/)[0]);
        if (!d) continue;
        bump(devCount, d); bump(devHours, d, num(g.Playtime));
    }
    sections.studios = {
        available: devCount.size > 0,
        byCount: tallyList(devCount, 8),
        byHours: tallyList(devHours).filter(x => x.value > 0).slice(0, 5).map(x => ({ label: x.label, value: Math.round(x.value / 60) })),
    };

    // ── Franchises ──────────────────────────────────────────────────────────
    const fMap = new Map();
    for (const g of games) { const f = clean(g.Franchise); if (f) { if (!fMap.has(f)) fMap.set(f, []); fMap.get(f).push(g); } }
    const series = [...fMap.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    sections.franchises = {
        available: series.length > 0,
        list: series.slice(0, 6).map(([name, list]) => ({ label: name, value: list.length, art: tile(list.find(g => g.HeroArt || g.CoverArt) || list[0]) })),
    };

    // ── Linux readiness (ProtonDB) ──────────────────────────────────────────
    const proton = hs.protonReadiness(games);
    sections.linux = { available: proton.rated > 0, rated: proton.rated, readyPct: proton.pct || 0, tiers: proton.tiers };

    // ── Favourites ──────────────────────────────────────────────────────────
    const favList = games.filter(hs.isFav).sort((a, b) => num(b.Playtime) - num(a.Playtime) || titleOf(a).localeCompare(titleOf(b)));
    sections.favourites = {
        available: favList.length > 0,
        count: favList.length,
        games: favList.slice(0, 12).map(g => tile(g)),
    };

    // ── Library growth ──────────────────────────────────────────────────────
    const addedMap = new Map();
    const monthKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const months = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now); d.setDate(1); d.setMonth(d.getMonth() - i); months.push(monthKey(d)); }
    let addedYear = 0;
    for (const g of games) {
        const s = num(g.date_added); if (!s) continue;
        const t = s * 1000;
        bump(addedMap, monthKey(new Date(t)));
        if (t >= yearStart) addedYear++;
    }
    const growth = months.map(m => ({ label: m, value: addedMap.get(m) || 0 }));
    sections.growth = {
        available: growth.some(x => x.value > 0),
        months: growth,
        lastYear: growth.reduce((s, x) => s + x.value, 0),
        thisYear: addedYear,
    };

    // ── Storage ─────────────────────────────────────────────────────────────
    const sized = games.filter(g => hs.isInstalled(g) && num(g.DiskSize) > 0).sort((a, b) => num(b.DiskSize) - num(a.DiskSize));
    sections.storage = {
        available: sized.length > 0,
        installed, measured: sized.length, bytes: diskBytes,
        biggest: sized.slice(0, 5).map(g => tile(g, { bytes: num(g.DiskSize) })),
    };

    // ── EmuLatte, when its library sits beside this one ─────────────────────
    const emu = opts.emulatte;
    if (emu && Array.isArray(emu.games) && emu.games.length) {
        const sysName = new Map((emu.systems || []).map(s => [s.id, clean(s.name) || clean(s.short_name)]));
        const bySys = new Map();
        for (const r of emu.games) bump(bySys, sysName.get(r.system_id) || 'Other');
        sections.emulatte = {
            available: true,
            games: emu.games.length,
            systems: bySys.size,
            played: emu.games.filter(r => num(r.last_played) > 0).length,
            favourites: emu.games.filter(r => num(r.fav) === 1).length,
            list: tallyList(bySys, 8),
        };
    } else {
        sections.emulatte = { available: false };
    }

    // Art to decorate with: the games that define this library, best-known first.
    const artPool = [];
    const addArt = g => { if (g && !artPool.some(t => t.id === g.id) && (g.HeroArt || g.CoverArt || g.Screenshot)) artPool.push(tile(g)); };
    byPlaytime.slice(0, 12).forEach(addArt);
    byLast.slice(0, 12).forEach(addArt);
    favList.slice(0, 12).forEach(addArt);
    rated.slice(0, 12).forEach(x => addArt(x.g));

    return {
        generatedAt: now,
        order: SECTION_ORDER.filter(id => sections[id]),
        sections,
        art: artPool.slice(0, 24),
    };
}

// EmuLatte keeps its library in its own database; this is the query the report needs from it.
const EMULATTE_QUERIES = {
    games: 'SELECT system_id, last_played, fav FROM games',
    systems: 'SELECT id, name, short_name FROM systems',
};

module.exports = { buildReport, SECTION_ORDER, EMULATTE_QUERIES };
