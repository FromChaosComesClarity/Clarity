'use strict';
/*
 * The library report, rendered.
 *
 * ONE function turns a report (packages/core/library-report.js) into a complete, self-contained
 * HTML document, and every output is that document: the live preview, the saved web page, the
 * PDF (printed from it) and the images (captured from it). Nothing is drawn twice, so what the
 * preview shows is what gets saved.
 *
 * Self-contained is load-bearing. A saved page has to open on someone else's machine, and a PDF
 * or image is rendered with no network at all, so fonts and art arrive inlined as data URLs
 * (`opts.fonts`, `opts.img`) and nothing here references a file or a host.
 *
 * Layouts
 *   document   every picked section, one after another (web page and PDF)
 *   poster     a single frame: the title, a wall of the library's art, up to six headline stats
 *   cards      one frame per section, sized for a social carousel; `opts.only` renders one
 *   cards-strip  every card side by side, scaled down, for the preview
 */

const STYLES = {
    clarity: {
        vars: {
            bg: '#07090a', bg2: '#0e1315', panel: 'rgba(13,17,19,.72)', ink: '#e4eded', muted: '#93a7aa',
            dim: '#5b6f72', line: 'rgba(228,237,237,.12)', a1: '#2fe0d6', a2: '#ff5fa2', a3: '#e8b765',
            duo0: '#041012', duo1: '#2fe0d6', glow: 'rgba(47,224,214,.22)', r: '0px',
        },
        display: "'Sora'", displayWeight: 800, label: "'JetBrains Mono'", labelWeight: 400, body: "'Sora'",
        numeral: "'Sora'", tracking: '-0.045em', labelCase: 'uppercase', labelTracking: '.18em',
        fonts: ['Sora', 'JetBrains Mono'],
    },
    afterglow: {
        vars: {
            bg: '#0d0710', bg2: '#1c1020', panel: 'rgba(28,16,32,.62)', ink: '#fbefe8', muted: '#cdb7b0',
            dim: '#8d7777', line: 'rgba(251,239,232,.14)', a1: '#ff7a59', a2: '#ffc56b', a3: '#b68cff',
            duo0: '#1a0816', duo1: '#ff9a62', glow: 'rgba(255,122,89,.26)', r: '28px',
        },
        display: "'Fraunces'", displayWeight: 640, label: "'Sora'", labelWeight: 600, body: "'Sora'",
        numeral: "'Fraunces'", tracking: '-0.03em', labelCase: 'uppercase', labelTracking: '.16em',
        displayVariation: "'opsz' 144, 'SOFT' 60", fonts: ['Fraunces', 'Sora'],
    },
    daylight: {
        vars: {
            bg: '#eef1f5', bg2: '#ffffff', panel: 'rgba(255,255,255,.82)', ink: '#0a0f16', muted: '#4a5463',
            dim: '#8b94a1', line: 'rgba(10,15,22,.12)', a1: '#2344ff', a2: '#ff4d2e', a3: '#12a877',
            duo0: '#0b1a66', duo1: '#e9edff', glow: 'rgba(35,68,255,.14)', r: '8px',
        },
        display: "'Raleway'", displayWeight: 900, label: "'Sora'", labelWeight: 600, body: "'Sora'",
        numeral: "'Raleway'", tracking: '-0.035em', labelCase: 'uppercase', labelTracking: '.14em',
        light: true, fonts: ['Raleway', 'Sora'],
    },
};

// "My theme" borrows the active Clarity theme's tokens. Pixel fonts are kept for labels only:
// they are the theme's character, but a 7-digit number in PxPlus VGA at poster size is noise.
function themeStyle(t = {}) {
    const light = isLight(t.bg || '#111');
    const font = t.font ? `'${t.font}'` : "'Sora'";
    return {
        vars: {
            bg: t.bg || '#111', bg2: t.bg_menu || t.bg || '#161616', panel: t.bg_panel || 'rgba(0,0,0,.5)',
            ink: t.text_main || '#eee', muted: t.text_sec || '#aaa', dim: t.text_dim || '#777',
            line: t.border || 'rgba(255,255,255,.14)', a1: t.accent || '#2fe0d6', a2: t.accent_menu || t.accent || '#ff5fa2',
            a3: t.text_sec || '#e8b765', duo0: t.bg || '#111', duo1: t.accent || '#2fe0d6',
            glow: 'transparent', r: '10px',
        },
        display: "'Sora'", displayWeight: 800, label: font, labelWeight: 400, body: "'Sora'", numeral: "'Sora'",
        tracking: '-0.04em', labelCase: 'uppercase', labelTracking: '.12em', light,
        fonts: ['Sora', t.font].filter(Boolean),
    };
}

