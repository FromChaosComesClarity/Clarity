'use strict';
/*
 * Filling in what a library row does not know about itself.
 *
 * A row arrives from an importer with a name and a launch command. Everything
 * that makes it worth looking at — cover, hero, logo, screenshots, genre, year,
 * developer, the blurb, how long it takes to beat, how well it runs under
 * Proton — comes from somewhere else, and "somewhere else" is four services
 * with four different failure modes:
 *
 *   Steam appdetails   the primary source, keyed by appid — which the row
 *                      often does not have, so it is searched for by name
 *   SteamGridDB        better hero and logo art, and the only source of a logo
 *                      for most games. Needs the user's own API key
 *   HowLongToBeat      an unofficial endpoint needing a token fetched
 *                      immediately beforehand; it changes shape occasionally
 *   IGDB               fills Steam's gaps, knows about franchises, and is the
 *                      only source at all for a GOG-only game. Needs Twitch
 *                      credentials
 *
 * ⚠️ Every one of them is optional and every one fails routinely — rate limits,
 * missing keys, a game that is not on Steam. So nothing here throws on a failed
 * source: each contributes what it can, and a scrape that got a cover but no
 * HLTB time is a success. The only true failure is "neither Steam nor IGDB knew
 * anything about this".
 *
 * Extracted verbatim in behaviour from apps/manager/main.js's `auto-fetch`,
 * which is the complete implementation — Couch has a thinner one that requires
 * an appid up front, and following that one would have quietly dropped
 * appid-discovery, local-art preservation, the SGDB fallbacks and everything
 * IGDB contributes. Same move, and the same reasoning, as packages/core/launch.js.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const STEAM_LANG_MAP = { en: 'english', pt_BR: 'brazilian' };

// How alike two titles are, 0..1, by shared words. Used to reject a search hit
// that happens to come back first but is a different game — "DOOM" against
// "DOOM Eternal" against "Doom 3", which Steam's own search mixes freely.
function titleSimilarity(a, b) {
    const tokens = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean));
    const ta = tokens(a), tb = tokens(b);
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
}

/*
 * deps:
 *   db         the face's open games.db — settings holds the API keys, games is
 *              what gets written
 *   imagesDir  where downloaded art lands
 *
 * ⚠️ Art paths are stored as 'GameManagerConfig/images/<file>', relative to the
 * install root rather than to imagesDir, because that is the spelling the rest
 * of the suite reads.
 */
