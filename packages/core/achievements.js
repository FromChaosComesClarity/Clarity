'use strict';
/*
 * @clarity/core, Steam achievement completion scan for the Home dashboard.
 * Uses ISteamUserStats/GetPlayerAchievements (needs the user's steam_api_key +
 * steam_id, the same creds the Steam import uses). Network + opt-in (manual scan).
 * Defensive: a game with no achievements / a failed call is simply skipped.
 */
const { session } = require('electron');

async function playerAch(appid, key, steamid) {
    try {
        const r = await session.defaultSession.fetch(`https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appid}&key=${key}&steamid=${steamid}`);
        if (!r.ok) return null;
        const ps = (await r.json()).playerstats;
        if (!ps || ps.success === false || !Array.isArray(ps.achievements)) return null;
        const total = ps.achievements.length;
        if (!total) return null;
        return { unlocked: ps.achievements.filter(a => a.achieved === 1).length, total };
    } catch { return null; }
}

// targets: [{ id, appid }]. Returns [{ id, unlocked, total }] for games that have achievements.
async function scanLibrary(targets, key, steamid, opts = {}) {
    const concurrency = opts.concurrency || 6, limit = opts.limit || 400;
    const list = (targets || []).slice(0, limit);
    const out = [];
    let i = 0;
    async function worker() {
        while (i < list.length) {
            const g = list[i++];
            const a = await playerAch(g.appid, key, steamid);
            if (a) out.push({ id: g.id, unlocked: a.unlocked, total: a.total });
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return out;
}

module.exports = { playerAch, scanLibrary };