function isLight(hex) {
    const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

const TIER_COLORS = { NATIVE: '#35d07f', PLATINUM: '#c9d6e3', GOLD: '#e2b93b', SILVER: '#a9b0b6', BRONZE: '#c9803e', BORKED: '#ff4a4a' };

// Film grain, generated once as an SVG so it is resolution-independent and costs no image file.
const GRAIN = "url(\"data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>') + "\")";

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderReport(report, opts = {}) {
    const S = (opts.strings && opts.strings.r) || {};
    const lang = String(opts.lang || 'en').replace('_', '-');
    const nf = new Intl.NumberFormat(lang);
    const n = v => nf.format(Math.round(Number(v) || 0));
    const tr = (key, vars = {}) => String(S[(Object.values(vars).some(v => v === '1' || v === 1) && S[key + '_one']) ? key + '_one' : key] || key).replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
    // Wraps the substituted values of a sentence so the template can make them glow.
    // `key_one` is used when the sentence's count is exactly 1, so a small library never reads "1 games".
    const one = (key, vars) => (Object.values(vars).some(v => v === '1' || v === 1) && S[key + '_one']) ? key + '_one' : key;
    const trEm = (key, vars = {}) => esc(String(S[one(key, vars)] || key)).replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? `<em>${esc(vars[k])}</em>` : `{${k}}`);
    const img = (p, kind) => (p && opts.img ? opts.img(p, kind) : '') || '';
    const storeLogo = label => (opts.storeLogo ? opts.storeLogo(label) : '') || '';
    const bytes = b => {
        const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0, v = Number(b) || 0;
        while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
        return `${new Intl.NumberFormat(lang, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} ${u[i]}`;
    };
    const dateStr = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(report.generatedAt || Date.now()));
    const style = opts.style === 'theme' ? themeStyle(opts.theme) : (STYLES[opts.style] || STYLES.clarity);
    const layout = opts.layout || 'document';
    const title = opts.title || '';
    const subtitle = opts.subtitle || '';
    const secs = report.sections || {};
    const picked = (opts.sections || report.order || []).filter(id => secs[id] && secs[id].available);

    // ── Pieces ──────────────────────────────────────────────────────────────
    const cover = (t, cls = '') => {
        const src = img(t && (t.cover || t.hero), 'cover');
        return src ? `<img class="cv ${cls}" src="${src}" alt="">` : `<div class="cv cv-none ${cls}"><span>${esc(t && t.title)}</span></div>`;
    };
    const bars = (list, { unit = '', max, logos = false, colors } = {}) => {
        const top = max || Math.max(1, ...list.map(x => x.value));
        return `<ol class="bars">${list.map((x, i) => {
            const logo = logos ? storeLogo(x.label) : '';
            const color = colors ? colors[x.label] : '';
            return `<li style="--p:${(x.value / top * 100).toFixed(2)}%;${color ? `--bar:${color};` : ''}--i:${i}">
                <span class="bl">${logo ? `<i class="logo" style="-webkit-mask-image:url('${logo}')"></i>` : ''}${esc(x.label)}</span>
                <span class="bv">${n(x.value)}${unit ? `<small>${esc(unit)}</small>` : ''}</span>
                <span class="bt"><span class="bf"></span></span></li>`;
        }).join('')}</ol>`;
    };
    const ring = (pct, label) => `<div class="ring" style="--p:${Math.max(0, Math.min(100, pct))}"><div class="ring-in"><b>${n(pct)}<small>%</small></b>${label ? `<span>${esc(label)}</span>` : ''}</div></div>`;
    const ago = d => d == null ? '' : d === 0 ? tr('today') : d === 1 ? tr('yesterday') : tr('days_ago', { n: n(d) });
    const H = tr('hours_unit');

    // Backdrop art: the section's own defining image, duotoned into the style and graded down.
    const backdrop = (p, kind = 'hero', extra = '') => {
        const src = img(p, kind);
        return src ? `<div class="bd ${extra}"><img src="${src}" alt=""></div>` : '';
    };
    const wall = (list, count = 24) => {
        const covers = (list || []).map(t => img(t.cover, 'cover')).filter(Boolean);
        if (!covers.length) return '';
        const cells = Array.from({ length: count }, (_, i) => covers[(i * 7 + (i % 3)) % covers.length]);
        return `<div class="wall"><div class="wall-grid">${cells.map(c => `<img src="${c}" alt="">`).join('')}</div></div>`;
    };

    // ── Sections ────────────────────────────────────────────────────────────
    // Each returns { art, body, stat } where `stat` is the one-line version the poster uses.
    const SECTIONS = {
        overview(s) {
            const cells = [
                [s.games, tr('overview_games')], [s.hours, tr('overview_hours')], [s.installed, tr('overview_installed')],
                [s.achievements, tr('overview_achievements')], [s.stores, tr('overview_stores')], [s.metacriticAvg, tr('overview_metacritic')],
            ].filter(([v]) => v != null && v !== 0);
            return {
                art: wall(report.art, 30),
                body: `<div class="ov">${cells.map(([v, l], i) => `<div class="ov-cell${i === 0 ? ' big' : ''}"><b>${n(v)}</b><span>${esc(l)}</span></div>`).join('')}</div>`,
                headline: esc(title || tr('overview')),
                stat: { value: n(s.games), label: tr('overview_games') },
                isCover: true,
            };
        },
        mostPlayed(s) {
            const top = s.games[0];
            const logo = img(top.logo, 'logo');
            const rest = s.games.slice(1, 10);
            const max = Math.max(1, ...s.games.map(g => g.minutes));
            return {
                art: backdrop(top.hero || top.shot || top.cover, 'hero', 'bd-strong'),
                headline: trEm('mostPlayed_head', { hours: n(s.totalHours) }),
                body: `<div class="mp">
                    <div class="mp-top">${logo ? `<img class="mp-logo" src="${logo}" alt="">` : `<div class="mp-name">${esc(top.title)}</div>`}
                        <div class="mp-hours"><b>${n(top.hours)}</b><span>${H}</span></div></div>
                    <p class="sub">${esc(tr('mostPlayed_sub', { game: top.title, hours: n(top.hours), n: n(s.gamesWithHours), pct: n(s.topShare) }))}</p>
                    <ol class="rank">${rest.map((g, i) => `<li style="--p:${(g.minutes / max * 100).toFixed(2)}%">
                        <span class="rk">${i + 2}</span>${cover(g, 'sm')}<span class="rt">${esc(g.title)}</span>
                        <span class="rv">${n(g.hours)}<small>${H}</small></span><span class="bt"><span class="bf"></span></span></li>`).join('')}</ol>
                    <p class="src">${esc(tr('steam_note'))}</p></div>`,
                stat: { value: n(top.hours), unit: H, label: top.title },
            };
        },
        recent(s) {
            // Hours only lead when there is at least one to talk about; a few Steam minutes read as "0 h".
            const byHours = s.orderedBy === 'twoWeekHours' && s.twoWeekHours >= 1;
            const head = byHours ? trEm('recent_head_hours', { hours: n(s.twoWeekHours) })
                : s.playedInWindow ? trEm('recent_head_games', { n: n(s.playedInWindow), days: n(s.days) }) : esc(tr('recent_head_last'));
            const lead = s.games[0];
            return {
                art: backdrop(lead && (lead.hero || lead.shot), 'hero'),
                headline: head,
                body: `<ul class="shelf">${s.games.map((g, i) => `<li style="--i:${i}">${cover(g)}<span class="st">${esc(g.title)}</span>
                    <span class="sv">${byHours && g.recentHours >= 0.5 ? `${n(g.recentHours)} ${H}` : esc(ago(g.daysAgo))}</span></li>`).join('')}</ul>`,
                stat: byHours ? { value: n(s.twoWeekHours), unit: H, label: tr('recent') } : { value: n(s.playedInWindow || s.games.length), label: tr('recent') },
            };
        },
        genres(s) {
            const byHours = s.byHours.length > 0;
            return {
                art: s.leadArt.length ? `<div class="mosaic">${s.leadArt.slice(0, 9).map(t => img(t.cover, 'cover')).filter(Boolean).map(src => `<img src="${src}" alt="">`).join('')}</div>` : '',
                headline: trEm('genres_head', { genre: s.lead || '' }),
                body: `<p class="sub">${esc(tr('genres_sub', { n: n(s.distinct), genre: s.lead || '', metric: tr(byHours ? 'genres_metric_hours' : 'genres_metric_count') }))}</p>
                    <div class="split">
                        <div><h4>${esc(tr('genres_by_count'))}</h4>${bars(s.byCount.slice(0, 7))}</div>
                        ${byHours ? `<div class="alt"><h4>${esc(tr('genres_by_hours'))}</h4>${bars(s.byHours.slice(0, 7), { unit: H })}</div>` : ''}
                    </div>`,
                stat: { value: s.lead || '', label: tr('genres'), text: true },
            };
        },
        achievements(s) {
            const lead = s.perfect[0] || s.closest[0];
            return {
                art: backdrop(lead && (lead.hero || lead.shot), 'hero'),
                headline: trEm('achievements_head', { n: n(s.unlocked) }),
                body: `<div class="ach">
                    ${ring(s.completion, '')}
                    <div class="ach-facts">
                        <p><b>${esc(tr('achievements_completion', { pct: n(s.completion), n: n(s.gamesStarted) }))}</b></p>
                        ${s.perfectCount ? `<p>${trEm('achievements_perfect', { n: n(s.perfectCount) })}</p>` : ''}
                        ${s.thisYear ? `<p>${trEm('achievements_this_year', { n: n(s.thisYear) })}</p>` : ''}
                    </div>
                    ${s.perfect.length ? `<div class="ach-perfect">${s.perfect.slice(0, 6).map(g => `<figure>${cover(g)}<figcaption>100%</figcaption></figure>`).join('')}</div>` : ''}
                    ${s.closest.length ? `<div class="ach-close"><h4>${esc(tr('achievements_closest'))}</h4><ol class="prog">${s.closest.map(g => `<li style="--p:${g.pct}%">${cover(g, 'sm')}<span class="rt">${esc(g.title)}</span><span class="rv">${n(g.pct)}%</span><span class="bt"><span class="bf"></span></span></li>`).join('')}</ol></div>` : ''}
                </div>`,
                stat: { value: n(s.unlocked), label: tr('achievements') },
            };
        },
        stores(s) {
            const total = s.list.reduce((a, x) => a + x.value, 0);
            return {
                art: wall(report.art, 18),
                headline: trEm('stores_head', { n: n(total), s: n(s.list.length) }),
                body: `${bars(s.list, { logos: true })}${s.multiStore ? `<p class="sub">${esc(tr('stores_multi', { n: n(s.multiStore) }))}</p>` : ''}`,
                stat: { value: n(s.list.length), label: tr('stores') },
            };
        },
        backlog(s) {
            return {
                art: wall((s.quickWins.length ? s.quickWins : []).concat(report.art || []), 18),
                headline: trEm('backlog_head', { n: n(s.neverPlayed) }),
                body: `<div class="bl-facts">
                    <div class="fact"><b>${n(s.neverPlayedPct)}<small>%</small></b><span>${esc(tr('backlog_share_label'))}</span></div>
                    ${s.backlogHours ? `<div class="fact"><b>${n(s.backlogHours)}<small>${H}</small></b><span>${esc(tr('backlog_hours_label'))}</span></div>` : ''}
                    ${s.wantToPlay ? `<div class="fact"><b>${n(s.wantToPlay)}</b><span>${esc(tr('backlog_want_label', { h: n(s.wantHours) }))}</span></div>` : ''}
                </div>
                ${s.quickWins.length ? `<h4>${esc(tr('backlog_quick'))}</h4><ul class="shelf small">${s.quickWins.map(g => `<li>${cover(g)}<span class="st">${esc(g.title)}</span><span class="sv">${esc(tr('backlog_to_beat', { h: n(g.hltb) }))}</span></li>`).join('')}</ul>` : ''}`,
                stat: { value: n(s.neverPlayed), label: tr('backlog') },
            };
        },
        ratings(s) {
            return {
                art: backdrop(s.best[0] && (s.best[0].hero || s.best[0].shot), 'hero'),
                headline: trEm('ratings_head', { avg: n(s.average) }),
                body: `<div class="rt-wrap">
                    <div class="score"><b>${n(s.average)}</b><span>${esc(tr('ratings_sub', { n: n(s.rated) }))}</span></div>
                    <div class="hist">${s.bands.map(b => { const m = Math.max(1, ...s.bands.map(x => x.value)); return `<div class="hb" style="--p:${(b.value / m * 100).toFixed(1)}%"><span class="hv">${n(b.value)}</span><span class="hc"></span><span class="hl">${esc(b.label)}</span></div>`; }).join('')}</div>
                </div>
                <h4>${esc(tr('ratings_best'))}</h4>
                <ul class="shelf">${s.best.map(g => `<li>${cover(g)}<span class="badge">${n(g.score)}</span><span class="st">${esc(g.title)}</span></li>`).join('')}</ul>`,
                stat: { value: n(s.average), label: tr('overview_metacritic') },
            };
        },
        decades(s) {
            const m = Math.max(1, ...s.list.map(x => x.value));
            return {
                art: backdrop(s.oldest && (s.oldest.hero || s.oldest.shot), 'hero'),
                headline: trEm('decades_head', { span: n(s.span) }),
                body: `<div class="hist tall">${s.list.map(d => `<div class="hb" style="--p:${(d.value / m * 100).toFixed(1)}%"><span class="hv">${n(d.value)}</span><span class="hc"></span><span class="hl">${esc(d.label)}</span></div>`).join('')}</div>
                <div class="ends">
                    ${s.oldest ? `<div class="end">${cover(s.oldest)}<div><span class="k">${esc(tr('decades_oldest'))}</span><b>${esc(s.oldest.title)}</b><span class="y">${s.oldest.year}</span></div></div>` : ''}
                    ${s.newest ? `<div class="end">${cover(s.newest)}<div><span class="k">${esc(tr('decades_newest'))}</span><b>${esc(s.newest.title)}</b><span class="y">${s.newest.year}</span></div></div>` : ''}
                </div>`,
                stat: { value: n(s.span), label: tr('decades') },
            };
        },
        studios(s) {
            const lead = s.byCount[0];
            return {
                art: wall(report.art, 18),
                headline: trEm('studios_head', { studio: lead.label, n: n(lead.value) }),
                body: `${bars(s.byCount.slice(0, 8))}${s.byHours.length ? `<p class="chips"><span>${esc(tr('studios_hours'))}</span>${s.byHours.slice(0, 3).map(x => `<i>${esc(x.label)} · ${n(x.value)} ${H}</i>`).join('')}</p>` : ''}`,
                stat: { value: lead.label, label: tr('studios'), text: true },
            };
        },
        franchises(s) {
            const lead = s.list[0];
            return {
                art: backdrop(lead.art && (lead.art.hero || lead.art.shot), 'hero'),
                headline: trEm('franchises_head', { n: n(lead.value), series: lead.label }),
                body: `<ul class="series">${s.list.map(f => { const src = img(f.art && (f.art.hero || f.art.shot || f.art.cover), 'hero'); return `<li>${src ? `<img src="${src}" alt="">` : ''}<div><b>${esc(f.label)}</b><span>${esc(tr('franchises_count', { n: n(f.value) }))}</span></div></li>`; }).join('')}</ul>`,
                stat: { value: lead.label, label: tr('franchises'), text: true },
            };
        },
        linux(s) {
            const total = s.tiers.reduce((a, x) => a + x.value, 0) || 1;
            return {
                art: wall(report.art, 18),
                headline: trEm('linux_head', { pct: n(s.readyPct) }),
                body: `<div class="lx">${ring(s.readyPct, '')}<p class="sub">${esc(tr('linux_sub', { n: n(s.rated) }))}</p></div>
                    <div class="stack">${s.tiers.map(t => `<span style="flex:${t.value};--c:${TIER_COLORS[t.label]}"></span>`).join('')}</div>
                    <ul class="legend">${s.tiers.map(t => `<li style="--c:${TIER_COLORS[t.label]}"><i></i>${esc(tr('tier_' + t.label))}<b>${n(t.value)}</b><small>${n(t.value / total * 100)}%</small></li>`).join('')}</ul>`,
                stat: { value: `${n(s.readyPct)}`, unit: '%', label: tr('linux') },
            };
        },
        favourites(s) {
            return {
                art: '',
                headline: trEm('favourites_head', { n: n(s.count) }),
                body: `<div class="favwall">${s.games.slice(0, 12).map((g, i) => `<div style="--i:${i}">${cover(g)}</div>`).join('')}</div>`,
                stat: { value: n(s.count), label: tr('favourites') },
            };
        },
        growth(s) {
            const m = Math.max(1, ...s.months.map(x => x.value));
            const monthName = key => new Intl.DateTimeFormat(lang, { month: 'short' }).format(new Date(`${key}-15T12:00:00`));
            return {
                art: wall(report.art, 18),
                headline: trEm('growth_head', { n: n(s.lastYear) }),
                body: `<div class="hist months">${s.months.map(x => `<div class="hb" style="--p:${(x.value / m * 100).toFixed(1)}%"><span class="hv">${x.value ? n(x.value) : ''}</span><span class="hc"></span><span class="hl">${esc(monthName(x.label))}</span></div>`).join('')}</div>
                    ${s.thisYear ? `<p class="sub">${esc(tr('growth_this_year', { n: n(s.thisYear) }))}</p>` : ''}`,
                stat: { value: n(s.lastYear), label: tr('growth') },
            };
        },
        storage(s) {
            return {
                art: backdrop(s.biggest[0] && (s.biggest[0].hero || s.biggest[0].shot), 'hero'),
                headline: trEm('storage_head', { size: bytes(s.bytes) }),
                body: `<p class="sub">${esc(tr('storage_sub', { n: n(s.installed) }))}</p><h4>${esc(tr('storage_biggest'))}</h4>
                    <ol class="rank">${s.biggest.map((g, i) => `<li style="--p:${(g.bytes / s.biggest[0].bytes * 100).toFixed(2)}%"><span class="rk">${i + 1}</span>${cover(g, 'sm')}<span class="rt">${esc(g.title)}</span><span class="rv">${esc(bytes(g.bytes))}</span><span class="bt"><span class="bf"></span></span></li>`).join('')}</ol>`,
                stat: { value: bytes(s.bytes), label: tr('storage'), text: true },
            };
        },
        emulatte(s) {
            return {
                art: `<div class="bignum">${n(s.systems)}</div>`,
                headline: trEm('emulatte_head', { n: n(s.games), s: n(s.systems) }),
                body: `<p class="sub">${esc(tr('emulatte_sub'))}</p>${bars(s.list.slice(0, 8))}`,
                stat: { value: n(s.games), label: tr('emulatte') },
            };
        },
    };

    const build = id => ({ id, label: tr(id), ...SECTIONS[id](secs[id]) });
    const blocks = picked.filter(id => SECTIONS[id]).map(build);

    // ── Frames ──────────────────────────────────────────────────────────────
    const brand = `<span class="brand"><i></i>clarity</span>`;
    const w = Math.round(Number(opts.size && opts.size.w) || 1080);
    const h = Math.round(Number(opts.size && opts.size.h) || 1350);
    const frameBase = Math.min(w, h) * (w > h * 1.3 ? 0.026 : 0.0235);
    const orient = w > h * 1.15 ? 'land' : h > w * 1.4 ? 'tall' : h < w * 1.12 ? 'sq' : 'port';

    const sectionHtml = (b, where) => `<section class="sec sec-${b.id}${b.isCover ? ' is-cover' : ''}" data-sec="${b.id}">
        ${b.art ? `<div class="art">${b.art}</div>` : ''}
        <div class="sec-in">
            ${b.isCover ? `<div class="cover-head">${brand}<span class="date">${esc(dateStr)}</span></div>
                <h1 class="title">${esc(title || tr('overview'))}</h1>${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}`
            : `<div class="eyebrow">${esc(b.label)}</div><h2 class="headline">${b.headline}</h2>`}
            <div class="sec-body">${b.body}</div>
        </div></section>`;

    let bodyHtml;
    if (layout === 'poster') {
        const stats = blocks.filter(b => !b.isCover).slice(0, 6);
        const lead = blocks.find(b => b.isCover) || null;
        bodyHtml = `<div class="frame poster ${orient}" style="width:${w}px;height:${h}px;font-size:${frameBase.toFixed(2)}px">
            <div class="art">${wall(report.art, 36)}</div><div class="grain"></div>
            <div class="poster-in">
                <div class="cover-head">${brand}<span class="date">${esc(dateStr)}</span></div>
                <h1 class="title">${esc(title || tr('overview'))}</h1>${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
                ${lead ? `<div class="poster-lead">${SECTIONS.overview(secs.overview).body}</div>` : ''}
                <div class="tiles n${stats.length}">${stats.map(b => `<div class="tile"><span class="eyebrow">${esc(b.label)}</span>
                    <b class="${b.stat.text ? 'txt' : ''}">${esc(b.stat.value)}${b.stat.unit ? `<small>${esc(b.stat.unit)}</small>` : ''}</b>
                    <span class="tl">${esc(b.stat.text || b.stat.label === b.label ? '' : b.stat.label)}</span></div>`).join('')}</div>
            </div>
            <div class="frame-foot"><span>${esc(tr('made_with'))}</span></div></div>`;
    } else if (layout === 'cards' || layout === 'cards-strip') {
        const list = opts.only != null ? blocks.filter((_, i) => i === Number(opts.only)) : blocks;
        bodyHtml = `<div class="${layout === 'cards-strip' ? 'strip' : 'cards'}">${list.map(b => {
            const idx = blocks.indexOf(b) + 1;
            return `<div class="frame card ${orient}" style="width:${w}px;height:${h}px;font-size:${frameBase.toFixed(2)}px">
                <div class="grain"></div>
                ${sectionHtml(b, 'card')}
                <div class="frame-foot">${b.isCover ? `<span>${esc(tr('made_with'))}</span>` : `${brand}<span class="ft">${esc(title)}</span>`}<span class="pg">${idx}/${blocks.length}</span></div>
            </div>`;
        }).join('')}</div>`;
    } else {
        bodyHtml = `<main class="doc">${blocks.map(b => sectionHtml(b, 'doc')).join('')}
            <footer class="doc-foot">${brand}<span>${esc(tr('made_with'))} · ${esc(dateStr)}</span></footer></main>`;
    }

    // A saved report inlines its art, and the same cover can appear a dozen times (the wall, a
    // shelf, a ranking). Each repeat would carry its own copy of the image, roughly doubling the
    // file. Repeated images are stored once as a CSS variable and drawn as backgrounds instead.
    let shared = '';
    if (opts.dedupe) {
        const counts = new Map();
        for (const m of bodyHtml.matchAll(/<img (?:class="([^"]*)" )?src="(data:[^"]+)" alt="">/g)) {
            if (/\bmp-logo\b/.test(m[1] || '')) continue;       // a logo needs its intrinsic size
            counts.set(m[2], (counts.get(m[2]) || 0) + 1);
        }
        const names = new Map();
        for (const [url, c] of counts) if (c > 1) names.set(url, `--m${names.size}`);
        bodyHtml = bodyHtml.replace(/<img (?:class="([^"]*)" )?src="(data:[^"]+)" alt="">/g, (all, cls, url) =>
            names.has(url) ? `<i class="im${cls ? ' ' + cls : ''}" style="background-image:var(${names.get(url)})"></i>` : all);
        shared = names.size ? `:root{${[...names].map(([url, name]) => `${name}:url("${url}")`).join(';')}}` : '';
    }

    return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || tr('overview'))}</title>