function create({ db = null, imagesDir = '' } = {}) {

    const safeName = (name) => String(name || '').replace(/[\\/:*?"<>|#]/g, '').trim();
    const stored = (file) => `GameManagerConfig/images/${file}`;
    const setting = (key) => { try { return db?.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''; } catch { return ''; } };
    const isLocal = (v) => !!v && String(v).startsWith('GameManagerConfig');

    async function downloadImage(url, dest) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!res.ok) return false;
            fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
            return true;
        } catch (e) { return false; }
    }

    // ── Steam ────────────────────────────────────────────────────────────────

    // Candidates for a name. This is what "the library has the wrong game"
    // needs: pick the right entry and its id drives everything else.
    async function searchSteam(gameName) {
        try {
            const res = await fetch(
                `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`);
            const data = await res.json();
            if (!data.items?.length) return [];
            return data.items.map(item => ({ id: String(item.id), name: item.name }));
        } catch (e) { return []; }
    }

    async function findAppId(gameName) {
        const hits = await searchSteam(gameName);
        const match = hits.find(h => titleSimilarity(h.name, gameName) >= 0.4);
        return match ? match.id : '';
    }

    async function fetchDescI18n(appId, enDesc) {
        const lang = setting('language') || 'en';
        const i18n = { en: enDesc };
        if (lang !== 'en' && STEAM_LANG_MAP[lang] && appId) {
            try {
                const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=${STEAM_LANG_MAP[lang]}`);
                const d = await r.json();
                if (d[appId]?.success) i18n[lang] = d[appId].data.short_description || enDesc;
            } catch (e) { /* the English blurb alone is fine */ }
        }
        return JSON.stringify(i18n);
    }

    // ── SteamGridDB ──────────────────────────────────────────────────────────

    async function sgdbId(gameName, apiKey, appId) {
        const headers = { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' };
        if (appId) {
            try {
                const r = await fetch(`https://www.steamgriddb.com/api/v2/games/steam/${appId}`, { headers });
                const d = await r.json();
                if (d.success && d.data) return d.data.id;
            } catch (e) { /* fall through to the name search */ }
        }
        try {
            const res = await fetch(
                `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
            const data = await res.json();
            return data.success && data.data?.length ? data.data[0].id : null;
        } catch (e) { return null; }
    }

    // Candidate covers, for a face that lets the user choose one.
    async function sgdbSearch(gameName, apiKey, appId) {
        if (!apiKey) return [];
        try {
            const id = await sgdbId(gameName, apiKey, appId);
            if (!id) return [];
            const headers = { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' };
            const res = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${id}?dimensions=600x900`, { headers });
            const data = await res.json();
            if (!data.success || !data.data) return [];
            return data.data.map(g => ({ thumb: g.thumb, url: g.url }));
        } catch (e) { return []; }
    }

    async function sgdbApply(gameId, gameName, url) {
        const file = `${safeName(gameName)} - Custom Cover.jpg`;
        if (!await downloadImage(url, path.join(imagesDir, file))) return false;
        try { db.prepare('UPDATE games SET CoverArt=? WHERE id=?').run(stored(file), gameId); } catch { return false; }
        return true;
    }

    // First asset of a kind, downloaded and stored — the hero and logo fallback
    // for everything Steam's CDN does not have.
    async function sgdbFirst(gameName, apiKey, appId, assetType) {
        try {
            const id = await sgdbId(gameName, apiKey, appId);
            if (!id) return '';
            const headers = { Authorization: `Bearer ${apiKey}`, 'User-Agent': 'Mozilla/5.0' };
            const endpoint = assetType === 'hero' ? 'heroes' : assetType === 'logo' ? 'logos' : 'grids';
            const res = await fetch(`https://www.steamgriddb.com/api/v2/${endpoint}/game/${id}`, { headers });
            const data = await res.json();
            if (!data.success || !data.data?.length) return '';
            const file = `${safeName(gameName)} - SGDB ${assetType}.${assetType === 'logo' ? 'png' : 'jpg'}`;
            return await downloadImage(data.data[0].url, path.join(imagesDir, file)) ? stored(file) : '';
        } catch (e) { return ''; }
    }

    // ── HowLongToBeat ────────────────────────────────────────────────────────
    // ⚠️ Unofficial and deliberately awkward: the search needs a token plus a
    // header pair fetched from /init immediately beforehand, and the field
    // names change from time to time. A bonus, never a reason to fail.

    function hltbInit() {
        return new Promise((resolve, reject) => {
            const req = https.get('https://howlongtobeat.com/api/bleed/init?t=' + Date.now(), {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    referer: 'https://howlongtobeat.com/',
                },
            }, res => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
        });
    }

    async function searchHltb(gameName) {
        const { token, hpKey, hpVal } = await hltbInit();
        const payload = {
            searchType: 'games', searchTerms: String(gameName).trim().split(' '),
            searchPage: 1, size: 5,
            searchOptions: {
                games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main',
                         rangeTime: { min: 0, max: 0 },
                         gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
                         rangeYear: { min: 0, max: 0 }, modifier: '' },
                users: { sortCategory: 'postcount' }, lists: { sortCategory: 'all' },
                filter: '', sort: 0, randomizer: 0,
            },
            useCache: true,
        };
        if (hpKey) payload[hpKey] = hpVal;
        const body = JSON.stringify(payload);
        return new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'howlongtobeat.com', path: '/api/bleed', method: 'POST',
                headers: {
                    'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    origin: 'https://howlongtobeat.com', referer: 'https://howlongtobeat.com/search',
                    'x-auth-token': token, 'x-hp-key': hpKey, 'x-hp-val': hpVal,
                },
            }, res => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => { try { resolve(JSON.parse(data).data || []); } catch (e) { reject(e); } });
            });
            req.on('error', reject);
            req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
            req.write(body); req.end();
        });
    }

    async function hoursToBeat(gameName) {
        try {
            let hits = await searchHltb(gameName);
            // A subtitle usually costs the match; the base title usually finds it.
            if (!hits.length) hits = await searchHltb(String(gameName).replace(/[:\-].*/, '').replace(/[™®©]/g, '').trim());
            if (hits[0]?.comp_main > 0) return `${Math.round(hits[0].comp_main / 3600)} Hours`;
        } catch (e) { /* a bonus field */ }
        return '';
    }

    // ── IGDB ─────────────────────────────────────────────────────────────────
    // The token is cached in settings with its expiry: Twitch rate-limits
    // credential grants, and a 500-game batch would otherwise ask per game.

    const IGDB_FIELDS = 'fields name,summary,involved_companies.developer,involved_companies.publisher,'
        + 'involved_companies.company.name,genres.name,themes.name,themes.id,first_release_date,'
        + 'aggregated_rating,cover.url,screenshots.url,videos.video_id,similar_games.name,'
        + 'franchises.name,collection.name,external_games.category,external_games.uid;';

    async function igdbAuth() {
        const clientId = setting('igdb_client_id');
        const secret = setting('igdb_client_secret');
        if (!clientId || !secret) return null;
        const cached = setting('igdb_token');
        const expiry = setting('igdb_token_expiry');
        if (cached && expiry && Date.now() < parseInt(expiry, 10)) return { token: cached, clientId };
        try {
            const res = await fetch(
                `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${secret}&grant_type=client_credentials`,
                { method: 'POST' });
            const data = await res.json();
            if (!data.access_token) return null;
            const exp = Date.now() + (data.expires_in * 1000) - 86400000;
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('igdb_token',?)").run(data.access_token);
            db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('igdb_token_expiry',?)").run(String(exp));
            return { token: data.access_token, clientId };
        } catch (e) { return null; }
    }

    async function igdbQuery(auth, body) {
        const res = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: { 'Client-ID': auth.clientId, Authorization: `Bearer ${auth.token}`, 'Content-Type': 'text/plain' },
            body,
        });
        const data = await res.json();
        if (!Array.isArray(data) || data[0]?.title) return null;   // an error object, not a game
        return data[0] || null;
    }

    async function igdbSearch(gameName, steamAppId) {
        const auth = await igdbAuth();
        if (!auth) return null;
        try {
            if (steamAppId) {
                const byId = await igdbQuery(auth,
                    `${IGDB_FIELDS} where external_games.uid = "${steamAppId}" & external_games.category = 1; limit 1;`);
                if (byId) return byId;
            }
            return await igdbQuery(auth, `search "${String(gameName).replace(/"/g, '')}"; ${IGDB_FIELDS} limit 3;`);
        } catch (e) { return null; }
    }

    const igdbImg = (url, size = 'cover_big') => (url ? 'https:' + url.replace('t_thumb', `t_${size}`) : null);

    // ── The scrape ───────────────────────────────────────────────────────────

    /*
     * Everything known about one game, written to its row.
     *
     * specificAppId forces a Steam entry — that is what the "this is the wrong
     * game" flow passes once the user has picked from a name search. Without
     * it, the appid is searched for by title and accepted only above a
     * similarity threshold.
     *
     * ⚠️ Art already held locally is never overwritten. A scrape is also a
     * re-scrape, and a user who chose a cover by hand should not lose it by
     * refreshing the blurb.
     */
    async function autoFetch(gameId, gameName, specificAppId = '') {
        if (!db) return { ok: false, message: 'The library is not open.' };
        try {
            const name = safeName(gameName);
            let appId = String(specificAppId || '').replace(/\.0+$/, '').trim();
            if (appId === 'None') appId = '';
            if (!appId) appId = await findAppId(gameName);

            const existing = db.prepare('SELECT CoverArt, HeroArt, Logo, Screenshot FROM games WHERE id=?').get(gameId) || {};
            let cover  = isLocal(existing.CoverArt)   ? existing.CoverArt   : '';
            let hero   = isLocal(existing.HeroArt)    ? existing.HeroArt    : '';
            let logo   = isLocal(existing.Logo)       ? existing.Logo       : '';
            let shots  = isLocal(existing.Screenshot) ? existing.Screenshot : '';

            let steamOk = false;
            let desc = '', htmlDesc = '', dev = '', pub = '', released = '', meta = '';
            let genre = '', coop = 'None', players = '', tags = '', hltb = '', proton = '', trailer = '';

            if (appId) {
                try {
                    const dr = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
                    const dd = await dr.json();
                    if (dd[appId]?.success) {
                        steamOk = true;
                        const a = dd[appId].data;

                        desc = a.short_description || '';
                        htmlDesc = a.detailed_description || '';
                        dev = a.developers?.join(', ') || '';
                        pub = a.publishers?.join(', ') || '';
                        released = a.release_date?.date?.slice(-4) || '';
                        meta = a.metacritic ? String(a.metacritic.score) : '';
                        genre = a.genres?.map(g => g.description).join(', ') || '';

                        const cats = a.categories?.map(c => c.description) || [];
                        if (cats.includes('Online Co-op') && cats.includes('Shared/Split Screen Co-op')) coop = 'Local & Online';
                        else if (cats.includes('Online Co-op')) coop = 'Online';
                        else if (cats.includes('Shared/Split Screen Co-op')) coop = 'Local';
                        else if (cats.includes('Co-op')) coop = 'Online/Local';
                        players = [cats.includes('Single-player') && 'Single-player',
                                   cats.includes('Multi-player') && 'Multi-player'].filter(Boolean).join(', ');
                        tags = cats.slice(0, 5).join(', ');

                        hltb = await hoursToBeat(gameName);

                        try {
                            const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                            if (pr.ok) { const pd = await pr.json(); if (pd.tier) proton = pd.tier.toUpperCase(); }
                        } catch (e) { /* unrated is a normal answer */ }

                        if (!cover) {
                            const file = `${name} - Cover.jpg`;
                            let ok = await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_600x900.jpg`, path.join(imagesDir, file));
                            // Not every app has a 600x900 portrait; the header
                            // image is the wrong shape but beats an empty tile.
                            if (!ok && a.header_image) ok = await downloadImage(a.header_image, path.join(imagesDir, file));
                            if (ok) cover = stored(file);
                        }
                        if (!hero) {
                            const file = `${name} - Hero.jpg`;
                            if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/library_hero.jpg`, path.join(imagesDir, file))) hero = stored(file);
                        }
                        if (!logo) {
                            const file = `${name} - Logo.png`;
                            if (await downloadImage(`https://steamcdn-a.akamaihd.net/steam/apps/${appId}/logo.png`, path.join(imagesDir, file))) logo = stored(file);
                        }
                        if (!shots && a.screenshots?.length) {
                            const saved = [];
                            for (let i = 0; i < Math.min(5, a.screenshots.length); i++) {
                                const file = `${name} - Screen ${i + 1}.jpg`;
                                if (await downloadImage(a.screenshots[i].path_full, path.join(imagesDir, file))) saved.push(stored(file));
                            }
                            if (saved.length) shots = saved.join('|');
                        }

                        const movie = a.movies?.[0];
                        if (movie) trailer = movie.mp4?.max || movie.webm?.max || movie.webm?.['480'] || '';
                    }
                } catch (e) { /* Steam being unreachable leaves IGDB to try */ }
            }

            // SGDB fills the two Steam most often lacks.
            const sgdbKey = setting('steamgriddb_api');
            if (sgdbKey) {
                if (!hero) hero = await sgdbFirst(gameName, sgdbKey, appId, 'hero');
                if (!logo) logo = await sgdbFirst(gameName, sgdbKey, appId, 'logo');
            }

            // IGDB: gap-filler for a Steam game, and the only source at all for
            // a GOG-only one.
            let similar = '', franchise = '', igdbTrailer = '';
            const igdb = await igdbSearch(gameName, appId);

            if (igdb) {
                // ⚠️ IGDB's search is fuzzy enough to return a different game
                // with similar words, and its adult titles carry art that has
                // no business appearing in a library. Its *text* is still worth
                // having when Steam gave none; its artwork is not, unless the
                // match is convincing.
                const adult = igdb.themes?.some(t => t.id === 42);
                const skipArt = adult || titleSimilarity(igdb.name || '', gameName) < 0.4;

                if (igdb.similar_games?.length) similar = igdb.similar_games.map(g => g.name).slice(0, 6).join(', ');
                franchise = igdb.franchises?.[0]?.name || igdb.collection?.name || '';
                igdbTrailer = igdb.videos?.[0]?.video_id || '';

                if (!desc && igdb.summary) desc = igdb.summary;
                if (!dev && igdb.involved_companies) dev = igdb.involved_companies.filter(c => c.developer).map(c => c.company.name).join(', ');
                if (!pub && igdb.involved_companies) pub = igdb.involved_companies.filter(c => c.publisher).map(c => c.company.name).join(', ');
                if (!genre && igdb.genres) genre = [...(igdb.genres?.map(g => g.name) || []), ...(igdb.themes?.map(t => t.name) || [])].slice(0, 3).join(', ');
                if (!released && igdb.first_release_date) released = new Date(igdb.first_release_date * 1000).getFullYear().toString();
                if (!meta && igdb.aggregated_rating) meta = Math.round(igdb.aggregated_rating).toString();

                // A GOG-only game often *is* on Steam, and knowing its appid is
                // what makes a ProtonDB rating possible at all.
                if (!appId) {
                    const steamExt = igdb.external_games?.find(e => e.category === 1);
                    if (steamExt?.uid) {
                        appId = String(steamExt.uid).replace(/\.0+$/, '');
                        try {
                            const pr = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
                            if (pr.ok) { const pd = await pr.json(); if (pd.tier) proton = pd.tier.toUpperCase(); }
                        } catch (e) { /* unrated */ }
                    }
                }

                if (!cover && igdb.cover?.url && !skipArt) {
                    const file = `${name} - Cover.jpg`;
                    if (await downloadImage(igdbImg(igdb.cover.url, 'cover_big'), path.join(imagesDir, file))) cover = stored(file);
                }
                if (!shots && igdb.screenshots?.length && !skipArt) {
                    const saved = [];
                    for (let i = 0; i < Math.min(5, igdb.screenshots.length); i++) {
                        const file = `${name} - Screen ${i + 1}.jpg`;
                        if (await downloadImage(igdbImg(igdb.screenshots[i].url, 'screenshot_big'), path.join(imagesDir, file))) saved.push(stored(file));
                    }
                    if (saved.length) shots = saved.join('|');
                }
            }

            if (!steamOk && !igdb) return { ok: false, message: 'No data found on Steam or IGDB.' };

            const descI18n = await fetchDescI18n(appId, desc);
            db.prepare(`UPDATE games SET Description=?, SteamDesc=?, Description_i18n=?, DEV=?, PUB=?,
                RELEASED=?, METACRITIC=?, GENRE=?, CoverArt=?, HeroArt=?, Logo=?, Screenshot=?, SteamAppID=?,
                Coop=?, NumPlayers=?, Tags=?, HLTB_Main=?, ProtonTier=?, SteamTrailer=?, SimilarGames=?,
                Franchise=?, IGDBTrailer=? WHERE id=?`)
                .run(desc, htmlDesc, descI18n, dev, pub, released, meta, genre, cover, hero, logo, shots,
                     appId || '', coop, players, tags, hltb, proton, trailer, similar, franchise, igdbTrailer, gameId);

            const sources = [steamOk && 'Steam', igdb && 'IGDB'].filter(Boolean).join(' + ');
            return { ok: true, message: `Fetched from ${sources}`, appId, cover: !!cover, sources };
        } catch (err) {
            return { ok: false, message: `Scraping error: ${err.message}` };
        }
    }

    // Has this row been scraped at all? Decides "Scrape" versus "Re-scrape",
    // and which rows a batch over "missing only" should touch.
    const isScraped = (row) => !!(String(row.CoverArt || '').trim() || String(row.Description || row.SteamDesc || '').trim());

    return { autoFetch, searchSteam, findAppId, sgdbSearch, sgdbApply, sgdbFirst, isScraped, titleSimilarity };
}

module.exports = { create, titleSimilarity };
