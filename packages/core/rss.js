'use strict';
/*
 * @clarity/core, RSS/Atom reader for the "Gaming News" Home widget (Phase 3).
 * Network + opt-in (the widget/row is off by default). Lightweight regex parsing
 * (no XML dependency), handles RSS 2.0 <item> and Atom <entry>. Defensive: any
 * failing feed contributes []; the whole call resolves to [] on error.
 */
const { session } = require('electron');

const DEFAULT_NEWS = [
    'https://www.gamingonlinux.com/article_rss.php', // Linux-first, perfect for this audience
    'https://www.pcgamer.com/rss/',
    'https://www.rockpapershotgun.com/feed',
];

function _tag(block, tag) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    let v = m[1].trim();
    const cd = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cd) v = cd[1];
    return v.trim();
}
function _clean(s) {
    return String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
        .trim();
}

function parseFeed(xml, source) {
    const out = [];
    const isAtom = /<entry[\s>]/.test(xml) && !/<item[\s>]/.test(xml);
    const blocks = xml.match(isAtom ? /<entry[\s\S]*?<\/entry>/gi : /<item[\s\S]*?<\/item>/gi) || [];
    for (const b of blocks) {
        const title = _clean(_tag(b, 'title'));
        if (!title) continue;
        let link = '';
        if (isAtom) {
            const m = b.match(/<link[^>]*href=["']([^"']+)["']/i);
            link = m ? m[1] : '';
        } else {
            link = _clean(_tag(b, 'link'));
        }
        const dStr = _tag(b, 'pubDate') || _tag(b, 'published') || _tag(b, 'updated') || _tag(b, 'dc:date') || '';
        const date = dStr ? Date.parse(dStr) : 0;
        if (link) out.push({ title, link, date: isFinite(date) ? date : 0, source });
    }
    return out;
}

async function fetchNews(urls, limit = 14) {
    const lists = await Promise.all((urls || []).map(async u => {
        try {
            const r = await session.defaultSession.fetch(u);
            if (!r.ok) return [];
            const xml = await r.text();
            let host = u; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
            return parseFeed(xml, host);
        } catch { return []; }
    }));
    const all = [].concat(...lists).filter(i => i.title && i.link);
    all.sort((a, b) => b.date - a.date);
    return all.slice(0, limit);
}

module.exports = { fetchNews, parseFeed, DEFAULT_NEWS };