<style>${fontFaces(style, opts.fonts)}${shared}${css(style, layout)}</style></head>
<body class="L-${layout}${style.light ? ' light' : ''}">${bodyHtml}</body></html>`;
}

function fontFaces(style, fonts = {}) {
    // `fonts` maps a family to [{ data, weight }], resolved by the caller from the bundled files.
    return (style.fonts || []).map(fam => (fonts[fam] || []).map(f =>
        `@font-face{font-family:'${fam}';src:url('${f.data}') format('truetype');font-weight:${f.weight || '100 900'};font-display:block}`).join('')).join('');
}

function css(st, layout) {
    const v = st.vars;
    return `
:root{--bg:${v.bg};--bg2:${v.bg2};--panel:${v.panel};--ink:${v.ink};--muted:${v.muted};--dim:${v.dim};--line:${v.line};
--a1:${v.a1};--a2:${v.a2};--a3:${v.a3};--duo0:${v.duo0};--duo1:${v.duo1};--glow:${v.glow};--r:${v.r};
--display:${st.display},'Sora',system-ui,sans-serif;--dw:${st.displayWeight};--label:${st.label},'Sora',ui-monospace,monospace;--lw:${st.labelWeight};
--body:${st.body},'Sora',system-ui,sans-serif;--num:${st.numeral},'Sora',system-ui,sans-serif;--track:${st.tracking};--ltrack:${st.labelTracking};--lcase:${st.labelCase};
--dvar:${st.displayVariation || 'normal'};--grain:${GRAIN};}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--bg);color:var(--ink);font-family:var(--body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{display:block;max-width:100%}
.im{display:block;background-size:cover;background-position:center;background-repeat:no-repeat}
em{font-style:normal;color:var(--a1)}
h4{font-family:var(--label);font-weight:var(--lw);text-transform:var(--lcase);letter-spacing:var(--ltrack);font-size:.72em;color:var(--muted);margin:1.6em 0 .7em}
.eyebrow{font-family:var(--label);font-weight:var(--lw);text-transform:var(--lcase);letter-spacing:var(--ltrack);font-size:.78em;color:var(--a1);display:flex;align-items:center;gap:.7em}
.eyebrow::before{content:"";width:1.6em;height:2px;background:currentColor;display:inline-block}
.headline{font-family:var(--display);font-weight:var(--dw);font-variation-settings:var(--dvar);letter-spacing:var(--track);line-height:1.02;font-size:2.6em;margin:.35em 0 .6em;text-wrap:balance}
.headline em{background:linear-gradient(100deg,var(--a1),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{color:var(--muted);font-size:.95em;line-height:1.5;max-width:52ch;margin:.2em 0 1em}
.src{color:var(--dim);font-size:.7em;font-family:var(--label);letter-spacing:.06em;margin-top:1.2em}
.brand{font-family:var(--label);text-transform:lowercase;letter-spacing:.14em;font-size:.8em;color:var(--ink);display:inline-flex;align-items:center;gap:.55em;font-weight:var(--lw)}
.brand i{width:.7em;height:.7em;background:var(--a1);display:inline-block;border-radius:calc(var(--r) / 6)}

/* ── Art and effects ───────────────────────────────────────────────── */
.sec,.frame{position:relative;overflow:hidden;isolation:isolate}
.art{position:absolute;inset:0;z-index:-1;pointer-events:none}
.bd,.bd img,.bd .im{position:absolute;inset:0;width:100%;height:100%}
.bd img,.bd .im{object-fit:cover;filter:grayscale(1) contrast(1.15) brightness(${st.light ? '1.08' : '.75'});transform:scale(1.06)}
.bd::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,var(--duo0),var(--duo1));mix-blend-mode:${st.light ? 'screen' : 'color'};opacity:${st.light ? '.55' : '.9'};z-index:1}
.bd::after{content:"";position:absolute;inset:0;z-index:2;background:
  linear-gradient(180deg,color-mix(in srgb,var(--bg) 78%,transparent) 0%,color-mix(in srgb,var(--bg) 38%,transparent) 30%,color-mix(in srgb,var(--bg) 55%,transparent) 50%,var(--bg) 80%)}
.bd-strong::after{background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 82%,transparent) 0%,color-mix(in srgb,var(--bg) 30%,transparent) 32%,color-mix(in srgb,var(--bg) 60%,transparent) 52%,var(--bg) 74%)}
.wall{position:absolute;inset:-25%;display:grid;place-items:center}
.wall-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:1.1em;width:100%;transform:perspective(1600px) rotateX(24deg) rotateZ(-14deg);transform-origin:50% 40%}
.wall-grid img,.wall-grid .im{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:calc(var(--r) / 3);filter:grayscale(1) contrast(1.1) brightness(${st.light ? '1.05' : '.72'})}
.wall::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,var(--duo0),var(--duo1));mix-blend-mode:${st.light ? 'screen' : 'color'};opacity:${st.light ? '.5' : '.85'};z-index:1}
.wall::after{content:"";position:absolute;inset:0;z-index:2;background:
  radial-gradient(90% 60% at 30% 30%,var(--glow),transparent 60%),
  linear-gradient(180deg,color-mix(in srgb,var(--bg) 70%,transparent) 0%,color-mix(in srgb,var(--bg) 45%,transparent) 30%,var(--bg) 72%)}
