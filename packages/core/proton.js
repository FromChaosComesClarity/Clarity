'use strict';
/*
 * @clarity/core — ProtonDB tier watch for the Home dashboard (Phase 3).
 * Fetches current ProtonDB ratings for Steam games and diffs them against the
 * tier stored in the library, surfacing anything that climbed. Network + opt-in
 * (runs only on an explicit "Check now"). Defensive: failures → skipped/[].
 */
const { session } = require('electron');

const TIER_RANK = { borked: 0, pending: 1, bronze: 2, silver: 3, gold: 4, platinum: 5, native: 6 };

async function tier(appId) {
    try {
        const r = await session.defaultSession.fetch(`https://www.protondb.com/api/v1/reports/summaries/${appId}.json`);
        if (!r.ok) return null;
        const d = await r.json();
        return d && d.tier ? String(d.tier).toLowerCase() : null;
    } catch { return null; }
}

// games: rows with { id, Game, SteamAppID, ProtonTier }. Returns changes vs the stored tier.
async function checkLibrary(games, opts = {}) {
    const limit = opts.limit || 120, concurrency = opts.concurrency || 6;
    const targets = (games || []).filter(g => {
        const s = String(g.SteamAppID || '').trim();
        return s && s !== 'None';
    }).slice(0, limit);

    const changes = [];
    let i = 0;
    async function worker() {
        while (i < targets.length) {
            const g = targets[i++];
            const appId = String(g.SteamAppID).replace(/\.0+$/, '');
            const t = await tier(appId);
            if (!t) continue;
            const old = String(g.ProtonTier || '').toLowerCase();
            if (old !== t) changes.push({
                id: g.id, game: g.Game, old: g.ProtonTier || '', now: t.toUpperCase(),
                improved: (TIER_RANK[t] ?? -1) > (TIER_RANK[old] ?? -1),
            });
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return { checked: targets.length, changes };
}

module.exports = { tier, checkLibrary, TIER_RANK };
