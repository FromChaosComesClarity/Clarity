'use strict';
/*
 * @clarity/core, Steam per-game news / patch notes for the Home dashboard
 * (Phase 3). Uses the PUBLIC Steam News API (ISteamNews/GetNewsForApp), no key.
 * Network + opt-in; only the games you actually play/own are queried. Defensive.
 */
const { session } = require('electron');

async function appNews(appid, count) {
    try {
        const r = await session.defaultSession.fetch(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=${count || 3}&maxlength=1&format=json`);
        if (!r.ok) return [];
        const d = await r.json();
        return (d && d.appnews && d.appnews.newsitems) || [];
    } catch { return []; }
}

// targets: [{ appid, name }]. Returns merged, newest-first news across the set.
async function gameNews(targets, opts = {}) {
    const perApp = opts.perApp || 3, limit = opts.limit || 24, total = opts.total || 14, concurrency = opts.concurrency || 6;
    const list = (targets || []).slice(0, limit);
    const all = [];
    let i = 0;
    async function worker() {
        while (i < list.length) {
            const g = list[i++];
            const items = await appNews(g.appid, perApp);
            for (const it of items) {
                if (it.title && it.url) all.push({ title: it.title, url: it.url, date: (it.date || 0) * 1000, source: g.name || it.feedlabel || 'Steam' });
            }
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    all.sort((a, b) => b.date - a.date);
    return all.slice(0, total);
}

module.exports = { appNews, gameNews };