.frame .art::before,.poster .art::after{content:"";position:absolute;left:0;right:0;top:0;height:24%;z-index:3;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 96%,transparent) 0%,color-mix(in srgb,var(--bg) 70%,transparent) 45%,transparent)}
.mosaic{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);opacity:${st.light ? '.35' : '.5'}}
.mosaic img,.mosaic .im{width:100%;height:100%;object-fit:cover;filter:grayscale(1) contrast(1.2)}
.mosaic::after{content:"";position:absolute;inset:0;background:linear-gradient(135deg,var(--duo0),var(--duo1));mix-blend-mode:${st.light ? 'screen' : 'color'}}
.mosaic::before{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,var(--bg) 35%,${st.light ? 'rgba(238,241,245,.7)' : 'rgba(0,0,0,.55)'} 100%)}
.grain{position:absolute;inset:0;background-image:var(--grain);opacity:${st.light ? '.10' : '.16'};mix-blend-mode:overlay;pointer-events:none;z-index:5}

/* ── Covers ────────────────────────────────────────────────────────── */
.cv{width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:calc(var(--r) / 2.5);background-color:var(--bg2);box-shadow:0 .9em 2em -1em rgba(0,0,0,.7)}
.cv-none{display:grid;place-items:center;padding:.5em;text-align:center;font-size:.6em;color:var(--dim);border:1px solid var(--line)}
.cv.sm{width:2.3em;flex:none}

