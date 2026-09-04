'use strict';
/*
 * @clarity/core, "Free This Week" sources for the Home dashboards (Phase 2).
 * Currently the Epic Games weekly free games via their PUBLIC promotions endpoint
 * (no key, no auth). Network, only called when the Freebies widget/row is enabled
 * (opt-in). Defensive: resolves to [] on any error.
 */
const { session } = require('electron');

async function epicFree(country = 'US') {
    const cc = (country || 'US').toUpperCase();
    const url = `https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${encodeURIComponent(cc)}&allowCountries=${encodeURIComponent(cc)}`;
    let data;
    try { const r = await session.defaultSession.fetch(url); if (!r.ok) return []; data = await r.json(); }
    catch { return []; }

    const els = data?.data?.Catalog?.searchStore?.elements || [];
    const now = Date.now();
    const out = [];
    for (const e of els) {
        const blocks = e.promotions?.promotionalOffers || [];
        let endsAt = null, free = false;
        for (const block of blocks) for (const off of (block.promotionalOffers || [])) {
            const start = off.startDate ? Date.parse(off.startDate) : 0;
            const end = off.endDate ? Date.parse(off.endDate) : 0;
            const pct = off.discountSetting?.discountPercentage;
            // Epic quirk: discountPercentage is the % of the original price you PAY, so 0 == free.
            // (Free games also report originalPrice/discountPrice as 0, so don't gate on those.)
            if (pct === 0 && (!start || start <= now) && (!end || end >= now)) { free = true; endsAt = off.endDate; }
        }
        if (!free) continue;

        const slug = e.productSlug || e.urlSlug
            || e.catalogNs?.mappings?.[0]?.pageSlug
            || e.offerMappings?.[0]?.pageSlug || '';
        const img = (e.keyImages || []).find(k => ['OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail', 'OfferImageTall', 'DieselStoreFrontTall'].includes(k.type)) || (e.keyImages || [])[0];
        out.push({
            title: e.title,
            cover: img?.url || '',
            url: slug ? `https://store.epicgames.com/en-US/p/${slug}` : 'https://store.epicgames.com/en-US/free-games',
            endsAt,
            store: 'Epic',
        });
    }
    return out;
}

async function freeGames(country) { return epicFree(country); }

module.exports = { epicFree, freeGames };
