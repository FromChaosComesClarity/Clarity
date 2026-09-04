'use strict';
/*
 * @clarity/core, IsThereAnyDeal (ITAD) API v2 wrapper for the Wishlist
 * deals feature (Phase 2). 100% network and 100% OPT-IN: nothing here runs
 * unless the user has saved an ITAD API key (settings key `itad_api_key`).
 *
 * Free key: register an app at https://isthereanydeal.com/apps/developer/
 * Every call is defensive, resolves to null / {} / [] on any error, never throws.
 */
const { session } = require('electron');
const BASE = 'https://api.isthereanydeal.com';

async function _get(url) {
    try { const r = await session.defaultSession.fetch(url); if (!r.ok) return null; return await r.json(); }
    catch { return null; }
}
async function _post(url, body) {
    try {
        const r = await session.defaultSession.fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!r.ok) return null; return await r.json();
    } catch { return null; }
}

// Title search → [{ id, slug, title, type }]
async function search(key, title) {
    if (!key || !title) return [];
    const data = await _get(`${BASE}/games/search/v1?key=${encodeURIComponent(key)}&title=${encodeURIComponent(title)}&results=18`);
    return Array.isArray(data) ? data.map(g => ({ id: g.id, slug: g.slug, title: g.title, type: g.type })) : [];
}

// Game info (cover art lives under assets) → { id, slug, title, cover, appid }
async function info(key, id) {
    if (!key || !id) return null;
    const d = await _get(`${BASE}/games/info/v2?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`);
    if (!d) return null;
    const a = d.assets || {};
    return { id: d.id, slug: d.slug, title: d.title, cover: a.boxart || a.banner400 || a.banner300 || a.banner145 || '', appid: d.appid || null };
}

// Current prices → { id: { price, regular, cut, shop, url, currency } | null }
async function prices(key, country, ids) {
    const out = {};
    if (!key || !ids || !ids.length) return out;
    const data = await _post(`${BASE}/games/prices/v3?key=${encodeURIComponent(key)}&country=${encodeURIComponent(country || 'US')}&nondeals=true&vouchers=true`, ids);
    if (!Array.isArray(data)) return out;
    for (const g of data) {
        const deals = Array.isArray(g.deals) ? g.deals : [];
        let best = null;
        for (const d of deals) { const amt = d.price && d.price.amount; if (amt == null) continue; if (!best || amt < best.price.amount) best = d; }
        out[g.id] = best ? { price: best.price.amount, regular: best.regular && best.regular.amount, cut: best.cut, shop: best.shop && best.shop.name, url: best.url, currency: best.price.currency } : null;
    }
    return out;
}

// All-time historical low → { id: { amount, currency, shop } | null }
async function historyLow(key, country, ids) {
    const out = {};
    if (!key || !ids || !ids.length) return out;
    const data = await _post(`${BASE}/games/historylow/v1?key=${encodeURIComponent(key)}&country=${encodeURIComponent(country || 'US')}`, ids);
    if (!Array.isArray(data)) return out;
    for (const g of data) out[g.id] = g.low ? { amount: g.low.amount, currency: g.low.currency, shop: g.low.shop && g.low.shop.name } : null;
    return out;
}

// Merge current price + historical low onto wishlist rows (each row needs .itad_id).
async function enrich(key, country, rows) {
    const ids = rows.map(r => r.itad_id).filter(Boolean);
    if (!ids.length) return rows.map(r => ({ ...r, deal: null, low: null }));
    const [pr, lo] = await Promise.all([prices(key, country, ids), historyLow(key, country, ids)]);
    return rows.map(r => ({ ...r, deal: pr[r.itad_id] || null, low: lo[r.itad_id] || null }));
}

module.exports = { search, info, prices, historyLow, enrich };