/* ── Charts ────────────────────────────────────────────────────────── */
.bars{list-style:none;display:grid;gap:.55em}
.bars li{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto .42em;column-gap:1em;row-gap:.3em;align-items:end}
.bl{font-size:.9em;display:flex;align-items:center;gap:.5em;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bv{font-family:var(--num);font-weight:700;font-size:1em;font-variant-numeric:tabular-nums}
.bv small,.rv small{font-weight:400;color:var(--muted);margin-left:.12em;font-size:.72em}
.bt{grid-column:1/-1;height:.42em;background:var(--line);border-radius:1em;overflow:hidden}
.bf{display:block;height:100%;width:var(--p);background:var(--bar,linear-gradient(90deg,var(--a1),var(--a2)));border-radius:1em}
.logo{width:1.1em;height:1.1em;background:var(--ink);-webkit-mask-size:contain;-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;flex:none}
.rank,.prog{list-style:none;display:grid;gap:.5em}
.rank li,.prog li{display:grid;grid-template-columns:auto auto 1fr auto;grid-template-rows:auto .32em;column-gap:.7em;row-gap:.35em;align-items:center}
.rank .cv.sm,.prog .cv.sm{grid-row:1/3}
.rk{font-family:var(--num);font-weight:700;color:var(--dim);width:1.4em;text-align:right;grid-row:1/3;font-variant-numeric:tabular-nums}
.rt{font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.rv{font-family:var(--num);font-weight:700;font-variant-numeric:tabular-nums}
.rank .bt,.prog .bt{grid-column:3/5;height:.32em}
.ring{--sz:9em;width:var(--sz);height:var(--sz);border-radius:50%;flex:none;display:grid;place-items:center;
  background:conic-gradient(var(--a1) 0,var(--a2) calc(var(--p) * 1%),var(--line) 0)}
.ring-in{width:78%;height:78%;border-radius:50%;background:var(--bg);display:grid;place-items:center;text-align:center}
.ring b{font-family:var(--num);font-weight:800;font-size:2.4em;letter-spacing:var(--track);line-height:1}
.ring b small{font-size:.45em;color:var(--muted);font-weight:500}
.hist{display:flex;align-items:flex-end;gap:.6em;height:9em}
.hist.tall{height:12em}
.hb{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:.35em;min-width:0}
.hc{width:100%;height:var(--p);min-height:2px;background:linear-gradient(180deg,var(--a1),var(--a2));border-radius:calc(var(--r) / 4) calc(var(--r) / 4) 0 0}
.hv{font-family:var(--num);font-weight:700;font-size:.85em;font-variant-numeric:tabular-nums}
.hl{font-family:var(--label);font-size:.72em;color:var(--muted);letter-spacing:.06em;white-space:nowrap}
.stack{display:flex;height:1em;border-radius:1em;overflow:hidden;gap:3px;margin:1.2em 0 .9em}
.stack span{background:var(--c)}
.legend{list-style:none;display:flex;flex-wrap:wrap;gap:.5em 1.3em;font-size:.82em}
.legend li{display:flex;align-items:center;gap:.4em}
.legend i{width:.7em;height:.7em;border-radius:50%;background:var(--c)}
.legend b{font-family:var(--num);font-variant-numeric:tabular-nums}
.legend small{color:var(--dim)}
.chips{display:flex;flex-wrap:wrap;gap:.5em;align-items:center;margin-top:1.1em;font-size:.8em}
.chips span{color:var(--muted);font-family:var(--label);text-transform:var(--lcase);letter-spacing:var(--ltrack);font-size:.85em;margin-right:.3em}
.chips i{font-style:normal;border:1px solid var(--line);padding:.35em .8em;border-radius:2em;background:var(--panel)}

/* ── Section bodies ────────────────────────────────────────────────── */
.ov{display:grid;grid-template-columns:repeat(3,1fr);gap:1.4em 1.2em;margin-top:1.4em}
.ov-cell b{font-family:var(--num);font-weight:var(--dw);font-variation-settings:var(--dvar);font-size:2.6em;letter-spacing:var(--track);line-height:1;display:block;font-variant-numeric:tabular-nums}
.ov-cell span{font-family:var(--label);text-transform:var(--lcase);letter-spacing:var(--ltrack);font-size:.66em;color:var(--muted);display:block;margin-top:.5em}
.ov-cell.big b{background:linear-gradient(100deg,var(--a1),var(--a2));-webkit-background-clip:text;background-clip:text;color:transparent}
.title{font-family:var(--display);font-weight:var(--dw);font-variation-settings:var(--dvar);letter-spacing:var(--track);line-height:.95;font-size:4.4em;text-wrap:balance;margin-top:auto}
.subtitle{font-family:var(--label);color:var(--muted);letter-spacing:.08em;margin-top:.6em;font-size:1em}
.cover-head{display:flex;justify-content:space-between;align-items:center;gap:1em}
.date{font-family:var(--label);font-size:.72em;color:var(--ink);letter-spacing:.1em;text-transform:var(--lcase)}
.mp-top{display:flex;align-items:flex-end;justify-content:space-between;gap:1.5em;margin:.2em 0 .6em}
.mp-logo{max-height:5.5em;max-width:62%;object-fit:contain;object-position:left bottom;filter:drop-shadow(0 .4em 1.2em rgba(0,0,0,.6))}
.mp-name{font-family:var(--display);font-weight:var(--dw);font-size:2em;line-height:1.05;max-width:62%}
.mp-hours{display:flex;align-items:baseline;gap:.15em}
.mp-hours b{font-family:var(--num);font-weight:var(--dw);font-variation-settings:var(--dvar);font-size:5.6em;line-height:.85;letter-spacing:var(--track);background:linear-gradient(170deg,var(--ink),var(--a1));-webkit-background-clip:text;background-clip:text;color:transparent}
.mp-hours span{font-size:1.6em;color:var(--muted);font-weight:600}
.shelf{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:1.1em .9em}
.shelf li{position:relative;display:grid;gap:.4em;min-width:0}
.st{font-size:.78em;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sv{font-family:var(--label);font-size:.66em;color:var(--a1);letter-spacing:.04em}
.shelf.small{grid-template-columns:repeat(5,1fr)}
.badge{position:absolute;top:.5em;right:.5em;font-family:var(--num);font-weight:800;font-size:.85em;background:var(--a1);color:var(--bg);padding:.18em .45em;border-radius:calc(var(--r) / 4 + 2px)}
.split{display:grid;grid-template-columns:1fr;gap:.5em 2.4em}
.ach{display:grid;grid-template-columns:auto 1fr;gap:1.4em 2em;align-items:center}
.ach-facts p{font-size:1em;line-height:1.45;color:var(--muted)}
.ach-facts p b{color:var(--ink);font-weight:600}
.ach-perfect{grid-column:1/-1;display:grid;grid-template-columns:repeat(6,1fr);gap:.8em}
.ach-perfect figure{position:relative}
.ach-perfect figcaption{position:absolute;bottom:.45em;left:50%;transform:translateX(-50%);font-family:var(--num);font-weight:800;font-size:.66em;background:var(--a1);color:var(--bg);padding:.12em .5em;border-radius:1em}
.ach-close{grid-column:1/-1}
.bl-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:1.2em;margin:.4em 0 .4em}
.fact b{font-family:var(--num);font-weight:var(--dw);font-variation-settings:var(--dvar);font-size:2.4em;letter-spacing:var(--track);line-height:1;display:block}
.fact b small{font-size:.45em;color:var(--muted);font-weight:500;margin-left:.1em}
.fact span{display:block;color:var(--muted);font-size:.8em;line-height:1.4;margin-top:.45em}
.rt-wrap{display:grid;grid-template-columns:auto 1fr;gap:2em;align-items:end}
.score b{font-family:var(--num);font-weight:var(--dw);font-size:5.4em;line-height:.85;letter-spacing:var(--track);display:block;color:var(--a1)}
.score span{display:block;color:var(--muted);font-size:.8em;margin-top:.6em}
.ends{display:grid;grid-template-columns:1fr 1fr;gap:1.2em;margin-top:1.6em}
.end{display:grid;grid-template-columns:3.4em 1fr;gap:.9em;align-items:center}
.end .k{font-family:var(--label);text-transform:var(--lcase);letter-spacing:var(--ltrack);font-size:.62em;color:var(--a1);display:block}
.end b{display:block;font-size:.95em;line-height:1.25;margin:.2em 0}
.end .y{font-family:var(--num);font-weight:700;color:var(--muted)}
.series{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:.9em}
.series li{position:relative;aspect-ratio:16/10;border-radius:calc(var(--r) / 2);overflow:hidden;display:flex;align-items:flex-end;background:var(--bg2)}
.series img,.series .im{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:saturate(.8) brightness(.62)}
.series li::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.8))}
.series div{position:relative;z-index:1;padding:.8em;color:#fff}
.series b{display:block;font-size:.95em;line-height:1.2}
.series span{font-family:var(--label);font-size:.62em;letter-spacing:.08em;opacity:.8}
.lx{display:grid;grid-template-columns:auto 1fr;gap:1.6em;align-items:center}
.favwall{display:grid;grid-template-columns:repeat(6,1fr);gap:.8em}
.favwall > div:nth-child(odd){transform:translateY(1.2em)}
.hist.months .hl{font-size:.56em}
.bignum{position:absolute;right:-.06em;top:50%;transform:translateY(-58%);font-family:var(--num);font-weight:var(--dw);font-variation-settings:var(--dvar);font-size:24em;line-height:.8;letter-spacing:.02em;color:transparent;-webkit-text-stroke:.012em color-mix(in srgb,var(--a1) 55%,transparent);background:radial-gradient(60% 60% at 60% 50%,var(--glow),transparent 70%);-webkit-background-clip:text;background-clip:text;opacity:.9}
.doc .bignum{font-size:18em}

/* ── Document ──────────────────────────────────────────────────────── */
.L-document{font-size:16px}
.doc{max-width:1120px;margin:0 auto;padding:48px 28px 64px;display:grid;gap:28px}
.doc .sec{border-radius:var(--r);border:1px solid var(--line);background:var(--bg2);padding:clamp(28px,4vw,52px);container:sec/inline-size}
.doc .sec-in{position:relative;z-index:1}
.doc .sec.is-cover{min-height:560px;display:flex;background:var(--bg)}
.doc .sec.is-cover .sec-in{display:flex;flex-direction:column;width:100%}
.doc .sec.is-cover .title{margin-top:auto;padding-top:180px}
.doc .shelf{grid-template-columns:repeat(8,1fr)}
.doc .shelf.small{grid-template-columns:repeat(5,1fr);max-width:720px}
.doc .ov{grid-template-columns:repeat(6,1fr)}
@container sec (min-width: 760px){
  .doc .split{grid-template-columns:1fr 1fr}
  .doc .rank{grid-template-columns:1fr 1fr;column-gap:2.4em}
  .doc .series{grid-template-columns:repeat(3,1fr)}
}
@container sec (max-width: 620px){
  .doc .shelf{grid-template-columns:repeat(4,1fr)}
  .doc .ov{grid-template-columns:repeat(3,1fr)}
  .doc .ach-perfect,.doc .favwall{grid-template-columns:repeat(3,1fr)}
  .doc .bl-facts{grid-template-columns:1fr}
}
.doc-foot{display:flex;justify-content:space-between;align-items:center;color:var(--dim);font-size:.8em;font-family:var(--label);padding:8px 4px}
@media print{
  @page{size:A4;margin:0}
  html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  /* A PDF cannot keep CSS filters or blend modes as vectors, so Chromium rasterises every art
     block to a full-page bitmap: measured, 23.7 MB for this document against 9.8 MB without them.
     Print keeps the mood with a plain translucent tint over full-colour art instead. Gradient-
     clipped numbers also print as boxes, so they fall back to the solid accent. */
  .bd img,.bd .im,.wall-grid img,.wall-grid .im,.mosaic img,.mosaic .im{filter:none!important}
  .bd::before,.wall::before,.mosaic::after{mix-blend-mode:normal!important;opacity:.55!important}
  /* Chromium does not clip 3D-transformed layers at page breaks, so a tilted cover wall paints
     a stray diagonal strip into the margin of the page before it. Print lays the wall flat. */
  .wall{inset:0!important}
  .wall-grid{transform:none!important;grid-template-columns:repeat(8,1fr)!important;gap:.5em!important}
  .headline em,.ov-cell.big b,.mp-hours b{background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;color:var(--a1)!important}
  .doc{max-width:none;padding:22px;gap:18px}
  .doc .sec{break-inside:avoid;page-break-inside:avoid}
  .doc .sec.is-cover{min-height:740px}
}

/* ── Frames (poster and cards) ─────────────────────────────────────── */
.L-poster,.L-cards,.L-cards-strip{margin:0;overflow:hidden}
.frame{background:var(--bg);display:flex;flex-direction:column}
.frame .grain{z-index:6}
.frame-foot{position:absolute;left:0;right:0;bottom:0;z-index:7;display:flex;align-items:center;gap:1em;padding:1.1em 2.2em;font-family:var(--label);font-size:.62em;letter-spacing:.12em;color:var(--dim);text-transform:var(--lcase)}
.frame-foot .brand{font-size:1em}
.frame-foot .ft{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.frame-foot .pg{margin-left:auto;font-variant-numeric:tabular-nums}
.card .sec{position:absolute;inset:0;display:flex}
.card .sec-in{position:relative;z-index:1;display:flex;flex-direction:column;width:100%;padding:2.4em 2.2em 3.6em}
.card .sec-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.card .headline{font-size:2.9em;margin:.4em 0 auto;padding-bottom:.8em}
.card .is-cover .sec-in{justify-content:flex-start}
.card .is-cover .title{font-size:5.2em;margin-top:auto}
.card .is-cover .sec-body{flex:none}
.card .is-cover .ov{grid-template-columns:repeat(3,1fr);margin-top:1.8em}
.card .shelf{grid-template-columns:repeat(4,1fr)}
.card .shelf.small,.card .sec-ratings .shelf{grid-template-columns:repeat(5,1fr);gap:.8em .6em}
.card .sec-ratings .shelf li:nth-child(n+6){display:none}
.card .hist.tall{height:20em}
.L-cards:not(.light) .sub,.L-cards:not(.light) .eyebrow,.L-cards:not(.light) .headline{text-shadow:0 .08em 1.2em rgba(0,0,0,.55)}
.L-cards:not(.light) .headline em{text-shadow:none}
.card .rank{gap:.55em}
.card .rank li:nth-child(n+8){display:none}
.card .ach{grid-template-columns:auto 1fr}
.card .ach-perfect{grid-template-columns:repeat(6,1fr)}
.card .ach-close .prog li:nth-child(n+5){display:none}
.card .split .alt{display:none}
.card .favwall{grid-template-columns:repeat(4,1fr)}
.card .favwall > div:nth-child(n+13){display:none}
.card .series{grid-template-columns:repeat(2,1fr)}
.card .series li:nth-child(n+5){display:none}
.card .mosaic{grid-template-columns:repeat(3,1fr);grid-auto-rows:1fr}
.card .mosaic::before{background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 80%,transparent) 0%,color-mix(in srgb,var(--bg) 45%,transparent) 28%,var(--bg) 64%)}
.card.land .sec-in{padding:2em 2.4em 3em}
.card.land .headline{font-size:2.5em;max-width:62%}
.card.land .sec-body{justify-content:flex-end}
.card.land .mp-logo{max-height:3.4em}
.card.land .mp-hours b{font-size:4.2em}
.card.land .shelf{grid-template-columns:repeat(8,1fr)}
.card.land .shelf.small,.card.land .sec-ratings .shelf{grid-template-columns:repeat(6,1fr)}
.card.land .sec-ratings .shelf li:nth-child(n+6){display:grid}
.card.land .hist.tall{height:11em}
.card.land .rank{grid-template-columns:1fr 1fr;column-gap:2em}
.card.land .rank li:nth-child(n+8){display:grid}
.card.land .rank li:nth-child(n+10){display:none}
.card.land .split{grid-template-columns:1fr 1fr}
.card.land .split .alt{display:block}
.card.land .is-cover .ov{grid-template-columns:repeat(6,1fr)}
.card.land .is-cover .title{font-size:4.2em}
.card.land .favwall{grid-template-columns:repeat(8,1fr)}
.card.land .favwall > div:nth-child(n+9){display:none}
.card.land .series{grid-template-columns:repeat(3,1fr)}
.card.land .series li:nth-child(n+4){display:none}
.card.land .ach-close{display:none}
.card.land .ends{display:none}
.card.tall .sec-in{padding:3.2em 2.2em 4.2em}
.card.tall .headline{font-size:3.2em}
.card.tall .is-cover .title{font-size:5.8em}
.card.tall .rank li:nth-child(n+8){display:grid}
.card.tall .split .alt{display:block}
.card.tall .shelf{grid-template-columns:repeat(3,1fr)}
.card.tall .favwall{grid-template-columns:repeat(3,1fr)}
.card.tall .series{grid-template-columns:1fr 1fr}
.card.tall .series li:nth-child(n+5){display:none}
.card.tall .is-cover .ov{grid-template-columns:repeat(2,1fr)}
.card.port .shelf li:nth-child(n+9),.card.tall .shelf li:nth-child(n+10){display:none}
/* Square: about 80% of a portrait card's height, so every list is cut to fit rather than squeezed. */
.card.sq .headline{font-size:2.5em;padding-bottom:.5em}
.card.sq .sec-in{padding:2em 2.1em 3.2em}
.card.sq .is-cover .title{font-size:4.4em}
.card.sq .mp-logo{max-height:3.6em}
.card.sq .mp-hours b{font-size:4.2em}
.card.sq .rank li:nth-child(n+6),.card.sq .bars li:nth-child(n+7),.card.sq .prog li:nth-child(n+4){display:none}
.card.sq .shelf{grid-template-columns:repeat(4,1fr)}
.card.sq .shelf li:nth-child(n+5){display:none}
.card.sq .shelf.small,.card.sq .sec-ratings .shelf{grid-template-columns:repeat(5,1fr)}
.card.sq .shelf.small li:nth-child(5),.card.sq .sec-ratings .shelf li:nth-child(5){display:grid}
.card.sq .sec-ratings .shelf li:nth-child(n+6),.card.sq .shelf.small li:nth-child(n+6){display:none}
.card.sq .sec-ratings .hist{height:6.5em}
.card.sq .score b{font-size:4.2em}
.card.sq .favwall{grid-template-columns:repeat(6,1fr)}
.card.sq .favwall > div:nth-child(n+13){display:none}
.card.sq .ach-perfect figure:nth-child(n+7){display:none}
.card.sq .ach-close,.card.sq .ends{display:none}
.card.sq .hist.tall{height:13em}
.card.sq .series li:nth-child(n+3){display:none}
.card.sq .series{grid-template-columns:1fr 1fr}
.card.port .ach-perfect figure:nth-child(n+7){display:none}

/* Poster */
.poster .art{z-index:0}
.poster .wall{inset:-30% -30% 18% -30%;-webkit-mask-image:linear-gradient(180deg,#000 0%,#000 48%,transparent 82%)}
.poster .wall-grid img,.poster .wall-grid .im{filter:grayscale(1) contrast(1.18) brightness(${st.light ? '1.08' : '1'})}
.poster .wall::before{opacity:${st.light ? '.55' : '.78'}}
.poster .wall::after{background:radial-gradient(75% 55% at 38% 28%,var(--glow),transparent 62%),linear-gradient(180deg,color-mix(in srgb,var(--bg) 40%,transparent) 0%,color-mix(in srgb,var(--bg) 10%,transparent) 32%,color-mix(in srgb,var(--bg) 55%,transparent) 62%,var(--bg) 84%)}
.poster .art::after{height:13%}
.poster-in{position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:2.4em 2.2em 3.4em}
.poster .title{font-size:5em;margin-top:auto}
.poster .subtitle{margin-top:.5em}
.poster-lead .ov{grid-template-columns:repeat(3,1fr);margin-top:1.6em}
.poster-lead .ov-cell:nth-child(n+4){display:none}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin-top:1.8em;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}
.tiles.n1{grid-template-columns:1fr}.tiles.n2,.tiles.n4{grid-template-columns:repeat(2,1fr)}
.tile{background:var(--panel);backdrop-filter:blur(14px);padding:1em 1.1em 1.1em;display:flex;flex-direction:column;gap:.35em;min-width:0}
.tile .eyebrow{font-size:.58em}
.tile .eyebrow::before{width:1em}
.tile b{font-family:var(--num);font-weight:var(--dw);font-variation-settings:var(--dvar);font-size:2.3em;letter-spacing:var(--track);line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile b.txt{font-size:1.35em;line-height:1.15;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tile b small{font-size:.45em;color:var(--muted);font-weight:500;margin-left:.1em}
.tile .tl{font-size:.66em;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.poster.land .poster-in{display:grid;grid-template-columns:1fr 1.05fr;grid-template-rows:auto 1fr auto;column-gap:2.4em;padding:2.2em 2.4em 3em}
.poster.land .cover-head{grid-column:1/-1}
.poster.land .title{grid-column:1;align-self:end;font-size:4.2em}
.poster.land .subtitle{grid-column:1}
.poster.land .poster-lead{display:none}
.poster.land .tiles{grid-column:2;grid-row:2/4;align-self:end}
.poster.land .wall{inset:-40% -10% -40% -30%}
.poster.tall .title{font-size:5.6em}
.poster.tall .tiles{grid-template-columns:repeat(2,1fr)}

/* Preview strip */
.strip{display:flex;flex-wrap:wrap;gap:48px;padding:48px;zoom:.3;background:var(--bg)}
.L-cards-strip{overflow:auto}
`;
}

module.exports = { renderReport, STYLES: Object.keys(STYLES).concat('theme') };
