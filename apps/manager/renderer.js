let allGames = [];
let allPlaylists        = [];
let currentPlaylistId   = null;
let currentPlaylistGames = null;
let currentGameId = null;

function isManualCategory(game) {
    if (game.InstallerGameId) return false;
    const s = (game.Store || '').toLowerCase();
    return !/steam|epic|gog|itch|flatpak|pico/.test(s);
}

function openAddCmdDialog(gameId, gameName) {
    const modal = document.getElementById('modal-add-cmd');
    const input = document.getElementById('add-cmd-input');
    document.getElementById('add-cmd-newgame-wrap').style.display = 'none';
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 50);
    document.getElementById('add-cmd-save').onclick = async () => {
        const cmd = input.value.trim();
        if (!cmd) return;
        await window.api.setLaunchCommand(gameId, cmd);
        modal.classList.remove('active');
        await loadGames();
    };
    document.getElementById('add-cmd-cancel').onclick = () => modal.classList.remove('active');
}

function openAddGameDialog() {
    const modal   = document.getElementById('modal-add-cmd');
    const nameWrap = document.getElementById('add-cmd-newgame-wrap');
    const nameInput = document.getElementById('add-cmd-new-name');
    const cmdInput  = document.getElementById('add-cmd-input');
    nameWrap.style.display = 'block';
    nameInput.value = '';
    cmdInput.value  = '';
    modal.classList.add('active');
    setTimeout(() => nameInput.focus(), 50);
    const close = () => { nameWrap.style.display = 'none'; modal.classList.remove('active'); };
    document.getElementById('add-cmd-save').onclick = async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        const result = await window.api.addGame(name);
        if (!result.success) { await showAlert(t('alert.add_failed')); return; }
        const cmd = cmdInput.value.trim();
        if (cmd) await window.api.setLaunchCommand(result.id, cmd);
        close();
        await loadGames();
    };
    document.getElementById('add-cmd-cancel').onclick = close;
    document.getElementById('add-cmd-installer').onclick = async () => {
        const name = nameInput.value.trim();
        close();
        if (name) { const r = await window.api.addGame(name); if (r.success) await loadGames(); }
    };
}

function _isInstallerGame(game) {
    const store = (game.Store || '').toLowerCase();
    return store.includes('gog') || store.includes('epic') || /installer:\/\/launch/i.test(game.LaunchCommand || '');
}

function getInstallCommand(game) {
    if (_isInstallerGame(game)) return null; // GOG/Epic install via Installer, not a URL
    const cmd = game.LaunchCommand || '';
    const store = (game.Store || '').toLowerCase();
    const appId = game.SteamAppID ? String(game.SteamAppID).replace(/\.0+$/, '').trim() : '';
    if (appId && appId !== 'None' && (store.includes('steam') || /steam:\/\/rungameid/i.test(cmd))) {
        return `steam://install/${appId}`;
    }
    return null;
}

// Clean Steam AppID (strips trailing ".0", rejects empty/"None"); '' when not a Steam title.
function _steamAppId(game) {
    const id = game && game.SteamAppID ? String(game.SteamAppID).replace(/\.0+$/, '').trim() : '';
    return (id && id !== 'None') ? id : '';
}

// ⚠️ A SteamAppID does NOT mean the game is owned on Steam. The scrapers attach one to
// anything they can match by name, so a GOG-only or itch title carries a Steam id purely
// for metadata and artwork, 224 of them in Jose's library. Ownership lives in `Store`,
// which is a comma list ("Steam, GOG", "GOG, Steam", "Others, Steam"), so Steam actions
// are gated on the store, and the id is only used to build the deep link once that holds.
function _isOnSteam(game) {
    return (game?.Store || '').toLowerCase().split(',').some(s => s.trim() === 'steam');
}

// ── "Open in Steam" dropdown, deep-links into the Steam client via steam:// URLs ──
function _closeSteamMenu() {
    document.getElementById('steam-menu')?.remove();
    document.removeEventListener('click', _steamMenuOutside, true);
}
function _steamMenuOutside(e) {
    if (e.target.closest('#steam-menu') || e.target.closest('#btn-gamepage-steam')) return;
    _closeSteamMenu();
}
function openSteamMenu(anchorBtn, appId) {
    _closeSteamMenu();
    const items = [
        { label: 'Open game page', url: `steam://nav/games/details/${appId}` },
        { label: 'Game properties', url: `steam://gameproperties/${appId}` },
        { label: 'Store page',      url: `steam://store/${appId}` },
        { label: 'Verify files',    url: `steam://validate/${appId}` },
    ];
    const menu = document.createElement('div');
    menu.id = 'steam-menu';
    menu.className = 'steam-menu';
    menu.innerHTML = items.map(it => `<button class="steam-menu-item" data-url="${it.url}">${it.label}</button>`).join('');
    document.body.appendChild(menu);
    const r = anchorBtn.getBoundingClientRect();
    let left = r.right - menu.offsetWidth;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    menu.addEventListener('click', (e) => {
        const b = e.target.closest('.steam-menu-item');
        if (!b) return;
        window.api.openExternal(b.dataset.url);
        _closeSteamMenu();
    });
    setTimeout(() => document.addEventListener('click', _steamMenuOutside, true), 0);
}

// ── Which screen games open on ───────────────────────────────────────────────
// Two backends behind one interface: a KWin script on KDE, Hyprland window rules on
// Hyprland (see packages/core/hypr-display.js). The card appears wherever one of them
// reports isSupported() and stays away everywhere else rather than showing a setting
// that cannot work. Nothing inside a game decides which monitor it lands on under
// Wayland. The compositor does.
async function initDisplayPicker() {
    const card = document.getElementById('display-card');
    const sel = document.getElementById('display-select');
    if (!card || !sel) return;

    let opts = null;
    try { opts = await window.api.displayOptions(); } catch (e) {}

    // ⚠️ Unsupported means REMOVE, not hide. This card ships with an inline display:none,
    // and the Control Panel used to reset `display` on every .tools-section in three places,
    // so hiding it lasted exactly until the panel was opened. Those resets went with the
    // settings search in wave 2A, so hiding would hold now, removal is kept because it is
    // still the honest answer. This used to remove the card on Hyprland too, because the
    // only backend was a KWin script; Hyprland has its own backend now, so the card appears
    // there and is removed only where neither compositor is running.
    //
    // Having only one screen is different: the feature works, there is just nothing to
    // choose, and plugging a second monitor in makes it meaningful again. Hiding is right
    // there, but it has to survive the same reset, so it is removed too and comes back on
    // the next start, which is when a newly plugged monitor would be noticed anyway.
    if (!opts || !opts.supported || opts.displays.length < 2) { card.remove(); return; }

    card.style.display = '';
    // ⚠️ Compositor-neutral wording: the same card now backs onto KWin or Hyprland.
    sel.innerHTML = '<option value="">Default &mdash; let the desktop decide</option>';
    for (const d of opts.displays) {
        const o = document.createElement('option');
        o.value = String(d.index);
        // The connector name alone means nothing to most people; the size is what makes a
        // monitor recognisable.
        o.textContent = `${d.name}${d.mode ? `, ${d.mode}${d.hz ? `@${d.hz}Hz` : ''}` : ''}${d.primary ? ' (primary)' : ''}`;
        if (opts.current === d.index) o.selected = true;
        sel.appendChild(o);
    }

    const status = document.getElementById('display-status');
    sel.onchange = async () => {
        const v = sel.value === '' ? null : Number(sel.value);
        status.style.color = 'var(--text_dim)';
        status.textContent = 'Applying…';
        const res = await window.api.setGameDisplay(v);
        if (!res || !res.ok) {
            status.style.color = '#ef5350';
            status.textContent = (res && res.error) || 'Could not change it.';
            return;
        }
        status.style.color = '#66bb6a';
        // Two separate things happened on Hyprland, and only one of them is a window rule,
        // say so, because the second one changed something about the X session.
        const xNote = res.xPrimary?.ok ? ` ${res.display.name} is now the primary screen for X11 games too.` : '';
        status.textContent = res.display
            ? `Games will open on ${res.display.name}. Takes effect on the next game you start.${xNote}`
            : 'Back to letting the desktop decide.';
    };
}
initDisplayPicker();

// ── Fan games & source ports ─────────────────────────────────────────────────
// The catalogue of things installable from a file the user already downloaded. Each entry
// states where to get the download and what it is called, because "go find a source port"
// is the step that actually stops people, and then reports whether the game data it needs
// was located in their own library, which is the half worth automating.
let _customRecipes = [];

async function openCustomInstallModal() {
    const modal = document.getElementById('modal-custom');
    const list = document.getElementById('custom-list');
    list.innerHTML = `<div class="hc-empty">Loading&hellip;</div>`;
    modal.classList.add('active');
    _customRecipes = await window.api.customRecipeList() || [];
    document.getElementById('custom-search').value = '';
    renderCustomList(_customRecipes);
}

// Grouped by the game they belong to, because that is how anyone looks for them: you come
// here wanting "something for Doom", not "a source port". Ports, mods and fan games for the
// same game sit together, and the kind chip on each row still says which is which.
const CUSTOM_GROUP_ORDER = ['Doom', 'Quake', 'Wolfenstein 3D', 'Build engine games', 'OutRun'];
function _customGroupOf(r) {
    if (r.kind === 'OpenBOR') return 'OpenBOR';
    return r.game || 'Standalone games';
}

// Opens folded: the catalogue is long enough that a wall of entries buries the shape of
// it, and the group names are the fastest way to find what you came for. A search is the
// exception, hiding matches behind a closed header would defeat the search.
function renderCustomList(recipes, { collapsed = true } = {}) {
    const list = document.getElementById('custom-list');
    list.innerHTML = '';
    if (!recipes.length) { list.innerHTML = `<div class="hc-empty">Nothing matches that.</div>`; return; }

    const groups = new Map();
    for (const r of recipes) {
        const g = _customGroupOf(r);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
    }
    const names = [...groups.keys()].sort((a, b) => {
        const ia = CUSTOM_GROUP_ORDER.indexOf(a), ib = CUSTOM_GROUP_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });

    for (const name of names) {
        const rows = groups.get(name);
        const head = document.createElement('div');
        head.className = 'ci-group';
        head.innerHTML = `<span class="ci-group-caret">${collapsed ? '▸' : '▾'}</span><span>${escHtml(name)}</span><span class="ci-group-n">${rows.length}</span>`;
        const body = document.createElement('div');
        body.className = 'ci-group-body';
        if (collapsed) body.style.display = 'none';
        head.onclick = () => {
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            head.querySelector('.ci-group-caret').textContent = hidden ? '▾' : '▸';
        };
        list.appendChild(head);
        list.appendChild(body);
        for (const r of rows) body.appendChild(_customRow(r));
    }
}

function _customRow(r) {
    {
        const row = document.createElement('div');
        row.className = 'ci-row';

        // Data status is the thing worth saying loudest: it decides whether this install
        // will produce something playable, and the user can act on it.
        let dataLine = '';
        if (r.data) {
            if (r.data.ready) {
                dataLine = `<div class="ci-meta">Game data: <span class="ci-ok">ready</span> &mdash; from your copy of ${escHtml(r.data.from)}</div>`;
            } else if (r.data.userSupplied) {
                // Never sold in a form a library can hold. Saying "not found in your
                // library" would read as a fault and send the user looking for a purchase
                // that does not exist.
                dataLine = `<div class="ci-meta">Game data: <span style="color:var(--text_sec);">you provide it</span> &mdash; ${escHtml(r.data.message || '')} You will be asked for the folder during install.</div>`;
            } else {
                dataLine = `<div class="ci-meta">Game data: <span class="ci-warn">${escHtml(r.data.label)} needed</span> &mdash; ${escHtml(r.data.message || '')}${
                      r.data.owned && r.data.owned.length ? ` <span style="color:var(--text_sec);">(you own: ${escHtml(r.data.owned.slice(0, 3).join(', '))})</span>` : ''
                    }<br><span style="color:var(--text_sec);">Or install anyway and point at a folder holding your own copy of the game files.</span></div>`;
            }
        }

        // Mods need an engine. Say so up front, including that we will install it in the
        // same click, so "two file dialogs" is expected rather than a surprise.
        let engineLine = '';
        if (r.engineNames) {
            engineLine = r.engineReady
                ? `<div class="ci-meta">Engine: <span class="ci-ok">${escHtml(r.engineTitle)} ready</span></div>`
                : `<div class="ci-meta">Engine: <span class="ci-warn">${escHtml(r.engineNames.join(' or '))} needed</span> &mdash; you will be asked for that download first, then this one.</div>`;
        }

        row.innerHTML =
            `<div class="ci-head"><span class="ci-title">${escHtml(r.title)}</span><span class="ci-kind">${escHtml(r.kind)}</span>${
                r.game ? `<span class="ci-kind">for ${escHtml(r.game)}</span>` : ''}</div>` +
            `<div class="ci-blurb">${escHtml(r.blurb)}</div>` +
            (r.source.url
                ? `<div class="ci-meta">Get it from <a href="#" data-url="${escHtml(r.source.url)}">${escHtml(r.source.name)}</a><br>${escHtml(r.source.hint)}</div>`
                : `<div class="ci-meta">${escHtml(r.source.hint)}</div>`) +
            engineLine +
            dataLine +
            `<div class="ci-actions"></div>`;

        const actions = row.querySelector('.ci-actions');
        const btn = document.createElement('button');
        btn.className = 'primary';
        // A shape-based entry is never "reinstalled", every OpenBOR archive is a different
        // game arriving through the same recipe, so it always reads as adding one.
        btn.textContent = r.folder ? 'CHOOSE A FOLDER'
                        : r.dynamic ? 'ADD FROM FILE'
                        : r.onEngine ? (r.installed ? 'REINSTALL' : 'INSTALL')
                        : (r.installed ? 'REINSTALL' : 'INSTALL FROM FILE');
        btn.onclick = r.folder
            ? () => addWindowsGameFromFolder().catch(e => showAlert(`Something went wrong.\n\n${e && e.message ? e.message : e}`))
            : () => runCustomInstall(r, btn);
        actions.appendChild(btn);
        const tagText = r.dynamic
            ? (r.installedCount ? `${r.installedCount} INSTALLED` : '')
            : (r.installed ? 'INSTALLED' : '');
        if (tagText) {
            const tag = document.createElement('span');
            tag.className = 'ci-installed';
            tag.textContent = tagText;
            actions.appendChild(tag);
        }

        row.querySelector('a[data-url]')?.addEventListener('click', (e) => {
            e.preventDefault();
            window.api.openExternal(e.target.dataset.url);
        });
        return row;
    }
}

// Free-text filter over the whole catalogue, title, kind, game and blurb, so "quake",
// "mod" and "openbor" all find what you would expect.
document.getElementById('custom-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderCustomList(_customRecipes); return; }        // back to folded
    renderCustomList(
        _customRecipes.filter(r => [r.title, r.kind, r.game, r.blurb]
            .some(v => String(v || '').toLowerCase().includes(q))),
        { collapsed: false });                                    // matches must be visible
});

// ── Adding a Windows game from a folder you already have ─────────────────────
// The same machinery, minus the download: scan for what could start the game, let the user
// confirm which, and register the folder where it sits without copying anything.
async function addWindowsGameFromFolder() {
    const picked = await window.api.customFolderPick();
    if (!picked || !picked.ok) return;

    const scan = await window.api.customFolderScan(picked.path);
    if (!scan || !scan.ok) { showAlert((scan && scan.error) || 'Could not read that folder.'); return; }
    if (!scan.entries.length) {
        showAlert('Nothing in that folder looks like it starts a game, no .exe, .bat or .sh was found.');
        return;
    }

    const chosen = await pickRunOptions({
        title: 'Add a game from a folder',
        okLabel: 'Add to Library',
        radios: {
            header: 'What starts the game?',
            hint: 'Best guess first. A .bat is sometimes the real entry point. It can carry the command line a mod needs, and sometimes just a utility, so check the name.',
            items: scan.entries.map(e => ({
                value: e.rel,
                label: e.name + (e.bat ? '   (batch file)' : ''),
                sub: `${e.dir ? e.dir + ' · ' : ''}${_fmtBytes(e.size)}${e.junk ? ' · probably not the game' : ''}`,
            })),
        },
        nameInput: { label: 'Name in your library', value: scan.suggestedTitle },
    });
    if (!chosen || !chosen.choice) return;

    const res = await window.api.customFolderAdd({
        folder: picked.path, executable: chosen.choice, title: chosen.name || scan.suggestedTitle,
    });
    if (!res || !res.ok) { showAlert((res && res.error) || 'Could not add that folder.'); return; }
    showAlert(`${res.title} was added to your library.\n\nIt runs ${res.executable} from the folder where it already lives, nothing was copied.`);
    loadGames();
}

document.getElementById('btn-custom-folder')?.addEventListener('click', () =>
    addWindowsGameFromFolder().catch(e => showAlert(`Something went wrong.\n\n${e && e.message ? e.message : e}`)));

// Which files out of a mod archive should actually be loaded. Resolves to an array of
// archive-relative paths, or null if the user backed out. The biggest file is ticked
// because in every pack seen so far that is the mod itself and the rest are extras.
// One dialog for every "before we go, which one?" question in this feature: which files
// out of a mod pack to load, which Doom to run it on, which executable in a folder starts
// the game. Sections appear only when there is something to ask.
//   checks, multi-select list   {header, hint, items:[{value,label,sub,checked}]}
//   radios, single-select list  {header, hint, items:[{value,label,sub}], current}
//   nameInput, optional free text {label, value}
// Resolves to {selected:[], choice:'', name:''} or null if cancelled.
function pickRunOptions({ title, okLabel = 'Install Selected', checks = null, radios = null, nameInput = null }) {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-modpick');
        const list = document.getElementById('modpick-list');
        const radioWrap = document.getElementById('modpick-iwad-wrap');
        const radioList = document.getElementById('modpick-iwad-list');
        const nameWrap = document.getElementById('modpick-name-wrap');
        const nameEl = document.getElementById('modpick-name');
        document.getElementById('modpick-title').textContent = title;
        document.getElementById('btn-modpick-ok').textContent = okLabel;
        list.innerHTML = '';
        radioList.innerHTML = '';

        const rowFor = (type, group, o, checked) => {
            const row = document.createElement('label');
            row.className = 'mp-row';
            const input = document.createElement('input');
            input.type = type;
            if (group) input.name = group;
            input.value = o.value;
            input.checked = !!checked;
            const txt = document.createElement('div');
            txt.innerHTML = `<div class="mp-name">${escHtml(o.label)}</div>` +
                            (o.sub ? `<div class="mp-sub">${escHtml(o.sub)}</div>` : '');
            row.appendChild(input);
            row.appendChild(txt);
            return row;
        };

        const filesWrap = document.getElementById('modpick-files-wrap');
        filesWrap.style.display = checks ? '' : 'none';
        if (checks) {
            document.getElementById('modpick-files-head').textContent = checks.header;
            document.getElementById('modpick-files-hint').textContent = checks.hint || '';
            checks.items.forEach((o, i) => list.appendChild(rowFor('checkbox', '', o, o.checked ?? i === 0)));
        }

        radioWrap.style.display = radios ? '' : 'none';
        if (radios) {
            document.getElementById('modpick-iwad-head').textContent = radios.header;
            document.getElementById('modpick-iwad-hint').textContent = radios.hint || '';
            radios.items.forEach((o, i) => radioList.appendChild(
                rowFor('radio', 'modpick-radio', o, radios.current ? o.value === radios.current : i === 0)));
            // The remembered choice may no longer exist, never leave the list unanswered.
            if (radios.items.length && !radioList.querySelector('input:checked')) {
                radioList.querySelector('input').checked = true;
            }
        }

        nameWrap.style.display = nameInput ? '' : 'none';
        if (nameInput) {
            document.getElementById('modpick-name-head').textContent = nameInput.label;
            nameEl.value = nameInput.value || '';
        }

        const done = (val) => {
            modal.classList.remove('active');
            document.getElementById('btn-modpick-ok').onclick = null;
            document.getElementById('btn-modpick-cancel').onclick = null;
            resolve(val);
        };
        document.getElementById('btn-modpick-ok').onclick = () => done({
            selected: checks ? [...list.querySelectorAll('input:checked')].map(i => i.value) : [],
            choice: radios ? (radioList.querySelector('input:checked')?.value ?? '') : undefined,
            name: nameInput ? nameEl.value.trim() : '',
        });
        document.getElementById('btn-modpick-cancel').onclick = () => done(null);
        modal.classList.add('active');
        if (nameInput) setTimeout(() => nameEl.focus(), 30);
    });
}

async function runCustomInstall(recipe, btn) {
    const label = btn.textContent;
    // Anything thrown on the main side arrives here as a rejected invoke. Unhandled, that
    // is a button that does nothing at all, the worst possible failure, because there is
    // nothing to report and nowhere to look. Every path below either succeeds or says why.
    try {
        // A game on a shared engine has nothing to download. It is assembled from an
        // engine that is already here (or asked for once) plus the game's own data.
        let archivePath = null;
        if (!recipe.onEngine || recipe.needsArchive) {
            const picked = await window.api.customInstallPick(recipe.id);
            if (!picked || !picked.ok) return;   // cancelled the file dialog
            archivePath = picked.path;
        }

        btn.disabled = true;
        btn.textContent = 'INSTALLING…';
        let res = await window.api.customInstall({ recipeId: recipe.id, archivePath });

        // The mod needs an engine and there isn't one yet. Ask for that download too and
        // install both in this one click, rather than sending the user away to do it
        // themselves, installing GZDoom was never the thing they wanted.
        // The library has no copy of the data, but the user very likely does, on a shelf
        // or in a folder from a disc they still own. Offer that rather than dead-ending:
        // for anything the storefronts never sold, it is the only route there is.
        if (res && !res.ok && res.needsData) {
            // When the data was never sold in a form a library can hold, asking "do you
            // have it?" is a wasted click, the folder picker is the only route anyway.
            if (!res.userSupplied) {
                const ok = await showConfirm(
                    `${recipe.title} needs ${res.dataLabel}.\n\n${res.error}\n\nDo you have those game files in a folder? Point at it and they will be used.`,
                    'Choose folder', false);
                if (!ok) return;
            }
            const folder = await window.api.customFolderPick(`Select the folder containing ${res.dataLabel}`);
            if (!folder || !folder.ok) return;
            btn.textContent = 'INSTALLING…';
            res = await window.api.customInstall({ recipeId: recipe.id, archivePath, dataPath: folder.path });
        }

        if (res && !res.ok && res.needsEngine) {
            const names = res.engines.map(e => e.title).join(' or ');
            const ok = await showConfirm(`${recipe.title} runs on ${names}, which isn't installed yet.\n\nPick your ${names} download next and both will be installed together.`, 'Choose file', false);
            if (!ok) return;
            const eng = await window.api.customInstallPick(res.engines[0].id);
            if (!eng || !eng.ok) return;
            btn.textContent = 'INSTALLING…';
            res = await window.api.customInstall({ recipeId: recipe.id, archivePath, engineArchivePath: eng.path });
        }

        // Reinstalling over an existing folder is a decision, not a default, ask rather
        // than silently deleting whatever is already there.
        // The archive holds several loadable files, Black Edition ships the mod plus
        // thirty-odd optional voice and footstep packs. Which one is "the mod" is not
        // something to guess at, so ask, with the largest pre-ticked.
        if (res && !res.ok && res.choose) {
            const chosen = await pickRunOptions({
                title: `${recipe.title}, what should load?`,
                okLabel: 'Install Selected',
                checks: {
                    header: 'Files to load',
                    hint: 'This download contains more than one loadable file. The largest is usually the mod itself; the rest are normally optional extras. Load order follows the file names.',
                    items: res.choose.map(c => ({
                        value: c.rel, label: c.name,
                        sub: `${_fmtBytes(c.size)}${c.dir && c.dir !== '.' ? ' · ' + c.dir : ''}`,
                    })),
                },
            });
            if (!chosen || !chosen.selected.length) return;
            btn.textContent = 'INSTALLING…';
            res = await window.api.customInstall({
                recipeId: recipe.id, archivePath, selected: chosen.selected,
            });
        }

        if (res && !res.ok && res.exists) {
            const ok = await showConfirm(`${recipe.title} is already installed.\n\nReplace it? Anything in its folder will be deleted.`, 'Replace', true);
            if (!ok) return;
            res = await window.api.customInstall({ recipeId: recipe.id, archivePath, overwrite: true });
        }

        if (!res || !res.ok) { showAlert((res && res.error) || 'Could not install that.'); return; }

        const bits = [];
        if (res.engineTitle) bits.push(`Running on ${res.engineTitle}.`);
        if (res.modFiles && res.modFiles.length) bits.push(`Loading ${res.modFiles.join(', ')}.`);
        if (res.iwadLabel) bits.push(`You will be asked which Doom to play it on each time you press Play.`);
        if (res.dataFrom) bits.push(`Game data linked from your copy of ${res.dataFrom.title} (${res.dataFrom.linked.join(', ')}).`);
        showAlert(`${res.title} is installed and added to your library.${bits.length ? '\n\n' + bits.join('\n') : ''}`);
        renderCustomList(await window.api.customRecipeList() || []);
        loadGames();
    } catch (e) {
        showAlert(`Something went wrong installing ${recipe.title}.\n\n${e && e.message ? e.message : e}`);
    } finally {
        btn.disabled = false;
        btn.textContent = label;
    }
}

document.getElementById('btn-custom-install')?.addEventListener('click', openCustomInstallModal);
document.getElementById('btn-close-custom')?.addEventListener('click', () => document.getElementById('modal-custom').classList.remove('active'));

// ── Play-task picker ──────────────────────────────────────────────────────────
// A GOG release can ship several ways to start, and the one GOG marks primary is not
// always the one you want: Quake: The Offering starts GLQuake, which reads its music off
// the physical CD and so plays none at all, while the DOS task in the very same install
// plays the soundtrack. The Installer face has always exposed this choice; from the Manager
// there was no way to reach it, which made a whole class of GOG classics quietly worse.
function _closePlayTaskMenu() {
    document.getElementById('playtask-menu')?.remove();
    document.removeEventListener('click', _playTaskMenuOutside, true);
}
function _playTaskMenuOutside(e) {
    if (e.target.closest('#playtask-menu') || e.target.closest('#btn-gamepage-playtask')) return;
    _closePlayTaskMenu();
}
function openPlayTaskMenu(anchorBtn, game, tasks) {
    _closePlayTaskMenu();
    const menu = document.createElement('div');
    menu.id = 'playtask-menu';
    menu.className = 'steam-menu pt-menu';

    for (const t of tasks) {
        const item = document.createElement('button');
        item.className = 'pt-item' + (t.isActive ? ' active' : '');
        item.dataset.index = String(t.index);

        const check = document.createElement('div');
        check.className = 'pt-check';
        check.textContent = t.isActive ? '✓' : '';

        const name = document.createElement('div');
        name.className = 'pt-name';
        name.textContent = t.name + (t.isPrimary ? ', GOG default' : '');
        const sub = document.createElement('div');
        sub.className = 'pt-path';
        sub.textContent = t.path;

        const body = document.createElement('div');
        body.appendChild(name);
        body.appendChild(sub);
        item.appendChild(check);
        item.appendChild(body);
        menu.appendChild(item);
    }
    document.body.appendChild(menu);

    const r = anchorBtn.getBoundingClientRect();
    const left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top  = (r.bottom + 6) + 'px';

    menu.addEventListener('click', async (e) => {
        const b = e.target.closest('.pt-item');
        if (!b) return;
        _closePlayTaskMenu();
        // GOG's own primary is stored as no override at all, so a game left on the default
        // keeps following it if a later update moves what the default is.
        const picked = tasks.find(t => String(t.index) === b.dataset.index);
        if (!picked) return;
        const res = picked.isPrimary
            ? await window.api.setLaunchTarget(game.InstallerGameId, '', null)
            : await window.api.setLaunchTarget(game.InstallerGameId, picked.path, picked.index);
        if (!res || !res.ok) {
            showAlert('Could not save that choice.' + (res?.error ? `\n\n${res.error}` : ''));
            return;
        }
        _refreshPlayTaskBtn(game);
    });
    setTimeout(() => document.addEventListener('click', _playTaskMenuOutside, true), 0);
}

async function _refreshPlayTaskBtn(game) {
    const btn = document.getElementById('btn-gamepage-playtask');
    if (!btn) return;
    btn.style.display = 'none';
    btn.onclick = null;
    btn.classList.remove('active');
    if (!/^gog_/i.test(game.InstallerGameId || '') || game.Installed != 1) return;

    let tasks = [];
    try { tasks = await window.api.playTasks(game.InstallerGameId) || []; } catch (e) {}
    if (currentGameId !== game.id) return;   // gamepage moved on while we were asking
    if (tasks.length < 2) return;            // one way to start is not a choice

    const active = tasks.find(t => t.isActive);
    btn.style.display = 'block';
    // Tinted only when the game is on something other than GOG's default, the button
    // says "this starts the usual way" or "this starts differently" without being opened.
    btn.classList.toggle('active', !!active && !active.isPrimary);
    btn.title = active ? `Starts: ${active.name}, click to change`
                       : `Choose which of the ${tasks.length} versions PLAY starts`;
    btn.onclick = (e) => { e.stopPropagation(); openPlayTaskMenu(btn, game, tasks); };
}

// ── Now Playing popup ─────────────────────────────────────────────────────────
let _npTimer = null;

function showNowPlaying(game) {
    notifyDesktop('Now Playing', game.Game || '', game);   // desktop/phone ping w/ cover
    const modal    = document.getElementById('modal-now-playing');
    const artBg    = document.getElementById('np-art-bg');
    const logoImg  = document.getElementById('np-logo-img');
    const coverImg = document.getElementById('np-cover-img');
    const artWrap  = document.getElementById('np-art');
    const titleEl  = document.getElementById('np-title');
    if (!modal) return;

    titleEl.textContent = game.Game || '';

    const logo  = game.Logo     ? getSafePath(game.Logo)     : null;
    const cover = game.CoverArt ? getSafePath(game.CoverArt) : null;
    const hero  = game.HeroArt  ? getSafePath(game.HeroArt)  : null;

    logoImg.style.display  = 'none';
    coverImg.style.display = 'none';
    artBg.style.backgroundImage = '';

    if (logo) {
        artWrap.style.display = 'flex';
        logoImg.src = logo; logoImg.style.display = '';
        if (cover || hero) artBg.style.backgroundImage = `url('${cover || hero}')`;
    } else if (cover) {
        artWrap.style.display = 'flex';
        coverImg.src = cover; coverImg.style.display = '';
        artBg.style.backgroundImage = `url('${cover}')`;
    } else {
        artWrap.style.display = 'none';
    }

    document.getElementById('np-progress').style.display = 'none';
    document.getElementById('np-bar').style.width = '0%';
    document.getElementById('np-progress-msg').textContent = '';
    _npSetupSeen = false; _npDismissed = false;

    modal.classList.add('active');
    clearTimeout(_npTimer);
    _npTimer = setTimeout(closeNowPlaying, 5000);
}

// Set when the card goes away, so slow-launch progress never yanks it back up in front of
// someone who has already dismissed it and moved on.
let _npDismissed = false;
function closeNowPlaying() {
    clearTimeout(_npTimer);
    _npDismissed = true;
    document.getElementById('modal-now-playing')?.classList.remove('active');
}

// ── Slow-launch progress ─────────────────────────────────────────────────────
// The main process tails a launching game's log (umu runtime download → Wine prefix build →
// game start). A launch where everything is already set up races through every step, so hold
// the card back until the wait is real, otherwise it would flash on every single launch.
let _npSetupSeen = false;
const _NP_SHOW_AFTER = ['runtime', 'prefix', 'extras', 'verify'];   // the phases that actually take minutes
window.api.onGameLaunchProgress(p => {
    if (!p) return;
    const modal = document.getElementById('modal-now-playing');
    const wrap  = document.getElementById('np-progress');
    if (!modal || !wrap) return;

    if (p.done) {
        if (_npSetupSeen) {
            document.getElementById('np-bar').style.width = '100%';
            document.getElementById('np-progress-msg').textContent =
                p.phase === 'running' ? 'Ready. The game is starting.' : '';
            _npTimer = setTimeout(closeNowPlaying, 2500);
        }
        _npSetupSeen = false;
        return;
    }

    if (_npDismissed) return;                                         // user closed it, leave them alone
    if (!_npSetupSeen && !_NP_SHOW_AFTER.includes(p.phase)) return;   // fast launch → stay quiet
    _npSetupSeen = true;

    // A long setup must not be cut off by Now Playing's 5s auto-close.
    clearTimeout(_npTimer);
    modal.classList.add('active');
    wrap.style.display = '';
    document.getElementById('np-bar').style.width = (p.percent || 0) + '%';
    document.getElementById('np-progress-msg').textContent = p.message || '';
});

document.getElementById('modal-now-playing')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-now-playing')) closeNowPlaying();
});
document.getElementById('np-close-btn')?.addEventListener('click', closeNowPlaying);
// ─────────────────────────────────────────────────────────────────────────────

function _guessLabel(cmd) {
    if (!cmd) return 'Custom';
    if (/steam:\/\/rungameid/i.test(cmd))     return 'Steam';
    if (/installer:\/\/launch\/gog/i.test(cmd))  return 'GOG via Installer';
    if (/installer:\/\/launch\/epic/i.test(cmd)) return 'Epic via Installer';
    if (cmd.startsWith('itch://'))            return 'itch.io';
    if (cmd.startsWith('pico8-cart:'))        return 'PICO-8';
    if (/^flatpak run/i.test(cmd))            return 'Flatpak';
    if (cmd.startsWith('installer://'))         return 'Installer';
    return 'Custom';
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Every store a row can be played or installed from, with each one's install state
// (Steam appmanifest / GOG-Epic library.db). Main resolves this from the row's store
// fields, not just LaunchCommands, so a mixed-store row that never got the plural column
// written still lists both stores. [] on failure, callers fall back to the single path.
async function launcherStatesFor(game) {
    try { return await window.api.launcherStates(game.id) || []; } catch (e) { return []; }
}

// `states` comes from launcherStatesFor(). `mode` only picks the wording: the buttons
// always offer Play for a store that's installed and Install for one that isn't.
function showLauncherPicker(game, states, mode = 'launch') {
    const modal = document.getElementById('modal-launcher-pick');
    const list  = document.getElementById('launcher-pick-list');
    list.innerHTML = '';
    const prompt = document.getElementById('launcher-pick-prompt');
    if (prompt) {
        prompt.innerHTML = 'This game is available on multiple stores.<br>' +
            (mode === 'install' ? 'Which one do you want to install from?' : 'Which one do you want to launch?');
    }
    states.forEach(st => {
        // An untracked launcher (flatpak / custom / emulator) has no install state to read,
        // so it counts as playable, its command is the only thing we know about it.
        const installed = st.installed !== false || st.store === null;
        const btn = document.createElement('button');
        btn.className = installed ? 'primary' : 'btn-install-primary';
        btn.style.cssText = 'width:100%; display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 14px; font-size:13px;';
        btn.innerHTML = `<span>${installed ? '▶' : '⤓'} ${escHtml(st.label || st.cmd)}</span>` +
                        `<span style="opacity:.65; font-size:11px;">${installed ? '' : 'Install'}</span>`;
        btn.addEventListener('click', () => {
            modal.classList.remove('active');
            if (installed) { showNowPlaying(game); _doLaunch(game, st.cmd); }
            else _installLauncher(game, st.store || null, st.cmd);
        });
        list.appendChild(btn);
    });
    modal.classList.add('active');
}

// Route an uninstalled launcher in the picker to the right installer for its store.
function _installLauncher(game, store, cmd) {
    if (store === 'steam') {
        const appId = _steamAppId(game);
        if (appId) { window.api.openInstallUrl('steam://install/' + appId); return; }
    }
    if (store === 'gog' || store === 'epic') {
        if (/^(gog|epic)_/i.test(game.InstallerGameId || '')) { openInstallerInstall(game); return; }
        _openCompatFor(game); return;
    }
    _doLaunch(game, cmd); // untracked launcher, best-effort launch
}
document.getElementById('btn-launcher-pick-cancel').addEventListener('click', () => {
    document.getElementById('modal-launcher-pick').classList.remove('active');
});
document.getElementById('modal-launcher-pick').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-launcher-pick'))
        document.getElementById('modal-launcher-pick').classList.remove('active');
});

// A Doom mod runs on whichever Doom you feel like tonight, so the choice belongs at the
// moment you press Play rather than baked in at install time. Returns the launch line to
// use, '' to cancel the launch, or undefined when there is nothing to ask about, which is
// every game that is not a mod with more than one IWAD beside it, so nothing else is slowed
// down by a round trip it does not need.
async function _iwadForLaunch(installerGameId) {
    let opts = null;
    try { opts = await window.api.customIwadOptions(installerGameId); } catch (e) {}
    if (!opts || !opts.iwads || opts.iwads.length < 2) return undefined;

    const chosen = await pickRunOptions({
        title: 'Which Doom?',
        okLabel: 'Play',
        radios: {
            header: 'Which Doom to play it on',
            hint: 'Every Doom you own is linked next to the engine, so this mod can run on any of them.',
            items: opts.iwads.map(i => ({ value: i.file, label: i.label, sub: i.file })),
            current: opts.current,
        },
    });
    if (!chosen) return null;                     // cancelled, do not launch
    // Remembered as the new default so the dialog opens on last night's choice.
    try { await window.api.customSetIwad(installerGameId, chosen.choice); } catch (e) {}
    return opts.argsFor[chosen.choice];
}

// Blood plays on Raze and on BuildGDX, and they are different experiences, one is a
// modern renderer, the other is closer to the DOS original and has its own tuning. If both
// are installed the choice belongs to the moment you press Play, not to install time.
// Returns the executable to run, '' for "as recorded", or null if cancelled.
async function _engineForLaunch(installerGameId) {
    let opts = null;
    try { opts = await window.api.customEngineOptions(installerGameId); } catch (e) {}
    if (!opts || !opts.engines || opts.engines.length < 2) return '';

    const chosen = await pickRunOptions({
        title: 'Which engine?',
        okLabel: 'Play',
        radios: {
            header: 'Run this game on',
            hint: 'Both are installed and both play this game. They render and behave differently, so pick whichever suits tonight.',
            items: opts.engines.map(e => ({ value: e.exe, label: e.title, sub: e.exe })),
            current: opts.current,
        },
    });
    if (!chosen) return null;
    try { await window.api.customSetEngine(installerGameId, chosen.choice); } catch (e) {}
    return chosen.choice;
}

async function _doLaunch(game, cmd) {
    // Route by the actual command so the multi-launcher picker is honoured:
    //  - a installer:// (GOG/Epic) command, or a installer-linked game with no cmd,
    //    launches via Installer's engine in-process
    //  - everything else (steam://, itch://, pico8-cart:, native) launches directly
    const isInstallerCmd = /installer:\/\/launch/i.test(cmd || '');
    if (isInstallerCmd || (!cmd && game?.InstallerGameId)) {
        if (game?.InstallerGameId) {
            const exe = await _engineForLaunch(game.InstallerGameId);
            if (exe === null) return;              // the dialog was cancelled
            const args = await _iwadForLaunch(game.InstallerGameId);
            if (args === null) return;
            window.api.launchGame('installer://launch/' + game.InstallerGameId, args, exe);
        } else {
            _openCompatFor(game);
        }
        Promise.all([window.api.updateLastPlayed(game.id), window.api.verifyInstallStatus(game.id)]).then(() => loadGames());
        return;
    }
    window.api.launchGame(cmd);
    Promise.all([window.api.updateLastPlayed(game.id), window.api.verifyInstallStatus(game.id)]).then(() => loadGames());
}

// ── Global operation toast, keeps install/sync/scrape progress visible even when its modal is hidden ──
let _opToastTimer = null;
function opToast(label, pct) {
    const tEl = document.getElementById('op-toast'); if (!tEl) return;
    clearTimeout(_opToastTimer);
    tEl.classList.add('show');
    if (label != null) document.getElementById('op-toast-label').innerText = label;
    if (typeof pct === 'number') document.getElementById('op-toast-fill').style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function opToastDone(label) {
    const tEl = document.getElementById('op-toast'); if (!tEl) return;
    if (label != null) document.getElementById('op-toast-label').innerText = label;
    document.getElementById('op-toast-fill').style.width = '100%';
    _opToastTimer = setTimeout(() => tEl.classList.remove('show'), 3000);
}
function opToastHide() { const tEl = document.getElementById('op-toast'); if (tEl) { clearTimeout(_opToastTimer); tEl.classList.remove('show'); } }
let _giInstallName = '';

// Redistributable installs report line-by-line with no percentage of their own, so the toast
// carries the current step rather than a bar that would have to be invented. See
// 'installer-run-redist' in main.js for what this is repairing.
let _redistBusy = false;
window.api.onRedistProgress(d => {
    if (!_redistBusy) return;
    if (d && d.done) return;                       // the awaited result reports the outcome
    const line = String((d && d.line) || '').trim();
    if (line) opToast(`Compatibility files: ${line.slice(0, 90)}`);
});

// Live progress for in-process install/uninstall, drives the global toast always,
// plus the modal's inline bar while it's still visible (so 'Hide' keeps progress on screen).
window.api.onInstallerInstallProgress(d => {
    const step = (d.step || '').toUpperCase();
    const pct  = typeof d.percent === 'number' ? d.percent : undefined;

    // Feed the active download's live state (drives the Download Manager card).
    if (_dlActive) {
        if (typeof d.percent === 'number') _dlActive.pct = d.percent;
        if (d.message) _dlActive.message = d.message;
        _dlActive.step = step;
        // A download can hold its transfer rate up while making no progress at all; the
        // engine watches the percentage and tells us when it has stopped moving.
        _dlActive.stalled = !!d.stalled;
        _dlActive.stalledMinutes = d.stalledMinutes || 0;
    }

    if (_dlmOpen) {
        renderDownloadManager();        // manager is open → it owns the display, keep the toast hidden
    } else {
        const name = _dlActive ? _dlActive.name : _giInstallName;
        const label = `${name ? name + ', ' : ''}${step}${d.message ? ': ' + d.message : ''}`;
        if (d.done) opToastDone(label); else opToast(label, pct);   // auto-hide once the engine signals completion/error
    }

    const pr = document.getElementById('gi-progress');
    if (pr && pr.style.display !== 'none') {
        document.getElementById('gi-step').textContent = step;
        if (pct != null) document.getElementById('gi-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (d.message) document.getElementById('gi-msg').textContent = d.message;
    }
});

// ── DOWNLOAD MANAGER (multi-download queue, the same manager as Installer, in CN) ──
// Installs still run one at a time in the engine; this queues extra requests and
// surfaces active/queued/completed in #modal-dlm, opened by clicking the top toast.
let _dlActive = null;        // { gameId, gid, name, store, dir, pct, message, step }
const _dlQueue = [];         // pending: { gameId, gid, name, store, dir }
const _dlHistory = [];       // completed: { name, store, success, error, at }
let _dlmOpen = false;
function _dlStoreOf(gid) { return /^gog_/i.test(gid) ? 'gog' : /^epic_/i.test(gid) ? 'epic' : 'other'; }
function _dlStoreMeta(s) {
    if (s === 'gog')  return { label: 'GOG',  color: '#9b59d9' };
    if (s === 'epic') return { label: 'EPIC', color: '#4a9eff' };
    return { label: (s || '').toUpperCase() || 'GAME', color: 'var(--text_dim)' };
}
function _dlEsc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// Queue a download (dir/platform already chosen). Starts immediately if nothing is active.
function enqueueDownload(item) {
    // DLC jobs carry a distinct dlcKey so they don't collide with the base game's install (or each other).
    const key = q => String(q.dlcKey || q.gameId);
    const dup = (_dlActive && key(_dlActive) === key(item)) || _dlQueue.some(q => key(q) === key(item));
    if (dup) { opToast('Already downloading / queued: ' + item.name, _dlActive ? _dlActive.pct : 0); return; }
    _dlQueue.push(item);
    if (_dlActive && !_dlmOpen) opToast(`Queued: ${item.name}  (+${_dlQueue.length} in queue)`, _dlActive.pct || 0);
    renderDownloadManager();
    _pumpDownloadQueue();
}

async function _pumpDownloadQueue() {
    if (_dlActive || _dlQueue.length === 0) return;
    const item = _dlQueue.shift();
    _dlActive = { ...item, pct: 0, message: 'Starting…', step: 'START' };
    if (!_dlmOpen) opToast('Installing ' + item.name + '…', 0);
    renderDownloadManager();
    let res;
    try { res = await window.api.installerInstall({ gameId: item.gameId, installerGameId: item.gid, installDir: item.dir, dlc: item.dlc, platform: item.platform }); }
    catch (e) { res = { ok: false, error: e.message }; }
    const success = !!(res && res.ok);
    const cancelled = !success && /cancel/i.test((res && res.error) || '');
    // Desktop/phone ping (KDE Connect mirrors it), cover art as the notification icon.
    notifyDesktop(success ? 'Game installed' : (cancelled ? 'Install cancelled' : 'Install failed'), item.name,
        allGames.find(g => String(g.id) === String(item.gameId)));
    _dlHistory.unshift({ gameId: item.gameId, name: item.name, store: item.store, success, cancelled, error: success ? null : (res && res.error), at: Date.now() });
    if (_dlHistory.length > 30) _dlHistory.length = 30;
    if (!_dlmOpen) {
        if (success) opToastDone('✓ Installed: ' + item.name);
        else if (cancelled) { opToast('Cancelled: ' + item.name); setTimeout(opToastHide, 3000); }
        else { opToast('Install failed: ' + item.name); setTimeout(opToastHide, 5000); }
    }
    _dlActive = null;
    renderDownloadManager();
    refreshAfterInstall(item.gameId);   // flip INSTALL → PLAY now, not on the next window focus
    _pumpDownloadQueue();      // advance to the next queued download immediately, never blocked on the refresh
}

// ── After an install finishes ────────────────────────────────────────────────
// `loadGames()` alone was not enough, and the symptom was that the gamepage kept showing
// INSTALL until the window was unfocused and focused again, which "fixed" it only because
// the focus handler does three things this path was missing.
//
// The gamepage's button reads `!!game.LaunchCommand`, and for a Installer title that command
// does not exist until Installer's own installed state is pulled into the shared DB. So the
// row can be marked Installed=1 while LaunchCommand is still empty, and the button correctly
// but uselessly keeps saying INSTALL. Hence the same sequence the focus handler runs:
// verify, sync, reload, then re-render the open page.
//
// Deliberately not awaited by the caller: the download queue must advance immediately rather
// than wait on a refresh, which is why the previous code left it fire-and-forget too.
async function refreshAfterInstall(gameId) {
    try { if (gameId) await window.api.verifyInstallStatus(gameId); } catch {}
    try { await syncInstallerInstalled(); } catch {}   // where a Installer title's LaunchCommand comes from
    await loadGames();

    const onGamepage = document.getElementById('view-gamepage')?.classList.contains('active');
    if (onGamepage && currentGameId && String(currentGameId) === String(gameId)) {
        const updated = allGames.find(g => String(g.id) === String(currentGameId));
        if (updated) refreshGamepagePlayBtn(updated);
    }
}

function cancelQueuedDownload(gameId) {
    const i = _dlQueue.findIndex(q => String(q.gameId) === String(gameId));
    if (i >= 0) { _dlQueue.splice(i, 1); renderDownloadManager(); }
}
async function cancelActiveDownload() {
    if (!_dlActive) return;
    _dlActive.message = 'Cancelling…';
    renderDownloadManager();
    await window.api.installerCancelInstall();   // engine kills the child → install resolves failed → queue advances
}

function openDownloadManager() {
    _dlmOpen = true;
    opToastHide();   // the toast sits at z-31000 and would cover the modal; hide it while the manager is open
    document.getElementById('modal-dlm')?.classList.add('active');
    renderDownloadManager();
}
function closeDownloadManager() {
    _dlmOpen = false;
    document.getElementById('modal-dlm')?.classList.remove('active');
    if (_dlActive) opToast('Installing ' + _dlActive.name + '…', _dlActive.pct || 0);   // restore the progress bar
}

// Clicking a game's name anywhere in the manager jumps to its gamepage.
function openGameFromDownloadManager(gameId) {
    const g = allGames.find(x => String(x.id) === String(gameId));
    if (!g) return;
    closeDownloadManager();
    switchView(lastGridView);
    openGamepage(g);
}

// Titlebar downloads button badge, shows the count of active + queued downloads.
function _updateDownloadBadge() {
    const badge = document.getElementById('dl-badge');
    if (!badge) return;
    const n = (_dlActive ? 1 : 0) + _dlQueue.length;
    if (n > 0) { badge.style.display = 'block'; badge.textContent = n; }
    else badge.style.display = 'none';
}

function renderDownloadManager() {
    _updateDownloadBadge();   // keep the titlebar badge current even when the modal is closed
    if (!_dlmOpen) return;
    const $ = id => document.getElementById(id);
    // Active
    $('dlm-active-section').style.display = _dlActive ? 'flex' : 'none';
    if (_dlActive) {
        const m = _dlStoreMeta(_dlActive.store);
        const _at = $('dlm-active-title'); _at.textContent = _dlActive.name || ''; _at.dataset.dlgame = _dlActive.gameId; _at.classList.add('dlm-clickable');
        $('dlm-active-store').textContent = m.label; $('dlm-active-store').style.color = m.color;
        $('dlm-bar').style.width = (_dlActive.pct || 0) + '%';
        $('dlm-pct').textContent = (_dlActive.pct || 0).toFixed(1) + '%';
        $('dlm-msg').textContent = _dlActive.message || '';
        // Stalled: colour the bar and the figure so a frozen percentage cannot be mistaken
        // for a working one, and put the explanation where the eye already is.
        // Both of these carry their normal colour in the inline style attribute, so the
        // "not stalled" branch has to restore var(--accent) explicitly, clearing to ''
        // deletes the declaration and leaves the bar with no background at all (invisible).
        const stalled = !!_dlActive.stalled;
        $('dlm-bar').style.background = stalled ? '#ef5350' : 'var(--accent)';
        $('dlm-pct').style.color = stalled ? '#ef5350' : 'var(--accent)';
        const warn = $('dlm-stall-warning');
        if (warn) {
            warn.style.display = stalled ? 'flex' : 'none';
            const mins = _dlActive.stalledMinutes || 0;
            $('dlm-stall-text').textContent =
                `No progress for ${mins} minute${mins === 1 ? '' : 's'}. This usually means GOG is serving a bad copy of one file, ` +
                `cancel and start the download again, which normally picks a different server and continues from where it stopped.`;
        }
    }
    // Queue
    $('dlm-queue-section').style.display = _dlQueue.length ? 'flex' : 'none';
    if (_dlQueue.length) {
        $('dlm-queue-label').textContent = `${_dlQueue.length} waiting`;
        $('dlm-queue-list').innerHTML = _dlQueue.map(item => {
            const m = _dlStoreMeta(item.store);
            return `<div class="dlm-row"><div class="dlm-dot"></div><div class="dlm-row-meta">` +
                   `<div class="dlm-row-title dlm-clickable" data-dlgame="${_dlEsc(item.gameId)}">${_dlEsc(item.name)}</div>` +
                   `<div class="dlm-row-sub" style="color:${m.color}">${m.label} · Waiting</div></div>` +
                   `<button class="dlm-remove" data-dlq="${_dlEsc(item.gameId)}">✕ Remove</button></div>`;
        }).join('');
    }
    // Completed
    $('dlm-history-section').style.display = _dlHistory.length ? 'flex' : 'none';
    if (_dlHistory.length) {
        $('dlm-history-list').innerHTML = _dlHistory.map(h => {
            const m = _dlStoreMeta(h.store);
            return `<div class="dlm-row"><div class="dlm-dot" style="background:${h.success ? '#66bb6a' : '#ef5350'}"></div>` +
                   `<div class="dlm-row-meta"><div class="dlm-row-title dlm-clickable" data-dlgame="${_dlEsc(h.gameId)}">${_dlEsc(h.name)}</div>` +
                   `<div class="dlm-row-sub" style="color:${m.color}">${m.label} · ${h.success ? 'Completed' : 'Failed'}</div></div></div>`;
        }).join('');
    }
    // Empty state
    $('dlm-empty').style.display = (!_dlActive && !_dlQueue.length && !_dlHistory.length) ? 'flex' : 'none';
}

// NOTE: renderer.js is included (line ~6273 of index.html) BEFORE #op-toast / #modal-dlm
// are parsed, so these elements don't exist yet at top-level execution time. Wire the
// listeners once the DOM is ready (fallback: run now if it already parsed).
function _wireDownloadManager() {
    document.getElementById('btn-titlebar-downloads')?.addEventListener('click', openDownloadManager);
    document.getElementById('op-toast')?.addEventListener('click', openDownloadManager);
    document.getElementById('btn-dlm-close')?.addEventListener('click', closeDownloadManager);
    document.getElementById('modal-dlm')?.addEventListener('click', (e) => {
        const gt = e.target.closest('[data-dlgame]');
        if (gt) { openGameFromDownloadManager(gt.dataset.dlgame); return; }
        if (e.target.id === 'modal-dlm') closeDownloadManager();
    });
    document.getElementById('dlm-btn-cancel-active')?.addEventListener('click', cancelActiveDownload);
    document.getElementById('dlm-queue-list')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-dlq]'); if (b) cancelQueuedDownload(b.dataset.dlq);
    });
    document.getElementById('dlm-btn-clear-history')?.addEventListener('click', () => { _dlHistory.length = 0; renderDownloadManager(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wireDownloadManager);
else _wireDownloadManager();

// In-process GOG/Epic install with a progress modal (no Installer window).
async function openInstallerInstall(game) {
    const gid = game.InstallerGameId || '';
    if (!/^(gog|epic)_/i.test(gid)) { _openCompatFor(game); return; }   // custom → compatibility panel

    const modal = document.getElementById('modal-installer-install');
    const $ = id => document.getElementById(id);
    $('gi-title').textContent = game.Game || '';
    $('gi-dir').value = (await window.api.installerDefaultDir()) || '';
    $('gi-config').style.display = '';
    $('gi-progress').style.display = 'none';
    $('gi-bar').style.width = '0%';
    $('gi-step').textContent = ''; $('gi-step').style.color = 'var(--accent)';
    $('gi-msg').textContent = '';
    $('gi-install').style.display = ''; $('gi-install').disabled = false; $('gi-install').textContent = 'Install';
    $('gi-cancel').textContent = 'Cancel';
    modal.classList.add('active');

    // Platform choice, only for GOG games that ship BOTH a native build for this host and a
    // Windows build. The native key varies by host (gogdl calls it 'linux' on Linux, 'osx' on
    // macOS), hardcoding 'linux' here meant a Mac-native GOG game never got offered its own
    // native build at all: hasChoice stayed false, so the platform silently fell through to
    // whatever library.db already had (usually fine) rather than ever being a real choice.
    const nativeKey   = window.api.platform === 'darwin' ? 'osx' : 'linux';
    const nativeLabel = window.api.platform === 'darwin' ? 'Mac Native' : 'Linux Native';
    let selectedPlatform;
    let hasChoice = false;
    const platRow = $('gi-platform-row');
    try {
        const pinfo = await window.api.installerPlatforms(gid);
        const avail = pinfo.platforms || [];
        hasChoice = /^gog_/i.test(gid) && avail.includes(nativeKey) && avail.includes('windows');
        selectedPlatform = pinfo.platform === nativeKey ? nativeKey : 'windows';
    } catch { hasChoice = false; }
    if (platRow) platRow.style.display = hasChoice ? 'flex' : 'none';
    const nativeBtn = $('gi-plat-linux');
    if (nativeBtn) { nativeBtn.textContent = nativeLabel; nativeBtn.title = `Install the native ${nativeLabel} build`; }

    const fmtB = b => b == null ? '?' : (b >= 1024**3 ? (b/1024**3).toFixed(1) + ' GB' : (b/1024**2).toFixed(0) + ' MB');

    // ⚠️ A missing store sign-in used to be indistinguishable from a store hiccup, because
    // every layer below here turns failure into null: getInstallSize catches, gogInstallInfo
    // returns null on a missing token, and gogdl's own failure is swallowed by the JSON parse.
    // What the user saw was a dialog showing free space and no size, and, after pressing
    // Install, a download that failed saying nothing. That is the same silent shape the
    // CA-bundle bug had, and it cost a day of looking at the wrong things twice.
    //
    // Being signed out is the ONE cause that is both far and away the commonest and precisely
    // knowable, so it is worth a question of its own. It is asked only when the size lookup has
    // already failed, so the normal path pays nothing. If the check itself cannot answer, no
    // accusation is made, an unreachable store is not a signed-out one.
    const store      = _dlStoreOf(gid);
    const storeLabel = store === 'gog' ? 'GOG' : store === 'epic' ? 'Epic' : '';
    const storeSignedOut = async () => {
        if (store !== 'gog' && store !== 'epic') return false;
        try {
            const st = store === 'gog' ? await window.api.gogAuthStatus()
                                       : await window.api.epicAuthStatus();
            return !st?.loggedIn;
        } catch { return false; }
    };

    // When signed out, the primary button stops being a dead end and becomes the fix.
    let signInMode = false;
    const setSignInMode = (on) => {
        signInMode = on;
        const b = $('gi-install');
        b.textContent = on ? `Sign in to ${storeLabel}…` : 'Install';
        b.disabled = false;
    };

    const refreshSizeInfo = async () => {
        const el = $('gi-sizeinfo'); el.textContent = 'Checking size & free space…';
        // Always the resolved platform, even without a choice to make, it's already set
        // correctly above from library.db's own value, and passing undefined here used to
        // silently default the size lookup to Windows (gogInstallInfo's own `platform ||
        // 'windows'` fallback), showing the wrong download size for a game with no Windows
        // build at all.
        const [info, free] = await Promise.all([
            window.api.getInstallSize(gid, selectedPlatform).catch(() => null),
            window.api.getDiskSpace($('gi-dir').value).catch(() => null),
        ]);
        const val = v => `<b style="color:var(--text_main)">${fmtB(v)}</b>`;
        const parts = [];
        if (info?.download_size) parts.push(`Download ${val(info.download_size)}`);
        if (info?.disk_size)     parts.push(`On disk ${val(info.disk_size)}`);
        const need = info?.disk_size || info?.download_size || 0;
        if (free != null) {
            const low = need && free < need;
            parts.push(`<b style="color:${low ? '#ef5350' : '#66bb6a'}">${fmtB(free)} free</b>${low ? ', not enough space!' : ''}`);
        }
        if (!info && await storeSignedOut()) {
            const freeTxt = free != null ? ` &nbsp;·&nbsp; <span style="color:var(--text_dim)">${fmtB(free)} free</span>` : '';
            el.innerHTML = `<b style="color:#ef5350">Not signed in to ${storeLabel}.</b> ` +
                `<span style="color:var(--text_dim)">The download size can’t be read, and installing would fail.</span>${freeTxt}`;
            setSignInMode(true);
            return;
        }
        setSignInMode(false);
        el.innerHTML = parts.length ? parts.join(' &nbsp;·&nbsp; ') : 'Size info unavailable';
    };

    if (hasChoice) {
        const setPlat = p => {
            selectedPlatform = p;
            $('gi-plat-linux').classList.toggle('active', p === nativeKey);
            $('gi-plat-windows').classList.toggle('active', p === 'windows');
            refreshSizeInfo();
        };
        $('gi-plat-linux').onclick   = () => setPlat(nativeKey);
        $('gi-plat-windows').onclick = () => setPlat('windows');
        setPlat(selectedPlatform);
    } else {
        refreshSizeInfo();
    }

    $('gi-change-dir').onclick = async () => {
        const dir = await window.api.installerPickDir($('gi-dir').value);
        if (dir) { $('gi-dir').value = dir; refreshSizeInfo(); }
    };
    $('gi-cancel').onclick = () => { modal.classList.remove('active'); loadGames(); };
    $('gi-install').onclick = async () => {
        // Signed out: sign in first, then re-check. The modal stays open so the install the
        // user came here for is one press away once the sign-in lands.
        if (signInMode) {
            const b = $('gi-install');
            b.disabled = true; b.textContent = 'Waiting for sign-in…';
            let res = null;
            try {
                res = store === 'gog' ? await window.api.gogLogin() : await window.api.epicLogin();
            } catch { res = null; }
            b.disabled = false;
            if (!res?.ok) {
                // A cancelled sign-in is a choice, not a fault, say nothing extra about it.
                setSignInMode(true);
                if (res && res.error && res.error !== 'cancelled' && typeof opToast === 'function') {
                    opToast(`${storeLabel} sign-in failed: ${res.error}`); setTimeout(opToastHide, 2600);
                }
                return;
            }
            await refreshSizeInfo();
            return;
        }
        // Hand off to the Download Manager queue: it downloads now (or waits its turn),
        // shows progress in the top toast, and is managed by clicking that toast.
        const item = { gameId: game.id, gid, name: game.Game || '', store: _dlStoreOf(gid), dir: $('gi-dir').value };
        if (hasChoice) item.platform = selectedPlatform;
        modal.classList.remove('active');
        enqueueDownload(item);
    };
}

// ── Launch failures / Proton ─────────────────────────────────────────────────
// GOG/Epic games are spawned detached, so a game that dies on the spot reports nothing by
// itself. The main process watches for that (and for launches it refuses outright) and sends
// `game-launch-failed`; the commonest cause by far is having no Proton installed, which we can
// fix right here instead of sending the user off to read a terminal log.
let _protonBusy = false;
async function showLaunchFailure(info) {
    const $ = id => document.getElementById(id);
    const modal = $('modal-proton');
    if (!modal || _protonBusy) return;
    const isProtonIssue = info.code === 'NO_PROTON';

    $('pr-heading').textContent = isProtonIssue ? 'Proton Required' : "Can't Start Game";
    $('pr-title').textContent   = info.title || '';
    $('pr-message').textContent = info.message || 'The game could not be started.';
    $('pr-explain').style.display = isProtonIssue ? '' : 'none';
    $('pr-progress').style.display = 'none';
    $('pr-bar').style.width = '0%';
    $('pr-step').textContent = ''; $('pr-progress-msg').textContent = '';
    // Only offer to install a Windows runtime when the failure is actually about one missing,
    // this used to show unconditionally, so a completely unrelated failure (a stale library.db
    // lookup, a bad path) still offered "Install GE-Proton" as if that would fix it. Confusing
    // on Linux; actively wrong on macOS, where GE-Proton isn't a concept that exists at all.
    $('pr-install').style.display = isProtonIssue ? '' : 'none';
    $('pr-install').disabled = false;
    $('pr-install').textContent = 'Install GE-Proton';
    $('pr-close').textContent = 'Close';

    // ── A failure we can actually fix, offered as a button ────────────────────
    // NO_VULKAN means the GPU predates Vulkan and DXVK cannot start, which is not something
    // the app can repair, but Proton has an OpenGL path, and switching to it is a single
    // per-game environment variable. Telling someone the variable's name and leaving them to
    // find the right box is a worse answer than offering to set it, so this does.
    //
    // ⚠️ Only offered when the game is known: the variable is per-game, and the engine's
    // launch-issue payload is the only thing that knows which one just failed.
    //
    // Offered for D3D_CRASH too: that is the same crash on a machine that DOES have Vulkan, so
    // the cause is a driver or a build rather than the hardware, but the OpenGL path is still
    // the one thing worth trying, and its message says so. Naming the variable while making the
    // user go and find the box would be exactly the worse answer described above.
    const fixBtn = $('pr-fix');
    const canFixVulkan = (info.code === 'NO_VULKAN' || info.code === 'D3D_CRASH') && info.installerGameId != null;
    fixBtn.style.display = canFixVulkan ? '' : 'none';
    fixBtn.disabled = false;
    fixBtn.textContent = 'Use OpenGL for this game';
    if (canFixVulkan) {
        fixBtn.onclick = async () => {
            fixBtn.disabled = true;
            fixBtn.textContent = 'Applying…';
            const r = await window.api.installerSetEnvVar({
                installerGameId: info.installerGameId, name: 'PROTON_USE_WINED3D', value: '1',
            });
            if (r && r.ok) {
                $('pr-message').textContent =
                    'Done, this game will now render through OpenGL instead of Vulkan. Press Play to try again. ' +
                    'You can undo it any time by removing PROTON_USE_WINED3D from the game\'s environment variables.';
                fixBtn.textContent = '✓ Applied';
                $('pr-close').textContent = 'Close';
            } else {
                fixBtn.disabled = false;
                fixBtn.textContent = 'Use OpenGL for this game';
                $('pr-message').textContent = (r && r.error) || 'Could not apply it.';
            }
        };
    }

    const log = (info.log || '').trim();
    $('pr-details').style.display = log ? '' : 'none';
    $('pr-details').open = false;
    $('pr-log').textContent = log ? (log + (info.logPath ? `\n\n(full log: ${info.logPath})` : '')) : '';

    // If Proton builds DO exist, the problem is something else (or a bad selection), let the
    // user pick which one to use as the default rather than pushing another download at them.
    // None of this applies when the failure isn't Proton-related in the first place.
    let list = { protons: [], current: '' };
    if (isProtonIssue) { try { list = await window.api.protonList(); } catch {} }
    const sel = $('pr-select');
    if (isProtonIssue && list.protons && list.protons.length) {
        $('pr-found').style.display = '';
        sel.innerHTML = list.protons
            .map(p => `<option value="${p.path.replace(/"/g, '&quot;')}">${(p.label || p.name)}, ${p.name}</option>`)
            .join('');
        if (list.current) sel.value = list.current;
        sel.onchange = () => window.api.protonSetDefault(sel.value);
        $('pr-install').textContent = 'Install the latest GE-Proton';
    } else {
        $('pr-found').style.display = 'none';
        sel.innerHTML = '';
    }

    modal.classList.add('active');
    $('pr-close').onclick = () => { if (!_protonBusy) modal.classList.remove('active'); };
    modal.onclick = e => { if (e.target === modal && !_protonBusy) modal.classList.remove('active'); };
    $('pr-install').onclick = () => installProtonFromModal();
}

async function installProtonFromModal() {
    const $ = id => document.getElementById(id);
    _protonBusy = true;
    $('pr-install').disabled = true;
    $('pr-close').textContent = 'Cancel';
    $('pr-close').onclick = async () => { await window.api.protonInstallCancel(); };
    $('pr-progress').style.display = '';
    $('pr-step').textContent = 'Preparing'; $('pr-step').style.color = 'var(--accent)';

    const res = await window.api.protonInstallLatest();
    _protonBusy = false;
    $('pr-close').textContent = 'Close';
    $('pr-close').onclick = () => document.getElementById('modal-proton').classList.remove('active');

    if (res && res.ok) {
        $('pr-step').textContent = 'Done'; $('pr-bar').style.width = '100%';
        $('pr-progress-msg').textContent = `${res.proton?.label || 'Proton'} installed. Try launching the game again.`;
        $('pr-install').style.display = 'none';
        $('pr-message').textContent = 'Proton is ready, your Windows games can run now.';
        $('pr-explain').style.display = 'none';
    } else {
        $('pr-step').textContent = 'Failed'; $('pr-step').style.color = '#ff6d00';
        $('pr-progress-msg').textContent = (res && res.error) || 'Could not install Proton.';
        $('pr-install').disabled = false;
        $('pr-install').textContent = 'Try again';
    }
}

window.api.onProtonInstallProgress(d => {
    const step = document.getElementById('pr-step');
    const bar  = document.getElementById('pr-bar');
    const msg  = document.getElementById('pr-progress-msg');
    if (!step) return;
    step.textContent = (d.phase || '').toUpperCase();
    if (typeof d.percent === 'number') bar.style.width = d.percent + '%';
    msg.textContent = d.message || '';
});
window.api.onGameLaunchFailed(info => showLaunchFailure(info || {}));

// In-process GOG/Epic uninstall (reuses the install modal in progress-only mode).
async function openInstallerUninstall(game) {
    const gid = game.InstallerGameId || '';
    if (!/^(gog|epic)_/i.test(gid)) return;
    const ok = await showConfirm(`Uninstall "${game.Game}"?\nThis removes the game files and its Wine prefix.`);
    if (!ok) return;
    const modal = document.getElementById('modal-installer-install');
    const $ = id => document.getElementById(id);
    $('gi-title').textContent = 'Uninstalling: ' + (game.Game || '');
    $('gi-config').style.display = 'none';
    $('gi-progress').style.display = '';
    $('gi-bar').style.width = '0%';
    $('gi-step').textContent = 'UNINSTALLING'; $('gi-step').style.color = 'var(--accent)';
    $('gi-msg').textContent = '';
    $('gi-install').style.display = 'none';
    $('gi-cancel').textContent = 'Hide';
    $('gi-cancel').onclick = () => { modal.classList.remove('active'); loadGames(); };
    modal.classList.add('active');
    const res = await window.api.installerUninstall({ gameId: game.id, installerGameId: gid });
    if (res && res.ok) {
        $('gi-step').textContent = 'DONE'; $('gi-bar').style.width = '100%'; $('gi-msg').textContent = 'Game uninstalled.';
        setTimeout(() => { modal.classList.remove('active'); loadGames(); }, 1000);
    } else {
        $('gi-step').textContent = 'ERROR'; $('gi-step').style.color = '#ff6d00';
        $('gi-msg').textContent = (res && res.error) || 'Uninstall failed.';
        $('gi-cancel').textContent = 'Close';
    }
}

async function handleInstall(game) {
    // A row can front several stores at once (Store "Steam, GOG"), and the game may well be
    // owned on all of them, so ask which store to install from instead of silently taking
    // whichever branch happens to match first.
    const states = await launcherStatesFor(game);
    if (states.length >= 2) { showLauncherPicker(game, states, 'install'); return; }

    if (_isInstallerGame(game)) {
        if (/^(gog|epic)_/i.test(game.InstallerGameId || '')) { openInstallerInstall(game); return; }
        _openCompatFor(game); return;
    }
    const installCmd = getInstallCommand(game);
    if (installCmd) { window.api.openInstallUrl(installCmd); return; }
    if (isManualCategory(game)) openAddCmdDialog(game.id, game.Game);
}

async function verifyAndLaunch(gameId, launchCmd) {
    try {
        const game = allGames.find(g => g.id == gameId);

        // Multi-store: pick the store before committing to a launch.
        const states = game ? await launcherStatesFor(game) : [];
        if (states.length >= 2) {
            showLauncherPicker(game, states);
            return;
        }
        if (game) showNowPlaying(game);
        const cmd = states.length === 1 ? states[0].cmd : launchCmd;
        await _doLaunch(game, cmd);
    } catch (e) { console.error('[verifyAndLaunch]', e); }
}

window.api.onInstallStatusUpdated(() => loadGames());

// On window refocus (e.g. returning from the Installer install/uninstall window),
// re-read the shared DB and re-render ONLY if install state actually changed,
// avoids any re-render jank on ordinary alt-tabbing.
let _refocusTimer = 0;
window.api.onWindowRefocused(() => {
    clearTimeout(_refocusTimer);
    _refocusTimer = setTimeout(async () => {
        const res = await window.api.getGames();
        const fresh = (res.games || []).filter(g => g.Game && g.Game !== 'null');
        const changed = fresh.length !== allGames.length || fresh.some(g => {
            const old = allGames.find(o => o.id === g.id);
            return !old || old.Installed != g.Installed || old.LaunchCommand != g.LaunchCommand;
        });
        if (changed) { allGames = fresh; applyFilters(); }
        // Playlists can be created/edited from Couch (shared games.db), re-read the
        // list so a playlist made on the couch shows up without restarting The Manager.
        try {
            const freshPl = await window.api.getPlaylists();
            const plChanged = !allPlaylists || freshPl.length !== allPlaylists.length
                || freshPl.some((p, i) => !allPlaylists[i] || allPlaylists[i].id !== p.id || allPlaylists[i].name !== p.name);
            if (plChanged) { allPlaylists = freshPl; renderPlaylistPanels(); }
        } catch {}
    }, 500);
});

// ── GPU IDLE SUSPEND ──────────────────────────────────────────────────────────
// Chromium keeps compositing CSS animations (the Ken Burns hero, spinners, etc.) on
// a window that is merely unfocused or occluded, which burned 30-40% GPU while the
// app sat idle in the background. Pause ALL animations + videos when the window is
// hidden or loses focus; resume on focus. animation-play-state only affects @keyframes
// animations (not transitions), so interactions stay snappy on resume.
(function () {
    let _suspended = null;
    function setGpuSuspended(s) {
        if (s === _suspended) return; _suspended = s;
        if (document.body) document.body.classList.toggle('gpu-suspended', s);
        if (s) { try { document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); }); } catch (e) {} }
    }
    document.addEventListener('visibilitychange', () => setGpuSuspended(document.hidden));
    window.addEventListener('blur',  () => setGpuSuspended(true));
    window.addEventListener('focus', () => setGpuSuspended(false));
    // Apply initial state once the DOM is ready.
    if (document.readyState !== 'loading') setGpuSuspended(document.hidden);
    else document.addEventListener('DOMContentLoaded', () => setGpuSuspended(document.hidden));
})();

// Auto-refresh play button when Clarity regains focus (e.g. after installing via Installer)
let _focusRefreshTimer = null;
window.addEventListener('focus', () => {
    clearTimeout(_focusRefreshTimer);
    _focusRefreshTimer = setTimeout(async () => {
        const onGamepage = document.getElementById('view-gamepage')?.classList.contains('active');
        if (currentGameId) await window.api.verifyInstallStatus(currentGameId);
        await syncInstallerInstalled();   // pull Installer's installed flags into the shared DB
        await loadGames();              // always re-render so a game installed via Installer flips Install→Play
        if (onGamepage && currentGameId) {
            const updated = allGames.find(g => g.id === currentGameId);
            if (updated) refreshGamepagePlayBtn(updated);
        }
    }, 400);
});
let currentLaunchCmd = '';
let activeFilters = new Set(); // empty = ALL GAMES
const STORE_FILTERS     = new Set(['steam','gog','epic','flatpak','pico8','itch','physical','emulation','apps','others','openbor']);
// ── One definition of "installed" ────────────────────────────────────────────
// ⚠️ There were six of these, and they disagreed. The gallery cards asked for a launch
// command AND a non-zero Installed flag, while four of the filters accepted
// `Installed == 1 || !!LaunchCommand`, so anything carrying a launch command counted as
// installed no matter what the flag said. On a library imported from another machine that is
// almost every row, which is why the Installed filter listed 22 games and most of them showed
// an INSTALL button: the filter and the button were answering different questions.
//
// A NULL flag still counts as installed, deliberately: it means "never reconciled", and rows
// the reconciler cannot judge must not vanish from the filter. An explicit 0 means it was
// judged and is not here.
function isGameInstalled(g) {
    return !!g && !!g.LaunchCommand && (g.Installed == null || g.Installed == 1);
}

const QUALIFIER_FILTERS = new Set(['installed','favs','want','playable','mac-native']);

// ── Genres ───────────────────────────────────────────────────────────────────
// The vocabulary lives in packages/core/genres.js and arrives via the genre-list IPC,
// so the renderer never hardcodes the list. Each game row carries a `Genres` string
// (comma-joined slugs) built by get-games, filtering is a string check, no lookups.
let allGenres = [];             // [{ slug, label, count }]
let genreCoverage = { total: 0, classified: 0, locked: 0 };
let currentGenre = null;        // slug, or null for "All Genres"

function genreLabel(slug) { return allGenres.find(g => g.slug === slug)?.label || ''; }

// A playlist with a rule fills itself (see packages/core/smart-playlists.js); one
// without is the ordinary hand-picked kind. The renderer only needs to tell them apart.
function _playlistRule(p) {
    try { const r = typeof p?.rule === 'string' ? JSON.parse(p.rule) : p?.rule; return (r && typeof r === 'object') ? r : null; }
    catch { return null; }
}
function isSmartPlaylist(p) { return !!_playlistRule(p); }
function smartPlaylistSummary(p) {
    const r = _playlistRule(p);
    if (!r) return '';
    const bits = [];
    if (r.genres?.length) bits.push(r.genres.map(genreLabel).filter(Boolean).join(' or '));
    if (r.stores?.length) bits.push('on ' + r.stores.join(' or '));
    if (r.installed) bits.push('installed');
    if (r.fav) bits.push('favourites');
    if (r.want) bits.push('want to play');
    return bits.filter(Boolean).join(', ');
}
function gameGenres(game) { return String(game?.Genres || '').split(',').filter(Boolean); }
function gameHasGenre(game, slug) { return gameGenres(game).includes(slug); }
// The one-word answer for chips and columns: what the game IS, falling back to the
// old free-text GENRE for anything a scan has not reached yet.
function primaryGenreLabel(game) {
    return genreLabel(game?.PrimaryGenre) || String(game?.GENRE || '').split(',')[0].trim();
}

async function loadGenres() {
    try {
        const res = await window.api.genreList();
        allGenres = res?.genres || [];
        genreCoverage = res?.coverage || genreCoverage;
    } catch (e) { allGenres = []; }
    _rebuildGenreDropdown();
    _renderGenreCoverage();
}

// Only genres that actually match something are listed, an empty menu entry is a
// dead end, and the counts make the list self-explanatory.
function _rebuildGenreDropdown() {
    const sel = document.getElementById('gallery-genre');
    if (!sel) return;
    const opts = ['<option value="all">All Genres</option>'];
    for (const g of allGenres) {
        if (!g.count) continue;
        opts.push(`<option value="${g.slug}">${escHtml(g.label)} (${g.count})</option>`);
    }
    const unclassified = Math.max(0, genreCoverage.total - genreCoverage.classified);
    if (unclassified) opts.push(`<option value="__none__">No Genre Yet (${unclassified})</option>`);
    sel.innerHTML = opts.join('');
    sel.value = currentGenre || 'all';
    if (sel.selectedIndex < 0) { sel.value = 'all'; currentGenre = null; }
}

function _renderGenreCoverage() {
    const el = document.getElementById('genre-coverage-bar');
    if (!el) return;
    const { total, classified, locked } = genreCoverage;
    if (!total) { el.textContent = ''; return; }
    const pct = Math.round((classified / total) * 100);
    el.innerHTML = `<b style="color:var(--accent);">${classified}</b> of ${total} games sorted (${pct}%)` +
                   (locked ? ` &middot; ${locked} set by you` : '');
}
let lastGridView = 'view-gallery';
let _activePanelSection = null; // 'stores' | null
let savedGridScrollTop = 0;
// When set, switchView restores this scrollTop on the next view it activates (instead of zeroing).
// Survives the async overlay-close (which re-runs switchView after the leave animation).
let _pendingScrollRestore = null;
let baseDir = '';

let strings = {};
let currentLang = 'en';
function t(key, vars = {}) {
  const val = key.split('.').reduce((o, k) => o?.[k], strings);
  if (!val) return key;
  return String(val).replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}
// ── Custom alert / confirm dialogs ────────────────────────────────────────────
const _dlg        = document.getElementById('modal-dialog');
const _dlgBody    = document.getElementById('modal-dialog-body');
const _dlgOk      = document.getElementById('modal-dialog-ok');
const _dlgCancel  = document.getElementById('modal-dialog-cancel');

function _openDialog(body, okLabel, isDanger, showCancel) {
    return new Promise(resolve => {
        _dlgBody.textContent = body;
        _dlgOk.textContent   = okLabel;
        _dlgOk.className     = isDanger ? '' : 'primary';
        _dlgOk.style.cssText = isDanger
            ? 'flex:1; background:rgba(198,40,40,0.15); border:1px solid #c62828; color:#ef5350;'
            : 'flex:1;';
        _dlgCancel.style.display = showCancel ? '' : 'none';
        _dlg.classList.add('active');
        const done = r => {
            _dlg.classList.remove('active');
            _dlgOk.onclick = _dlgCancel.onclick = _dlg.onclick = null;
            resolve(r);
        };
        _dlgOk.onclick     = () => done(true);
        _dlgCancel.onclick = () => done(false);
        _dlg.onclick       = e => { if (e.target === _dlg) done(false); };
    });
}
function showAlert(body)                            { return _openDialog(body, 'OK',     false, false); }
function showConfirm(body, okLabel = 'Confirm', isDanger = false) { return _openDialog(body, okLabel, isDanger, true); }
// ─────────────────────────────────────────────────────────────────────────────

function getLocalizedDescription(game) {
  if (game.Description_i18n) {
    try { const d = JSON.parse(game.Description_i18n); return d[currentLang] || d['en'] || game.Description || ''; } catch(e) {}
  }
  return game.Description || '';
}

function applyI18nToDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.getAttribute('data-i18n')); if (v) el.textContent = v; });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { const v = t(el.getAttribute('data-i18n-html')); if (v) el.innerHTML = v; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const v = t(el.getAttribute('data-i18n-ph')); if (v) el.placeholder = v; });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { const v = t(el.getAttribute('data-i18n-title')); if (v) el.title = v; });
}

window.api.getSetting('language').then(lang => {
  currentLang = lang || 'en';
  window.api.getStrings(currentLang).then(s => { strings = s; applyI18nToDOM(); });
});

window.api.checkEmuLatte().then(exists => {
    if (exists) {
        const railEmu = document.getElementById('btn-rail-emulatte');
        if (railEmu) railEmu.style.display = '';
    }
});
// Always-visible floating Couch call-to-action
document.getElementById('couch-cta')?.addEventListener('click', () => window.api.launchCouch());
// Support pill → an in-app panel. Nothing here opens a browser.
//
// ⚠️ This used to open the project website's support.html. The site is offline while the app is
// being reworked, and a URL baked into a shipped build is the one link that cannot be corrected
// afterwards, so the app no longer sends anyone anywhere. The details are shown in-app instead,
// which also means they still work with no network at all. Because nothing is clickable, both
// values must be copyable, and that is the whole point of the Copy buttons.
const _supportModal = document.getElementById('modal-support');
const _closeSupport = () => _supportModal?.classList.remove('active');
document.getElementById('support-cta')?.addEventListener('click', () => _supportModal?.classList.add('active'));
document.getElementById('btn-close-support')?.addEventListener('click', _closeSupport);
_supportModal?.addEventListener('click', e => { if (e.target === _supportModal) _closeSupport(); });
document.querySelectorAll('.support-copy').forEach(btn => {
    btn.addEventListener('click', () => {
        const el = document.getElementById(btn.getAttribute('data-copy'));
        if (!el) return;
        const ok = window.api.copyText ? window.api.copyText(el.textContent.trim()) : false;
        const was = btn.textContent;
        btn.textContent = ok ? 'Copied' : 'Failed';
        setTimeout(() => { btn.textContent = was; }, 1400);
    });
});
document.getElementById('btn-rail-emulatte')?.addEventListener('click', () => window.api.launchEmuLatte());


// Local variable to hold our gaming history limit preference
let recentGamesCount = 0;
let recentlyImportedCount = 100;
let detailScreenshotInterval = null;
let heroKbInterval = null;
let ssBannerKbInterval = null; // FIX: New Ken Burns interval for the Screenshots Banner

// Language selector logic
window.api.getSetting('language').then(activeLang => {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-lang') === (activeLang || 'en'));
        btn.addEventListener('click', async () => {
            const lang = btn.getAttribute('data-lang');
            await window.api.setSetting('language', lang);
            document.body.style.transition = 'opacity 0.15s ease';
            document.body.style.opacity = '0';
            setTimeout(() => window.location.reload(), 160);
        });
    });
});

// SAFE: We only load games AFTER we have the correct base directory path
window.api.getBaseDir().then(dir => {
    baseDir = dir;

    // Load SEE filter visibility preferences at startup
    applySeeFilterVisibility();

    // ── UI scale ─────────────────────────────────────────────────────────────
    // 100% for everyone, always. The user changes it if they want to.
    //
    // ⚠️ This used to derive a scale from the screen, 0.75 on anything small, because on a
    // 1152x720 panel the icon rail ran past the bottom of the window and the Control Panel
    // button, the one control that fixes an oversized interface, could not be clicked. Two
    // Phase 1 changes already removed that trap: the rail is `overflow-y: auto`, so nothing in
    // it can be out of reach, and Ctrl +/-/0 changes the scale from anywhere (Ctrl+0 lands on
    // exactly 1.0). The guard was defending against a failure that no longer exists.
    //
    // ⚠️ And it was wrong in practice on the very devices it targeted: 0.75 makes everything
    // too small to read on a Steam Deck, and Jose runs 100% on the 1152x720 MacBook the rule
    // was written for. Deriving also meant one install disagreed with itself across monitors,
    // a rotated 900x1440 head derived 75% while the desktop head beside it derived 100%.
    //
    // With nothing derived there is nothing to re-derive, so the screen stamp that existed to
    // stop a saved value being overwritten (`clarity_ui_scale_screen`) is gone with it.

    // Mirrored for the pre-paint script: applying the zoom after the window is visible makes
    // the whole layout jump, which is the most obvious part of the startup flash.
    const _cacheScale = v => { try { localStorage.setItem('clarity_ui_scale_cache_v2', String(v)); } catch {} };

    function _markScaleButton(val) {
        document.querySelectorAll('.ui-scale-btn').forEach(btn =>
            btn.classList.toggle('active', btn.getAttribute('data-val') === val));
    }

    // ⚠️ One-time reset. Removing the derivation fixes what a FRESH install gets, but every
    // existing install is still carrying whatever the old code auto-derived and wrote into
    // `clarity_ui_scale`, typically 0.75, and that value is indistinguishable from a scale the
    // user actually picked. Since it was almost never a choice, and 100% is now the intended
    // baseline, it is cleared once. A scale chosen after this sticks for good.
    Promise.all([
        window.api.getSetting('clarity_ui_scale'),
        window.api.getSetting('ui_scale_reset_100'),
    ]).then(([val, done]) => {
        let v;
        if (done) {
            v = val ? parseFloat(val) : 1.0;
        } else {
            v = 1.0;
            window.api.setSetting('clarity_ui_scale', '1.0');
            window.api.setSetting('ui_scale_reset_100', '1');
        }
        window.api.setZoomLevel(v);
        _zoomNow = v;
        _cacheScale(String(v));
        _markScaleButton(String(v));
    });

    // Load the recently-imported playlist setting at startup
    window.api.getSetting('recently_imported_count').then(async val => {
        const n = val !== null && val !== undefined ? parseInt(val, 10) : 100;
        recentlyImportedCount = n;
        if (val === null || val === undefined) await window.api.setSetting('recently_imported_count', '100');
        document.querySelectorAll('#recently-imported-segmented-control .segmented-btn').forEach(btn =>
            btn.classList.toggle('active', btn.getAttribute('data-val') === String(n)));
        renderPlaylistPanels();
    });

    // Load the gaming history preference at startup
    window.api.getSetting('recent_games_count').then(val => {
        if (val) {
            recentGamesCount = parseInt(val, 10);
            document.querySelectorAll('#history-segmented-control .segmented-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-val') === val);
            });
        }
        loadGames();
    });
});

// Segmented Control Logic for Gaming History
document.querySelectorAll('#history-segmented-control .segmented-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        document.querySelectorAll('#history-segmented-control .segmented-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const val = e.target.getAttribute('data-val');
        recentGamesCount = parseInt(val, 10);
        await window.api.setSetting('recent_games_count', val);
        applyFilters();
    });
});

// Segmented Control Logic for Recently Imported Playlist
document.querySelectorAll('#recently-imported-segmented-control .segmented-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        document.querySelectorAll('#recently-imported-segmented-control .segmented-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        const val = e.target.getAttribute('data-val');
        recentlyImportedCount = parseInt(val, 10);
        await window.api.setSetting('recently_imported_count', val);
        if (currentPlaylistId === 'recently-imported') {
            if (recentlyImportedCount === 0) clearPlaylistFilter();
            else await setRecentlyImportedFilter();
        }
        renderPlaylistPanels();
    });
});

// Segmented Control Logic for UI Scaling
// ⚠️ Delegates to setZoom() rather than repeating it. This handler used to carry its own copy
// of the apply-and-save sequence and the copy drifted, which is how a scale picked here could
// be undone on the next start. One caller, one path.
document.querySelectorAll('.ui-scale-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        setZoom(parseFloat(e.target.getAttribute('data-val')));
    });
});

// Segmented Control Logic for Corner Style (sharp vs round)
document.querySelectorAll('.corners-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        document.querySelectorAll('.corners-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        _cornersStyle = e.target.getAttribute('data-val');
        applyCornersStyle();
        await window.api.setSetting('corners_style', _cornersStyle);
    });
});

// Ken Burns hero effect toggle (On default / Off for less powerful machines).
// CSS gate: body.kb-off kills the panZoom animation on every .hero-kb-img.
function applyKenBurns(off) {
    document.body.classList.toggle('kb-off', off);
    document.querySelectorAll('.kenburns-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (off ? 'off' : 'on')));
    window.api.setSetting('kenburns_off', off ? '1' : '');
}
document.querySelectorAll('.kenburns-btn').forEach(btn =>
    btn.addEventListener('click', () => applyKenBurns(btn.dataset.val === 'off')));
document.getElementById('ui-font-select')?.addEventListener('change', (e) => setUiFont(e.target.value));
(async () => {
    if (await window.api.getSetting('kenburns_off') === '1') applyKenBurns(true);
})();

// Desktop notifications (On default / Off): install-complete + Now Playing pings with
// the game's cover as icon. KDE Connect / GSConnect mirror them to a paired phone.
let _notifyOff = false;
function applyNotifyToggle(off) {
    _notifyOff = off;
    document.querySelectorAll('.notify-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (off ? 'off' : 'on')));
    window.api.setSetting('notify_off', off ? '1' : '');
}
function notifyDesktop(title, body, game) {
    if (_notifyOff) return;
    window.api.notify({ title, body, icon: (game && game.CoverArt) || '' });
}
document.querySelectorAll('.notify-btn').forEach(btn =>
    btn.addEventListener('click', () => applyNotifyToggle(btn.dataset.val === 'off')));
(async () => {
    if (await window.api.getSetting('notify_off') === '1') applyNotifyToggle(true);
})();

// Clear Gaming History Logic
document.getElementById('btn-clear-history').addEventListener('click', async () => {
    if (await showConfirm(t('confirm.clear_history'), 'Clear', true)) {
        const success = await window.api.clearHistory();
        if (success) { await loadGames(); await showAlert(t('alert.history_cleared')); }
    }
});

// Split internal App assets from external user data & handle absolute paths securely
function getSafePath(rawPath) {
    if (!rawPath) return '';
    let p = String(rawPath).replace(/\\/g, '/');

    // Route User Data to EXTERNAL baseDir
    if (p.startsWith('GameManagerConfig') && baseDir) {
        p = baseDir + '/' + p;
        if (!p.startsWith('/')) p = '/' + p;
        return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
    }
    else if (p.startsWith('~') && baseDir) {
        p = p.replace('~/GameAppBuild', baseDir);
        if (p.startsWith('~')) p = baseDir + p.substring(1);
        if (!p.startsWith('/')) p = '/' + p;
        return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
    }

    // Catch absolute paths (Linux/macOS starts with '/' or Windows starts with 'C:/')
    if (p.startsWith('/') || /^[a-zA-Z]:\//.test(p)) {
        return 'file://' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
    }

    // Internal ASSETS remain relative so they load securely from inside the AppImage
    return encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
}

// --- WINDOW CONTROLS ---
// macOS gets the real traffic lights (see main.js's titleBarStyle:'hidden'); the custom row
// stays hidden there via body.platform-darwin in CSS rather than removed, so nothing else that
// queries #btn-min/#btn-max/#btn-close has to know the host differs.
if (window.api.platform === 'darwin') document.body.classList.add('platform-darwin');
document.getElementById('btn-min').addEventListener('click', () => window.api.minimizeApp());
document.getElementById('btn-max').addEventListener('click', () => window.api.maximizeApp());
document.getElementById('btn-close').addEventListener('click', () => window.api.closeApp());

// ── DOS GAMES: which DOSBox runs them ──────────────────────────────────────
// The status line is the whole point of the card: "Native" is only meaningful if a
// native DOSBox is actually installed, so say plainly whether one is, and how to get it.
async function _refreshDosboxCard() {
    const el = document.getElementById('dosbox-status');
    if (!el) return;
    let st = { mode: 'auto', native: null };
    try { st = await window.api.dosboxStatus() || st; } catch (e) {}
    document.querySelectorAll('.dosbox-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === st.mode));

    // The whole point of this line: "Native" means nothing unless a native DOSBox is
    // actually installed, so say plainly which one is in use, and if none is, give the
    // command for *this* distribution rather than a guess.
    const cmds = [st.hint?.native, st.hint?.flatpak].filter(Boolean)
        .map(c => `<code style="user-select:text;">${escHtml(c)}</code>`).join(' &nbsp;or&nbsp; ');
    const name = st.native?.label || '';
    if (st.native) {
        const sandboxNote = st.native.flatpak
            ? ' <span style="color:var(--text_dim);">(Flatpak, if a game fails to start, its folder may be outside the sandbox.)</span>'
            : '';
        el.innerHTML = st.mode === 'bundled'
            ? `<span style="color:var(--text_dim);">Using GOG's DOSBox. <b>${escHtml(name)}</b> is installed if you want it.</span>`
            : `<span style="color:#66bb6a;">Using <b>${escHtml(name)}</b>.</span>${sandboxNote}`;
    } else {
        el.innerHTML = st.mode === 'native'
            ? `<span style="color:#ef5350;">No native DOSBox installed, so DOS games will not start.</span><br>` +
              `<span style="color:var(--text_dim);">Install one with ${cmds}, or switch back to Automatic.</span>`
            : `<span style="color:var(--text_dim);">No native DOSBox found, using GOG's, which works. ` +
              `For the better one: ${cmds}</span>`;
    }
}
document.querySelectorAll('.dosbox-mode-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
        await window.api.setDosboxMode(btn.dataset.val);
        _refreshDosboxCard();
    }));
_refreshDosboxCard();

// ── PICO-8 VISIBILITY ─────────────────────────────────────────────────────
let _hidePico8 = false;

// "Hide PICO-8" must mean *only* PICO-8. A library row can front several stores at once
// (Store = "PICO-8, GOG"), and a substring test reads that as a PICO-8 game and hides it,
// which is how a GOG copy of Wolfenstein 3D vanished from the gallery entirely because a
// PICO-8 demake happens to share its name. Same principle as resolveInstallState: only act
// on a multi-store row when *every* store agrees.
function _isPico8Only(store) {
    const toks = String(store || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    return toks.length > 0 && toks.every(t => t.includes('pico-8') || t.includes('pico8'));
}
function applyPico8Visibility(hide) {
    _hidePico8 = hide;
    window.api.setSetting('hide_pico8', hide ? '1' : '');
    document.querySelectorAll('.pico8-vis-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (hide ? 'hide' : 'show')));
    applyFilters();
}
document.querySelectorAll('.pico8-vis-btn').forEach(btn =>
    btn.addEventListener('click', () => applyPico8Visibility(btn.dataset.val === 'hide')));
(async () => {
    const saved = await window.api.getSetting('hide_pico8');
    if (saved === '1') applyPico8Visibility(true);
})();

// ── FREE-TO-PLAY VISIBILITY ────────────────────────────────────────────────
// Steam free-to-play games (game.FreeToPlay==1) are shown by default; the user can
// hide them from every library view via the Tools toggle or by clicking a "FREE"
// pill on any of them. Tags come from sync-steam (see main.js).
let _hideFreeGames = false;
function isFreeToPlay(game) { return game && (game.FreeToPlay == 1); }
function applyFreeGamesVisibility(hide) {
    _hideFreeGames = hide;
    window.api.setSetting('hide_free_games', hide ? '1' : '');
    document.querySelectorAll('.freegames-vis-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (hide ? 'hide' : 'show')));
    applyFilters();
    // If a gamepage is open, refresh its F2P pill (a hidden game may still be showing).
    const gp = document.getElementById('gamepage-f2p-pill');
    if (gp) gp.classList.toggle('hidden-mode', _hideFreeGames);
}
document.querySelectorAll('.freegames-vis-btn').forEach(btn =>
    btn.addEventListener('click', () => applyFreeGamesVisibility(btn.dataset.val === 'hide')));
// Pill click → the show/hide popup. When opened from a specific game's pill, also
// offer to hide just that one game (via the general hide system below).
let _f2pPromptGame = null;
function openFreeGamesPrompt(game = null) {
    _f2pPromptGame = game || null;
    document.querySelectorAll('#modal-free-games .freegames-vis-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.val === (_hideFreeGames ? 'hide' : 'show')));
    const oneBtn = document.getElementById('btn-f2p-hide-one');
    if (oneBtn) oneBtn.style.display = _f2pPromptGame ? 'block' : 'none';
    document.getElementById('modal-free-games')?.classList.add('active');
}
(async () => {
    const saved = await window.api.getSetting('hide_free_games');
    if (saved === '1') applyFreeGamesVisibility(true);
})();
// Popup dismissal: choosing Show/Hide inside it, the Close button, or a backdrop click.
document.querySelectorAll('#modal-free-games .freegames-vis-btn').forEach(btn =>
    btn.addEventListener('click', () => document.getElementById('modal-free-games')?.classList.remove('active')));
document.getElementById('btn-close-free-games')?.addEventListener('click', () =>
    document.getElementById('modal-free-games')?.classList.remove('active'));
document.getElementById('modal-free-games')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-free-games') e.currentTarget.classList.remove('active');
});

// ── MAC-NATIVE FILTER (macOS only) ──────────────────────────────────────────
// Which games have a real macOS build vs. Windows-only. GOG/Epic are tagged from library.db
// (free, local); Steam needs a live per-game lookup, so it's a user-triggered scan rather than
// something that runs on every sync, see scan-mac-native in main.js. The filter itself is just
// another qualifier in activeFilters (see QUALIFIER_FILTERS/applyFilters), reachable from the
// same "ALL GAMES ▾" dropdown Favourites/Want/Installed already live in, not a bespoke toggle,
// so it's exactly as easy to find as those.
function isMacNative(game) { return game && (game.MacNative == 1); }
if (window.api.platform === 'darwin') {
    document.getElementById('mac-native-tool-card')?.style.setProperty('display', '');
} else {
    // Not meaningful data on any other host, so REMOVE both surfaces rather than hide them.
    // Hiding is not enough in either case, for the same underlying reason: several code paths
    // walk the DOM instead of reading CSS. enhanceSelect()'s popup reads sel.options directly,
    // and the Control Panel used to reset `display` on EVERY .tools-section in three places
    // (openToolsModal, closeTools, and the search filter), which silently un-did the inline
    // display:none this card ships with the moment the panel was opened. Those three resets
    // are gone as of wave 2A. That shipped in 1.8.0:
    // Linux users saw a "Mac-Native Games" card offering a scan the backend refuses anyway
    // (scan-mac-native is gated on host.id === 'darwin').
    document.getElementById('gallery-category-mac-native')?.remove();
    document.getElementById('mac-native-tool-card')?.remove();
}
document.getElementById('btn-scan-mac-native')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-scan-mac-native');
    const status = document.getElementById('mac-native-scan-status');
    btn.disabled = true;
    window.api.onMacNativeScanProgress?.(p => {
        if (status && p.total) status.textContent = `${p.label || ''} (${p.scanned}/${p.total})`;
    });
    if (status) status.textContent = 'Scanning…';
    const r = await window.api.scanMacNative({ force: false });
    btn.disabled = false;
    if (!r.ok) { if (status) status.textContent = r.error === 'already_running' ? 'Already scanning…' : `Failed: ${r.error}`; return; }
    if (status) status.textContent = `Done, ${r.macNative} Mac-native games found.`;
    const res = await window.api.getGames();
    allGames = (res.games || []).filter(g => g.Game && g.Game !== 'null');
    applyFilters();
});

// ── HIDDEN GAMES (per-game hide; managed from the Control Panel) ────────────
// Any game can be hidden from every library view; hidden games live in the
// Hidden Games manager where they can be unhidden individually.
function isHidden(game) { return game && (game.Hidden == 1); }
async function setGameHidden(id, hidden) {
    const val = hidden ? 1 : 0;
    // Optimistic: patch the master list AND any active playlist snapshot in place, then re-render
    // immediately so the game disappears/reappears instantly, persist to the DB afterwards.
    for (const arr of [allGames, currentPlaylistGames]) {
        const g = arr && arr.find(x => String(x.id) === String(id));
        if (g) g.Hidden = val;
    }
    applyFilters();
    await window.api.setGameFlag(id, 'Hidden', val);
}
function renderHiddenGamesList() {
    const list = document.getElementById('hidden-games-list');
    if (!list) return;
    const hidden = allGames.filter(isHidden).sort((a, b) => (a.Game || '').localeCompare(b.Game || ''));
    const countEl = document.getElementById('hidden-games-count');
    if (countEl) countEl.textContent = hidden.length;
    const emptyEl = document.getElementById('hidden-games-empty');
    if (emptyEl) emptyEl.style.display = hidden.length ? 'none' : 'block';
    list.innerHTML = '';
    for (const g of hidden) {
        const row = document.createElement('div');
        row.className = 'hidden-game-row';
        const cover = g.CoverArt ? getSafePath(g.CoverArt) : '';
        row.innerHTML =
            `<div class="hg-cover">${cover ? `<img src="${cover}" loading="lazy">` : ''}</div>` +
            `<div class="hg-meta"><div class="hg-title">${g.Game || ''}</div><div class="hg-store">${g.Store || ''}</div></div>` +
            `<button class="hg-unhide" data-unhide="${g.id}">Unhide</button>`;
        list.appendChild(row);
    }
}
function openHiddenGamesModal() {
    renderHiddenGamesList();
    document.getElementById('modal-hidden-games')?.classList.add('active');
}
document.getElementById('hidden-games-list')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-unhide]');
    if (!btn) return;
    await setGameHidden(btn.dataset.unhide, false);
    renderHiddenGamesList();
});
document.getElementById('btn-open-hidden-games')?.addEventListener('click', openHiddenGamesModal);
// Manage Storage: open Installer on installed games sorted by size (GOG/Epic), or Steam's storage settings.
// ── COMPATIBILITY + STORAGE (absorbed from the Installer GUI) ──────────────────
// Installer's per-game setup modal and its storage view were the last two reasons
// to open that window. Both live here now, against the same library.db row.
let _compatGid = null;

function _fmtBytes(n) {
    if (!n) return '-';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
}

// Per-game entry point. A game reaches the compatibility panel only if it has a
// Installer row to edit. There is no window to fall back to any more, so a game
// without one says why instead of doing nothing.
function _openCompatFor(game) {
    const gid = game?.InstallerGameId || '';
    if (gid) { openCompatModal(gid, game.Game || ''); return true; }
    showAlert('This game has no Installer entry yet, install it through Clarity first, and its compatibility settings appear here.');
    return false;
}

async function openCompatModal(installerGameId, title = '') {
    _compatGid = installerGameId;
    const box = document.getElementById('modal-compat');
    document.getElementById('compat-game-name').textContent = title ? ', ' + title : '';
    document.getElementById('compat-status').textContent = '';
    box.classList.add('active');

    const res = await window.api.installerCompatGet(installerGameId);
    if (!res || !res.ok) {
        document.getElementById('compat-status').textContent = res?.error || 'Could not read this game\'s settings.';
        return;
    }
    const g = res.game;
    document.getElementById('compat-subtitle').textContent =
        [g.store ? g.store.toUpperCase() : '', g.platform || '', g.install_path || ''].filter(Boolean).join('  ·  ');

    // Proton list: the stored value may point at a runtime that is no longer installed,
    // so it is added as its own option rather than silently resetting to the default.
    const psel = document.getElementById('compat-proton');
    psel.innerHTML = '<option value="">Default (whatever Installer picks)</option>';
    const seen = new Set();
    (res.protons || []).forEach(pv => {
        const val = pv.path || pv;
        const name = pv.label || pv.name || val;
        if (seen.has(val)) return; seen.add(val);
        psel.insertAdjacentHTML('beforeend', `<option value="${escHtml(val)}">${escHtml(name)}</option>`);
    });
    if (g.proton_path && !seen.has(g.proton_path)) {
        psel.insertAdjacentHTML('beforeend', `<option value="${escHtml(g.proton_path)}">${escHtml(g.proton_path)} (not installed)</option>`);
    }
    psel.value = g.proton_path || '';

    // GOG play tasks, keyed by index, because two tasks can share an executable.
    const trow = document.getElementById('compat-row-target');
    const tsel = document.getElementById('compat-launch-target');
    if ((res.tasks || []).length > 1) {
        tsel.innerHTML = '<option value="">Default executable</option>';
        res.tasks.forEach(tk => tsel.insertAdjacentHTML('beforeend',
            `<option value="${escHtml(String(tk.index))}"${tk.isActive ? ' selected' : ''}>${escHtml(tk.name + (tk.isPrimary ? ' (default)' : ''))}</option>`));
        trow.style.display = 'flex';
    } else {
        trow.style.display = 'none';
    }

    document.getElementById('compat-prefix').value      = g.prefix_path || '';
    document.getElementById('compat-launch-args').value = g.launch_args || '';
    document.getElementById('compat-custom-exe').value  = g.custom_exe  || '';
    document.getElementById('compat-env').value         = g.custom_env  || '';
    document.getElementById('compat-winetricks').value  = g.winetricks  || '';
    document.getElementById('compat-notes').value       = g.notes       || '';
    // esync/fsync default ON for a game that has never been configured; the rest default OFF.
    document.getElementById('compat-esync').checked    = g.use_esync !== 0;
    document.getElementById('compat-fsync').checked    = g.use_fsync !== 0;
    document.getElementById('compat-nvapi').checked    = !!g.use_dxvk_nvapi;
    document.getElementById('compat-battleye').checked = !!g.use_battleye;
    document.getElementById('compat-eac').checked      = !!g.use_eac;
}

document.getElementById('btn-compat-close')?.addEventListener('click', () =>
    document.getElementById('modal-compat').classList.remove('active'));
document.getElementById('modal-compat')?.addEventListener('click', e => {
    if (e.target.id === 'modal-compat') e.currentTarget.classList.remove('active');
});

document.getElementById('btn-compat-save')?.addEventListener('click', async () => {
    if (!_compatGid) return;
    const status = document.getElementById('compat-status');
    status.textContent = 'Saving…';
    const patch = {
        prefix_path:    document.getElementById('compat-prefix').value.trim(),
        proton_path:    document.getElementById('compat-proton').value,
        launch_args:    document.getElementById('compat-launch-args').value.trim(),
        custom_exe:     document.getElementById('compat-custom-exe').value.trim(),
        custom_env:     document.getElementById('compat-env').value.trim(),
        winetricks:     document.getElementById('compat-winetricks').value.trim(),
        notes:          document.getElementById('compat-notes').value,
        use_esync:      document.getElementById('compat-esync').checked    ? 1 : 0,
        use_fsync:      document.getElementById('compat-fsync').checked    ? 1 : 0,
        use_dxvk_nvapi: document.getElementById('compat-nvapi').checked    ? 1 : 0,
        use_battleye:   document.getElementById('compat-battleye').checked ? 1 : 0,
        use_eac:        document.getElementById('compat-eac').checked      ? 1 : 0,
    };
    const r = await window.api.installerCompatSet({ installerGameId: _compatGid, patch });
    if (!r || !r.ok) { status.textContent = r?.error || 'Could not save.'; return; }
    // The launch target is not a plain column, the engine rewrites the stored task.
    const trow = document.getElementById('compat-row-target');
    if (trow.style.display !== 'none') {
        await window.api.installerSetLaunchTarget({
            installerGameId: _compatGid,
            taskIndex: document.getElementById('compat-launch-target').value,
        });
    }
    status.textContent = 'Saved.';
    setTimeout(() => { document.getElementById('modal-compat').classList.remove('active'); }, 550);
});

async function openStorageModal() {
    const box = document.getElementById('modal-storage');
    const list = document.getElementById('storage-list');
    const summary = document.getElementById('storage-summary');
    list.innerHTML = '';
    summary.textContent = 'Measuring installed games…';
    box.classList.add('active');
    const res = await window.api.installerStorageList();
    if (!res || !res.ok) { summary.textContent = res?.error || 'Could not read installed games.'; return; }
    if (!res.games.length) { summary.textContent = 'No installed games found.'; return; }
    summary.textContent = `${res.games.length} installed game${res.games.length === 1 ? '' : 's'} · ${_fmtBytes(res.total)} on disk`;
    list.innerHTML = res.games.map(g => `
        <div class="storage-row" data-id="${escHtml(g.id)}">
            <span class="sr-name" title="${escHtml(g.install_path || '')}">${escHtml(g.title || g.id)}</span>
            <span class="sr-store">${escHtml(g.store || '')}</span>
            <span class="sr-size">${_fmtBytes(g.bytes)}</span>
            <span class="sr-act">
                <button class="sr-move" data-id="${escHtml(g.id)}">Move</button>
                <button class="sr-del"  data-id="${escHtml(g.id)}">Delete</button>
            </span>
        </div>`).join('');

    // One handler on the list rather than two per row: the list is rebuilt on every
    // open, and per-row listeners would leak a set each time.
    list.onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const game = res.games.find(g => String(g.id) === btn.dataset.id);
        if (!game) return;
        if (btn.classList.contains('sr-move')) openMoveDialog(game);
        else if (btn.classList.contains('sr-del')) deleteInstalledGame(game);
    };
}

// ── Delete an installed game ─────────────────────────────────────────────────
// The confirm names the game, the folder and the size, because "are you sure?" on
// its own is a question nobody can answer.
async function deleteInstalledGame(game) {
    const ok = await showConfirm(
        `Delete ${game.title || game.id}?\n\n` +
        `This removes the installed files from:\n${game.install_path}\n\n` +
        `That frees ${_fmtBytes(game.bytes)}. The game stays in your library and can be installed again.\n\n` +
        `Save games and artwork are not touched.`,
        'Delete', true);
    if (!ok) return;
    const res = await window.api.installerDeleteGame({ gameId: game.id, installerGameId: game.id });
    if (!res || !res.ok) { showAlert(res?.error || 'Could not delete it.'); return; }
    await openStorageModal();
}

// ── Move an installed game to another drive or folder ────────────────────────
let _moveTarget = null;
async function openMoveDialog(game) {
    const modal = document.getElementById('modal-storage-move');
    const listEl = document.getElementById('move-target-list');
    const goBtn = document.getElementById('btn-move-go');
    const wrap = document.getElementById('move-progress-wrap');
    if (!modal) return;

    _moveTarget = null;
    goBtn.disabled = true;
    wrap.style.display = 'none';
    document.getElementById('move-progress-bar').style.width = '0%';
    document.getElementById('move-game-name').textContent = game.title || game.id;
    document.getElementById('move-game-where').textContent = `${game.install_path}  ·  ${_fmtBytes(game.bytes)}`;
    listEl.innerHTML = '<p style="font-size:11px; color:var(--text_dim); margin:4px 0;">Looking for drives…</p>';
    modal.classList.add('active');

    const res = await window.api.installerStorageTargets(game.install_path);
    const targets = (res && res.ok ? res.targets : []).filter(x => x.path !== _parentDir(game.install_path));
    if (!targets.length) {
        listEl.innerHTML = '<p style="font-size:11px; color:var(--text_dim); margin:4px 0;">No other drive found. Use the button below to pick a folder.</p>';
    } else {
        listEl.innerHTML = targets.map(x => `
            <button class="move-target${x.freeBytes !== null && x.freeBytes < game.bytes ? ' tight' : ''}" data-path="${escHtml(x.path)}">
                <span class="mt-label">${escHtml(x.label)}<span class="mt-path">${escHtml(x.path)}</span></span>
                <span class="mt-free">${x.freeBytes === null ? '' : _fmtBytes(x.freeBytes) + ' free'}</span>
            </button>`).join('');
        listEl.onclick = (e) => {
            const b = e.target.closest('.move-target');
            if (!b) return;
            listEl.querySelectorAll('.move-target').forEach(n => n.classList.remove('selected'));
            b.classList.add('selected');
            _moveTarget = b.dataset.path;
            goBtn.disabled = false;
        };
    }

    const close = () => { modal.classList.remove('active'); listEl.onclick = null; };
    document.getElementById('btn-move-cancel').onclick = close;
    modal.onclick = e => { if (e.target === modal) close(); };

    document.getElementById('btn-move-browse').onclick = async () => {
        // ⚠️ This handler answers with a plain path string or null, not an object.
        const picked = await window.api.installerPickDir(_moveTarget || game.install_path);
        if (!picked) return;
        _moveTarget = picked;
        listEl.querySelectorAll('.move-target').forEach(n => n.classList.remove('selected'));
        document.getElementById('move-game-where').textContent =
            `${game.install_path}  ->  ${picked}`;
        goBtn.disabled = false;
    };

    goBtn.onclick = async () => {
        if (!_moveTarget) return;
        goBtn.disabled = true;
        document.getElementById('btn-move-browse').disabled = true;
        wrap.style.display = '';
        document.getElementById('move-progress-note').textContent = 'Starting…';
        const res2 = await window.api.installerMoveGame({ gameId: game.id, targetDir: _moveTarget });
        document.getElementById('btn-move-browse').disabled = false;
        if (!res2 || !res2.ok) {
            wrap.style.display = 'none';
            goBtn.disabled = false;
            showAlert(res2?.error || 'Could not move it.');
            return;
        }
        close();
        showAlert(`${game.title || game.id} now lives in:\n${res2.to}` +
                  (res2.sameFs ? '' : '\n\nIt was copied across drives, so this took a while.'));
        await openStorageModal();
    };
}
function _parentDir(p) { return String(p || '').replace(/\/[^/]*$/, '') || '/'; }

// Live progress while a move is running.
window.api.onInstallerMoveProgress?.(d => {
    const bar = document.getElementById('move-progress-bar');
    const note = document.getElementById('move-progress-note');
    if (!bar || !note) return;
    bar.style.width = `${Math.max(0, Math.min(100, d.pct || 0))}%`;
    note.textContent = d.note ? `${d.note}… ${d.pct || 0}%` : `${d.pct || 0}%`;
});
document.getElementById('btn-close-storage')?.addEventListener('click', () =>
    document.getElementById('modal-storage').classList.remove('active'));
document.getElementById('modal-storage')?.addEventListener('click', e => {
    if (e.target.id === 'modal-storage') e.currentTarget.classList.remove('active');
});

document.getElementById('btn-storage-installer')?.addEventListener('click', openStorageModal);
document.getElementById('btn-storage-steam')?.addEventListener('click', () => window.api.openInstallUrl('steam://settings/storage'));

// ── Add to Desktop, per-game launcher via the --game deeplink ────────────────
function openShortcutDialog(game) {
    const modal = document.getElementById('modal-shortcut');
    if (!modal) return;
    document.getElementById('shortcut-game-name').textContent = game.Game || 'this game';
    modal.classList.add('active');
    const close = () => modal.classList.remove('active');
    const run = async (targets) => {
        close();
        const res = await window.api.addGameShortcut(game.id, targets);
        showAlert(res && res.ok ? (res.message || 'Shortcut created.')
                                : `Could not create the shortcut.${res && res.message ? '\n\n' + res.message : ''}`);
    };
    document.getElementById('btn-shortcut-both').onclick    = () => run({ menu: true,  desktop: true  });
    document.getElementById('btn-shortcut-menu').onclick    = () => run({ menu: true,  desktop: false });
    document.getElementById('btn-shortcut-desktop').onclick = () => run({ menu: false, desktop: true  });
    document.getElementById('btn-shortcut-cancel').onclick  = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
}

// ── Scan for Updates, GOG/Epic real check (+ optional in-CN update), Steam flag-only ──
const _storeBadge = { gog: '#a55eea', epic: '#4b7bec', steam: '#2a9d8f' };
function _renderUpdateRow(u) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--border_solid); border-radius:8px; background:var(--bg_panel);';
    const badge = `<span style="flex-shrink:0; font-size:9px; font-weight:800; letter-spacing:1px; padding:2px 6px; border-radius:4px; color:#fff; background:${_storeBadge[u.store] || '#888'};">${u.store.toUpperCase()}</span>`;
    const ver = (u.store === 'gog' || u.store === 'epic') && u.current
        ? `<div style="font-size:10px; color:var(--text_dim);">${escHtml(String(u.current))} &rarr; ${escHtml(String(u.latest))}</div>`
        : (u.store === 'steam' ? `<div style="font-size:10px; color:var(--text_dim);">Pending in Steam</div>` : '');
    row.innerHTML =
        `${badge}<div style="flex:1 1 auto; min-width:0;"><div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(u.name || 'Game')}</div>${ver}</div>`;
    const btn = document.createElement('button');
    btn.style.cssText = 'flex-shrink:0; font-size:11px; padding:7px 14px;';
    if (u.store === 'steam') {
        btn.textContent = 'Open in Steam';
        btn.onclick = () => window.api.openInstallUrl('steam://open/downloads');
    } else {
        btn.className = 'primary';
        btn.textContent = 'Update';
        btn.onclick = () => {
            document.getElementById('modal-updates')?.classList.remove('active');
            const game = allGames.find(g => g.id == u.id);
            // Re-running the install reconciles GOG/Epic to latest. The scan already knows
            // which store has the update, so go straight there, no store picker to answer.
            if (game) _installLauncher(game, u.store, game.LaunchCommand);
            else showAlert('This game is no longer in your library.');
        };
    }
    row.appendChild(btn);
    return row;
}

let _updateScanRunning = false;
async function runUpdateScan() {
    if (_updateScanRunning) return;
    _updateScanRunning = true;
    const modal   = document.getElementById('modal-updates');
    const statusEl = document.getElementById('updates-status');
    const listEl  = document.getElementById('updates-list');
    const fill    = document.getElementById('updates-progress-fill');
    const wrap    = document.getElementById('updates-progress-wrap');
    listEl.innerHTML = '';
    statusEl.textContent = 'Scanning your installed GOG, Epic and Steam games…';
    fill.style.width = '0%'; wrap.style.display = 'block';
    modal.classList.add('active');
    try {
        const res = await window.api.scanUpdates();
        const updates = (res && res.updates) || [];
        wrap.style.display = 'none';
        if (!updates.length) {
            statusEl.textContent = 'Everything is up to date. 🎉';
        } else {
            const n = updates.length;
            statusEl.textContent = `${n} game${n === 1 ? '' : 's'} with an update available. Updating is optional.`;
            updates.sort((a, b) => (a.store).localeCompare(b.store) || String(a.name).localeCompare(String(b.name)));
            for (const u of updates) listEl.appendChild(_renderUpdateRow(u));
        }
    } catch (e) {
        wrap.style.display = 'none';
        statusEl.textContent = 'Could not complete the update scan.';
    } finally {
        _updateScanRunning = false;
    }
}
window.api.onUpdateScanProgress?.((d) => {
    const statusEl = document.getElementById('updates-status');
    const fill = document.getElementById('updates-progress-fill');
    if (!statusEl || !d) return;
    if (d.total) fill.style.width = `${Math.round((d.scanned / d.total) * 100)}%`;
    if (d.label) statusEl.textContent = d.label + (d.total ? ` (${d.scanned}/${d.total})` : '');
});
// ── Genre detection ─────────────────────────────────────────────────────────
// The scan is paced by SteamSpy's one-request-a-second guidance, so it is minutes
// long by nature. It is therefore built to be interrupted: every game is written as
// it is classified, cancelling keeps the work so far, and re-running resumes.
let _genreScanRunning = false;

function openGenreModal() {
    const modal = document.getElementById('modal-genres');
    const done  = genreCoverage.classified, total = genreCoverage.total;
    const left  = Math.max(0, total - done);
    const mins  = Math.max(1, Math.round(left * 1.2 / 60));
    document.getElementById('genres-intro').innerHTML = left
        ? `<b>${left}</b> of your ${total} games still need a genre. The scan reads the tags players ` +
          `voted on for each one, so it works through them about one a second, roughly <b>${mins} minute${mins === 1 ? '' : 's'}</b>. ` +
          `You can close this and keep using the app, or stop it at any point and keep what it found.`
        : `All ${total} games already have a genre. Re-check them if you want the latest tags.`;
    document.getElementById('genres-progress-wrap').style.display = 'none';
    document.getElementById('genres-status').textContent = '';
    document.getElementById('genres-force').checked = !left;
    document.getElementById('btn-genres-start').textContent = _genreScanRunning ? 'Stop Scan' : 'Start Scan';
    modal.classList.add('active');
}

async function runGenreScan() {
    if (_genreScanRunning) { window.api.cancelGenreScan(); return; }
    _genreScanRunning = true;
    const startBtn = document.getElementById('btn-genres-start');
    const wrap = document.getElementById('genres-progress-wrap');
    const fill = document.getElementById('genres-progress-fill');
    const statusEl = document.getElementById('genres-status');
    startBtn.textContent = 'Stop Scan';
    wrap.style.display = 'block';
    fill.style.width = '0%';
    document.getElementById('genres-force-row').style.display = 'none';

    const force = document.getElementById('genres-force').checked;
    try {
        const res = await window.api.scanGenres({ force });
        statusEl.textContent = res?.ok
            ? `Sorted ${res.classified} game${res.classified === 1 ? '' : 's'}${res.cancelled ? ' before you stopped it' : ''}.`
            : 'Scan failed.';
        fill.style.width = '100%';
        await loadGenres();
        await loadGames();          // rows carry Genres/PrimaryGenre, re-read to show them
    } catch (e) {
        statusEl.textContent = 'Scan failed.';
    } finally {
        _genreScanRunning = false;
        startBtn.textContent = 'Start Scan';
        document.getElementById('genres-force-row').style.display = '';
        opToastDone('Genres updated');
    }
}

window.api.onGenreScanProgress(p => {
    if (!p) return;
    const pct = p.total ? Math.round((p.scanned / p.total) * 100) : 0;
    const fill = document.getElementById('genres-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const statusEl = document.getElementById('genres-status');
    if (statusEl) statusEl.textContent = p.label ? `${p.scanned} / ${p.total} · ${p.label}` : `${p.scanned} / ${p.total}`;
    // Mirrored to the global toast so closing the modal doesn't hide the progress.
    opToast(`Detecting genres, ${p.scanned}/${p.total}`, pct);
});

document.getElementById('btn-scan-genres')?.addEventListener('click', openGenreModal);
document.getElementById('btn-genres-start')?.addEventListener('click', runGenreScan);
document.getElementById('btn-genres-close')?.addEventListener('click', () =>
    document.getElementById('modal-genres')?.classList.remove('active'));
document.getElementById('modal-genres')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-genres')) e.currentTarget.classList.remove('active');
});

document.getElementById('btn-scan-updates')?.addEventListener('click', runUpdateScan);
document.getElementById('btn-close-updates')?.addEventListener('click', () =>
    document.getElementById('modal-updates')?.classList.remove('active'));
document.getElementById('modal-updates')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-updates')) e.currentTarget.classList.remove('active');
});
document.getElementById('btn-close-hidden-games')?.addEventListener('click', () =>
    document.getElementById('modal-hidden-games')?.classList.remove('active'));

// ── DLC panel (installed GOG games) ─────────────────────────────────────────
let _dlcGame = null;
async function openDlcModal(game) {
    _dlcGame = game;
    const modal = document.getElementById('modal-dlc');
    document.getElementById('dlc-modal-game').textContent = game.Game ? `· ${game.Game}` : '';
    const statusEl = document.getElementById('dlc-status');
    document.getElementById('dlc-list').innerHTML = '';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Loading DLCs…';
    document.getElementById('btn-dlc-install-all').style.display = 'none';
    document.getElementById('btn-dlc-reset').style.display = 'none';
    modal.classList.add('active');
    let res;
    try { res = await window.api.dlcList(game.InstallerGameId, null); }
    catch (e) { res = { ok: false, error: e.message, dlcs: [] }; }
    if (_dlcGame !== game || !modal.classList.contains('active')) return;  // closed / switched while loading
    renderDlcModal(game, res);
}

function renderDlcModal(game, res) {
    const listEl   = document.getElementById('dlc-list');
    const statusEl = document.getElementById('dlc-status');
    const allBtn   = document.getElementById('btn-dlc-install-all');
    const resetBtn = document.getElementById('btn-dlc-reset');
    listEl.innerHTML = '';
    const dlcs = (res && res.dlcs) || [];
    if (!res || !res.ok || !dlcs.length) {
        statusEl.style.display = 'block';
        statusEl.textContent = (res && !res.ok) ? (res.error || 'Could not load DLCs.')
                                                : 'No DLCs to install here. Any DLCs you own for this game are already bundled into the base install.';
        allBtn.style.display = 'none'; resetBtn.style.display = 'none';
        return;
    }
    statusEl.style.display = 'none';
    for (const d of dlcs) {
        const row = document.createElement('div'); row.className = 'dlc-row';
        const meta = document.createElement('div'); meta.className = 'dlc-meta';
        const title = document.createElement('div'); title.className = 'dlc-title'; title.textContent = d.title;
        const sub = document.createElement('div'); sub.className = 'dlc-sub';
        const sizeStr = d.disk_size > 1024 * 1024 ? ' · ' + _fmtBytes(d.disk_size) : '';
        sub.textContent = (d.installed ? 'Installed' : 'Not installed') + sizeStr;
        meta.appendChild(title); meta.appendChild(sub); row.appendChild(meta);
        // No per-DLC install button: GOG's downloader can't safely install a single DLC (its --dlcs
        // filter removes tracked files, which can delete the base game). Badges are informational; the
        // one safe operation is "Install all DLCs" (adds every owned DLC, never removes the base).
        const badge = document.createElement('div');
        if (d.installed) { badge.className = 'dlc-installed'; badge.textContent = '✓ INSTALLED'; }
        else { badge.className = 'dlc-sub'; badge.style.flexShrink = '0'; badge.textContent = 'not installed'; }
        row.appendChild(badge);
        listEl.appendChild(row);
    }
    const missing = dlcs.filter(d => !d.installed);
    allBtn.style.display = missing.length ? 'block' : 'none';
    allBtn.textContent = `Install all DLCs (${missing.length} missing)`;
    allBtn.onclick = async () => {
        const ok = await showConfirm(
            `Install all ${dlcs.length} owned DLC(s) for "${game.Game}"?\n\nGOG installs DLCs as a set, so this downloads every owned DLC for the game (already-installed ones are skipped).`,
            'Install all DLCs');
        if (!ok) return;
        _dlcEnqueue(game, 'all', null, `${game.Game}, all DLCs`); closeDlcModal();
    };
    resetBtn.style.display = dlcs.some(d => d.installed) ? 'inline-block' : 'none';
}

function _dlcEnqueue(game, mode, ids, label) {
    enqueueDownload({ gameId: game.id, gid: game.InstallerGameId, name: label, store: 'GOG', dir: null,
        dlc: { mode, ids }, dlcKey: `${game.id}:dlc:${mode}:${(ids || []).join(',')}` });
}
function closeDlcModal() { _dlcGame = null; document.getElementById('modal-dlc')?.classList.remove('active'); }

document.getElementById('btn-close-dlc')?.addEventListener('click', closeDlcModal);
document.getElementById('modal-dlc')?.addEventListener('click', (e) => { if (e.target.id === 'modal-dlc') closeDlcModal(); });

// ── Save Manager (installed GOG games) ──────────────────────────────────────
// Locate a GOG game's saves, back them up to a portable .zip, restore them.
let _savesGame = null;
async function openSavesModal(game) {
    _savesGame = game;
    const modal = document.getElementById('modal-saves');
    document.getElementById('saves-modal-game').textContent = game.Game ? `· ${game.Game}` : '';
    const statusEl = document.getElementById('saves-status');
    document.getElementById('saves-list').innerHTML = '';
    document.getElementById('saves-backups').innerHTML = '';
    document.getElementById('saves-override-note').style.display = 'none';
    statusEl.style.display = 'block';
    statusEl.textContent = 'Locating saves…';
    document.getElementById('btn-saves-backup').style.display = 'none';
    modal.classList.add('active');
    let res;
    try { res = await window.api.savesResolve(game.id); }
    catch (e) { res = { ok: false, error: e.message, candidates: [] }; }
    if (_savesGame !== game || !modal.classList.contains('active')) return;   // closed / switched while loading
    renderSavesModal(game, res);
}

function _fmtSaveDate(ts) { try { return new Date(ts).toLocaleString(); } catch { return ''; } }
function _saveBadge(src, store) {
    if (src === 'store')  return { text: store === 'epic' ? 'from Epic' : 'from GOG', color: '#5be27a', sub: store === 'epic' ? 'declared by Epic' : 'declared by GOG' };
    if (src === 'manual') return { text: 'you chose this', color: 'var(--accent)', sub: 'your chosen folder' };
    return { text: 'detected', color: 'var(--text_dim)', sub: 'detected in the Wine prefix' };
}

function renderSavesModal(game, res) {
    const listEl    = document.getElementById('saves-list');
    const statusEl  = document.getElementById('saves-status');
    const backupsEl = document.getElementById('saves-backups');
    const noteEl    = document.getElementById('saves-override-note');
    const backupBtn = document.getElementById('btn-saves-backup');
    const restoreBtn= document.getElementById('btn-saves-restore');
    const locateBtn = document.getElementById('btn-saves-locate');
    listEl.innerHTML = ''; backupsEl.innerHTML = '';

    // Restore (from any backup zip) and Locate are always available.
    restoreBtn.style.display = 'inline-block';
    restoreBtn.onclick = () => doSavesRestore(game, null);
    locateBtn.style.display = 'inline-block';

    // Manual-override note + "use auto-detect" escape hatch.
    if (res && res.override) {
        noteEl.style.display = 'block';
        noteEl.innerHTML = 'Using a folder you picked. <a href="#" id="saves-clear-override" style="color:var(--accent);">Use auto-detect instead</a>';
        noteEl.querySelector('#saves-clear-override').onclick = async (e) => {
            e.preventDefault();
            await window.api.savesClearOverride(game.id);
            openSavesModal(game);
        };
    } else { noteEl.style.display = 'none'; }

    const cands = (res && res.candidates) || [];
    if (!cands.length) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = res && res.native
            ? 'Native Linux game, its save location can\'t be auto-detected.<br>Use <strong>Locate saves…</strong> to point at the folder.'
            : (!res || !res.ok) ? ('Could not read this game\'s saves.' + (res && res.error ? '<br>' + res.error : ''))
            : 'No saves found yet, play the game first, then come back.<br>If it saves somewhere unusual, use <strong>Locate saves…</strong>.';
        backupBtn.style.display = 'none';
        renderSaveBackups(game, (res && res.backups) || [], backupsEl);   // history still usable
        return;
    }
    statusEl.style.display = 'none';

    for (const c of cands) {
        const row = document.createElement('label'); row.className = 'dlc-row'; row.style.cursor = 'pointer'; row.title = c.dir;
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'save-cand'; cb.checked = !!c.checked; cb.dataset.dir = c.dir;
        cb.style.flexShrink = '0'; cb.style.width = '16px'; cb.style.height = '16px';
        const meta = document.createElement('div'); meta.className = 'dlc-meta';
        const title = document.createElement('div'); title.className = 'dlc-title'; title.textContent = c.label;
        const b = _saveBadge(c.source, res && res.store);
        const sub = document.createElement('div'); sub.className = 'dlc-sub'; sub.textContent = b.sub;
        meta.appendChild(title); meta.appendChild(sub);
        const badge = document.createElement('div'); badge.className = 'dlc-sub'; badge.style.flexShrink = '0'; badge.style.color = b.color; badge.style.fontWeight = '700'; badge.textContent = b.text;
        row.appendChild(cb); row.appendChild(meta); row.appendChild(badge);
        listEl.appendChild(row);
    }

    backupBtn.style.display = 'block';
    backupBtn.textContent = 'Back Up Now';
    backupBtn.onclick = () => doSavesBackup(game);
    renderSaveBackups(game, (res && res.backups) || [], backupsEl);
}

function renderSaveBackups(game, backups, el) {
    el.innerHTML = '';
    if (!backups.length) return;
    const h = document.createElement('div'); h.className = 'dlc-sub'; h.style.margin = '12px 0 6px'; h.style.textTransform = 'uppercase'; h.style.letterSpacing = '1px'; h.textContent = 'Previous backups';
    el.appendChild(h);
    for (const b of backups.slice(0, 8)) {
        const row = document.createElement('div'); row.className = 'dlc-row';
        const meta = document.createElement('div'); meta.className = 'dlc-meta';
        const t = document.createElement('div'); t.className = 'dlc-title'; t.textContent = String(b.path).split('/').pop(); t.title = b.path;
        const s = document.createElement('div'); s.className = 'dlc-sub';
        s.textContent = `${_fmtSaveDate(b.created)}${b.bytes ? ' · ' + _fmtBytes(b.bytes) : ''}${b.source === 'pre-restore' ? ' · safety snapshot' : ''}`;
        meta.appendChild(t); meta.appendChild(s);
        const rb = document.createElement('button'); rb.className = 'dlc-install-btn'; rb.textContent = 'Restore'; rb.style.flexShrink = '0';
        rb.onclick = () => doSavesRestore(game, b.path);
        const del = document.createElement('button'); del.className = 'dlc-install-btn'; del.textContent = 'Delete'; del.style.flexShrink = '0';
        del.style.background = 'transparent'; del.style.border = '1px solid #ef5350'; del.style.color = '#ef5350';
        del.title = 'Delete this backup file';
        del.onclick = async () => {
            const ok = await showConfirm(`Delete this backup file?\n\n${b.path}\n\nThis only removes the .zip, your live saves are untouched.`, 'Delete', true);
            if (!ok) return;
            const r = await window.api.savesDeleteBackup(game.id, b.path);
            if (r && r.ok) { if (_savesGame === game) openSavesModal(game); }
            else showAlert('Could not delete the backup: ' + ((r && r.error) || 'unknown error'));
        };
        row.appendChild(meta); row.appendChild(rb); row.appendChild(del);
        el.appendChild(row);
    }
}

async function doSavesBackup(game) {
    const dirs = Array.from(document.querySelectorAll('#saves-list input.save-cand:checked')).map(cb => cb.dataset.dir);
    if (!dirs.length) { showAlert('Select at least one save folder to back up.'); return; }
    const btn = document.getElementById('btn-saves-backup');
    const prev = btn.textContent; btn.disabled = true; btn.textContent = 'Backing up…';
    let res; try { res = await window.api.savesBackup(game.id, dirs); } catch (e) { res = { ok: false, error: e.message }; }
    btn.disabled = false; btn.textContent = prev;
    if (res && res.ok) { showAlert(`Backed up ${res.dirs} folder(s) to:\n${res.path}`); if (_savesGame === game) openSavesModal(game); }
    else if (res && !res.canceled) showAlert('Backup failed: ' + (res.error || 'unknown error'));
}

async function doSavesRestore(game, zipPath) {
    // Step 1: resolve targets (opens a native file picker only when no backup was passed).
    let pv; try { pv = await window.api.savesRestorePreview(game.id, zipPath || null); } catch (e) { pv = { ok: false, error: e.message }; }
    if (!pv || !pv.ok) { if (pv && !pv.canceled) showAlert('Restore failed: ' + (pv.error || 'unknown error')); return; }
    // Step 2: our OWN themed confirm (native message box replaced).
    const ok = await showConfirm(
        `Restore saves for ${pv.title}?\n\nThis overwrites the current save folder(s):\n\n${pv.targets.join('\n')}\n\nA safety snapshot of your current saves is made first.`,
        'Restore');
    if (!ok) return;
    // Step 3: commit (snapshot + extract).
    let res; try { res = await window.api.savesRestoreCommit(game.id, pv.zipPath); } catch (e) { res = { ok: false, error: e.message }; }
    if (res && res.ok) { showAlert(`Restored ${res.restored} file(s).\nA safety snapshot of your previous saves was made first.`); if (_savesGame === game) openSavesModal(game); }
    else if (res && !res.canceled) showAlert('Restore failed: ' + (res.error || 'unknown error'));
}

function closeSavesModal() { _savesGame = null; document.getElementById('modal-saves')?.classList.remove('active'); }
document.getElementById('btn-close-saves')?.addEventListener('click', closeSavesModal);
document.getElementById('modal-saves')?.addEventListener('click', (e) => { if (e.target.id === 'modal-saves') closeSavesModal(); });
document.getElementById('btn-saves-locate')?.addEventListener('click', async () => {
    if (!_savesGame) return;
    const res = await window.api.savesSetOverride(_savesGame.id);
    if (res && res.ok) openSavesModal(_savesGame);
    else if (res && res.error) showAlert('Could not set the save folder: ' + res.error);
});

// Save Manager, dedicated help/guide modal (opened by "LEARN MORE").
document.getElementById('saves-learn-more')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('modal-saves-help')?.classList.add('active'); });
document.getElementById('btn-close-saves-help')?.addEventListener('click', () => document.getElementById('modal-saves-help')?.classList.remove('active'));
document.getElementById('modal-saves-help')?.addEventListener('click', (e) => { if (e.target.id === 'modal-saves-help') document.getElementById('modal-saves-help')?.classList.remove('active'); });
document.getElementById('btn-dlc-reset')?.addEventListener('click', async () => {
    const game = _dlcGame; if (!game) return;
    const ok = await showConfirm(
        `Reset DLCs for "${game.Game}"?\n\nThis reinstalls the base game with NO DLCs, it re-downloads the entire game. Use this to remove installed DLCs.`,
        'Reset DLCs', true);
    if (!ok) return;
    _dlcEnqueue(game, 'reset', null, `${game.Game}, reinstalling (no DLCs)`);
    closeDlcModal();
});
document.getElementById('modal-hidden-games')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-hidden-games') e.currentTarget.classList.remove('active');
});
// F2P popup: "Hide this game only", hides just the game whose pill was clicked.
document.getElementById('btn-f2p-hide-one')?.addEventListener('click', async () => {
    if (_f2pPromptGame) await setGameHidden(_f2pPromptGame.id, true);
    document.getElementById('modal-free-games')?.classList.remove('active');
});

// ── CORNER STYLE (sharp vs round) ─────────────────────────────────────────
// 'sharp' = flat look (corners-flat on body); 'round' = the previous rounded
// style. One layout now, so it applies unconditionally.
let _cornersStyle = 'sharp';
function applyCornersStyle() {
    document.body.classList.toggle('corners-flat', _cornersStyle === 'sharp');
}

// ── LAYOUT ────────────────────────────────────────────────────────────────
// There is one layout: the icon side rail.
//
// The app carried 24 across four families, and not one of them could be reached
// in a shipped build, startup always called applyLayoutMode('rail') and ignored
// the saved layout_mode, while the picker card sat behind display:none. Between
// them they cost roughly 9,000 lines of renderer and CSS, so they were retired
// rather than revived: TTY and Ancient-OS first, then the flat family, the split
// pane, Commander, and finally the labelled sidebar and top nav.
//
// applyLayoutMode survives as the single place that stamps the layout class and
// the corner treatment, because init and the corners setting both call it.
// Any layout_mode left in an older install is simply ignored.
function applyLayoutMode() {
    document.getElementById('app-container').classList.add('layout-rail');
    document.body.classList.toggle('corners-flat', _cornersStyle === 'sharp');
    localStorage.setItem('clarity_layout_mode', 'rail');
}

// ════════════════════════════════════════════════════════════════════════════
//  HOME, "Control Room" dashboard (optional start screen preceding the library)
//  Stats come from the shared core engine via window.api.getHomeStats(); the
//  same engine feeds Couch's Home, so the numbers never drift between faces.
// ════════════════════════════════════════════════════════════════════════════
const HOME_WIDGETS = [
    { key: 'daily',    label: 'The Daily Grind' },
    { key: 'continue', label: 'Continue Playing' },
    { key: 'backlog',  label: 'Backlog Weight' },
    { key: 'overview', label: 'Library Overview' },
    { key: 'stores',   label: 'Store Breakdown' },
    { key: 'proton',   label: 'Proton Readiness' },
    { key: 'genres',   label: 'Top Genres' },
    { key: 'roulette', label: 'Roulette' },
    { key: 'recent',   label: 'Recently Imported' },
    { key: 'played',   label: 'Recently Played' },
    { key: 'gems',     label: 'Hidden Gems' },
    { key: 'mostplayed', label: 'Most Played' },
    { key: 'couchnight', label: 'Couch Night' },
    { key: 'franchise', label: 'Franchise Spotlight' },
    { key: 'beaten',   label: 'Beaten (completion)' },
    { key: 'completion', label: 'Achievement Completion' },
    { key: 'throwback', label: 'Throwback' },
    { key: 'disk',     label: 'Disk Footprint' },
    { key: 'wrapped',  label: 'Year in Review' },
    { key: 'wishlist', label: 'Wishlist & Deals' },
    { key: 'freebies', label: 'Free This Week' },
    { key: 'news',     label: 'Gaming News' },
    { key: 'gamenews', label: "Your Games, What's New" },
    { key: 'protonwatch', label: 'Proton Watch' },
];
// Online widgets make network calls, opt-in only.
const HOME_ONLINE = new Set(['wishlist', 'freebies', 'news', 'gamenews', 'protonwatch']);
// Default Home = a lean handful of widgets covering local stats plus one online feed.
// Everything else (Steam-playtime, disk/achievement scans, the other online widgets, and the
// heavier "extras") is opt-in via "+ Add Widget".
const HOME_DEFAULT_SET = new Set(['roulette', 'throwback', 'continue', 'gems', 'freebies', 'news', 'wishlist']);
const HOME_DEFAULT = HOME_WIDGETS.map(w => w.key).filter(k => HOME_DEFAULT_SET.has(k));
// 2D layout defaults on a 6-column grid (cellHeight 140px): { w, h, minW, minH } in cells.
const HOME_GS = {
    daily:      { w:2, h:2, minW:2, minH:2 }, continue:   { w:2, h:2, minW:2, minH:2 },
    backlog:    { w:2, h:2, minW:1, minH:1 }, overview:   { w:6, h:1, minW:2, minH:1 },
    stores:     { w:2, h:2, minW:2, minH:2 }, proton:     { w:2, h:2, minW:2, minH:2 },
    genres:     { w:2, h:2, minW:2, minH:2 }, roulette:   { w:2, h:2, minW:2, minH:2 },
    recent:     { w:6, h:2, minW:3, minH:2 }, played:     { w:6, h:2, minW:3, minH:2 },
    gems:       { w:6, h:2, minW:3, minH:2 }, mostplayed: { w:6, h:2, minW:3, minH:2 },
    couchnight: { w:6, h:2, minW:3, minH:2 }, franchise:  { w:6, h:2, minW:3, minH:2 },
    beaten:     { w:2, h:2, minW:2, minH:2 }, completion: { w:2, h:2, minW:2, minH:2 },
    throwback:  { w:2, h:2, minW:2, minH:2 }, disk:       { w:3, h:2, minW:2, minH:2 },
    wrapped:    { w:6, h:2, minW:3, minH:2 }, wishlist:   { w:6, h:2, minW:3, minH:2 },
    freebies:   { w:6, h:2, minW:3, minH:2 }, news:       { w:3, h:2, minW:2, minH:2 },
    gamenews:   { w:3, h:2, minW:2, minH:2 }, protonwatch:{ w:3, h:2, minW:2, minH:2 },
};
// Starting arrangement for new installs (and Reset): 6-col grid.
//  row 1: Roulette · Throwback · Continue Playing   (w2 each)
//  row 2: Hidden Gems · Free This Week              (w3 each)
//  row 3: Gaming News · Wishlist                    (w3 each, double height)
const HOME_DEFAULT_LAYOUT = {
    roulette:  { x:0, y:0, w:2, h:2 },
    throwback: { x:2, y:0, w:2, h:2 },
    continue:  { x:4, y:0, w:2, h:2 },
    gems:      { x:0, y:2, w:3, h:2 },
    freebies:  { x:3, y:2, w:3, h:2 },
    news:      { x:0, y:4, w:3, h:4 },
    wishlist:  { x:3, y:4, w:3, h:4 },
};
// Theme-derived chart palette, resolves against the active theme's CSS vars
// (color-mix is evaluated live), so the donut follows whatever theme is applied.
const HOME_PALETTE = [
    'var(--accent)',
    'color-mix(in srgb, var(--accent) 52%, var(--bg))',
    'var(--text_sec)',
    'color-mix(in srgb, var(--accent) 80%, var(--text_main))',
    'color-mix(in srgb, var(--accent) 42%, var(--text_dim))',
    'var(--text_dim)',
    'color-mix(in srgb, var(--accent) 88%, #000)',
    'color-mix(in srgb, var(--text_sec) 50%, var(--bg))',
];
let _homeEnabled = false;
let _homeWidgets = HOME_DEFAULT.slice();
let _homeLayout = { ...HOME_DEFAULT_LAYOUT };   // key → { x, y, w, h }; seeded with the default arrangement
let _homeEditMode = false, _gsGrid = null;
let _homeSnap = null;
let _homeClockTimer = null;
let _homeClockOn = true;   // faux-LCD header clock, show/hide via Customize Home

// Live clock for the Home header, ticks once a second while the Home view is on
// screen and self-clears when it isn't (so it never runs in the background).
function _updateHomeClock() {
    const cEl = document.getElementById('home-clock');
    const onHome = document.getElementById('view-home')?.classList.contains('active');
    if (!cEl || !onHome) { if (_homeClockTimer) { clearInterval(_homeClockTimer); _homeClockTimer = null; } return; }
    const now = new Date();
    cEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const hEl = document.getElementById('home-hello');
    if (hEl) { const h = now.getHours(); hEl.textContent = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
}
function _applyHomeClockVis() {
    const lcd = document.getElementById('home-lcd');
    if (lcd) lcd.classList.toggle('clock-off', !_homeClockOn);
}
function _startHomeClock() {
    if (_homeClockTimer) clearInterval(_homeClockTimer);
    _applyHomeClockVis();
    _updateHomeClock();
    _homeClockTimer = setInterval(_updateHomeClock, 1000);
}

async function loadHomeConfig() {
    _homeEnabled = (await window.api.getSetting('home_enabled')) === '1';
    _homeClockOn = (await window.api.getSetting('home_clock')) !== '0';   // default ON
    try { const raw = await window.api.getSetting('home_widgets'); if (raw) { const a = JSON.parse(raw); if (Array.isArray(a) && a.length) _homeWidgets = a.filter(k => HOME_GS[k]); } } catch (e) {}
    try { const raw = await window.api.getSetting('home_layout'); if (raw) { const o = JSON.parse(raw); if (o && typeof o === 'object') _homeLayout = o; } } catch (e) {}
}
function saveHomeConfig() {
    window.api.setSetting('home_enabled', _homeEnabled ? '1' : '');
    window.api.setSetting('home_clock', _homeClockOn ? '1' : '0');
    window.api.setSetting('home_widgets', JSON.stringify(_homeWidgets));
    window.api.setSetting('home_layout', JSON.stringify(_homeLayout));
}

function _hImg(t) { if (!t) return ''; const p = t.CoverArt || t.HeroArt || t.Logo || ''; return p ? getSafePath(p) : ''; }
function openHomeGameById(id, fallback) {
    const g = allGames.find(x => String(x.id) === String(id)) || fallback;
    if (!g) return;
    // The grid switch is only there to put the library behind the floating panel. If a panel is
    // already floating the library is already behind it, and going via the grid would just start
    // a close animation we immediately cancel, so swap the contents in place instead.
    if (!document.body.classList.contains('gamepage-overlay')) switchView(lastGridView);
    openGamepage(g);
}

// Opened with --game=<id> (the Clock links its artwork back here). If the library hasn't
// finished loading, wait for it rather than silently doing nothing.
window.api.onOpenGame?.(id => {
    whenLibraryReady(() => openHomeGameById(id));
});

// A request that arrives before the library is loaded is not a request to ignore, the app
// may have been started *by* it. Wait the five seconds it takes, then act.
function whenLibraryReady(fn, attempt = 0) {
    if (Array.isArray(allGames) && allGames.length) { fn(); return; }
    if (attempt < 20) setTimeout(() => whenLibraryReady(fn, attempt + 1), 250);
}

// --play=<id>, the Omarchy launcher overlay's Enter. Deliberately the same call the Play
// button makes, so the store picker, the engine and IWAD dialogs, the last-played write and
// the install-state check all happen exactly as they do for a click.
// ⚠️ An uninstalled game opens its page instead of failing quietly: that page is where the
// Install button is, which is what someone who just typed its name actually wants next.
window.api.onPlayGame?.(id => {
    whenLibraryReady(() => {
        const game = allGames.find(g => String(g.id) === String(id));
        if (!game) return;
        if (!isGameInstalled(game)) { openHomeGameById(game.id); return; }
        verifyAndLaunch(game.id, game.LaunchCommand);
    });
});

// --action=<id>, one of the command palette's actions, asked for from outside.
window.api.onRunAction?.(id => {
    whenLibraryReady(() => runPaletteAction(id));
});

function _homeFeatured(t, pill) {
    if (!t) return `<div class="hc-empty">Nothing here yet.</div>`;
    const meta = [t.Store, (t.GENRE || '').split(',')[0].trim(), t.METACRITIC ? ('MC ' + t.METACRITIC) : '', t.HLTB_Main].filter(Boolean).join(' &middot; ');
    const cov = _hImg(t);
    return `<div class="hc-feature" data-gid="${t.id}">${cov ? `<img class="cov" src="${cov}">` : `<div class="cov"></div>`}<div class="meta"><span class="hc-pill">${pill}</span><div class="t">${escHtml(t.Game || '')}</div><div class="s">${meta}</div></div></div>`;
}
function _homeBars(items) {
    if (!items || !items.length) return `<div class="hc-empty">No data yet.</div>`;
    const max = Math.max(...items.map(i => i.count)) || 1;
    return `<div class="hc-bars">${items.slice(0, 6).map(i => `<div class="hc-bar"><span class="bn">${escHtml(i.label)}</span><span class="bt"><span class="bf" style="width:${Math.round(i.count / max * 100)}%"></span></span><span class="bc">${i.count}</span></div>`).join('')}</div>`;
}
function _homeDonut(items) {
    if (!items || !items.length) return `<div class="hc-empty">No data yet.</div>`;
    const top = items.slice(0, 7);
    const total = top.reduce((s, i) => s + i.count, 0) || 1;
    let acc = 0; const stops = [], legend = [];
    top.forEach((it, idx) => {
        const col = HOME_PALETTE[idx % HOME_PALETTE.length];
        const a = acc / total * 360; acc += it.count; const b = acc / total * 360;
        stops.push(`${col} ${a}deg ${b}deg`);
        legend.push(`<div><i style="background:${col}"></i><span>${escHtml(it.label)}</span><span style="color:var(--text_dim); margin-left:auto; font-weight:800;">${it.count}</span></div>`);
    });
    return `<div class="hc-donut-wrap"><div class="hc-donut" style="background:conic-gradient(${stops.join(',')})"></div><div class="hc-legend">${legend.join('')}</div></div>`;
}
function _homeTileRow(items, empty) {
    if (!items || !items.length) return `<div class="hc-empty">${empty}</div>`;
    return `<div class="hc-row">${items.map(t => { const c = _hImg(t); return `<div class="hc-tile" data-gid="${t.id}">${c ? `<img src="${c}" loading="lazy">` : `<div class="ph"></div>`}<div class="tn">${escHtml(t.Game || '')}</div></div>`; }).join('')}</div>`;
}
function _homeSkelRow(n) { return `<div class="hc-row">${Array.from({ length: n }).map(() => `<div class="hc-skel" style="width:92px;height:122px;border-radius:7px;flex-shrink:0;"></div>`).join('')}</div>`; }
function _homeSkelList(n) { return `<div class="news-list">${Array.from({ length: n }).map(() => `<div style="padding:11px 8px;"><div class="hc-skel" style="height:13px;width:72%;border-radius:4px;"></div><div class="hc-skel" style="height:9px;width:34%;border-radius:4px;margin-top:7px;"></div></div>`).join('')}</div>`; }
function _homePlaytimeLabel(min) { const m = Number(min) || 0; return m >= 60 ? Math.round(m / 60) + 'h' : m + 'm'; }
function _homePlaytimeRow(items, key, empty) {
    if (!items || !items.length) return `<div class="hc-empty">${empty}</div>`;
    return `<div class="hc-row">${items.map(t => { const c = _hImg(t); return `<div class="hc-tile" data-gid="${t.id}">${c ? `<img src="${c}" loading="lazy">` : `<div class="ph"></div>`}<div class="tn">${escHtml(t.Game || '')}</div><div class="hc-pt">${_homePlaytimeLabel(t[key])}</div></div>`; }).join('')}</div>`;
}
function homeWidgetHtml(key, s) {
    switch (key) {
        case 'overview': {
            const c = s.counts || {};
            const chip = (n, l) => `<div class="hc-stat"><div class="n">${n || 0}</div><div class="l">${l}</div></div>`;
            return `<h4>Library Overview</h4><div class="hc-stats">${chip(c.total, 'Games')}${chip(c.installed, 'Installed')}${chip(c.backlog, 'Backlog')}${chip(c.played, 'Played')}${chip(c.favs, 'Favourites')}${chip(c.want, 'Want')}</div>`;
        }
        case 'daily':    return `<h4>The Daily Grind</h4>${_homeFeatured(s.dailyPick, "Today's Pick")}`;
        case 'continue': return `<h4>Continue Playing</h4>${_homeFeatured(s.continuePlaying, 'Resume')}`;
        case 'backlog': {
            const b = s.backlog || {};
            return `<h4>Backlog Weight</h4><div class="hc-big"><div class="bn">${b.count || 0}</div><div class="bl">games waiting</div><div class="bh">${b.hours ? ('~' + b.hours + ' hours to clear') : '&mdash;'}</div></div>`;
        }
        case 'stores':  return `<h4>Store Breakdown</h4>${_homeDonut(s.stores)}`;
        case 'proton':  return `<h4>Proton Readiness</h4>${(s.proton && s.proton.length) ? _homeBars(s.proton) : `<div class="hc-empty">No ProtonDB data scraped yet.</div>`}`;
        case 'genres':  return `<h4>Top Genres</h4>${_homeBars(s.genres)}`;
        case 'recent':  return `<h4>Recently Imported</h4>${_homeTileRow(s.recentlyImported, 'Nothing imported yet.')}`;
        case 'played':  return `<h4>Recently Played</h4>${_homeTileRow(s.recentlyPlayed, 'No play history yet.')}`;
        case 'gems':    return `<h4>Hidden Gems &mdash; Installed &amp; Unplayed</h4>${_homeTileRow(s.hiddenGems, 'No standout unplayed games found.')}`;
        case 'mostplayed': { const pt = s.playtime || {}; return `<h4>Most Played${pt.totalHours ? ` <span style="color:var(--text_dim); font-weight:700; letter-spacing:0;">&middot; ${pt.totalHours}h total</span>` : ''}</h4>${_homePlaytimeRow(s.mostPlayed, 'Playtime', 'No playtime yet &mdash; sync your Steam library (only Steam reports hours).')}`; }
        case 'couchnight': return `<h4>Couch Night &mdash; Co-op</h4>${_homeTileRow(s.couchNight, 'No co-op games found (needs the Co-op field scraped).')}`;
        case 'franchise': {
            const f = s.franchise;
            if (!f) return `<h4>Franchise Spotlight</h4><div class="hc-empty">No multi-game series found yet (needs the Franchise field scraped).</div>`;
            return `<h4>Franchise Spotlight &mdash; ${escHtml(f.name)} <span style="color:var(--text_dim); font-weight:700; letter-spacing:0;">&middot; ${f.count} owned</span></h4>${_homeTileRow(f.games, '')}`;
        }
        case 'throwback': return `<h4>Throwback</h4>${_homeFeatured(s.throwback, 'Blast from the Past')}`;
        case 'disk': return `<h4>Disk Footprint</h4><div id="home-disk-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'completion': return `<h4>Achievement Completion</h4><div id="home-completion-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'beaten': {
            const pct = s.beatenPct || 0, c = s.counts || {};
            return `<h4>Beaten</h4><div class="beaten-wrap"><div class="beaten-ring" style="background:conic-gradient(var(--accent) ${pct * 3.6}deg, var(--bg) 0deg)"><div class="beaten-ring-c">${pct}%</div></div><div class="beaten-l"><b style="color:var(--text_main); font-size:16px;">${c.played || 0}</b> of ${c.total || 0}<br>games beaten</div></div>`;
        }
        case 'wrapped': {
            const w = s.wrapped || {};
            const chip = (n, l) => (n == null || n === '') ? '' : `<div class="wrap-chip"><div class="n">${escHtml(String(n))}</div><div class="l">${l}</div></div>`;
            const tp = w.topPlayed;
            return `<h4>Your Library, Wrapped &middot; ${w.year || ''}</h4><div class="wrap-grid">`
                + `<div class="wrap-hero"><div class="wrap-big">${w.totalHours || 0}<span>h</span></div><div class="wrap-big-l">hours played &middot; Steam</div></div>`
                + (tp ? `<div class="wrap-top" data-gid="${tp.id}">${_hImg(tp) ? `<img src="${_hImg(tp)}">` : ''}<div><div class="wl">Most Played</div><div class="wt">${escHtml(tp.Game || '')}</div><div class="wh">${tp.hours || 0}h</div></div></div>` : '')
                + `<div class="wrap-chips">${chip(w.addedThisYear, 'Added in ' + (w.year || ''))}${chip(w.beaten, 'Beaten')}${chip(w.totalGames, 'In library')}${chip(w.topGenre, 'Top genre')}${chip(w.protonReadyPct != null ? w.protonReadyPct + '%' : '', 'Proton-ready')}</div>`
                + `</div>`;
        }
        case 'wishlist': return `<h4>Wishlist &mdash; Deals</h4><div id="home-wishlist-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'freebies': return `<h4>Free This Week</h4><div id="home-freebies-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'news': return `<h4>Gaming News</h4><div id="home-news-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'gamenews': return `<h4>Your Games &mdash; What's New</h4><div id="home-gamenews-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'protonwatch': return `<h4>Proton Watch</h4><div id="home-proton-body"><div class="hc-empty">Loading&hellip;</div></div>`;
        case 'roulette': return `<h4>Roulette &mdash; Can't Decide?</h4><div class="hc-roulette"><div id="home-roulette-result"><div class="hc-empty">Hit spin for a pick from your library.</div></div><div class="hc-roulette-opts"><button class="hc-chip" data-roul="installedOnly">Installed</button><button class="hc-chip" data-roul="backlogOnly">Backlog</button><button class="hc-chip" data-roul="favsOnly">Favourites</button></div><button class="hc-spin-btn" id="home-spin">Spin</button></div>`;
        default: return '';
    }
}
async function renderHome() {
    const grid = document.getElementById('home-grid'); if (!grid) return;
    const dEl = document.getElementById('home-date');
    if (dEl) dEl.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    _startHomeClock();   // live ticking time + keeps the greeting in sync as the hour rolls over
    grid.innerHTML = `<div class="hc-empty">Reading your library&hellip;</div>`;
    _homeSnap = (await window.api.getHomeStats({ hidePico8: _hidePico8 })) || {};
    if (_gsGrid) { try { _gsGrid.destroy(false); } catch (e) {} _gsGrid = null; }
    grid.innerHTML = '';
    grid.classList.toggle('home-editing', _homeEditMode);
    const editBar = `<div class="hc-edit-bar"><button class="hc-eb hc-eb-x" data-act="remove" title="Remove">&times;</button></div>`;
    for (const key of _homeWidgets) {
        const def = HOME_GS[key]; if (!def) continue;
        const lay = _homeLayout[key] || {};
        const item = document.createElement('div');
        item.className = 'grid-stack-item';
        item.setAttribute('gs-id', key);
        item.setAttribute('gs-w', lay.w || def.w);
        item.setAttribute('gs-h', lay.h || def.h);
        item.setAttribute('gs-min-w', def.minW);
        item.setAttribute('gs-min-h', def.minH);
        if (lay.x != null && lay.y != null) { item.setAttribute('gs-x', lay.x); item.setAttribute('gs-y', lay.y); }
        item.innerHTML = `<div class="grid-stack-item-content">${_homeEditMode ? editBar : ''}${homeWidgetHtml(key, _homeSnap)}</div>`;
        grid.appendChild(item);
    }
    // gridstack-all.js (UMD) exposes a namespace → the class can be at GridStack or GridStack.GridStack.
    const _GS = (typeof GridStack !== 'undefined') ? (GridStack.init ? GridStack : GridStack.GridStack) : null;
    if (!_GS) { grid.innerHTML = `<div class="hc-empty">Dashboard engine failed to load.</div>`; return; }
    _gsGrid = _GS.init({ column: 6, cellHeight: 140, margin: 8, float: true, animate: true, draggable: { handle: '.grid-stack-item-content' }, resizable: { handles: 'se' } }, grid);
    _gsGrid.setStatic(!_homeEditMode);
    _gsGrid.on('change', _persistLayout);
    if (_homeWidgets.some(k => !_homeLayout[k])) setTimeout(_persistLayout, 0);   // capture auto-placed positions
    if (_homeEditMode) {
        grid.querySelectorAll('.hc-eb-x[data-act="remove"]').forEach(b => {
            b.addEventListener('pointerdown', e => e.stopPropagation());   // don't start a drag from the × button
            b.addEventListener('click', e => { e.stopPropagation(); const k = b.closest('.grid-stack-item')?.getAttribute('gs-id'); if (!k) return; _homeWidgets = _homeWidgets.filter(x => x !== k); delete _homeLayout[k]; saveHomeConfig(); renderHome(); });
        });
    }
    grid.querySelectorAll('[data-gid]').forEach(el => el.addEventListener('click', () => { if (!_homeEditMode) openHomeGameById(el.getAttribute('data-gid')); }));
    const spin = document.getElementById('home-spin');
    if (spin) {
        const opts = {};
        grid.querySelectorAll('.hc-chip[data-roul]').forEach(ch => ch.addEventListener('click', () => { ch.classList.toggle('on'); opts[ch.dataset.roul] = ch.classList.contains('on'); }));
        spin.addEventListener('click', async () => {
            const res = document.getElementById('home-roulette-result');
            res.innerHTML = `<div class="hc-empty">Spinning&hellip;</div>`;
            const c = Object.fromEntries(Object.entries(opts).filter(([, v]) => v));
            if (_hidePico8) c.hidePico8 = true;
            const g = await window.api.getRandomGame(c);
            if (!g) { res.innerHTML = `<div class="hc-empty">No games match those filters.</div>`; return; }
            res.innerHTML = _homeFeatured(g, 'Your Pick');
            res.querySelector('[data-gid]')?.addEventListener('click', () => openHomeGameById(g.id, g));
        });
    }
    if (grid.querySelector('#home-wishlist-body')) loadWishlistWidget();
    if (grid.querySelector('#home-freebies-body')) loadFreebiesWidget();
    if (grid.querySelector('#home-news-body')) loadNewsWidget();
    if (grid.querySelector('#home-gamenews-body')) loadGameNewsWidget();
    if (grid.querySelector('#home-proton-body')) loadProtonWatchWidget();
    if (grid.querySelector('#home-disk-body')) loadDiskWidget();
    if (grid.querySelector('#home-completion-body')) loadCompletionWidget();
}

// ── Achievement Completion widget (extras, on-demand Steam scan) ─────────────
async function loadCompletionWidget() { renderCompletion(await window.api.achGet()); }
function renderCompletion(data) {
    const body = document.getElementById('home-completion-body'); if (!body) return;
    const ts = data && data.ts;
    let html = `<div class="wl-toolbar"><span style="font-size:11px; color:var(--text_dim); align-self:center; margin-right:auto;">${ts ? ('Scanned ' + _homeAgo(ts)) : 'Not scanned yet'}</span><button id="ach-scan-btn" class="home-ghost">Scan now</button></div>`;
    if (!ts) html += `<div class="hc-empty">Scan your Steam achievement progress (needs your Steam API key + ID from Connect & Sync).</div>`;
    else {
        const pct = data.avgPct || 0;
        html += `<div class="beaten-wrap"><div class="beaten-ring" style="background:conic-gradient(var(--accent) ${pct * 3.6}deg, var(--bg) 0deg)"><div class="beaten-ring-c">${pct}%</div></div><div class="beaten-l">avg completion across<br><b style="color:var(--text_main);">${data.withAch || 0}</b> games &middot; <b style="color:var(--text_main);">${data.completed || 0}</b> at 100%<br><span style="color:var(--text_dim); font-size:12px;">${(data.totalUnlocked || 0).toLocaleString()} / ${(data.totalAch || 0).toLocaleString()} achievements</span></div></div>`;
    }
    body.innerHTML = html;
    document.getElementById('ach-scan-btn')?.addEventListener('click', async () => {
        body.innerHTML = `<div class="hc-empty">Scanning Steam achievements&hellip; this can take a moment.</div>`;
        const res = await window.api.achScan();
        if (res && res.error) { body.innerHTML = `<div class="hc-empty">${escHtml(res.error)}</div>`; return; }
        renderCompletion(res);
    });
}

// ── Disk Footprint widget (Phase: extras, on-demand scan) ────────────────────
function _fmtBytes(b) { const n = Number(b) || 0; return n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(1) + ' GB' : n >= 1024 ** 2 ? Math.round(n / 1024 ** 2) + ' MB' : Math.round(n / 1024) + ' KB'; }
async function loadDiskWidget() { renderDisk(await window.api.diskGet()); }
function renderDisk(data) {
    const body = document.getElementById('home-disk-body'); if (!body) return;
    const ts = data && data.ts;
    let html = `<div class="wl-toolbar"><span style="font-size:11px; color:var(--text_dim); align-self:center; margin-right:auto;">${ts ? ('Scanned ' + _homeAgo(ts)) : 'Not scanned yet'}</span><button id="disk-scan-btn" class="home-ghost">Scan now</button></div>`;
    if (!ts) html += `<div class="hc-empty">Scan your installed games' on-disk size (Steam + GOG/Epic via Installer).</div>`;
    else {
        const max = (data.byStore[0] && data.byStore[0].bytes) || 1;
        html += `<div style="font-size:26px; font-weight:900; color:var(--accent); margin:2px 0 12px;">${_fmtBytes(data.totalBytes)} <span style="font-size:12px; color:var(--text_dim); font-weight:700;">across ${data.scanned} games</span></div>`;
        html += `<div class="hc-bars">` + data.byStore.map(s => `<div class="hc-bar"><span class="bn">${escHtml(s.store)}</span><span class="bt"><span class="bf" style="width:${Math.round(s.bytes / max * 100)}%"></span></span><span class="bc" style="white-space:nowrap; width:auto;">${_fmtBytes(s.bytes)}</span></div>`).join('') + `</div>`;
        if (data.biggest && data.biggest.length) html += `<div style="margin-top:12px; font-size:11px; color:var(--text_dim); text-transform:uppercase; letter-spacing:1px;">Biggest</div><div class="news-list">` + data.biggest.slice(0, 5).map(g => `<div class="news-item" style="cursor:default; display:flex; justify-content:space-between; gap:10px;"><span class="news-title" style="flex:1;">${escHtml(g.game)}</span><span style="color:var(--accent); font-weight:800; font-size:12px; white-space:nowrap;">${_fmtBytes(g.bytes)}</span></div>`).join('') + `</div>`;
    }
    body.innerHTML = html;
    document.getElementById('disk-scan-btn')?.addEventListener('click', async () => {
        body.innerHTML = `<div class="hc-empty">Scanning install sizes&hellip; large GOG/Epic games can take a moment.</div>`;
        renderDisk(await window.api.diskScan());
    });
}

async function loadGameNewsWidget() {
    const body = document.getElementById('home-gamenews-body'); if (!body) return;
    body.innerHTML = _homeSkelList(5);
    const items = (await window.api.getGameNews()) || [];
    if (!items.length) { body.innerHTML = `<div class="hc-empty">No recent news &mdash; sync Steam and play a few games first.</div>`; return; }
    body.innerHTML = `<div class="news-list">` + items.map(n =>
        `<div class="news-item" data-url="${escHtml(n.url)}"><div class="news-title">${escHtml(n.title)}</div><div class="news-meta">${escHtml(n.source)}${n.date ? ` &middot; ${_homeAgo(n.date)}` : ''}</div></div>`
    ).join('') + `</div>`;
    body.querySelectorAll('.news-item[data-url]').forEach(el => el.addEventListener('click', () => window.api.openInstallUrl(el.dataset.url)));
}

// ── ProtonDB Tier Watch widget (Phase 3, opt-in) ─────────────────────────────
const PW_RANK = { BORKED:0, PENDING:1, BRONZE:2, SILVER:3, GOLD:4, PLATINUM:5, NATIVE:6 };
const PW_COLOR = { NATIVE:'#66bb6a', PLATINUM:'#b8c6db', GOLD:'#d4af37', SILVER:'#9aa0a6', BRONZE:'#cd7f32', PENDING:'#888', BORKED:'#e05a5a' };
async function loadProtonWatchWidget() {
    const body = document.getElementById('home-proton-body'); if (!body) return;
    renderProtonWatch(body, await window.api.protonWatchGet());
}
function renderProtonWatch(body, data) {
    const ts = data && data.ts;
    let html = `<div class="wl-toolbar"><span style="font-size:11px; color:var(--text_dim); align-self:center; margin-right:auto;">${ts ? ('Last checked ' + _homeAgo(ts)) : 'Not checked yet'}</span><button id="proton-check-btn" class="home-ghost">Check now</button></div>`;
    const changes = (data && data.changes) || [];
    const climbed = changes.filter(c => c.improved && (PW_RANK[c.now] ?? -1) >= 4).sort((a, b) => (PW_RANK[b.now] ?? 0) - (PW_RANK[a.now] ?? 0));
    if (!ts) html += `<div class="hc-empty">Check your Steam library's current ProtonDB ratings &mdash; we'll flag anything that climbed to Gold, Platinum or Native.</div>`;
    else if (!climbed.length) html += `<div class="hc-empty">No Gold/Platinum/Native changes since last check (${(data && data.checked) || 0} games).</div>`;
    else html += `<div class="pw-list">` + climbed.slice(0, 16).map(c =>
        `<div class="pw-item"><span class="pw-game">${escHtml(c.game)}</span><span class="pw-change">${c.old ? `<span class="pw-old">${escHtml(String(c.old).toUpperCase())}</span> &rarr; ` : ''}<span class="pw-tier" style="color:${PW_COLOR[c.now] || 'var(--accent)'}">${escHtml(c.now)}</span></span></div>`
    ).join('') + `</div>`;
    body.innerHTML = html;
    document.getElementById('proton-check-btn')?.addEventListener('click', async () => {
        body.innerHTML = `<div class="hc-empty">Checking ProtonDB ratings across your Steam library&hellip; this can take a moment.</div>`;
        renderProtonWatch(body, await window.api.protonCheck());
    });
}

// ── Gaming News widget (Phase 3, opt-in RSS) ─────────────────────────────────
function _homeAgo(ts) {
    if (!ts) return ''; const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}
async function loadNewsWidget() {
    const body = document.getElementById('home-news-body'); if (!body) return;
    body.innerHTML = _homeSkelList(5);
    const items = (await window.api.getNews()) || [];
    let html = `<div class="wl-toolbar"><button id="news-settings-btn" class="home-ghost" title="News sources">&#9881;</button></div>`;
    if (!items.length) html += `<div class="hc-empty">No headlines &mdash; check your sources or connection.</div>`;
    else html += `<div class="news-list">` + items.map(n =>
        `<div class="news-item" data-url="${escHtml(n.link)}"><div class="news-title">${escHtml(n.title)}</div><div class="news-meta">${escHtml(n.source)}${n.date ? ` &middot; ${_homeAgo(n.date)}` : ''}</div></div>`
    ).join('') + `</div>`;
    body.innerHTML = html;
    document.getElementById('news-settings-btn')?.addEventListener('click', openNewsSettings);
    body.querySelectorAll('.news-item[data-url]').forEach(el => el.addEventListener('click', () => window.api.openInstallUrl(el.dataset.url)));
}
async function openNewsSettings() {
    const raw = await window.api.getSetting('news_sources');
    document.getElementById('news-sources-input').value = raw || '';
    document.getElementById('modal-news-settings').classList.add('active');
}
document.getElementById('news-save')?.addEventListener('click', async () => {
    await window.api.setSetting('news_sources', document.getElementById('news-sources-input').value.trim());
    document.getElementById('modal-news-settings').classList.remove('active');
    loadNewsWidget();
});
document.getElementById('news-close')?.addEventListener('click', () => document.getElementById('modal-news-settings').classList.remove('active'));
document.getElementById('modal-news-settings')?.addEventListener('click', e => { if (e.target.id === 'modal-news-settings') e.currentTarget.classList.remove('active'); });

async function loadFreebiesWidget() {
    const body = document.getElementById('home-freebies-body'); if (!body) return;
    body.innerHTML = _homeSkelRow(5);
    const games = (await window.api.freeGames()) || [];
    if (!games.length) { body.innerHTML = `<div class="hc-empty">No free games right now &mdash; check back later.</div>`; return; }
    body.innerHTML = `<div class="wl-row">` + games.map(g =>
        `<div class="wl-tile"><div class="wl-cov" data-url="${escHtml(g.url)}">${g.cover ? `<img src="${escHtml(g.cover)}" loading="lazy">` : `<div class="wl-ph"></div>`}<span class="wl-cut" style="background:var(--accent); color:var(--bg);">FREE</span></div><div class="wl-title">${escHtml(g.title)}</div><div class="wl-price"><span class="wl-shop">${escHtml(g.store || 'Epic')}</span></div></div>`
    ).join('') + `</div>`;
    body.querySelectorAll('.wl-cov[data-url]').forEach(t => t.addEventListener('click', () => window.api.openInstallUrl(t.dataset.url)));
}

// ── Wishlist & Deals widget (Phase 2, opt-in IsThereAnyDeal) ──────────────────
function _wlFmt(amount, currency) {
    if (amount == null) return ''; const a = Number(amount); if (!isFinite(a)) return '';
    if (currency === 'USD' || currency === 'CAD' || currency === 'AUD') return '$' + a.toFixed(2);
    if (currency === 'EUR') return '€' + a.toFixed(2);
    if (currency === 'GBP') return '£' + a.toFixed(2);
    if (currency === 'BRL') return 'R$' + a.toFixed(2);
    return a.toFixed(2) + (currency ? (' ' + currency) : '');
}
function _wlItadUrl(slug) { return slug ? `https://isthereanydeal.com/game/${slug}/info/` : ''; }
async function loadWishlistWidget() {
    const body = document.getElementById('home-wishlist-body'); if (!body) return;
    const [key, currency, click] = await Promise.all([
        window.api.getSetting('itad_api_key'),
        window.api.getSetting('itad_currency'),
        window.api.getSetting('itad_click'),
    ]);
    if (!key) {
        body.innerHTML = `<div class="wl-connect"><div class="wl-connect-t">Track prices &amp; all-time lows on games you don't own yet with <b>IsThereAnyDeal</b>.</div><button id="wl-setup-btn" class="home-primary" style="align-self:flex-start;">Set up IsThereAnyDeal</button></div>`;
        document.getElementById('wl-setup-btn').onclick = openWishlistSettings;
        return;
    }
    body.innerHTML = _homeSkelRow(6);
    const res = await window.api.wishlistDeals();
    const rows = (res && res.rows) || [];
    let html = `<div class="wl-toolbar"><button id="wl-add-btn" class="home-ghost">+ Add Game</button><button id="wl-settings-btn" class="home-ghost" title="Wishlist settings">&#9881;</button></div>`;
    if (!rows.length) html += `<div class="hc-empty">Your wishlist is empty &mdash; add a game to watch its price.</div>`;
    else html += `<div class="wl-row">` + rows.map(r => {
        const deal = r.deal, low = r.low;
        const dispCur = currency || (deal && deal.currency);
        const storeUrl = (deal && deal.url) ? deal.url : '', itadUrl = _wlItadUrl(r.slug);
        const url = (click === 'itad') ? (itadUrl || storeUrl) : (storeUrl || itadUrl);
        const price = deal ? `<b>${_wlFmt(deal.price, dispCur)}</b>${deal.shop ? ` <span class="wl-shop">${escHtml(deal.shop)}</span>` : ''}` : '<span class="wl-na">no price</span>';
        const cut = (deal && deal.cut) ? `<span class="wl-cut">-${deal.cut}%</span>` : '';
        const lowLine = low ? `<div class="wl-low">all-time low ${_wlFmt(low.amount, currency || low.currency)}</div>` : '';
        return `<div class="wl-tile"><div class="wl-cov" ${url ? `data-url="${escHtml(url)}"` : ''}>${r.cover ? `<img src="${escHtml(r.cover)}" loading="lazy">` : `<div class="wl-ph"></div>`}<button class="wl-x" data-rm="${escHtml(r.itad_id)}" title="Remove">&times;</button>${cut}</div><div class="wl-title">${escHtml(r.title)}</div><div class="wl-price">${price}</div>${lowLine}</div>`;
    }).join('') + `</div>`;
    body.innerHTML = html;
    document.getElementById('wl-add-btn')?.addEventListener('click', openWishlistAdd);
    document.getElementById('wl-settings-btn')?.addEventListener('click', openWishlistSettings);
    body.querySelectorAll('.wl-x[data-rm]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await window.api.wishlistRemove(b.dataset.rm); loadWishlistWidget(); }));
    body.querySelectorAll('.wl-cov[data-url]').forEach(t => t.addEventListener('click', () => window.api.openInstallUrl(t.dataset.url)));
}
async function openWishlistSettings() {
    const [key, country, currency, click] = await Promise.all([
        window.api.getSetting('itad_api_key'), window.api.getSetting('itad_country'),
        window.api.getSetting('itad_currency'), window.api.getSetting('itad_click'),
    ]);
    document.getElementById('wls-key').value = key || '';
    document.getElementById('wls-country').value = country || 'US';
    document.getElementById('wls-currency').value = currency || '';
    document.getElementById('wls-click').value = click || 'store';
    document.getElementById('modal-wishlist-settings').classList.add('active');
}
document.getElementById('wls-save')?.addEventListener('click', async () => {
    const key = document.getElementById('wls-key').value.trim();
    const country = (document.getElementById('wls-country').value.trim() || 'US').toUpperCase();
    const currency = document.getElementById('wls-currency').value.trim().toUpperCase();
    await Promise.all([
        window.api.setSetting('itad_api_key', key),
        window.api.setSetting('itad_country', country),
        window.api.setSetting('itad_currency', currency),
        window.api.setSetting('itad_click', document.getElementById('wls-click').value),
    ]);
    document.getElementById('modal-wishlist-settings').classList.remove('active');
    loadWishlistWidget();
});
document.getElementById('wls-close')?.addEventListener('click', () => document.getElementById('modal-wishlist-settings').classList.remove('active'));
document.getElementById('modal-wishlist-settings')?.addEventListener('click', e => { if (e.target.id === 'modal-wishlist-settings') e.currentTarget.classList.remove('active'); });
function openWishlistAdd() {
    document.getElementById('modal-wishlist-add').classList.add('active');
    const inp = document.getElementById('wl-search-input'); inp.value = ''; document.getElementById('wl-search-results').innerHTML = '';
    setTimeout(() => inp.focus(), 60);
}
async function runWishlistSearch() {
    const q = document.getElementById('wl-search-input').value.trim(); if (!q) return;
    const box = document.getElementById('wl-search-results'); box.innerHTML = `<div class="hc-empty">Searching&hellip;</div>`;
    const results = await window.api.itadSearch(q);
    if (!results || !results.length) { box.innerHTML = `<div class="hc-empty">No matches &mdash; is your ITAD key valid?</div>`; return; }
    box.innerHTML = results.map(r => `<div class="wl-res"><span>${escHtml(r.title)}</span><button class="wl-res-add" data-id="${escHtml(r.id)}" data-title="${escHtml(r.title)}" data-slug="${escHtml(r.slug || '')}">Add</button></div>`).join('');
    box.querySelectorAll('.wl-res-add').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '…';
        const res = await window.api.wishlistAdd({ id: b.dataset.id, title: b.dataset.title, slug: b.dataset.slug });
        b.textContent = (res && res.ok) ? '✓ Added' : 'Error';
        loadWishlistWidget();
    }));
}
document.getElementById('wl-search-go')?.addEventListener('click', runWishlistSearch);
document.getElementById('wl-search-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') runWishlistSearch(); });
document.getElementById('wl-add-close')?.addEventListener('click', () => document.getElementById('modal-wishlist-add').classList.remove('active'));
document.getElementById('modal-wishlist-add')?.addEventListener('click', e => { if (e.target.id === 'modal-wishlist-add') e.currentTarget.classList.remove('active'); });

// ── Edit-layout mode: drag to reorder, − / + to resize, × to remove ──────────
function _persistLayout() {
    if (!_gsGrid) return;
    const grid = document.getElementById('home-grid'); if (!grid) return;
    const layout = {};
    // Read each item's live size/position straight off its gridstackNode (with the rendered
    // gs-* attributes as a fallback), more reliable than save(), which could drop w/h for
    // some widgets and leave them snapping back to their default size on the next render.
    grid.querySelectorAll('.grid-stack-item').forEach(el => {
        const id = el.getAttribute('gs-id'); if (!id) return;
        const n = el.gridstackNode || {};
        const def = HOME_GS[id] || {};
        layout[id] = {
            x: n.x != null ? n.x : (parseInt(el.getAttribute('gs-x'), 10) || 0),
            y: n.y != null ? n.y : (parseInt(el.getAttribute('gs-y'), 10) || 0),
            w: n.w || parseInt(el.getAttribute('gs-w'), 10) || def.w || 1,
            h: n.h || parseInt(el.getAttribute('gs-h'), 10) || def.h || 1,
        };
    });
    _homeLayout = layout;
    // keep _homeWidgets in the saved board order (left-to-right, top-to-bottom)
    const ordered = Object.keys(layout).sort((a, b) => (layout[a].y - layout[b].y) || (layout[a].x - layout[b].x));
    if (ordered.length) _homeWidgets = ordered;
    saveHomeConfig();
}
function setHomeEdit(on) {
    _homeEditMode = on;
    document.getElementById('btn-home-edit').style.display = on ? 'none' : '';
    document.getElementById('btn-home-enter').style.display = on ? 'none' : '';
    document.getElementById('home-edit-bar').style.display = on ? 'flex' : 'none';
    renderHome();
}
document.getElementById('btn-home-edit')?.addEventListener('click', () => setHomeEdit(true));
document.getElementById('btn-home-done')?.addEventListener('click', () => setHomeEdit(false));
document.getElementById('btn-home-reset')?.addEventListener('click', async () => {
    if (!(await showConfirm('Reset the Home layout (positions, sizes & widgets) back to default?', 'Reset'))) return;
    _homeLayout = { ...HOME_DEFAULT_LAYOUT }; _homeWidgets = HOME_DEFAULT.slice();
    saveHomeConfig(); renderHome();
});

// "+ Add Widget" → toggle which widgets exist; order & size are handled by drag/resize.
function openHomeConfig() {
    document.getElementById('cfg-home-enabled').checked = _homeEnabled;
    document.getElementById('cfg-home-clock').checked = _homeClockOn;
    const wrap = document.getElementById('home-cfg-widgets'); wrap.innerHTML = '';
    HOME_WIDGETS.forEach(w => wrap.insertAdjacentHTML('beforeend', `<label><input type="checkbox" data-k="${w.key}" ${_homeWidgets.includes(w.key) ? 'checked' : ''}> <span>${w.label}</span></label>`));
    document.getElementById('modal-home-config').classList.add('active');
}
document.getElementById('btn-home-add')?.addEventListener('click', openHomeConfig);
// Instant apply, no Done button. Any toggle saves + re-renders immediately.
document.getElementById('cfg-home-enabled')?.addEventListener('change', (e) => { _homeEnabled = e.target.checked; saveHomeConfig(); });
document.getElementById('cfg-home-clock')?.addEventListener('change', (e) => { _homeClockOn = e.target.checked; saveHomeConfig(); _applyHomeClockVis(); });
document.getElementById('home-cfg-widgets')?.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-k]'); if (!cb) return;
    const k = cb.dataset.k;
    if (cb.checked) { if (!_homeWidgets.includes(k)) _homeWidgets.push(k); }
    else { _homeWidgets = _homeWidgets.filter(x => x !== k); delete _homeLayout[k]; }
    saveHomeConfig();
    renderHome();
});
document.getElementById('btn-home-cfg-close')?.addEventListener('click', () => document.getElementById('modal-home-config').classList.remove('active'));
document.getElementById('modal-home-config')?.addEventListener('click', e => { if (e.target.id === 'modal-home-config') e.currentTarget.classList.remove('active'); });
document.getElementById('btn-home-enter')?.addEventListener('click', () => switchView(lastGridView));
document.getElementById('btn-titlebar-home')?.addEventListener('click', async () => {
    if (_homeEditMode) { _homeEditMode = false; document.getElementById('btn-home-edit').style.display = ''; document.getElementById('btn-home-enter').style.display = ''; document.getElementById('home-edit-bar').style.display = 'none'; }
    switchView('view-home'); await renderHome();
});
document.getElementById('btn-titlebar-library')?.addEventListener('click', () => {
    if (_homeEditMode) { _homeEditMode = false; document.getElementById('btn-home-edit').style.display = ''; document.getElementById('btn-home-enter').style.display = ''; document.getElementById('home-edit-bar').style.display = 'none'; }
    switchView(lastGridView);
});

(async () => {
    // Sharp is the default, only an explicitly saved 'round' opts back into the rounded style.
    _cornersStyle = (await window.api.getSetting('corners_style')) === 'round' ? 'round' : 'sharp';
    document.querySelectorAll('.corners-btn').forEach(b => b.classList.toggle('active', b.dataset.val === _cornersStyle));
    // Release build: the icon side rail is the ONLY available layout, any saved
    // layout_mode is ignored, and the picker card is display:none, so the other
    // eight layouts ship as unreachable code.
    // ⚠️ This line is why the Phase 2 cull was safe: the sixteen retired layouts
    // could never execute in a shipped build. It is also why the surviving eight
    // are still dormant, reaching them needs this call to honour the saved mode
    // AND the picker card to lose its display:none.
    applyLayoutMode();
    await loadHomeConfig();
    if (_homeEnabled) { switchView('view-home'); await renderHome(); }
})();

// ── VIEW / REFRESH (all layouts) ──────────────────────────────────────────
['btn-view-list', 'btn-view-list-sb'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => { switchView('view-list'); applyFilters(); }));
['btn-view-gallery', 'btn-view-gallery-sb'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => { switchView('view-gallery'); applyFilters(); }));
document.getElementById('btn-refresh-library').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-library');
    btn.style.animation = 'spin 0.6s linear';
    setTimeout(() => { btn.style.animation = ''; }, 650);
    const onGamepage = document.getElementById('view-gamepage').classList.contains('active');
    if (onGamepage && currentGameId) await window.api.verifyInstallStatus(currentGameId);
    await updateLibraryFlow({ quiet: true });   // fetch new from Steam/Installer + offer to scrape only the new ones
    if (onGamepage && currentGameId) {
        const updated = allGames.find(g => g.id === currentGameId);
        if (updated) refreshGamepagePlayBtn(updated);
    }
});

function closeGamepageToLibrary() {
    applyFilters();
    _pendingScrollRestore = savedGridScrollTop;   // restored when switchView re-activates the grid (survives the close animation)
    switchView(lastGridView);
}
document.getElementById('btn-gamepage-back').addEventListener('click', closeGamepageToLibrary);

// Floating-overlay gamepage: clicking the blurred backdrop (outside the panel) closes it.
// The backdrop is body::before, so a click on it reports e.target === document.body; clicks on
// the panel, its pinned back bar / play button, or the titlebar report a different target (and
// so does the single click on a Home tile that opens the overlay, it never self-closes).
document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('gamepage-overlay')) return;
    if (e.target !== document.body) return;
    applyFilters();
    _pendingScrollRestore = savedGridScrollTop;
    switchView(lastGridView);
});

document.getElementById('btn-back-to-gamepage').addEventListener('click', () => {
    clearInterval(detailScreenshotInterval);
    const game = allGames.find(g => g.id === currentGameId);
    if (game) openGamepage(game); else switchView('view-gallery');
});

document.getElementById('btn-gamepage-edit').addEventListener('click', () => {
    const game = allGames.find(g => g.id === currentGameId);
    if(game) openDetails(game);
});

// --- SHARED PLAYLIST PICKER ---
async function openPlaylistPickerForGame(game) {
    document.getElementById('modal-playlist-picker-game').textContent = game.Game;
    const list = document.getElementById('playlist-picker-list');
    const confirmBtn = document.getElementById('btn-playlist-add-confirm');
    const newNameInput = document.getElementById('playlist-picker-new-name');
    const newBtn = document.getElementById('btn-playlist-picker-new');

    // (Re)render the checkbox list of playlists the game isn't already a member of.
    async function renderPickerList() {
        const gamePlaylistIds = await window.api.getGamePlaylists(game.id);
        // Smart playlists compute their members from a rule, so adding a game by hand
        // would write a row nothing ever reads. They are simply not offered.
        const available = allPlaylists.filter(p => !gamePlaylistIds.includes(p.id) && !isSmartPlaylist(p));
        confirmBtn.disabled = true;
        if (!available.length) {
            const msg = !allPlaylists.length ? 'No playlists yet, create one below.' : 'Game is already in all playlists.';
            list.innerHTML = `<div class="pl-select-row" style="cursor:default;color:var(--text_dim);">${msg}</div>`;
        } else {
            list.innerHTML = available.map(p =>
                `<div class="pl-select-row" data-id="${p.id}"><span class="pl-row-check">□</span><span>${escHtml(p.name)}</span></div>`
            ).join('');
            list.querySelectorAll('.pl-select-row[data-id]').forEach(row => {
                row.addEventListener('click', () => {
                    row.classList.toggle('pl-selected');
                    row.querySelector('.pl-row-check').textContent = row.classList.contains('pl-selected') ? '■' : '□';
                    confirmBtn.disabled = !list.querySelector('.pl-select-row.pl-selected');
                });
            });
        }
    }

    // Refresh the current view's game set so it never goes blank after a membership change.
    // Re-pull through the SAME path that built it, crucially the 'recently-imported' sentinel
    // needs getRecentlyImported, not getPlaylistGames (which would return [] and leave it empty).
    async function refreshCurrentView() {
        if (currentPlaylistId === 'recently-imported') {
            currentPlaylistGames = await window.api.getRecentlyImported(recentlyImportedCount);
        } else if (currentPlaylistId !== null) {
            currentPlaylistGames = await window.api.getPlaylistGames(currentPlaylistId);
        } else {
            currentPlaylistGames = null;   // not in a playlist → show the full library, never a stale subset
        }
        applyFilters();   // always re-render the current grid so the gallery isn't left blank on return
        renderPlaylistPanels();
    }

    await renderPickerList();

    confirmBtn.onclick = async () => {
        const selected = [...list.querySelectorAll('.pl-select-row.pl-selected')];
        await Promise.all(selected.map(row => window.api.addGameToPlaylist(Number(row.dataset.id), game.id)));
        await refreshCurrentView();
        document.getElementById('modal-add-to-playlist').classList.remove('active');
    };

    // "Add to a new playlist", create it, assign the game, and keep the modal open so the
    // freshly-made playlist shows up (already a member) and more can be added in one sitting.
    newNameInput.value = '';
    async function createAndAddNewPlaylist() {
        const name = newNameInput.value.trim();
        if (!name) { newNameInput.focus(); return; }
        const newId = await window.api.addPlaylist(name);
        if (newId) await window.api.addGameToPlaylist(Number(newId), game.id);
        newNameInput.value = '';
        await loadPlaylists();        // refresh allPlaylists + side panels / dropdowns
        await refreshCurrentView();
        await renderPickerList();     // reflect the new membership in the picker
        newNameInput.focus();
    }
    newBtn.onclick = createAndAddNewPlaylist;
    newNameInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); createAndAddNewPlaylist(); } };

    document.getElementById('modal-add-to-playlist').classList.add('active');
}

// --- PLAYLIST BUTTON (gamepage) ---
document.getElementById('btn-gamepage-playlist')?.addEventListener('click', async () => {
    const game = allGames.find(g => g.id === currentGameId)
               || (currentPlaylistGames || []).find(g => g.id === currentGameId);
    if (game) openPlaylistPickerForGame(game);
});
document.getElementById('btn-playlist-picker-close')?.addEventListener('click', () =>
    document.getElementById('modal-add-to-playlist').classList.remove('active'));

// --- PLAYLIST MODALS ---
['btn-create-playlist', 'btn-create-playlist-sb'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', openCreatePlaylistModal));

document.getElementById('btn-create-playlist-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-create-playlist').classList.remove('active'));

// A genre picked here becomes the playlist's rule; leaving it empty keeps the old
// hand-picked behaviour exactly as it was.
function _newPlaylistRule() {
    const slug = document.getElementById('new-playlist-genre')?.value || '';
    return slug ? { genres: [slug] } : null;
}
async function _createPlaylistFromModal() {
    const name = document.getElementById('new-playlist-name').value.trim();
    if (!name) { document.getElementById('new-playlist-name').focus(); return; }
    await window.api.addPlaylist(name, _newPlaylistRule());
    document.getElementById('modal-create-playlist').classList.remove('active');
    await loadPlaylists();
}
document.getElementById('btn-create-playlist-confirm')?.addEventListener('click', _createPlaylistFromModal);
document.getElementById('new-playlist-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _createPlaylistFromModal();
});
document.getElementById('new-playlist-genre')?.addEventListener('change', async e => {
    const preview = document.getElementById('new-playlist-preview');
    const rule = _newPlaylistRule();
    if (!rule) { preview.textContent = 'You choose what goes in, one game at a time.'; return; }
    // Show what the rule collects right now, before committing to it.
    const n = await window.api.previewPlaylistRule(rule).catch(() => 0);
    const nameInput = document.getElementById('new-playlist-name');
    if (!nameInput.value.trim()) nameInput.value = genreLabel(e.target.value);
    preview.innerHTML = `Collects <b style="color:var(--accent);">${n}</b> game${n === 1 ? '' : 's'} today, ` +
                        `and keeps itself up to date as you add more.`;
});

document.getElementById('btn-edit-playlist-cancel')?.addEventListener('click', () =>
    document.getElementById('modal-edit-playlist').classList.remove('active'));

document.getElementById('btn-edit-playlist-save')?.addEventListener('click', async () => {
    const id   = Number(document.getElementById('edit-playlist-id').value);
    const name = document.getElementById('edit-playlist-name').value.trim();
    if (!name) { document.getElementById('edit-playlist-name').focus(); return; }
    await window.api.updatePlaylist(id, name);
    document.getElementById('modal-edit-playlist').classList.remove('active');
    await loadPlaylists();
});

document.getElementById('btn-edit-playlist-delete')?.addEventListener('click', async () => {
    const id = Number(document.getElementById('edit-playlist-id').value);
    const pl = allPlaylists.find(p => p.id === id);
    const confirmed = await showConfirm(`Delete playlist "${pl?.name}"? This cannot be undone.`);
    if (!confirmed) return;
    await window.api.deletePlaylist(id);
    document.getElementById('modal-edit-playlist').classList.remove('active');
    if (currentPlaylistId === id) {
        currentPlaylistId = null;
        currentPlaylistGames = null;
        applyFilters();
    }
    await loadPlaylists();
});

// --- PLAYLISTS NAV MODAL (topnav / split) ---
[].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => {
        renderPlaylistPanels();
        document.getElementById('modal-playlists-nav').classList.add('active');
    }));
document.getElementById('btn-playlists-nav-close')?.addEventListener('click', () =>
    document.getElementById('modal-playlists-nav').classList.remove('active'));
document.getElementById('btn-playlists-nav-new')?.addEventListener('click', () => {
    document.getElementById('modal-playlists-nav').classList.remove('active');
    openCreatePlaylistModal();
});

// --- MANAGE PLAYLIST GAMES MODAL ---
document.getElementById('btn-manage-playlist-games-close')?.addEventListener('click', () =>
    document.getElementById('modal-manage-playlist-games').classList.remove('active'));

// --- REMOVE FROM PLAYLIST MODAL ---
document.getElementById('btn-remove-from-pl-close')?.addEventListener('click', () =>
    document.getElementById('modal-remove-from-playlist').classList.remove('active'));

// --- ABOUT BUTTON LOGIC ---
['btn-about', 'btn-about-sb'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => document.getElementById('modal-about').classList.add('active')));
document.getElementById('btn-close-about').addEventListener('click', () => { document.getElementById('modal-about').classList.remove('active'); });
// Stamp the suite version into the About dialog and the Control Panel splash
// (from package.json via app.getVersion()).
window.api.getAppVersion?.().then(v => {
    if (!v) return;
    const el = document.getElementById('about-version');
    if (el) el.textContent = `VERSION ${v}`;
    const cp = document.getElementById('cp-app-version-num');
    if (cp) cp.textContent = `VERSION ${v}`;
}).catch(() => {});
// The macOS build is unsigned and doesn't get the same Linux-first testing yet, make that
// visible in the two places anyone would look for the version, not just the docs.
if (window.api.platform === 'darwin') {
    document.getElementById('about-platform-badge')?.style.setProperty('display', '');
    document.getElementById('cp-platform-badge')?.style.setProperty('display', '');
}

// Control Panel splash → releases page. There is no in-app updater by design:
// the user reads the release notes on GitHub and grabs the AppImage themselves.
const RELEASES_URL = 'https://github.com/FromChaosComesClarity/Clarity/releases';
document.getElementById('btn-check-app-updates')?.addEventListener('click', () => window.api.openExternal(RELEASES_URL));

// --- MANUAL (opens as separate window) ---
document.addEventListener('click', (e) => { if (e.target.id === 'btn-open-manual') { document.getElementById('modal-about').classList.remove('active'); window.api.openManual(); } });
document.getElementById('btn-tools-manual').addEventListener('click', () => { document.getElementById('modal-tools').classList.remove('active'); window.api.openManual(); });

// --- FIRST-RUN WELCOME ---
// Shown every launch unless the user has checked "Don't show again"
// (stored in the settings DB, not localStorage, so a fresh GameManagerConfig always shows it).
const _welcomeModal = document.getElementById('modal-welcome');

function dismissWelcome() {
    _welcomeModal.classList.remove('active');
    if (document.getElementById('chk-welcome-noshow').checked) {
        window.api.setSetting('welcome_shown', '1');
    }
}

// Only these two buttons close the modal
// ── COMMAND PALETTE (Ctrl+K) ─────────────────────────────────────────────────
// Omarchy is keyboard-driven: everything else on this desktop opens from a fuzzy
// menu, and the library was the exception. Games and actions share one list, so
// "quake" and "backup" are the same gesture.
// ⚠️ Each `id` is a name the desktop knows us by, the Omarchy launcher overlay runs
// these from outside the app as `--action=<id>`, so an id is renamed only with the same
// care as a CLI flag. The visible `name` is free to change whenever the wording improves.
const _PAL_ACTIONS = [
    { id: 'control-panel',        name: 'Control Panel',            run: () => openToolsModal('welcome') },
    { id: 'settings-library',     name: 'Settings: Library',        run: () => openToolsModal('library') },
    { id: 'settings-appearance',  name: 'Settings: Appearance',     run: () => openToolsModal('appearance') },
    { id: 'settings-connections', name: 'Settings: Connections',    run: () => openToolsModal('connections') },
    { id: 'settings-ports',       name: 'Settings: Ports & Mods',   run: () => openToolsModal('ports') },
    { id: 'settings-desktop',     name: 'Settings: Desktop',        run: () => openToolsModal('desktop') },
    { id: 'themes',               name: 'Themes',                   run: () => document.getElementById('btn-theme-switch')?.click() },
    { id: 'manage-storage',       name: 'Manage Storage',           run: () => openStorageModal() },
    { id: 'refresh-library',      name: 'Refresh Library',          run: () => document.getElementById('btn-refresh-library')?.click() },
    { id: 'add-game',             name: 'Add Game',                 run: () => document.getElementById('btn-add-game')?.click() },
    { id: 'connect-stores',       name: 'Connect Stores',           run: () => document.getElementById('btn-open-connect')?.click() },
    { id: 'view-gallery',         name: 'Gallery View',             run: () => switchView('view-gallery') },
    { id: 'view-list',            name: 'List View',                run: () => switchView('view-list') },
    { id: 'view-home',            name: 'Home Dashboard',           run: () => switchView('view-home') },
    { id: 'couch',                name: 'Go Fullscreen', run: () => document.getElementById('couch-cta')?.click() },
    { id: 'emulatte',             name: 'Launch EmuLatte',          run: () => document.getElementById('btn-rail-emulatte')?.click() },
];

// Publish the list so the desktop offers exactly the actions this build has, rather than
// a copy that drifts the first time one is added or renamed. Sent once. They are static.
try { window.api.publishPaletteActions?.(_PAL_ACTIONS.map(a => ({ id: a.id, name: a.name }))); } catch (e) {}

// One way to run an action, whether it was picked in the palette or asked for from outside.
function runPaletteAction(id) {
    const a = _PAL_ACTIONS.find(x => x.id === id);
    if (!a) return false;
    a.run();
    return true;
}

let _palItems = [], _palSel = 0;

// Subsequence match, the same rule a fuzzy launcher uses: every character of the
// query must appear in order. Scoring prefers a prefix hit, then a word-start hit,
// then anything, so "kcd" finds "Kingdom Come: Deliverance" but an exact prefix
// still wins the top slot.
function _palScore(hay, q) {
    const h = hay.toLowerCase();
    if (!q) return 1;
    const idx = h.indexOf(q);
    if (idx === 0) return 1000;
    if (idx > 0) return 700 - Math.min(idx, 200) + (/[\s:._-]/.test(h[idx - 1]) ? 150 : 0);
    let i = 0, score = 300, last = -1;
    for (const ch of q) {
        const at = h.indexOf(ch, i);
        if (at === -1) return 0;
        if (last >= 0 && at === last + 1) score += 12;   // reward contiguity
        last = at; i = at + 1;
    }
    return score;
}

function _palRender(q) {
    const box = document.getElementById('palette-results');
    const rows = [];
    for (const a of _PAL_ACTIONS) {
        const s = _palScore(a.name, q);
        if (s) rows.push({ score: s + 40, kind: 'action', name: a.name, id: a.id });
    }
    for (const g of (allGames || [])) {
        // A user-hidden game is hidden here too. applyFilters() drops them from every
        // library view, and the palette reads allGames directly, which is how they kept
        // turning up in the one list that was supposed to be the fastest way in.
        if (isHidden(g)) continue;
        const s = _palScore(g.Game || '', q);
        if (s) rows.push({ score: s, kind: 'game', name: g.Game, game: g });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    _palItems = rows.slice(0, 40);
    _palSel = 0;
    document.getElementById('palette-count').textContent = rows.length ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : '';
    if (!_palItems.length) { box.innerHTML = '<div id="palette-empty">Nothing matches that.</div>'; return; }
    box.innerHTML = _palItems.map((r, i) => {
        const badge = r.kind === 'game'
            ? (isGameInstalled(r.game) ? '<span class="pi-badge">play</span>' : '<span class="pi-kind">install</span>')
            : '<span class="pi-kind">action</span>';
        return `<div class="palette-item${i === 0 ? ' sel' : ''}" data-i="${i}"><span class="pi-name">${escHtml(r.name)}</span>${badge}</div>`;
    }).join('');
}

function _palMove(d) {
    if (!_palItems.length) return;
    _palSel = (_palSel + d + _palItems.length) % _palItems.length;
    const box = document.getElementById('palette-results');
    box.querySelectorAll('.palette-item').forEach((el, i) => el.classList.toggle('sel', i === _palSel));
    box.querySelector('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
}

function _palRun(i) {
    const r = _palItems[i];
    if (!r) return;
    closePalette();
    if (r.kind === 'action') { runPaletteAction(r.id); return; }
    // A game opens its page rather than launching outright, Enter on a fuzzy match
    // is too easy to hit by accident for something that starts a process.
    openGamepage(r.game);
}

function openPalette() {
    const box = document.getElementById('palette');
    if (!box) return;
    const inp = document.getElementById('palette-input');
    inp.value = '';
    _palRender('');
    box.classList.add('active');
    setTimeout(() => inp.focus(), 20);
}
function closePalette() { document.getElementById('palette')?.classList.remove('active'); }

document.getElementById('palette-input')?.addEventListener('input', e => _palRender(e.target.value.trim().toLowerCase()));
document.getElementById('palette-results')?.addEventListener('click', e => {
    const row = e.target.closest('.palette-item');
    if (row) _palRun(Number(row.dataset.i));
});
document.getElementById('palette')?.addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });
document.getElementById('palette-input')?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); _palMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); _palMove(-1); }
    else if (e.key === 'Enter')  { e.preventDefault(); _palRun(_palSel); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
});

// ⚠️ Capture phase: the gamepage and several modals run their own keydown handlers,
// and Ctrl+K has to reach the palette from anywhere, including from inside a text
// field, which is where a user reaches for it most naturally.
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const open = document.getElementById('palette')?.classList.contains('active');
        if (open) closePalette(); else openPalette();
    }
}, true);

// ── First boot: detect, then propose ─────────────────────────────────────────
// The welcome screen used to open with six actions and no ordering, presenting
// empty fields whether or not the work was already done. It now leads with what
// this machine actually has, so the first thing a new user reads is a fact rather
// than a form. Everything here is measured at open time; nothing is assumed.
async function renderWelcomeDetection() {
    const card = document.getElementById('wlc-detect-card');
    const body = document.getElementById('wlc-detect-body');
    const btn  = document.getElementById('btn-wlc-install-tools');
    const note = document.getElementById('wlc-detect-note');
    if (!card || !body) return;
    const lines = [];
    let missingKeys = [];

    // The gaming stack, but only where we can act on it. On a non-Omarchy host the
    // installer commands do not exist, so reporting a gap we cannot close is noise.
    try {
        const om = await window.api.omarchyStatus();
        if (om?.detected && om.gap) {
            const g = om.gap;
            const missing = [...(g.missingRequired || []), ...(g.missingOptional || [])];
            missingKeys = missing.map(m => m.key || m).filter(Boolean);
            if (!missing.length) {
                lines.push(`<div class="wlc-line"><span class="wlc-dot wlc-ok"></span><b>Gaming tools</b><span class="wlc-detail">all ${g.total} present</span></div>`);
            } else {
                const names = missing.map(m => m.key || m).join(', ');
                lines.push(`<div class="wlc-line"><span class="wlc-dot wlc-warn"></span><b>Gaming tools</b><span class="wlc-detail">${g.present} of ${g.total}, missing ${escHtml(names)}</span></div>`);
            }
        }
    } catch {}

    // Stores: connected is a fact worth stating, because a returning user should not
    // be asked to sign in to something they already signed in to.
    let gogOn = false, epicOn = false;
    try {
        const [gog, epic] = await Promise.all([
            window.api.gogAuthStatus().catch(() => ({ loggedIn: false })),
            window.api.epicAuthStatus().catch(() => ({ loggedIn: false })),
        ]);
        gogOn = !!gog.loggedIn; epicOn = !!epic.loggedIn;
        lines.push(`<div class="wlc-line"><span class="wlc-dot ${gogOn ? 'wlc-ok' : 'wlc-off'}"></span><b>GOG</b><span class="wlc-detail">${gogOn ? 'connected' + (gog.username ? ', ' + escHtml(gog.username) : '') : 'not connected'}</span></div>`);
        lines.push(`<div class="wlc-line"><span class="wlc-dot ${epicOn ? 'wlc-ok' : 'wlc-off'}"></span><b>Epic</b><span class="wlc-detail">${epicOn ? 'connected' + (epic.account ? ', ' + escHtml(epic.account) : '') : 'not connected'}</span></div>`);
    } catch {}

    // Steam has no on-disk detection here. The library comes through the Web API,
    // so the honest thing to report is whether the credentials are already stored.
    try {
        const [sid, key] = await Promise.all([
            window.api.getSetting('steam_id'), window.api.getSetting('steam_api_key'),
        ]);
        const has = !!(sid && key);
        lines.push(`<div class="wlc-line"><span class="wlc-dot ${has ? 'wlc-ok' : 'wlc-off'}"></span><b>Steam</b><span class="wlc-detail">${has ? 'key saved, fetch below to refresh' : 'needs a SteamID64 and API key'}</span></div>`);
        if (has) {
            const idEl = document.getElementById('wlc-steam-id'), keyEl = document.getElementById('wlc-steam-api-key');
            if (idEl && !idEl.value) idEl.value = sid;
            if (keyEl && !keyEl.value) keyEl.value = key;
        }
    } catch {}

    if (!lines.length) { card.style.display = 'none'; return; }
    body.innerHTML = lines.join('');
    card.style.display = '';

    if (missingKeys.length) {
        btn.style.display = ''; note.style.display = '';
        btn.textContent = `Install the missing tools (${missingKeys.length})`;
        btn.onclick = async () => {
            btn.disabled = true;
            try { await window.api.omarchyInstallTools(missingKeys); } finally { btn.disabled = false; }
        };
    } else {
        btn.style.display = 'none'; note.style.display = 'none';
    }
}

document.getElementById('btn-welcome-done').addEventListener('click', dismissWelcome);
document.getElementById('btn-welcome-manual').addEventListener('click', () => { dismissWelcome(); window.api.openManual(); });

// Welcome screen, headless GOG/Epic sign-in.
// No Installer window: sign-in happens in-place and the owned library imports right away.

// Pull newly-authorized GOG/Epic games into Clarity's library (same path as Refresh Library).
async function importStoreLibrary() {
    try {
        await window.api.installerRefreshOwned();
        const gs = await window.api.installerStatus();
        if (gs.found && gs.allGames?.length) await window.api.syncAllInstallerGames(gs.allGames, gs.path);
        await loadGames();
    } catch (e) { console.warn('[store-import]', e); }
}

// Render "✓ GOG, name · ○ Epic not connected" into the given status element.
async function renderStoreAuthStatus(statusEl) {
    if (!statusEl) return { gog: false, epic: false };
    statusEl.style.color = 'var(--text_dim)';
    statusEl.textContent = 'Checking sign-in…';
    const [gog, epic] = await Promise.all([
        window.api.gogAuthStatus().catch(() => ({ loggedIn: false })),
        window.api.epicAuthStatus().catch(() => ({ loggedIn: false })),
    ]);
    const parts = [
        gog.loggedIn  ? `✓ GOG${gog.username ? ', ' + gog.username : ''}`  : '○ GOG not connected',
        epic.loggedIn ? `✓ Epic${epic.account ? ', ' + epic.account : ''}` : '○ Epic not connected',
    ];
    statusEl.style.color = (gog.loggedIn || epic.loggedIn) ? '#66bb6a' : 'var(--text_dim)';
    statusEl.innerHTML = parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;');
    return { gog: gog.loggedIn, epic: epic.loggedIn };
}

// Run a store sign-in from a button, import the library on success, refresh the status line.
async function runStoreLogin(store, btn, statusEl) {
    if (!btn || !statusEl) return;
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Opening sign-in…';
    let r;
    try { r = store === 'gog' ? await window.api.gogLogin() : await window.api.epicLogin(); }
    catch (e) { r = { ok: false, error: e.message }; }
    btn.disabled = false;
    btn.textContent = orig;
    if (r && r.ok) {
        statusEl.style.color = 'var(--text_dim)';
        statusEl.textContent = 'Importing your library…';
        await importStoreLibrary();
        await renderStoreAuthStatus(statusEl);
    } else {
        await renderStoreAuthStatus(statusEl);
        if (r && r.error && r.error !== 'cancelled') {
            statusEl.style.color = '#ef5350';
            statusEl.textContent = '✗ ' + r.error;
        }
    }
}

(() => {
    const statusEl = document.getElementById('wlc-installer-status');
    if (!statusEl) return;
    document.getElementById('btn-welcome-login-gog')?.addEventListener('click',  (e) => runStoreLogin('gog',  e.currentTarget, statusEl));
    document.getElementById('btn-welcome-login-epic')?.addEventListener('click', (e) => runStoreLogin('epic', e.currentTarget, statusEl));
    renderStoreAuthStatus(statusEl);
})();

// ── Step 1: Steam sync (inline, no close) ───────────────────────────────────
document.getElementById('btn-welcome-sync-steam').addEventListener('click', async () => {
    const steamId = document.getElementById('wlc-steam-id').value.trim();
    const apiKey  = document.getElementById('wlc-steam-api-key').value.trim();
    const btn     = document.getElementById('btn-welcome-sync-steam');
    const status  = document.getElementById('wlc-steam-status');
    if (!steamId || !apiKey) {
        status.style.color = '#f57c00';
        status.textContent = '⚠ Enter both SteamID64 and API Key.';
        return;
    }
    await window.api.setSetting('steam_id', steamId);
    await window.api.setSetting('steam_api_key', apiKey);
    // Mirror into the Connect modal fields so they're pre-filled when opened later
    document.getElementById('steam-id').value = steamId;
    document.getElementById('steam-api-key').value = apiKey;
    btn.disabled = true;
    btn.textContent = t('status.fetching');
    status.style.color = 'var(--text_dim)';
    status.textContent = 'Fetching Steam library…';
    const result = await window.api.syncSteam(steamId, apiKey);
    if (result.success) loadGames();
    btn.disabled = false;
    btn.textContent = 'Fetch Steam Library';
    status.style.color = result.success ? '#66bb6a' : '#ef5350';
    status.textContent = result.success ? '✓ Steam library synced!' : '✗ ' + result.message;
});

// ── Step 2: Batch fetch (inline progress, no close) ─────────────────────────
document.getElementById('btn-welcome-batch').addEventListener('click', async () => {
    const btn          = document.getElementById('btn-welcome-batch');
    const statusEl     = document.getElementById('wlc-batch-status');
    const progressWrap = document.getElementById('wlc-batch-progress-wrap');
    const progressFill = document.getElementById('wlc-batch-progress-fill');
    const toFetch = gamesMissingData(allGames); // same 'missing data' criteria as the Control Panel
    if (toFetch.length === 0) { statusEl.style.color = '#66bb6a'; statusEl.textContent = '✓ All games are already up to date!'; return; }
    btn.disabled = true;
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    // Mirror progress to the always-visible top toast (cpTask* → op-toast) so it keeps going,
    // and stays visible, after the user leaves the Welcome screen.
    cpTaskStart('Fetching media…', false);
    for (let i = 0; i < toFetch.length; i++) {
        const g = toFetch[i];
        const pct = Math.round(((i + 1) / toFetch.length) * 100);
        statusEl.style.color = 'var(--text_dim)';
        statusEl.innerHTML = `Fetching ${i + 1} / ${toFetch.length}: ${g.Game}…` +
            `<br><span style="opacity:0.72; font-size:11px;">You can leave this screen, fetching keeps running in the background, with progress in the bar at the top.</span>`;
        progressFill.style.width = `${pct}%`;
        cpTaskProgress(pct, `Fetching media ${i + 1}/${toFetch.length} · ${g.Game}`);
        await window.api.autoFetch(g.id, g.Game, g.SteamAppID);
        await new Promise(r => setTimeout(r, 500));
    }
    progressFill.style.width = '100%';
    statusEl.style.color = '#66bb6a';
    statusEl.textContent = `✓ Finished fetching ${toFetch.length} games!`;
    cpTaskEnd('Media fetch complete');
    setTimeout(() => { progressWrap.style.display = 'none'; progressFill.style.width = '0%'; }, 3000);
    btn.disabled = false;
    loadGames();
});


// ── Step 3: IGDB credentials (inline, no close) ─────────────────────────────

// ── Tools menu: re-open welcome screen ──────────────────────────────────────
document.getElementById('btn-show-welcome').addEventListener('click', () => {
    document.getElementById('modal-tools').classList.remove('active');
    // Reset the "don't show again" flag and uncheck the box so the user starts fresh
    window.api.setSetting('welcome_shown', '');
    document.getElementById('chk-welcome-noshow').checked = false;
    _welcomeModal.classList.add('active');
    renderWelcomeDetection();
});

// ── Step 5: Add to system menu (inline, no close) ───────────────────────────
document.getElementById('btn-welcome-add-menu').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-welcome-add-menu');
    const status = document.getElementById('wlc-menu-status');
    btn.disabled = true;
    btn.textContent = 'Installing…';
    status.style.color = 'var(--text_dim)';
    status.textContent = 'Registering shortcuts…';
    const result = await window.api.installToMenu();
    btn.disabled = false;
    btn.textContent = 'Add to Application Menu';
    status.style.color = result.success ? '#66bb6a' : '#ef5350';
    status.textContent = (result.success ? '✓ ' : '✗ ') + result.message;
});

// ── SIDE PANEL ────────────────────────────────────────────────────────────────
function openPanel(section) {
    if (_activePanelSection === section) { closePanel(); return; }
    _activePanelSection = section;
    document.getElementById('side-panel').classList.add('open');
    document.getElementById(`panel-sec-${section}`).style.display = '';
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.panel === section);
    });
}

function closePanel() {
    if (_activePanelSection) document.getElementById(`panel-sec-${_activePanelSection}`).style.display = 'none';
    _activePanelSection = null;
    document.getElementById('side-panel').classList.remove('open');
    document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => btn.classList.remove('active'));
}

// ── PLAYLISTS ─────────────────────────────────────────────────────────────────
async function loadPlaylists() {
    allPlaylists = await window.api.getPlaylists();
    renderPlaylistPanels();
}

function renderPlaylistPanels() {
    _renderPlaylistList('panel-playlists-list', 'rail');
    _renderPlaylistList('sidebar-playlists-list', 'sidebar');
    _renderPlaylistList('modal-playlists-nav-list', 'nav');
    _rebuildPlaylistDropdown();   // search-bar playlist dropdown (hoisted; defined with the gallery selects)
}

function _renderPlaylistList(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!allPlaylists.length && recentlyImportedCount === 0) {
        container.innerHTML = `<p style="font-size:11px; color:var(--text_dim); margin:4px 0; text-align:center;">No playlists yet.</p>`;
        return;
    }
    const manageBtnHtml = (id) => `<button class="btn-playlist-manage" data-playlist-id="${id}" title="View / remove games"
        style="width:24px; height:24px; padding:0; background:transparent; border:1px solid var(--border_solid); color:var(--text_dim); border-radius:4px; flex-shrink:0; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:color 0.15s, border-color 0.15s;">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    </button>`;

    const riActive = currentPlaylistId === 'recently-imported';
    const riHtml = recentlyImportedCount > 0
        ? `<div style="display:flex; align-items:center; gap:4px; margin-bottom:4px; flex-shrink:0;">
            <button class="btn-recently-imported-filter"
                style="flex:1; text-align:left; font-size:11px; padding:8px 10px; background:${riActive ? 'var(--accent)' : 'var(--bg_menu)'}; border:1px solid ${riActive ? 'var(--accent)' : 'var(--border_solid)'}; color:${riActive ? 'var(--bg)' : 'var(--text_sec)'}; border-radius:6px; cursor:pointer; font-family:inherit; font-weight:900; transition:background 0.15s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                📥 Recently Imported
            </button>
           </div>`
        : '';

    container.innerHTML = riHtml + allPlaylists.map(p => {
        const isActive = currentPlaylistId === p.id;
        const smart = isSmartPlaylist(p);
        return `<div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">
            <button class="btn-playlist-filter" data-playlist-id="${p.id}" title="${smart ? 'Fills itself, ' + escHtml(smartPlaylistSummary(p)) : ''}"
                style="flex:1; text-align:left; font-size:11px; padding:8px 10px; background:${isActive ? 'var(--accent)' : 'var(--bg_menu)'}; border:1px solid ${isActive ? 'var(--accent)' : 'var(--border_solid)'}; color:${isActive ? 'var(--bg)' : 'var(--text_sec)'}; border-radius:6px; cursor:pointer; font-family:inherit; font-weight:900; transition:background 0.15s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${smart ? '<span style="opacity:.75;">✦</span> ' : ''}${escHtml(p.name)}
            </button>
            ${smart ? '' : manageBtnHtml(p.id)}
        </div>`;
    }).join('');

    container.querySelector('.btn-recently-imported-filter')?.addEventListener('click', () => {
        document.getElementById('modal-playlists-nav')?.classList.remove('active');
        setRecentlyImportedFilter();
    });
    container.querySelectorAll('.btn-playlist-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('modal-playlists-nav')?.classList.remove('active');
            setPlaylistFilter(Number(btn.dataset.playlistId));
        });
    });
    container.querySelectorAll('.btn-playlist-manage').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const pl = allPlaylists.find(p => p.id === Number(btn.dataset.playlistId));
            if (pl) openManagePlaylistGames(pl);
        });
    });
}

async function setPlaylistFilter(playlistId) {
    activeFilters.clear();
    syncFilterActiveStates();
    currentPlaylistId = playlistId;
    currentPlaylistGames = await window.api.getPlaylistGames(playlistId);
    renderPlaylistPanels();
    applyFilters();
    closePanel();
    const active = document.querySelector('.view.active');
    if (active && (active.id === 'view-gamepage' || active.id === 'view-details')) switchView(lastGridView);
}

async function setRecentlyImportedFilter() {
    activeFilters.clear();
    syncFilterActiveStates();
    currentPlaylistId = 'recently-imported';
    currentPlaylistGames = await window.api.getRecentlyImported(recentlyImportedCount);
    renderPlaylistPanels();
    applyFilters();
    closePanel();
    const active = document.querySelector('.view.active');
    if (active && (active.id === 'view-gamepage' || active.id === 'view-details')) switchView(lastGridView);
}

function clearPlaylistFilter() {
    currentPlaylistId = null;
    currentPlaylistGames = null;
    renderPlaylistPanels();
    applyFilters();
}

// `presetGenre` is optional. The function is also wired straight to click handlers,
// which would otherwise hand it an Event.
function openCreatePlaylistModal(presetGenre) {
    if (typeof presetGenre !== 'string') presetGenre = '';
    document.getElementById('new-playlist-name').value = '';
    const gsel = document.getElementById('new-playlist-genre');
    if (gsel) {
        // Only genres with games in them: an auto-playlist that resolves to nothing is
        // just a confusing empty list.
        gsel.innerHTML = ["<option value=\"\">Hand-picked, I'll add games myself</option>"]
            .concat(allGenres.filter(g => g.count).map(g => `<option value="${g.slug}">${escHtml(g.label)} (${g.count})</option>`))
            .join('');
        gsel.value = presetGenre || '';
        gsel.dispatchEvent(new Event('change'));
    }
    document.getElementById('modal-create-playlist').classList.add('active');
    setTimeout(() => document.getElementById('new-playlist-name').focus(), 80);
}

function openEditPlaylistModal(pl) {
    document.getElementById('edit-playlist-id').value   = pl.id;
    document.getElementById('edit-playlist-name').value = pl.name;
    document.getElementById('modal-edit-playlist').classList.add('active');
}

async function openManagePlaylistGames(pl) {
    const renameInput = document.getElementById('manage-playlist-rename-input');
    renameInput.value = pl.name;

    document.getElementById('btn-manage-playlist-rename').onclick = async () => {
        const newName = renameInput.value.trim();
        if (!newName || newName === pl.name) return;
        await window.api.updatePlaylist(pl.id, newName);
        pl = { ...pl, name: newName };
        await loadPlaylists();
    };

    document.getElementById('btn-manage-playlist-delete').onclick = async () => {
        const confirmed = await showConfirm(`Delete playlist "${pl.name}"? This cannot be undone.`);
        if (!confirmed) return;
        await window.api.deletePlaylist(pl.id);
        document.getElementById('modal-manage-playlist-games').classList.remove('active');
        if (currentPlaylistId === pl.id) {
            currentPlaylistId = null;
            currentPlaylistGames = null;
            applyFilters();
        }
        await loadPlaylists();
    };

    const games = await window.api.getPlaylistGames(pl.id);
    const list = document.getElementById('manage-playlist-games-list');
    if (!games.length) {
        list.innerHTML = `<p style="font-size:11px; color:var(--text_dim); text-align:center; margin:16px 0;">No games in this playlist.</p>`;
    } else {
        list.innerHTML = games.map(g =>
            `<div style="display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--bg_menu); border-radius:6px; border:1px solid var(--border);">
                <span style="flex:1; font-size:12px; font-weight:700; color:var(--text_sec); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(g.Game)}</span>
                <button class="btn-remove-from-pl" data-game-id="${g.id}" data-playlist-id="${pl.id}"
                    style="padding:2px 8px; background:rgba(239,83,80,0.12); border:1px solid #ef5350; color:#ef5350; border-radius:4px; cursor:pointer; font-size:10px; font-weight:900; font-family:inherit; flex-shrink:0; transition:background 0.15s;" onmouseover="this.style.background='rgba(239,83,80,0.28)';" onmouseout="this.style.background='rgba(239,83,80,0.12)';">Remove</button>
            </div>`
        ).join('');
        list.querySelectorAll('.btn-remove-from-pl').forEach(btn => {
            btn.addEventListener('click', async () => {
                const plId = Number(btn.dataset.playlistId);
                const gId  = Number(btn.dataset.gameId);
                await window.api.removeGameFromPlaylist(plId, gId);
                if (currentPlaylistId === plId) {
                    currentPlaylistGames = await window.api.getPlaylistGames(plId);
                    applyFilters();
                }
                openManagePlaylistGames(pl);
            });
        });
    }
    document.getElementById('modal-manage-playlist-games').classList.add('active');
}

async function openRemoveFromPlaylistModal(game) {
    document.getElementById('remove-from-pl-game').textContent = game.Game;
    const gamePlaylistIds = await window.api.getGamePlaylists(game.id);
    const included = allPlaylists.filter(p => gamePlaylistIds.includes(p.id));
    const list = document.getElementById('remove-from-pl-list');
    const confirmBtn = document.getElementById('btn-remove-from-pl-confirm');
    confirmBtn.disabled = true;
    if (!included.length) {
        list.innerHTML = `<div class="pl-select-row" style="cursor:default;color:var(--text_dim);">Game is not in any playlist.</div>`;
    } else {
        list.innerHTML = included.map(p =>
            `<div class="pl-select-row" data-id="${p.id}"><span class="pl-row-check">□</span><span>${escHtml(p.name)}</span></div>`
        ).join('');
        list.querySelectorAll('.pl-select-row[data-id]').forEach(row => {
            row.addEventListener('click', () => {
                row.classList.toggle('pl-selected');
                row.querySelector('.pl-row-check').textContent = row.classList.contains('pl-selected') ? '■' : '□';
                confirmBtn.disabled = !list.querySelector('.pl-select-row.pl-selected');
            });
        });
    }
    confirmBtn.onclick = async () => {
        const selected = [...list.querySelectorAll('.pl-select-row.pl-selected')];
        await Promise.all(selected.map(async row => {
            const plId = Number(row.dataset.id);
            await window.api.removeGameFromPlaylist(plId, game.id);
            if (currentPlaylistId === plId) {
                currentPlaylistGames = await window.api.getPlaylistGames(plId);
                applyFilters();
            }
        }));
        document.getElementById('modal-remove-from-playlist').classList.remove('active');
        const remaining = await window.api.getGamePlaylists(game.id);
        if (remaining.length === 0) {
            document.getElementById('btn-gamepage-remove-playlist')?.style && (document.getElementById('btn-gamepage-remove-playlist').style.display = 'none');
        }
    };
    document.getElementById('modal-remove-from-playlist').classList.add('active');
}

// ──────────────────────────────────────────────────────────────────────────────

function syncFilterActiveStates() {
    document.querySelectorAll('.rail-btn[data-rail]').forEach(btn => {
        const f = btn.dataset.rail;
        btn.classList.toggle('active', f === 'all' ? activeFilters.size === 0 : activeFilters.has(f));
    });
    document.querySelectorAll('.panel-filter-btn[data-filter]').forEach(btn => {
        btn.classList.toggle('active', activeFilters.has(btn.dataset.filter));
    });
    document.querySelectorAll('.split-ftab[data-filter]').forEach(btn => {
        const f = btn.dataset.filter;
        btn.classList.toggle('active', f === 'all' ? activeFilters.size === 0 : activeFilters.has(f));
    });
    // Keep the search-bar category dropdown in step with the rail/sidebar buttons.
    // (Value assignment goes through the cust-sel shim → label syncs, no change event.)
    const catSel = document.getElementById('gallery-category');
    if (catSel) {
        if (activeFilters.size === 0) catSel.value = 'all';
        else if (activeFilters.size === 1) {
            const f = [...activeFilters][0];
            if ([...catSel.options].some(o => o.value === f)) catSel.value = f;
        } // multi-select via sidebar: leave the dropdown label as-is
    }
}

// Play the floating-overlay gamepage's leave animation, then run `done()` (which re-enters
// switchView to actually swap views). Falls back on a timer if animationend never fires.
let _gpOverlayCloseTimer = null;
// Bumped whenever a close is cancelled by the overlay re-opening. A close that has already
// been scheduled cannot be un-scheduled, so instead it checks this on the way out and stays
// quiet if it is stale, otherwise its done() fires ~360ms later and closes the panel that
// just re-opened, which is what a --game= request arriving over an open gamepage does.
let _gpOverlayCloseGen = 0;
function _animateOverlayClose(done) {
    // Animate out whichever panel is currently floating (gamepage or the edit page on top of it).
    const gp = document.querySelector('#view-details.active') || document.getElementById('view-gamepage');
    if (!gp || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.body.classList.remove('gamepage-overlay', 'gamepage-overlay-closing');
        done();
        return;
    }
    document.body.classList.add('gamepage-overlay-closing');
    const gen = ++_gpOverlayCloseGen;
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(_gpOverlayCloseTimer);
        gp.removeEventListener('animationend', onEnd);
        if (gen !== _gpOverlayCloseGen) return;   // the overlay re-opened, this close is void
        done();
    };
    const onEnd = (e) => { if (e.target === gp) finish(); };
    gp.addEventListener('animationend', onEnd);
    _gpOverlayCloseTimer = setTimeout(finish, 360);
}

function switchView(viewId) {
    _closeSteamMenu();
    // Re-home the hero pills after the view actually changes (the class swap happens below).
    setTimeout(() => { try { placeHeroPills(); } catch {} }, 0);
    // ── Floating-overlay gamepage: in the classic layouts, view-gamepage floats as a
    //    centered panel over the (blurred) current view instead of swapping in full-page.
    const _ac = document.getElementById('app-container');
    const _classicOverlay = true;
    const _overlayGamepage = viewId === 'view-gamepage' && _classicOverlay;
    // The Edit page (view-details), when reached FROM the floating gamepage, floats in the SAME
    // panel box directly on top, so opening/returning feels seamless, not a full-page swap.
    const _overlayDetails = viewId === 'view-details' && _classicOverlay && document.body.classList.contains('gamepage-overlay');
    if (_overlayGamepage || _overlayDetails) {
        document.body.classList.remove('gamepage-overlay-closing');   // cancel any in-flight close
        _gpOverlayCloseGen++;                                          // …and make that cancel stick
        document.body.classList.add('gamepage-overlay');
        const panel = document.getElementById(_overlayDetails ? 'view-details' : 'view-gamepage');
        const other = document.getElementById(_overlayDetails ? 'view-gamepage' : 'view-details');
        other.classList.remove('active');     // swap the visible panel; the grid view stays active behind both
        panel.classList.add('active');
        panel.scrollTop = 0;
        document.getElementById('gamepage-back-bar').style.display = _overlayGamepage ? 'block' : 'none';
        const _vp = document.getElementById('detail-video-player'); if (_vp) _vp.pause();
        clearInterval(heroKbInterval);                                   // gamepage hero, hidden either way
        if (_overlayGamepage) clearInterval(detailScreenshotInterval);   // stop edit screenshots when leaving the edit page (keep them while editing)
        return;
    }
    // Leaving the floating overlay → animate it out first, then complete the switch.
    if (document.body.classList.contains('gamepage-overlay') && !document.body.classList.contains('gamepage-overlay-closing')) {
        _animateOverlayClose(() => switchView(viewId));
        return;
    }
    document.body.classList.remove('gamepage-overlay', 'gamepage-overlay-closing');
    document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(viewId);
    target.classList.add('active');
    if (_pendingScrollRestore != null) { target.scrollTop = _pendingScrollRestore; _pendingScrollRestore = null; }
    else { target.scrollTop = 0; }
    document.body.classList.toggle('viewing-home', viewId === 'view-home');   // full-bleed Home

    // The search/category/sort/playlist row is a single node shared by the grid views,
    // move it into whichever one is being shown (all its wiring is id-based, so it just works).
    const _gsw = document.getElementById('gallery-search-wrap');
    if (_gsw) {
        if (viewId === 'view-list') target.insertBefore(_gsw, target.firstChild);
        else if (viewId === 'view-gallery') target.insertBefore(_gsw, document.getElementById('gallery-grid'));
    }

    document.getElementById('gamepage-back-bar').style.display = viewId === 'view-gamepage' ? 'block' : 'none';

    // Ensure video pauses when leaving the view
    const vp = document.getElementById('detail-video-player');
    if (vp) vp.pause();

    if (viewId !== 'view-gamepage') clearInterval(ssBannerKbInterval);
    if (viewId !== 'view-gallery') clearInterval(heroKbInterval);
    if (viewId !== 'view-details') clearInterval(detailScreenshotInterval);
    if (viewId === 'view-gallery' || viewId === 'view-list') lastGridView = viewId;

    ['btn-view-gallery', 'btn-view-gallery-sb'].forEach(id =>
        document.getElementById(id)?.classList.toggle('active', viewId === 'view-gallery'));
    ['btn-view-list', 'btn-view-list-sb'].forEach(id =>
        document.getElementById(id)?.classList.toggle('active', viewId === 'view-list'));
}


// Debounced applyFilters, collapses rapid successive calls (search keystrokes) into one render.
let _afTimer = null;
function _debouncedApplyFilters() {
    clearTimeout(_afTimer);
    _afTimer = setTimeout(applyFilters, 80);
}

// Debounced loadGames, collapses rapid successive calls (e.g. from two parallel .then() chains)
// into a single DB fetch 80ms after the last call, invisible to the user.
let _lgTimer = null;
let _lgResolvers = [];   // resolvers of every loadGames() coalesced into the pending timer
function loadGames() {
    clearTimeout(_lgTimer);
    return new Promise(resolve => {
        // Coalesce: each call registers its resolver; the surviving timer resolves them ALL.
        // (Previously the resolver lived inside the timer, so a later call that cleared the
        // timer left earlier promises pending forever, hanging any `await loadGames()`.)
        _lgResolvers.push(resolve);
        _lgTimer = setTimeout(async () => {
            const resolvers = _lgResolvers; _lgResolvers = [];
            try {
                const res = await window.api.getGames();
                let games = res.games || [];
                allGames = games.filter(g => g.Game && g.Game !== 'null');
                // Keep the active playlist/recently-imported snapshot fresh too, it's a separate
                // fetch, so without this a scrape/edit/hide only shows after switching views and back.
                if (currentPlaylistId === 'recently-imported') {
                    currentPlaylistGames = await window.api.getRecentlyImported(recentlyImportedCount);
                } else if (currentPlaylistId !== null) {
                    currentPlaylistGames = await window.api.getPlaylistGames(currentPlaylistId);
                }
                applyFilters();
            } catch (e) { console.error('[loadGames]', e); }
            finally { resolvers.forEach(r => { try { r(); } catch {} }); }
        }, 80);
    });
}

// Gallery search
document.getElementById('gallery-search').addEventListener('input', _debouncedApplyFilters);
document.getElementById('btn-gsearch-clear').addEventListener('click', () => {
    document.getElementById('gallery-search').value = '';
    document.getElementById('btn-gsearch-clear').style.display = 'none';
    applyFilters();
    document.getElementById('gallery-search').focus();
});

// ── GALLERY CATEGORY + SORT (search-bar dropdowns; custom select ported from EmuLatte) ──
let _gallerySort = 'alpha';
const _galleryIsScraped = g => !!(g.CoverArt || g.Description);
// Sort modes mirror EmuLatte's sortGames, mapped to Manager fields.
function sortGalleryGames(games) {
    const byTitle = (a, b) => (a.Game || '').localeCompare(b.Game || '', undefined, { sensitivity: 'base' });
    const arr = [...games];
    switch (_gallerySort) {
        case 'played':  return arr.sort((a, b) => (b.LastPlayed || 0) - (a.LastPlayed || 0) || byTitle(a, b));
        case 'favs':    return arr.sort((a, b) => (b.FAV === 'YES' ? 1 : 0) - (a.FAV === 'YES' ? 1 : 0) || byTitle(a, b));
        case 'want':    return arr.sort((a, b) => (b.WANT_TO_PLAY === 'YES' ? 1 : 0) - (a.WANT_TO_PLAY === 'YES' ? 1 : 0) || byTitle(a, b));
        case 'added':   return arr.sort((a, b) => (b.date_added || 0) - (a.date_added || 0) || (b.id || 0) - (a.id || 0));
        case 'scraped': return arr.sort((a, b) => (_galleryIsScraped(b) ? 1 : 0) - (_galleryIsScraped(a) ? 1 : 0) || byTitle(a, b));
        default:        return arr.sort(byTitle);                                             // 'alpha'
    }
}

// Custom select widget (EmuLatte port): hides the native <select>, renders a themed
// button whose option list is PORTALED to <body> at z-100000 so it can't be clipped.
let _openCustSel = null;
function installSelectValueShim(sel, onChange) {
    const vd = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const id = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    Object.defineProperty(sel, 'value',         { configurable: true, get() { return vd.get.call(this); }, set(v) { vd.set.call(this, v); onChange(); } });
    Object.defineProperty(sel, 'selectedIndex', { configurable: true, get() { return id.get.call(this); }, set(v) { id.set.call(this, v); onChange(); } });
}
function enhanceSelect(sel) {
    if (!sel || sel.dataset.enh) return;
    sel.dataset.enh = '1';
    sel.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'cust-sel';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cust-sel-btn';
    btn.innerHTML = '<span class="cust-sel-label"></span><span class="cust-sel-arrow">▾</span>';
    wrap.appendChild(btn);
    sel.parentNode.insertBefore(wrap, sel.nextSibling);
    const labelEl = btn.querySelector('.cust-sel-label');

    const syncLabel = () => { const o = sel.options[sel.selectedIndex]; labelEl.textContent = o ? o.textContent : ''; labelEl.style.fontFamily = (o && o.style.fontFamily) || ''; };

    let listEl = null;
    const api = { close };

    function close() {
        if (listEl) { listEl.remove(); listEl = null; }
        wrap.classList.remove('open');
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', close, true);
        window.removeEventListener('scroll', onScroll, true);
        if (_openCustSel === api) _openCustSel = null;
    }
    function onDocDown(e) { if (!listEl?.contains(e.target) && !wrap.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // Dismiss when the page behind the list scrolls, but NOT when scrolling the list itself.
    function onScroll(e) { if (!listEl?.contains(e.target)) close(); }

    function position() {
        const r = btn.getBoundingClientRect();
        listEl.style.left  = `${r.left}px`;
        listEl.style.width = `${r.width}px`;
        const below  = window.innerHeight - r.bottom;
        const listH  = Math.min(listEl.scrollHeight, 260);
        if (below < listH + 8 && r.top > below) {
            listEl.style.top = ''; listEl.style.bottom = `${window.innerHeight - r.top + 4}px`;
        } else {
            listEl.style.bottom = ''; listEl.style.top = `${r.bottom + 4}px`;
        }
    }

    function open() {
        _openCustSel?.close();
        listEl = document.createElement('div');
        listEl.className = 'cust-sel-list';
        Array.from(sel.options).forEach((o, i) => {
            const item = document.createElement('div');
            item.className = 'cust-sel-item' + (i === sel.selectedIndex ? ' sel' : '');
            item.textContent = o.textContent;
            if (o.style.fontFamily) item.style.fontFamily = o.style.fontFamily;   // preview each option in its own face
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                try {
                    sel.selectedIndex = i;                              // shim → syncLabel
                    sel.dispatchEvent(new Event('change', { bubbles: true }));
                } finally {
                    close();                                            // always tear down the portaled list + listeners
                }
            });
            listEl.appendChild(item);
        });
        document.body.appendChild(listEl);
        position();
        wrap.classList.add('open');
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', close, true);
        window.addEventListener('scroll', onScroll, true);
        _openCustSel = api;
        listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    }

    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); listEl ? close() : open(); });

    installSelectValueShim(sel, syncLabel);
    new MutationObserver(syncLabel).observe(sel, { childList: true });
    syncLabel();
}

// Only the gallery selects are enhanced (other native selects live in modals/forms).
enhanceSelect(document.getElementById('gallery-category'));
enhanceSelect(document.getElementById('gallery-sort'));
enhanceSelect(document.getElementById('gallery-genre'));
enhanceSelect(document.getElementById('gallery-playlist'));
enhanceSelect(document.getElementById('ui-font-select'));   // themed Interface Font dropdown (Appearance)

// Playlist dropdown, options rebuilt from allPlaylists (called from renderPlaylistPanels,
// so create/delete/rename and filter changes all keep it current). innerHTML swap triggers
// the cust-sel MutationObserver → label re-syncs.
function _rebuildPlaylistDropdown() {
    const sel = document.getElementById('gallery-playlist');
    if (!sel) return;
    const opts = ['<option value="none">No Playlist</option>'];
    if (recentlyImportedCount > 0) opts.push('<option value="recently-imported">Recently Imported</option>');
    allPlaylists.forEach(p => opts.push(`<option value="${p.id}">${escHtml(p.name)}</option>`));
    opts.push('<option value="__new__">+ New Playlist…</option>');
    sel.innerHTML = opts.join('');
    sel.value = currentPlaylistId == null ? 'none' : String(currentPlaylistId);
    if (sel.selectedIndex < 0) sel.value = 'none';   // active playlist was deleted
}
document.getElementById('gallery-genre')?.addEventListener('change', e => {
    const v = e.target.value;
    currentGenre = (v === 'all') ? null : v;
    // The "save as playlist" star only makes sense for a real genre, not for
    // "All Genres" or the "No Genre Yet" bucket.
    const star = document.getElementById('btn-genre-to-playlist');
    if (star) star.style.display = (currentGenre && currentGenre !== '__none__') ? '' : 'none';
    applyFilters();
});
document.getElementById('btn-genre-to-playlist')?.addEventListener('click', () => {
    if (currentGenre && currentGenre !== '__none__') openCreatePlaylistModal(currentGenre);
});

document.getElementById('gallery-playlist').addEventListener('change', e => {
    const v = e.target.value;
    if (v === '__new__') { _rebuildPlaylistDropdown(); openCreatePlaylistModal(); }   // revert label, open the create modal
    else if (v === 'none') clearPlaylistFilter();
    else if (v === 'recently-imported') setRecentlyImportedFilter();
    else setPlaylistFilter(Number(v));
});

document.getElementById('gallery-category').addEventListener('change', e => {
    // Dropdown is single-choice: clear any multi-selection first, then route through
    // activateFilter so the flatpak/pico8 scan hooks and view-return logic still run.
    activeFilters.clear();
    activateFilter(e.target.value);
});
document.getElementById('gallery-sort').addEventListener('change', e => {
    _gallerySort = e.target.value;
    window.api.setSetting('gallery_sort', _gallerySort);
    applyFilters();
});
document.getElementById('btn-gallery-random')?.addEventListener('click', pickRandomVisible);
(async () => {
    const saved = await window.api.getSetting('gallery_sort');
    if (saved && ['alpha','played','favs','want','added','scraped'].includes(saved)) {
        _gallerySort = saved;
        const sel = document.getElementById('gallery-sort');
        if (sel) sel.value = saved;   // shim syncs the custom label
        applyFilters();
    }
})();

async function activateFilter(filter) {
    // Leaving playlist mode when a store/qualifier filter is activated
    if (currentPlaylistId !== null) {
        currentPlaylistId = null;
        currentPlaylistGames = null;
        renderPlaylistPanels();
    }
    if (filter === 'all') {
        activeFilters.clear();
    } else if (_hidePico8 && filter === 'pico8') {
        // Exclusive: pico8 can't be combined with other filters when hidden
        if (activeFilters.has('pico8')) activeFilters.clear();
        else { activeFilters.clear(); activeFilters.add('pico8'); }
    } else if (_hidePico8 && activeFilters.has('pico8') && STORE_FILTERS.has(filter)) {
        // Switching away from exclusive pico8 mode to another store filter
        activeFilters.clear();
        activeFilters.add(filter);
    } else {
        if (activeFilters.has(filter)) activeFilters.delete(filter);
        else activeFilters.add(filter);
    }
    syncFilterActiveStates();
    if (filter === 'flatpak' && activeFilters.has('flatpak')) {
        const scanResult = await window.api.scanFlatpak();
        await loadGames();
        if (scanResult.iconMap && Object.keys(scanResult.iconMap).length > 0)
            generateFlatpakArt(scanResult.iconMap);
    }
    if (filter === 'pico8' && activeFilters.has('pico8')) {
        await window.api.scanPico8();
        await loadGames();
    }
    applyFilters();
    const active = document.querySelector('.view.active');
    if (active && (active.id === 'view-gamepage' || active.id === 'view-details')) switchView(lastGridView);
}

// Rail qualifier buttons (all, installed, favs, want)
document.querySelectorAll('.rail-btn[data-rail]').forEach(btn => {
    btn.addEventListener('click', () => { closePanel(); activateFilter(btn.dataset.rail); });
});
// Rail panel toggles
document.querySelectorAll('.rail-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.panel === 'search') document.getElementById('gallery-search')?.focus();
        else openPanel(btn.dataset.panel);
    });
});
// Panel store buttons
document.querySelectorAll('.panel-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => activateFilter(btn.dataset.filter));
});
// Panel close
document.getElementById('btn-panel-close')?.addEventListener('click', closePanel);

// Lowercased search text for a game: the title plus the metadata people actually search by.
// Searching every column instead (the old `Object.values(game).some(...)`) matched the multi-KB
// Steam descriptions and the artwork file paths, on an 887-game library "wit" returned 503 games
// (424 of them only because "with" appears in their description) when 10 have it in the title,
// and the gallery then rebuilt all 503 cards on every keystroke.
// Cached on the object under a Symbol, so it stays out of Object.values / JSON / IPC round-trips.
// Game objects are replaced wholesale on every loadGames(), so the cache can't go stale.
const _SEARCH_BLOB = Symbol('searchBlob');
function searchBlob(game) {
    let blob = game[_SEARCH_BLOB];
    if (blob === undefined) {
        blob = [game.Game, game.Store, game.DEV, game.PUB, game.GENRE, game.Franchise, game.Tags,
                gameGenres(game).map(genreLabel).join(' '), gameGenres(game).join(' ')]
            .filter(Boolean).join(' ').toLowerCase();
        Object.defineProperty(game, _SEARCH_BLOB, { value: blob, enumerable: false, configurable: true });
    }
    return blob;
}

// ── Random pick ───────────────────────────────────────────────────────────────
// The set the gallery last drew, kept so the dice can choose from exactly what is on
// screen. Also remembers the last few picks: a shuffle that hands you the same game
// twice in a row does not feel random even when it is.
let _galleryVisible = [];
let _recentPicks = [];

function pickRandomVisible() {
    const pool = _galleryVisible;
    if (!pool.length) { showAlert('Nothing to pick from, no games match the current filters.'); return; }
    if (pool.length === 1) { openHomeGameById(pool[0].id, pool[0]); return; }

    // Avoid repeats, but never at the cost of refusing to pick: with a pool smaller than
    // the memory, drop the oldest exclusions until something is available.
    const memory = Math.min(_recentPicks.length, Math.max(0, pool.length - 1));
    const recent = new Set(_recentPicks.slice(-memory));
    const fresh = pool.filter(g => !recent.has(g.id));
    const from = fresh.length ? fresh : pool;

    const game = from[Math.floor(Math.random() * from.length)];
    _recentPicks.push(game.id);
    if (_recentPicks.length > 10) _recentPicks.shift();
    openHomeGameById(game.id, game);
}

function applyFilters() {
    const query = (document.getElementById('gallery-search')?.value || '').toLowerCase();

    // Playlist mode: filter within the playlist's game set
    const baseGames = currentPlaylistGames !== null ? currentPlaylistGames : allGames;

    const storeActive     = [...activeFilters].filter(f => STORE_FILTERS.has(f));
    const qualifierActive = [...activeFilters].filter(f => QUALIFIER_FILTERS.has(f));

    let filtered = baseGames.filter(game => {
        const storeLower = (game.Store || '').toLowerCase();

        // User-hidden games never appear in any library view (only in the Hidden Games manager)
        if (isHidden(game)) return false;

        // PICO-8 visibility: hide unless pico8 filter is active or user explicitly searches for it
        if (_hidePico8 && _isPico8Only(game.Store)
            && !activeFilters.has('pico8') && !query.includes('pico')) return false;

        // Free-to-play visibility: hide tagged games everywhere when the toggle is off
        if (_hideFreeGames && isFreeToPlay(game)) return false;

        // Stores: OR, game must match at least one selected store (open if none selected)
        if (storeActive.length > 0) {
            const storeMatch = storeActive.some(f => {
                if (f === 'steam')     return storeLower.includes('steam');
                if (f === 'epic')      return storeLower.includes('epic');
                if (f === 'gog')       return storeLower.includes('gog');
                if (f === 'physical')  return storeLower.includes('physical');
                if (f === 'flatpak')   return storeLower.includes('flatpak');
                if (f === 'pico8')     return storeLower.includes('pico-8');
                if (f === 'itch')      return storeLower.includes('itch') || (game.LaunchCommand || '').startsWith('itch://');
                if (f === 'apps')      return storeLower.includes('apps');
                if (f === 'others')    return storeLower.includes('others');
                if (f === 'openbor')   return storeLower.includes('openbor');
                if (f === 'emulation') return storeLower.includes('emulation');
                return false;
            });
            if (!storeMatch) return false;
        }

        // Genre: AND against everything else, narrowing "Steam" by "CRPG" is the
        // whole point, so it never widens the result the way the store chips do.
        if (currentGenre === '__none__') {
            if (game.PrimaryGenre) return false;
        } else if (currentGenre && !gameHasGenre(game, currentGenre)) {
            return false;
        }

        // Qualifiers: AND, game must satisfy every selected qualifier
        for (const f of qualifierActive) {
            if (f === 'playable'   && !game.LaunchCommand) return false;
            if (f === 'favs'       && game.FAV !== 'YES') return false;
            if (f === 'want'       && game.WANT_TO_PLAY !== 'YES') return false;
            if (f === 'mac-native' && !isMacNative(game)) return false;
            if (f === 'installed') {
                // ⚠️ The manual/emulation special case is gone: it accepted any row with a
                // launch command, which is exactly how uninstalled emulator and RetroArch
                // entries kept showing up here. A NULL flag still counts, so rows that were
                // never reconciled behave as before.
                if (!isGameInstalled(game)) return false;
            }
        }

        if (!query) return true;
        return searchBlob(game).includes(query);
    });

    if (query) {
        filtered.sort((a, b) => {
            const aName = (a.Game || '').toLowerCase().includes(query);
            const bName = (b.Game || '').toLowerCase().includes(query);
            if (aName && !bName) return -1;
            if (!aName && bName) return 1;
            return 0;
        });
    }

    updateHeroMosaic(filtered);

    // Hero buttons: only show when that store is the sole active store filter
    const singleStore = storeActive.length === 1;
    [
        ['pico8-hero-btns',   singleStore && activeFilters.has('pico8')],
        ['steam-hero-btns',   singleStore && activeFilters.has('steam')],
        ['gog-hero-btns',     singleStore && activeFilters.has('gog')],
        ['epic-hero-btns',    singleStore && activeFilters.has('epic')],
        ['flatpak-hero-btns', singleStore && activeFilters.has('flatpak')],
        ['itch-hero-btns',    singleStore && activeFilters.has('itch')],
        ['others-hero-btns',  singleStore && activeFilters.has('others')]
    ].forEach(([id, show]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? 'flex' : 'none';
    });

    // Search-bar sort dropdown: order the grid by the chosen mode. With an explicit
    // non-alphabetical sort the RECENTLY-PLAYED strip is skipped so the whole grid
    // reads in the selected order.
    filtered = sortGalleryGames(filtered);

    // What the gallery is actually showing right now. The random pick reads this rather
    // than re-deriving the filters, so "surprise me" always answers the question the
    // screen is currently asking, search text, category, genre and playlist included.
    _galleryVisible = filtered;

    let recentGames = [];
    let regularGames = [...filtered];

    if (recentGamesCount > 0 && _gallerySort === 'alpha') {
        let playedGames = filtered.filter(g => g.LastPlayed && g.LastPlayed > 0).sort((a, b) => b.LastPlayed - a.LastPlayed);
        recentGames = playedGames.slice(0, recentGamesCount);
        const recentIds = new Set(recentGames.map(g => g.id));
        regularGames = filtered.filter(g => !recentIds.has(g.id));
    }

    renderTable(recentGames, regularGames);
    renderGallery(recentGames, regularGames);
}

function renderTable(recent, regular) {
    const tbody = document.getElementById('list-tbody');
    tbody.innerHTML = '';

    const appendRow = (game) => {
        const tr = document.createElement('tr');
        tr.style.cursor = "pointer";
        let displayStore = game.Store ? game.Store.replace(/EPIC/i, 'Epic').replace(/GOG/i, 'GOG') : '';
        const installCmd = getInstallCommand(game);
        const isInstalled = isGameInstalled(game);
        let actionCell;
        if (isInstalled) {
            actionCell = `<button class="primary btn-play" data-cmd="${game.LaunchCommand.replace(/"/g, '&quot;')}" data-id="${game.id}" style="padding: 4px 8px;">${t('status.play')}</button>`;
        } else if (_isInstallerGame(game)) {
            actionCell = `<button class="btn-install" data-installer="1" data-name="${game.Game.replace(/"/g, '&quot;')}" data-id="${game.id}" style="padding: 4px 8px;">${t('status.install')}</button>`;
        } else if (installCmd) {
            actionCell = `<button class="btn-install" data-url="${installCmd}" data-id="${game.id}" style="padding: 4px 8px;">${t('status.install')}</button>`;
        } else if (isManualCategory(game)) {
            actionCell = `<button class="btn-install" data-addcmd="1" data-id="${game.id}" data-name="${game.Game.replace(/"/g, '&quot;')}" style="padding: 4px 8px;">${t('status.install')}</button>`;
        } else {
            actionCell = `<span style="color:#555; font-size:12px;">${t('game.no_cmd')}</span>`;
        }
        const _lStarSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
        const _lBkSvg  = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        const _lPlSvg  = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/><line x1="19" y1="3" x2="19" y2="9"/><line x1="22" y1="6" x2="16" y2="6"/></svg>`;
        tr.innerHTML = `
        <td>${actionCell}</td>
        <td><button class="btn-list-fav${game.FAV === 'YES' ? ' active' : ''}" data-list-fav="${game.id}" title="Favourite">${_lStarSvg}</button></td>
        <td><button class="btn-list-want${game.WANT_TO_PLAY === 'YES' ? ' active' : ''}" data-list-want="${game.id}" title="Want to play">${_lBkSvg}</button></td>
        <td><button class="btn-list-playlist" data-list-playlist="${game.id}" title="Add to Playlist">${_lPlSvg}</button></td>
        <td style="font-weight: bold;">${game.Game}${isFreeToPlay(game) ? ` <span class="f2p-pill f2p-pill-inline" data-f2p-pill="1" title="Free-to-play, click to show/hide these">FREE</span>` : ''}</td>
        <td>${displayStore}</td>
        <td>${game.GENRE || ''}</td>
        <td>${game.RELEASED || ''}</td>
        `;
        tr.dataset.id = game.id;
        tbody.appendChild(tr);
    };

    if (recent && recent.length > 0) {
        const trLabel = document.createElement('tr');
        trLabel.innerHTML = `<td colspan="8" style="background: var(--bg_menu); color: var(--accent); font-weight: 900; letter-spacing: 2px; text-align: center;">${t('recent.header')}</td>`;
        tbody.appendChild(trLabel);
        recent.forEach(appendRow);

        const trAll = document.createElement('tr');
        trAll.innerHTML = `<td colspan="8" style="background: var(--bg_menu); color: var(--text_sec); font-weight: 900; letter-spacing: 2px; text-align: center;">${t('filter.all')}</td>`;
        tbody.appendChild(trAll);
    }
    regular.forEach(appendRow);

}


// Classic gamepage boxart → reuse the same big-cover lightbox (only when real art is present).
document.getElementById('gamepage-cover')?.addEventListener('click', () => {
    const el = document.getElementById('gamepage-cover');
    if (!el.dataset.zoom) return;
    document.getElementById('split-cover-zoom-img').src = el.src;
    document.getElementById('split-cover-zoom').classList.add('active');
});
['split-cover-zoom', 'split-cover-zoom-img'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
        document.getElementById('split-cover-zoom').classList.remove('active');
    });
});

// Keyboard: Home scrolls the gallery to top; Escape closes the big-cover lightbox.
// ⚠️ This block used to be "Split keyboard navigation" and carried the split pane's
// arrow-key row selection. Both surviving branches are layout-agnostic and the classic
// gamepage uses the same lightbox, so they outlive the layout that introduced them.
document.addEventListener('keydown', e => {
    if (e.key === 'Home' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        const inTextInput = active && ['INPUT','TEXTAREA'].includes(active.tagName);
        if (!inTextInput) {
            const gallery = document.getElementById('view-gallery');
            if (gallery?.classList.contains('active')) {
                e.preventDefault();
                gallery.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
        }
    }
    if (e.key === 'Escape' && document.getElementById('split-cover-zoom')?.classList.contains('active')) {
        document.getElementById('split-cover-zoom').classList.remove('active');
    }
});

// ── Table event delegation (set up once) ──────────────────────────────────────
const _tbody = document.getElementById('list-tbody');
_tbody.addEventListener('click', async (e) => {
    if (e.target.closest('[data-f2p-pill]')) {
        e.stopPropagation();
        const row = e.target.closest('tr[data-id]');
        openFreeGamesPrompt(row ? allGames.find(g => String(g.id) === row.dataset.id) : null);
        return;
    }
    const play = e.target.closest('.btn-play');
    if (play) { e.stopPropagation(); verifyAndLaunch(play.dataset.id, play.dataset.cmd); return; }
    const install = e.target.closest('.btn-install');
    if (install) {
        e.stopPropagation();
        if (install.dataset.addcmd) {
            openAddCmdDialog(install.dataset.id, install.dataset.name);
        } else if (install.dataset.installer) {
            const g = allGames.find(x => x.id == install.dataset.id);
            if (g) handleInstall(g); else showAlert('That game is no longer in the library, refresh and try again.');
        } else {
            const g = allGames.find(x => x.id == install.dataset.id);
            if (g) handleInstall(g); else window.api.openInstallUrl(install.dataset.url);
        }
        return;
    }
    const favBtn = e.target.closest('.btn-list-fav');
    if (favBtn) {
        e.stopPropagation();
        const id = favBtn.dataset.listFav;
        const game = allGames.find(g => String(g.id) === id);
        if (!game) return;
        game.FAV = game.FAV === 'YES' ? 'NO' : 'YES';
        favBtn.classList.toggle('active', game.FAV === 'YES');
        window.api.setGameFlag(id, 'FAV', game.FAV);
        return;
    }
    const wantBtn = e.target.closest('.btn-list-want');
    if (wantBtn) {
        e.stopPropagation();
        const id = wantBtn.dataset.listWant;
        const game = allGames.find(g => String(g.id) === id);
        if (!game) return;
        game.WANT_TO_PLAY = game.WANT_TO_PLAY === 'YES' ? 'NO' : 'YES';
        wantBtn.classList.toggle('active', game.WANT_TO_PLAY === 'YES');
        window.api.setGameFlag(id, 'WANT_TO_PLAY', game.WANT_TO_PLAY);
        return;
    }
    const plBtn = e.target.closest('.btn-list-playlist');
    if (plBtn) {
        e.stopPropagation();
        const id = plBtn.dataset.listPlaylist;
        const game = allGames.find(g => String(g.id) === id);
        if (game) openPlaylistPickerForGame(game);
        return;
    }
});
_tbody.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-f2p-pill]')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) { const g = allGames.find(x => String(x.id) === tr.dataset.id); if (g) openGamepage(g); }
});

// ── FLATPAK ART GENERATION ───────────────────────────────────────────────

async function generateFlatpakArt(iconMap) {
    for (const [gameId, iconName] of Object.entries(iconMap)) {
        const iconPath = await window.api.findFlatpakIcon(iconName);
        if (!iconPath) continue;

        const b64 = await window.api.readFileBase64(iconPath);
        if (!b64) continue;

        const isSvg = iconPath.endsWith('.svg');
        const dataUrl = `data:image/${isSvg ? 'svg+xml' : 'png'};base64,${b64}`;

        const img = await new Promise(resolve => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => resolve(null);
            el.src = dataUrl;
        });
        if (!img) continue;

        const color = _flatpakExtractColor(img);
        const coverB64 = _flatpakDrawCover(img, color);
        const heroB64  = _flatpakDrawHero(color);

        await window.api.saveFlatpakArt(Number(gameId), coverB64, heroB64, iconPath);

        // Update in-memory game so the gallery refreshes without a full reload
        const g = allGames.find(x => x.id == gameId);
        if (g) { g.CoverArt = '__pending__'; } // triggers re-render on next loadGames
    }
    if (Object.keys(iconMap).length > 0) await loadGames();
}

function _flatpakExtractColor(img) {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    let r = 0, g = 0, b = 0, n = 0;
    let maxSat = -1, sr = 80, sg = 100, sb = 180;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] < 100) continue;
        const pr = d[i], pg = d[i+1], pb = d[i+2];
        r += pr; g += pg; b += pb; n++;
        const mx = Math.max(pr,pg,pb), mn = Math.min(pr,pg,pb);
        const sat = mx < 20 ? 0 : (mx - mn) / mx;
        if (sat > maxSat && mx > 40) { maxSat = sat; sr = pr; sg = pg; sb = pb; }
    }
    // Prefer the most saturated color; fall back to average if icon is mostly greyscale
    if (n === 0) return [80, 100, 180];
    return maxSat > 0.25 ? [sr, sg, sb] : [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
}

function _flatpakGradient(ctx, w, h, r, g, b, dir = 'diagonal') {
    const d1 = `rgb(${Math.round(r*.10)},${Math.round(g*.10)},${Math.round(b*.10)})`;
    const d2 = `rgb(${Math.round(r*.22)},${Math.round(g*.22)},${Math.round(b*.22)})`;
    const grad = dir === 'horizontal'
        ? ctx.createLinearGradient(0,0,w,0)
        : ctx.createLinearGradient(0,0,w,h);
    grad.addColorStop(0, d1); grad.addColorStop(1, d2);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    // Radial glow
    const glow = ctx.createRadialGradient(w/2,h/2,0, w/2,h/2, Math.max(w,h)*.55);
    glow.addColorStop(0, `rgba(${r},${g},${b}.32)`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
}

function _flatpakDrawCover(img, [r,g,b]) {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 900;
    const ctx = c.getContext('2d');
    _flatpakGradient(ctx, 600, 900, r, g, b, 'diagonal');
    const sz = 380;
    ctx.drawImage(img, (600-sz)/2, (900-sz)/2, sz, sz);
    return c.toDataURL('image/png').split(',')[1];
}

function _flatpakDrawHero([r,g,b]) {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 400;
    const ctx = c.getContext('2d');
    _flatpakGradient(ctx, 1200, 400, r, g, b, 'horizontal');
    return c.toDataURL('image/png').split(',')[1];
}

// ── PICO-8 ART ────────────────────────────────────────────────────────────
// Cover art is handled in main.js: the .p8.png IS the image, copied directly.

// ── PICO-8 BBS ────────────────────────────────────────────────────────────
// Opens the real Lexaloffle BBS in a BrowserWindow.
// Downloads of .p8/.p8.png files are intercepted and saved to the carts folder.

// ─────────────────────────────────────────────────────────────────────────────

function getStoreLogo(store) {
    if (!store) return null;
    const s = store.toLowerCase();
    if (s.includes('steam'))    return 'assets/logos/steam.png';
    if (s.includes('gog'))      return 'assets/logos/gog.png';
    if (s.includes('epic'))     return 'assets/logos/epic.png';
    if (s.includes('flatpak'))  return 'assets/logos/flatpak.png';
    if (s.includes('pico-8') || s.includes('pico8')) return 'assets/logos/pico8.png';
    if (s.includes('itch'))  return 'assets/logos/itch.png';
    if (s.includes('physical')) return 'assets/logos/physical.png';
    if (s.includes('emulat'))   return 'assets/logos/emulation.png';
    if (s.includes('app'))      return 'assets/logos/apps.png';
    if (s.includes('openbor'))  return 'assets/logos/openbor.png';
    if (s.includes('other'))    return 'assets/logos/others.png';
    return null;
}

function _hltbDisplay(val) {
    if (!val) return null;
    const s = String(val);
    return (s !== '' && isFinite(+s)) ? s + 'h' : s;
}

function renderGallery(recent, regular) {
    const grid = document.getElementById('gallery-grid');
    grid.innerHTML = '';

    const appendCard = (game) => {
        const div = document.createElement('div');
        div.className = 'gallery-item';
        const imgSrc = game.CoverArt ? getSafePath(game.CoverArt) : '';
        const imgHtml = imgSrc ? `<img src="${imgSrc}" class="gallery-cover" loading="lazy">` : `<div class="gallery-cover" style="display:flex; align-items:center; justify-content:center; color:#555; font-size:12px;">${t('game.no_cover')}</div>`;
        const _badges = (game.Store ? String(game.Store).split(',') : []).map(s => s.trim()).filter(Boolean).map(s => { const l = getStoreLogo(s); return l ? `<div class="gallery-store-badge" style="-webkit-mask-image:url('${l}');"></div>` : ''; }).join('');
        const _macBadge = isMacNative(game) ? `<div class="gallery-store-badge gallery-mac-badge" style="-webkit-mask-image:url('assets/logos/apple.png');" title="Runs natively on macOS"></div>` : '';
        const badgeHtml = (_badges || _macBadge) ? `<div class="gallery-store-badges">${_badges}${_macBadge}</div>` : '';
        const f2pHtml = isFreeToPlay(game) ? `<div class="f2p-pill gallery-f2p-pill" data-f2p-pill="1" title="Free-to-play, click to show/hide these">FREE</div>` : '';
        const installCmdG = getInstallCommand(game);
        const isInstalled = isGameInstalled(game);
        const dotHtml = game.LaunchCommand ? `<div class="install-dot ${isInstalled ? 'is-installed' : 'not-installed'}" title="${isInstalled ? t('status.installed') : t('status.not_installed')}"></div>` : '';
        const isFav  = game.FAV === 'YES';
        const isWant = game.WANT_TO_PLAY === 'YES';
        const _starSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
        const _bkSvg  = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
        const _plSvg  = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/><line x1="19" y1="3" x2="19" y2="9"/><line x1="22" y1="6" x2="16" y2="6"/></svg>`;
        const flagsHtml = `<div class="gallery-flag-btns"><button class="btn-gallery-fav${isFav ? ' active' : ''}" data-fav="${game.id}" title="Favourite">${_starSvg}</button><button class="btn-gallery-want${isWant ? ' active' : ''}" data-want="${game.id}" title="Want to play">${_bkSvg}</button><button class="btn-gallery-playlist" data-playlist="${game.id}" title="Add to Playlist">${_plSvg}</button></div>`;
        let actionBtn = '';
        if (isInstalled) {
            actionBtn = `<button class="btn-play-gallery primary" data-cmd="${game.LaunchCommand.replace(/"/g, '&quot;')}" data-id="${game.id}" style="margin: 5px; font-size: 12px; padding: 4px;">${t('status.play')}</button>`;
        } else if (_isInstallerGame(game)) {
            actionBtn = `<button class="btn-install-gallery" data-installer="1" data-name="${game.Game.replace(/"/g, '&quot;')}" data-id="${game.id}" style="margin: 5px; font-size: 12px; padding: 4px;">${t('status.install')}</button>`;
        } else if (installCmdG) {
            actionBtn = `<button class="btn-install-gallery" data-url="${installCmdG}" data-id="${game.id}" style="margin: 5px; font-size: 12px; padding: 4px;">${t('status.install')}</button>`;
        } else if (isManualCategory(game)) {
            actionBtn = `<button class="btn-install-gallery" data-addcmd="1" data-id="${game.id}" data-name="${game.Game.replace(/"/g, '&quot;')}" style="margin: 5px; font-size: 12px; padding: 4px;">${t('status.install')}</button>`;
        }
        div.innerHTML = `
        <div class="gallery-cover-wrap">${imgHtml}${dotHtml}${badgeHtml}${f2pHtml}${flagsHtml}</div>
        <div class="gallery-title">${game.Game}</div>
        ${actionBtn}
        `;
        div.dataset.id = game.id;
        grid.appendChild(div);
    };

    if (recent && recent.length > 0) {
        const label = document.createElement('div');
        label.style.gridColumn = "1 / -1";
        label.style.background = "var(--bg_menu)";
        label.style.color = "var(--accent)";
        label.style.padding = "10px";
        label.style.fontWeight = "900";
        label.style.letterSpacing = "2px";
        label.style.textAlign = "center";
        label.style.borderRadius = "8px";
        label.style.border = "1px solid var(--border_solid)";
        label.innerText = t('recent.header');
        grid.appendChild(label);
        recent.forEach(appendCard);

        const labelAll = document.createElement('div');
        labelAll.style.gridColumn = "1 / -1";
        labelAll.style.background = "var(--bg_menu)";
        labelAll.style.color = "var(--text_sec)";
        labelAll.style.padding = "10px";
        labelAll.style.fontWeight = "900";
        labelAll.style.letterSpacing = "2px";
        labelAll.style.textAlign = "center";
        labelAll.style.borderRadius = "8px";
        labelAll.style.border = "1px solid var(--border_solid)";
        labelAll.innerText = t('filter.all');
        grid.appendChild(labelAll);
    }
    regular.forEach(appendCard);

}

// ── Gallery event delegation (set up once) ────────────────────────────────────
const _grid = document.getElementById('gallery-grid');
_grid.addEventListener('click', (e) => {
    if (e.target.closest('[data-f2p-pill]')) {
        e.stopPropagation();
        const card = e.target.closest('.gallery-item[data-id]');
        openFreeGamesPrompt(card ? allGames.find(g => String(g.id) === card.dataset.id) : null);
        return;
    }
    const play = e.target.closest('.btn-play-gallery');
    if (play) { e.stopPropagation(); verifyAndLaunch(play.dataset.id, play.dataset.cmd); return; }
    const install = e.target.closest('.btn-install-gallery');
    if (install) {
        e.stopPropagation();
        if (install.dataset.addcmd) {
            openAddCmdDialog(install.dataset.id, install.dataset.name);
        } else if (install.dataset.installer) {
            const g = allGames.find(x => x.id == install.dataset.id);
            if (g) handleInstall(g); else showAlert('That game is no longer in the library, refresh and try again.');
        } else {
            const g = allGames.find(x => x.id == install.dataset.id);
            if (g) handleInstall(g); else window.api.openInstallUrl(install.dataset.url);
        }
        return;
    }

    const favBtn = e.target.closest('.btn-gallery-fav');
    if (favBtn) {
        e.stopPropagation();
        const id = favBtn.dataset.fav;
        const game = allGames.find(g => String(g.id) === id);
        if (!game) return;
        game.FAV = game.FAV === 'YES' ? 'NO' : 'YES';
        favBtn.classList.toggle('active', game.FAV === 'YES');
        favBtn.style.animation = 'none'; void favBtn.offsetWidth;
        favBtn.style.animation = 'gallery-flag-glow 0.35s ease-out';
        setTimeout(() => { favBtn.style.animation = ''; }, 350);
        window.api.setGameFlag(id, 'FAV', game.FAV);
        return;
    }

    const wantBtn = e.target.closest('.btn-gallery-want');
    if (wantBtn) {
        e.stopPropagation();
        const id = wantBtn.dataset.want;
        const game = allGames.find(g => String(g.id) === id);
        if (!game) return;
        game.WANT_TO_PLAY = game.WANT_TO_PLAY === 'YES' ? 'NO' : 'YES';
        wantBtn.classList.toggle('active', game.WANT_TO_PLAY === 'YES');
        wantBtn.style.animation = 'none'; void wantBtn.offsetWidth;
        wantBtn.style.animation = 'gallery-flag-glow 0.35s ease-out';
        setTimeout(() => { wantBtn.style.animation = ''; }, 350);
        window.api.setGameFlag(id, 'WANT_TO_PLAY', game.WANT_TO_PLAY);
        return;
    }

    const plBtn = e.target.closest('.btn-gallery-playlist');
    if (plBtn) {
        e.stopPropagation();
        const id = plBtn.dataset.playlist;
        const game = allGames.find(g => String(g.id) === id);
        if (game) openPlaylistPickerForGame(game);
        return;
    }

    // plain click on the card (not on a flag/play/install button) opens the gamepage
    const item = e.target.closest('.gallery-item[data-id]');
    if (item) { const g = allGames.find(x => String(x.id) === item.dataset.id); if (g) openGamepage(g); }
});

// ── GOG Achievements ──────────────────────────────────────────────────────────

let _achAll = [];
let _achFilter = 'all';
let _achStores = {};   // storeLabel → achievements[]

function _gogAppIdFromGame(game) {
    const m = (game.LaunchCommand || '').match(/installer:\/\/launch\/gog\/(\d+)/i);
    return m ? m[1] : null;
}

function _relativeDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        const days = Math.floor((Date.now() - d) / 86400000);
        if (days === 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 7)  return `${days} days ago`;
        if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
        return d.toLocaleDateString();
    } catch { return iso; }
}

async function loadGamepageAchievements(game) {
    const container = document.getElementById('gp-ach-container');
    container.innerHTML = '';
    _achAll = [];
    _achStores = {};

    const gogId    = _gogAppIdFromGame(game);
    const steamRaw = game.SteamAppID ? String(game.SteamAppID).replace(/\.0+$/, '') : null;

    const tasks = [];
    if (gogId)    tasks.push({ label: 'GOG',   fetch: async () => { let r = await window.api.getGameAchievements(gogId); if (!r.ok || !r.achievements.length) r = await window.api.fetchAchievementsNow(gogId); return r; } });
    if (steamRaw) tasks.push({ label: 'STEAM', fetch: async () => { const k = `steam_${steamRaw}`; let r = await window.api.getGameAchievements(k); if (!r.ok || !r.achievements.length) r = await window.api.fetchSteamAchievements(steamRaw); return r; } });
    if (!tasks.length) return;

    const results = await Promise.all(tasks.map(t => t.fetch()));
    const multi = results.filter((r, i) => r.ok && r.achievements.length).length > 1;

    for (let i = 0; i < tasks.length; i++) {
        const res = results[i];
        if (!res.ok || !res.achievements.length) continue;
        const label = tasks[i].label;
        _achStores[label] = res.achievements;
        if (!_achAll.length) _achAll = res.achievements;
        _renderAchStrip(container, label, res.achievements, multi);
    }
}

function _renderAchStrip(container, label, achievements, showLabel) {
    const total    = achievements.length;
    const unlocked = achievements.filter(a => a.date_unlocked).length;
    const pct      = total ? Math.round(unlocked / total * 100) : 0;

    const strip = document.createElement('div');
    strip.style.cssText = 'background:var(--bg_panel); border-radius:8px; padding:14px; border:1px solid var(--border_solid); display:flex; flex-direction:column; gap:10px; cursor:pointer;';
    strip.title = 'View all achievements';
    strip.onclick = () => { _achAll = _achStores[label]; openAchievementsModal(label, showLabel); };

    // Header
    strip.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M5 7H3v4a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4V7h-2"/><path d="M5 3h14v8a7 7 0 0 1-7 7 7 7 0 0 1-7-7V3z"/></svg>
            <span class="stat-label" style="flex:1;">ACHIEVEMENTS${showLabel ? ` <span style="font-size:9px; opacity:0.7; font-weight:400; letter-spacing:1px;">, ${label}</span>` : ''}</span>
            <span style="font-size:11px; font-weight:900; color:var(--accent);">${unlocked} / ${total}</span>
        </div>
        <div style="height:3px; border-radius:2px; background:var(--border_solid); overflow:hidden;">
            <div style="height:100%; width:${pct}%; border-radius:2px; background:linear-gradient(90deg, color-mix(in srgb, var(--accent) 60%, transparent), var(--accent)); transition:width 0.5s ease;"></div>
        </div>`;

    // Recent unlocks preview
    const preview = document.createElement('div');
    preview.style.cssText = 'display:flex; flex-direction:column; gap:5px;';
    const recent = achievements.filter(a => a.date_unlocked).slice(0, 3);
    if (recent.length) {
        for (const a of recent) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:center; gap:7px;';
            if (a.image_unlocked) {
                const img = document.createElement('img');
                img.src = a.image_unlocked;
                img.style.cssText = 'width:22px; height:22px; border-radius:3px; object-fit:cover; flex-shrink:0;';
                img.onerror = () => img.style.display = 'none';
                row.appendChild(img);
            }
            const nameEl = document.createElement('span');
            nameEl.style.cssText = 'font-size:10px; color:#82c882; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;';
            nameEl.textContent = a.name || a.key;
            row.appendChild(nameEl);
            const dateEl = document.createElement('span');
            dateEl.style.cssText = 'font-size:9px; color:rgba(130,200,130,0.55); flex-shrink:0;';
            dateEl.textContent = _relativeDate(a.date_unlocked);
            row.appendChild(dateEl);
            preview.appendChild(row);
        }
    } else {
        const noEl = document.createElement('span');
        noEl.style.cssText = 'font-size:10px; color:var(--text_dim); font-style:italic;';
        noEl.textContent = 'No achievements unlocked yet';
        preview.appendChild(noEl);
    }
    strip.appendChild(preview);
    strip.insertAdjacentHTML('beforeend', '<div style="font-size:10px; color:var(--text_dim); text-align:right; letter-spacing:0.5px;">TAP TO VIEW ALL →</div>');
    container.appendChild(strip);
}

function openAchievementsModal() {
    if (!_achAll.length) return;
    const modal = document.getElementById('modal-achievements');
    const game  = allGames.find(g => g.id === currentGameId);
    const _label = arguments[0], _multi = arguments[1];
    document.getElementById('ach-modal-game-title').textContent =
        (_multi && _label) ? `${game?.Game || ''}, ${_label}` : (game?.Game || '');

    const total    = _achAll.length;
    const unlocked = _achAll.filter(a => a.date_unlocked).length;
    const pct      = total ? Math.round(unlocked / total * 100) : 0;
    const dash     = Math.round(pct * 100) / 100;  // stroke-dasharray value
    document.getElementById('ach-ring').setAttribute('stroke-dasharray', `${dash} 100`);
    document.getElementById('ach-ring-pct').textContent  = `${pct}%`;
    document.getElementById('ach-ring-count').textContent = `${unlocked}/${total}`;

    _achFilter = 'all';
    document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    _renderAchGrid();
    modal.classList.add('active');
}
window.openAchievementsModal = openAchievementsModal;

function setAchFilter(f, btn) {
    _achFilter = f;
    document.querySelectorAll('.ach-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === f));
    _renderAchGrid();
}
window.setAchFilter = setAchFilter;

function _renderAchGrid() {
    const grid  = document.getElementById('ach-modal-grid');
    const empty = document.getElementById('ach-modal-empty');
    grid.innerHTML = '';

    const list = _achAll.filter(a =>
        _achFilter === 'all'      ? true
      : _achFilter === 'unlocked' ? !!a.date_unlocked
      :                             !a.date_unlocked
    );

    if (!list.length) { grid.style.display = 'none'; empty.style.display = 'flex'; return; }
    grid.style.display = 'grid'; empty.style.display = 'none';

    for (const a of list) {
        const isUnlocked = !!a.date_unlocked;
        const card = document.createElement('div');
        card.className = 'ach-card' + (isUnlocked ? ' unlocked' : '');

        const iconUrl = isUnlocked ? a.image_unlocked : a.image_locked;
        if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            if (!isUnlocked) img.style.cssText = 'filter:grayscale(1) opacity(0.4);';
            img.onerror = () => { img.replaceWith(Object.assign(document.createElement('div'), { style: 'width:52px;height:52px;border-radius:6px;background:rgba(255,255,255,0.05);' })); };
            card.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.style.cssText = `width:52px; height:52px; border-radius:6px; background:rgba(255,255,255,0.05); ${!isUnlocked ? 'opacity:0.4;' : ''}`;
            card.appendChild(ph);
        }

        const name = document.createElement('div');
        name.className = 'ach-name';
        name.textContent = a.name || a.key;
        card.appendChild(name);

        if (a.description) {
            const desc = document.createElement('div');
            desc.className = 'ach-desc';
            desc.textContent = a.description;
            card.appendChild(desc);
        }

        if (isUnlocked) {
            const date = document.createElement('div');
            date.className = 'ach-date';
            date.textContent = _relativeDate(a.date_unlocked);
            card.appendChild(date);
        } else {
            const lock = document.createElement('div');
            lock.className = 'ach-lock';
            lock.textContent = '🔒';
            card.appendChild(lock);
        }
        grid.appendChild(card);
    }
}

// Close achievements modal on backdrop click
document.getElementById('modal-achievements').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-achievements'))
        document.getElementById('modal-achievements').classList.remove('active');
});

// --- THE IMMERSIVE GAMEPAGE LOGIC ---
function refreshGamepagePlayBtn(game) {
    const playBtn = document.getElementById('btn-gamepage-play');
    currentLaunchCmd = game.LaunchCommand || '';
    const isInstalled = isGameInstalled(game);

    if (isInstalled) {
        playBtn.style.display = 'block';
        playBtn.innerText = t('status.play');
        playBtn.className = 'primary';
        playBtn.onclick = () => verifyAndLaunch(currentGameId, currentLaunchCmd);
    } else {
        const installCmd = getInstallCommand(game);
        if (_isInstallerGame(game)) {
            playBtn.style.display = 'block';
            playBtn.innerText = t('status.install');
            playBtn.className = 'btn-install-primary';
            playBtn.onclick = () => handleInstall(game);
        } else if (installCmd) {
            playBtn.style.display = 'block';
            playBtn.innerText = t('status.install');
            playBtn.className = 'btn-install-primary';
            playBtn.onclick = () => handleInstall(game);
        } else if (isManualCategory(game)) {
            playBtn.style.display = 'block';
            playBtn.innerText = t('status.install');
            playBtn.className = 'btn-install-primary';
            playBtn.onclick = () => openAddCmdDialog(currentGameId, game.Game);
        } else {
            playBtn.style.display = 'none';
            playBtn.onclick = null;
        }
    }
}

function openGamepage(game) {
    savedGridScrollTop = document.getElementById(lastGridView)?.scrollTop || 0;
    currentGameId = game.id;
    currentLaunchCmd = game.LaunchCommand || '';

    const heroEl = document.getElementById('gamepage-hero');
    const logoEl = document.getElementById('gamepage-logo');
    const titleTextEl = document.getElementById('gamepage-title-text');
    const coverEl = document.getElementById('gamepage-cover');
    const playBtn = document.getElementById('btn-gamepage-play');
    const trailerBtn = document.getElementById('btn-gamepage-trailer');
    const installerBtn = document.getElementById('btn-gamepage-installer');

    const favBtn = document.getElementById('btn-gamepage-fav');
    const wantBtn = document.getElementById('btn-gamepage-want');
    const removeFromPlaylistBtn = document.getElementById('btn-gamepage-remove-playlist');

    // Hero Art, always reset to none first so the previous game's image
    // is cleared immediately, before the new URL starts loading.
    heroEl.style.backgroundImage = "none";
    if (game.HeroArt && game.HeroArt.trim() !== "") {
        heroEl.style.backgroundImage = `url('${getSafePath(game.HeroArt)}')`;
    } else if (game.Screenshot && game.Screenshot.trim() !== "") {
        const screens = String(game.Screenshot).split('|').filter(s => s.trim() !== "");
        heroEl.style.backgroundImage = `url('${getSafePath(screens[0])}')`;
    }

    // Logo vs Text
    if (game.Logo && game.Logo.trim() !== "") {
        logoEl.src = getSafePath(game.Logo);
        logoEl.style.display = 'block';
        titleTextEl.style.display = 'none';
    } else {
        logoEl.style.display = 'none';
        titleTextEl.innerText = game.Game;
        titleTextEl.style.display = 'block';
    }

    // Store Logos
    const storeContainer = document.getElementById('gamepage-store-container');
    storeContainer.innerHTML = '';
    if (game.Store && String(game.Store).trim() !== "") {
        const stores = String(game.Store).split(',').map(s => s.trim().toLowerCase().replace(/\s+/g, '_')).filter(s => s !== "");
        stores.forEach(s => {
            const div = document.createElement('div');
            const path = getSafePath('assets/logos/' + s + '.png');
            div.style.width = '30px'; div.style.height = '30px';
            div.style.backgroundColor = 'var(--text_sec)';
            div.style.webkitMaskSize = 'contain'; div.style.webkitMaskPosition = 'center'; div.style.webkitMaskRepeat = 'no-repeat';
            div.style.webkitMaskImage = `url('${path}')`;
            div.style.filter = "drop-shadow(0 2px 5px rgba(0,0,0,0.8))";
            storeContainer.appendChild(div);
        });
    }

    // Free-to-play hero pill, click opens the show/hide popup (with this game's per-game hide).
    const f2pPill = document.getElementById('gamepage-f2p-pill');
    if (f2pPill) {
        f2pPill.style.display = isFreeToPlay(game) ? 'inline-flex' : 'none';
        f2pPill.classList.toggle('hidden-mode', _hideFreeGames);
        f2pPill.onclick = (e) => { e.stopPropagation(); openFreeGamesPrompt(game); };
    }

    // Hide-game hero button, hides this game from the library and returns to it.
    const hideBtn = document.getElementById('btn-gamepage-hide');
    if (hideBtn) hideBtn.onclick = async () => {
        await setGameHidden(game.id, true);
        closeGamepageToLibrary();
    };

    // Live Toggle Logic for Favs / Wants (icon buttons, active class drives fill via CSS)
    const updateTogglesUI = () => {
        favBtn.classList.toggle('active', game.FAV === 'YES');
        wantBtn.classList.toggle('active', game.WANT_TO_PLAY === 'YES');
    };
    updateTogglesUI();

    // Remove-from-playlist button, visible whenever the game belongs to at least one playlist
    removeFromPlaylistBtn.style.display = 'none';
    removeFromPlaylistBtn.onclick = null;
    window.api.getGamePlaylists(game.id).then(ids => {
        if (ids.length > 0) {
            removeFromPlaylistBtn.style.display = 'flex';
            removeFromPlaylistBtn.onclick = () => openRemoveFromPlaylistModal(game);
        }
    });

    favBtn.onclick = async () => {
        game.FAV = game.FAV === 'YES' ? 'NO' : 'YES';
        updateTogglesUI();
        await window.api.updateGame(game.id, game); // Silently updates DB
        loadGames(); // Refreshes lists in the background
    };

    wantBtn.onclick = async () => {
        game.WANT_TO_PLAY = game.WANT_TO_PLAY === 'YES' ? 'NO' : 'YES';
        updateTogglesUI();
        await window.api.updateGame(game.id, game);
        loadGames();
    };

    // Play / Install / Add Command Button
    refreshGamepagePlayBtn(game);

    // Installer setup button, GOG and Epic games only
    const gpStore = (game.Store || '').toLowerCase();
    if (gpStore.includes('gog') || gpStore.includes('epic')) {
        installerBtn.style.display = 'block';
        installerBtn.onclick = () => _openCompatFor(game);
    } else {
        installerBtn.style.display = 'none';
        installerBtn.onclick = null;
    }

    // "Open in Steam" button, only for a game actually owned on Steam.
    const steamBtn = document.getElementById('btn-gamepage-steam');
    if (steamBtn) {
        const sAppId = _isOnSteam(game) ? _steamAppId(game) : '';
        if (sAppId) {
            steamBtn.style.display = 'block';
            steamBtn.onclick = (e) => { e.stopPropagation(); openSteamMenu(steamBtn, sAppId); };
        } else {
            steamBtn.style.display = 'none';
            steamBtn.onclick = null;
        }
    }

    // Uninstall button, installed GOG/Epic (in-process) or Steam (via the Steam client)
    const uninstallBtn = document.getElementById('btn-gamepage-uninstall');
    if (uninstallBtn) {
        const installerCan = /^(gog|epic)_/i.test(game.InstallerGameId || '') && (game.Installed == 1);
        // Same gate: uninstalling "through Steam" a game Steam does not own would open
        // the client on a title the user never bought there.
        const sAppId = _isOnSteam(game) ? _steamAppId(game) : '';
        const steamCan = !installerCan && sAppId && (game.Installed == 1);
        if (installerCan) {
            uninstallBtn.style.display = 'block';
            uninstallBtn.title = 'Uninstall';
            uninstallBtn.onclick = () => openInstallerUninstall(game);
        } else if (steamCan) {
            uninstallBtn.style.display = 'block';
            uninstallBtn.title = 'Uninstall via Steam';
            uninstallBtn.onclick = async () => {
                const ok = await showConfirm(`Uninstall "${game.Game}" through Steam?\nSteam will open and ask you to confirm.`, 'Uninstall', true);
                if (ok) window.api.openExternal(`steam://uninstall/${sAppId}`);
            };
        } else {
            uninstallBtn.style.display = 'none';
            uninstallBtn.onclick = null;
        }
    }

    // DLC button, installed GOG games (DLCs merge into the existing install folder)
    const dlcBtn = document.getElementById('btn-gamepage-dlc');
    if (dlcBtn) {
        if (/^gog_/i.test(game.InstallerGameId || '') && game.Installed == 1) {
            dlcBtn.style.display = 'block';
            dlcBtn.onclick = (e) => { e.stopPropagation(); openDlcModal(game); };
        } else {
            dlcBtn.style.display = 'none';
            dlcBtn.onclick = null;
        }
    }

    // Compatibility files, installed GOG games. GOG ships OpenAL, the VC++ runtimes and the
    // like beside a game and expects them installed into the prefix; a game missing one starts
    // and dies at once with nothing in the log naming the cause. Offered for every installed
    // GOG title rather than only where we think it is needed: whether a game declares
    // dependencies is GOG's answer to give, and runRedist already says "none required" when
    // there are none.
    const redistBtn = document.getElementById('btn-gamepage-redist');
    if (redistBtn) {
        if (/^gog_/i.test(game.InstallerGameId || '') && game.Installed == 1) {
            redistBtn.style.display = 'block';
            redistBtn.onclick = async (e) => {
                e.stopPropagation();
                if (_redistBusy) { showAlert('Compatibility files are already being installed.'); return; }
                const ok = await showConfirm(
                    `Install the compatibility files "${game.Game}" needs, OpenAL, Visual C++ runtimes and similar, into its Proton prefix?\n\n` +
                    `The game itself is not re-downloaded. Worth doing when a game installed cleanly but closes immediately when you press Play.`,
                    'Install');
                if (!ok) return;
                _redistBusy = true;
                opToast('Compatibility files: checking…');
                let res = null;
                try { res = await window.api.runRedist(game.InstallerGameId); }
                catch (err) { res = { ok: false, error: err.message }; }
                _redistBusy = false;
                if (res && res.ok) {
                    const n = res.installed || 0;
                    opToastDone(n ? `Installed ${n} compatibility package${n === 1 ? '' : 's'}` : 'No compatibility files needed');
                } else {
                    opToastHide();
                    showAlert((res && res.error) || 'The compatibility files could not be installed.');
                }
            };
        } else {
            redistBtn.style.display = 'none';
            redistBtn.onclick = null;
        }
    }

    // Play-task picker, installed GOG games that ship more than one way to start
    _refreshPlayTaskBtn(game);

    // Save Manager button, installed GOG & Epic games (locate/back up/restore saves)
    const savesBtn = document.getElementById('btn-gamepage-saves');
    if (savesBtn) {
        if (/^(gog|epic)_/i.test(game.InstallerGameId || '') && game.Installed == 1) {
            savesBtn.style.display = 'block';
            savesBtn.onclick = (e) => { e.stopPropagation(); openSavesModal(game); };
        } else {
            savesBtn.style.display = 'none';
            savesBtn.onclick = null;
        }
    }

    // SPLORE button, PICO-8 games only
    const sploreBtn = document.getElementById('btn-gamepage-splore');
    if (gpStore.includes('pico-8') || gpStore.includes('pico8')) {
        sploreBtn.style.display = 'block';
        sploreBtn.onclick = () => window.api.launchPico8Splore();
    } else {
        sploreBtn.style.display = 'none';
        sploreBtn.onclick = null;
    }

    // Manual button, always offered, because a manual can be attached to anything
    // (a physical copy, an emulated game), not only to titles with an install folder.
    _refreshManualBtn(game);

    // Browse Local Files button, shown whenever the game's install folder can be
    // located on disk (Steam, GOG/Epic, or a custom/emulator command with a real path).
    const browseBtn = document.getElementById('btn-gamepage-browse');
    if (browseBtn) {
        browseBtn.style.display = 'none';
        browseBtn.onclick = null;
        window.api.resolveGameFolder(game.id).then(folder => {
            if (currentGameId !== game.id) return;   // gamepage moved on while resolving
            if (folder) {
                browseBtn.style.display = 'block';
                browseBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const res = await window.api.openGameFolder(game.id);
                    if (!res || !res.ok) showAlert('Could not locate this game\'s install folder on disk.');
                };
            }
        });
    }

    // Add to Desktop button, any game; creates a launcher that opens it through CN.
    const shortcutBtn = document.getElementById('btn-gamepage-shortcut');
    if (shortcutBtn) shortcutBtn.onclick = (e) => { e.stopPropagation(); openShortcutDialog(game); };

    // Trailer button, always visible; plays local trailer or opens download flow
    trailerBtn.onclick = () => {
        document.getElementById('edit-name').value = game.Game;
        document.getElementById('btn-watch-trailer').click();
    };

    // Info Column
    const _gpHasCover = game.CoverArt && game.CoverArt.trim() !== "";
    coverEl.src = _gpHasCover ? getSafePath(game.CoverArt) : 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
    coverEl.style.cursor = _gpHasCover ? 'zoom-in' : 'default';   // click → big cover lightbox
    coverEl.dataset.zoom = _gpHasCover ? '1' : '';

    document.getElementById('gp-released').innerText = game.RELEASED || "--";
    document.getElementById('gp-dev').innerText = game.DEV || "--";
    document.getElementById('gp-pub').innerText = game.PUB || "--";
    document.getElementById('gp-genre').innerText = game.GENRE || "--";
    document.getElementById('gp-hltb').innerText = game.HLTB_Main || "--";

    const metaEl = document.getElementById('gp-meta');
    metaEl.innerText = game.METACRITIC || "--";
    metaEl.style.color = "var(--text_main)";
    if (game.METACRITIC) {
        let sc = parseInt(game.METACRITIC, 10);
        if (sc >= 80) metaEl.style.color = "#00ff00";
        else if (sc >= 60) metaEl.style.color = "#ffd700";
        else metaEl.style.color = "#ff0000";
    }

    const pEl = document.getElementById('gp-proton');
    pEl.innerText = game.ProtonTier || "--";
    pEl.style.color = "var(--text_main)";
    if (game.ProtonTier) {
        let t = game.ProtonTier.toUpperCase();
        if (t.includes("PLATINUM")) pEl.style.color = "#00e5ff";
        else if (t.includes("GOLD")) pEl.style.color = "#ffd700";
        else if (t.includes("SILVER")) pEl.style.color = "#c0c0c0";
        else if (t.includes("BORKED")) pEl.style.color = "#ff0000";
        else if (t.includes("NATIVE")) pEl.style.color = "#00ff00";
    }

    document.getElementById('gp-coop').innerText = game.Coop || "--";
    document.getElementById('gp-players').innerText = game.NumPlayers || "--";
    const similarEl = document.getElementById('gp-similar');
    if (!game.SimilarGames || !game.SimilarGames.trim() || game.SimilarGames === '--') {
        similarEl.innerText = '--';
    } else {
        const names = game.SimilarGames.split(',').map(n => n.trim()).filter(Boolean);
        similarEl.innerHTML = names.map(name => {
            const match = allGames.find(g => g.Game.toLowerCase() === name.toLowerCase());
            return match
                ? `<span class="similar-link" data-id="${match.id}" title="Open ${name}">${name}</span>`
                : `<span>${name}</span>`;
        }).join(', ');
        similarEl.querySelectorAll('.similar-link').forEach(el => {
            el.addEventListener('click', () => {
                const g = allGames.find(g => g.id === parseInt(el.dataset.id));
                if (g) openGamepage(g);
            });
        });
    }
    document.getElementById('gp-franchise').innerText = game.Franchise || "--";

    loadGamepageAchievements(game);

    // FIX: Screenshots Slideshow Logic with beautiful Ken Burns Effect
    const ssBanner = document.getElementById('gamepage-screenshots-banner');
    const ssKbImg = document.getElementById('gamepage-ss-kb-img');
    const modalSs = document.getElementById('modal-slideshow');
    const ssImg = document.getElementById('slideshow-img');
    const ssCounter = document.getElementById('slideshow-counter');

    clearInterval(ssBannerKbInterval);

    if (game.Screenshot && game.Screenshot.trim() !== "") {
        const screens = String(game.Screenshot).split('|').filter(s => s.trim() !== "");
        if (screens.length > 0) {
            ssBanner.style.display = 'block';

            // Ken Burns setup
            ssKbImg.style.display = 'block';
            let kbIdx = 0;
            const showNextSsImage = () => {
                ssKbImg.style.opacity = '0';
                setTimeout(() => {
                    if (document.getElementById('view-gamepage').classList.contains('active')) {
                        ssKbImg.src = getSafePath(screens[kbIdx]);
                        ssKbImg.style.opacity = '1';
                        kbIdx = (kbIdx + 1) % screens.length;
                    }
                }, 500);
            };
            showNextSsImage();

            if (screens.length > 1) {
                ssBannerKbInterval = setInterval(showNextSsImage, 5000);
            }

            ssBanner.onclick = () => {
                let currentIdx = 0;

                const updateSlide = () => {
                    ssImg.src = getSafePath(screens[currentIdx]);
                    ssCounter.innerText = `${currentIdx + 1} / ${screens.length}`;
                };

                updateSlide();
                modalSs.classList.add('active');

                document.getElementById('btn-slideshow-prev').onclick = () => {
                    currentIdx = (currentIdx - 1 + screens.length) % screens.length;
                    updateSlide();
                };

                document.getElementById('btn-slideshow-next').onclick = () => {
                    currentIdx = (currentIdx + 1) % screens.length;
                    updateSlide();
                };
            };
        } else {
            ssBanner.style.display = 'none';
        }
    } else {
        ssBanner.style.display = 'none';
    }

    document.getElementById('btn-slideshow-close').onclick = () => {
        modalSs.classList.remove('active');
    };

    // FIX: Inject the Short Description above the Steam Description
    const shortDescContainer = document.getElementById('gamepage-short-desc');
    const localDesc = getLocalizedDescription(game);
    if (localDesc && localDesc.trim() !== "") {
        shortDescContainer.innerText = localDesc;
        shortDescContainer.style.display = 'block';
    } else {
        shortDescContainer.style.display = 'none';
    }

    // Rich HTML Description vs Fallback Text
    const steamDescContainer = document.getElementById('gamepage-steam-desc');
    const fallbackDescContainer = document.getElementById('gamepage-fallback-desc');

    if (game.SteamDesc && game.SteamDesc.trim() !== "") {
        steamDescContainer.innerHTML = game.SteamDesc;
        steamDescContainer.style.display = 'block';
        fallbackDescContainer.style.display = 'none';
    } else {
        steamDescContainer.style.display = 'none';
        fallbackDescContainer.innerText = t('game.no_desc');
        // Only show fallback if we also didn't have a short description
        fallbackDescContainer.style.display = (localDesc && localDesc.trim() !== "") ? 'none' : 'block';
    }

    switchView('view-gamepage');
}


function _renderLauncherList(game) {
    const list = document.getElementById('edit-launchers-list');
    list.innerHTML = '';
    let launchers = [];
    try { launchers = JSON.parse(game.LaunchCommands || '[]'); } catch(e) {}
    if (launchers.length === 0 && game.LaunchCommand) {
        launchers = [{ label: _guessLabel(game.LaunchCommand), cmd: game.LaunchCommand }];
    }
    if (launchers.length === 0 && _isInstallerGame(game)) {
        list.innerHTML = '<p style="font-size:11px; color:var(--text_dim); margin:4px 0; font-style:italic;">Launched via Installer. You can add a custom command below if needed.</p>';
        return;
    }
    // installer:// rows are shown read-only rather than hidden: hiding them meant Save
    // rebuilt LaunchCommands from the visible rows alone and threw the GOG/Epic launcher
    // away, quietly demoting a Steam+GOG game to Steam-only (no store picker, wrong installer).
    launchers.forEach(l => {
        const managed = /installer:\/\/launch/i.test(l.cmd || '');
        list.appendChild(_makeLauncherRow(l.label || '', l.cmd || '', managed));
    });
}

// ── Game manuals ─────────────────────────────────────────────────────────────
// One button, two jobs: with a manual attached it reads it, without one it asks for the
// file. The picker opens in the game's own folder, which is where GOG leaves the PDFs it
// ships, so the common case is a couple of clicks.
async function _refreshManualBtn(game) {
    const btn = document.getElementById('btn-gamepage-manual');
    if (!btn) return;
    let info = { attached: [], detected: [], gogAppId: null };
    try { info = await window.api.manualList(game.id) || info; } catch (e) {}
    if (currentGameId !== game.id) return;   // gamepage moved on while we were asking

    const readable = info.attached.filter(m => m.exists);
    btn.classList.toggle('active', readable.length > 0);
    btn.title = readable.length > 1 ? `${readable.length} manuals, choose one`
              : readable.length     ? `Read: ${readable[0].label}`
              : info.detected.length ? `${info.detected.length} manual(s) found in this game's folder`
              : 'Attach a manual to this game';
    btn.onclick = (e) => { e.stopPropagation(); openGameManual(game); };
}

// One manual and nothing else on offer → just read it. Anything else is a choice, and the
// chooser is where that choice is made.
async function openGameManual(game) {
    let info = { attached: [], detected: [], gogAppId: null };
    try { info = await window.api.manualList(game.id) || info; } catch (e) {}
    const readable = info.attached.filter(m => m.exists);

    if (readable.length === 1 && !info.detected.length && info.attached.length === 1) {
        showManualViewer(game, readable[0].path);
        return;
    }
    openManualsModal(game);
}

function showManualViewer(game, filePath) {
    return window.api.openManualViewer({
        path: filePath,
        gameId: game.id,
        title: game.Game || 'Manual',
        store: (game.Store || '').split(',')[0].trim(),
        logo: game.Logo ? getSafePath(game.Logo) : '',
        font: _uiFont || '',
        theme: _currentThemeVars(),
    }).then(res => {
        if (res && !res.ok) showAlert(res.error || 'Could not open that manual.');
        return res;
    });
}

let _manualsGame = null;
const _fmtMB = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

async function openManualsModal(game) {
    _manualsGame = game;
    document.getElementById('manuals-game').textContent = game.Game || '';
    document.getElementById('manuals-status').textContent = '';
    document.getElementById('modal-manuals').classList.add('active');
    await renderManualsList();
}

async function renderManualsList() {
    const game = _manualsGame;
    if (!game) return;
    const list = document.getElementById('manuals-list');
    let info = { attached: [], detected: [], gogAppId: null };
    try { info = await window.api.manualList(game.id) || info; } catch (e) {}
    list.innerHTML = '';

    const section = text => {
        const h = document.createElement('div');
        h.style.cssText = 'font-size:9px; font-weight:900; letter-spacing:1.5px; text-transform:uppercase; color:var(--text_dim); margin:6px 0 1px;';
        h.textContent = text;
        list.appendChild(h);
    };
    const row = (label, sub, actions, dim) => {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid var(--border_solid); border-radius:8px; background:var(--bg_panel);' + (dim ? ' opacity:.6;' : '');
        el.innerHTML = `<div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:700; color:var(--text_main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(label)}</div>
            <div style="font-size:10px; color:var(--text_dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escHtml(sub)}</div>
        </div>`;
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; gap:6px; flex-shrink:0;';
        for (const a of actions) {
            const b = document.createElement('button');
            b.textContent = a.text;
            b.className = a.primary ? 'primary' : '';
            b.style.cssText = 'font-size:10px; padding:6px 11px;' + (a.primary ? '' : ' background:transparent; border:1px solid var(--border_solid); color:var(--text_sec);');
            b.onclick = a.fn;
            wrap.appendChild(b);
        }
        el.appendChild(wrap);
        list.appendChild(el);
        return el;
    };

    if (info.attached.length) {
        section('On this game');
        for (const m of info.attached) {
            const acts = [];
            if (m.exists) acts.push({ text: 'Read', primary: true, fn: () => showManualViewer(game, m.path) });
            acts.push({ text: 'Remove', fn: async () => { await window.api.removeManual(m.id, game.id); renderManualsList(); _refreshManualBtn(game); } });
            row(m.label || 'Manual', m.exists ? m.path : 'File is missing, ' + m.path, acts, !m.exists);
        }
    }

    // Found in the game's own folder. GOG names these itself ("Cluebook", "Password
    // reference card"), which is far better than anything guessed from a filename.
    if (info.detected.length) {
        section('Found in this game’s folder');
        for (const d of info.detected) {
            row(d.label, d.path, [{
                text: 'Add', primary: true,
                fn: async () => {
                    await window.api.attachManual(game.id, d.path, d.label, d.source);
                    renderManualsList(); _refreshManualBtn(game);
                }
            }]);
        }
    }

    if (!info.attached.length && !info.detected.length) {
        const p = document.createElement('p');
        p.style.cssText = 'font-size:12px; color:var(--text_dim); margin:4px 0;';
        p.textContent = 'Nothing found in this game’s folder. Browse for a file below' +
                        (info.gogAppId ? ', or see what GOG has.' : '.');
        list.appendChild(p);
    }

    if (info.gogAppId) renderGogManuals(game);
}

// GOG sells the extras alongside the game, the scanned originals. Listed lazily, because
// it is a network call and most of the time the folder already had what you wanted.
async function renderGogManuals(game) {
    const list = document.getElementById('manuals-list');
    const status = document.getElementById('manuals-status');
    status.textContent = 'Checking GOG for manuals…';
    let res = { ok: false, items: [] };
    try { res = await window.api.gogManualList(game.id) || res; } catch (e) {}
    if (_manualsGame?.id !== game.id) return;
    status.textContent = res.ok ? '' : (res.error || '');
    if (!res.ok || !res.items.length) {
        if (res.ok) status.textContent = 'GOG has no manual for this game.';
        return;
    }

    const h = document.createElement('div');
    h.style.cssText = 'font-size:9px; font-weight:900; letter-spacing:1.5px; text-transform:uppercase; color:var(--text_dim); margin:6px 0 1px;';
    h.textContent = 'From GOG';
    list.appendChild(h);

    for (const item of res.items) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex; align-items:center; gap:10px; padding:9px 11px; border:1px solid var(--border_solid); border-radius:8px; background:var(--bg_panel);';
        el.innerHTML = `<div style="flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:700; color:var(--text_main);">${escHtml(item.name)}</div>
            <div style="font-size:10px; color:var(--text_dim);">${escHtml(item.type)}${item.size ? ' · ' + _fmtMB(item.size) : ''}</div>
        </div>`;
        const btn = document.createElement('button');
        btn.textContent = 'Download';
        btn.className = 'primary';
        btn.style.cssText = 'font-size:10px; padding:6px 11px; flex-shrink:0;';
        btn.onclick = async () => {
            btn.disabled = true; btn.textContent = 'Downloading…';
            const r = await window.api.gogManualDownload(game.id, item.id);
            if (r && r.ok) { status.textContent = `Added ${r.files.length} document(s) from GOG.`; renderManualsList(); _refreshManualBtn(game); }
            else { status.textContent = (r && r.error) || 'Download failed.'; btn.disabled = false; btn.textContent = 'Download'; }
        };
        el.appendChild(btn);
        list.appendChild(el);
    }
}

window.api.onManualDownloadProgress(p => {
    if (!p || !_manualsGame || p.gameId !== _manualsGame.id) return;
    const status = document.getElementById('manuals-status');
    if (status && p.total) status.textContent = `Downloading… ${_fmtMB(p.got)} of ${_fmtMB(p.total)}`;
});

document.getElementById('btn-manuals-browse')?.addEventListener('click', async () => {
    if (!_manualsGame) return;
    const res = await window.api.pickManual(_manualsGame.id);
    if (res && res.ok) { renderManualsList(); _refreshManualBtn(_manualsGame); }
});
document.getElementById('btn-manuals-close')?.addEventListener('click', () =>
    document.getElementById('modal-manuals')?.classList.remove('active'));
document.getElementById('modal-manuals')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-manuals')) e.currentTarget.classList.remove('active');
});

// The viewer is a separate window with its own document, so it cannot inherit the CSS
// variables, the active theme's colours are passed across and re-applied there.
function _currentThemeVars() {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k of ['bg', 'bg_panel', 'bg_menu', 'accent', 'text_main', 'text_sec', 'text_dim', 'border', 'border_solid']) {
        const v = cs.getPropertyValue('--' + k).trim();
        if (v) out[k] = v;
    }
    return out;
}

// Genre override in the edit dialog. Choosing one pins the game, scans skip it from
// then on, and "Detected automatically" hands it back to them.
function _renderGenrePicker(game) {
    const sel = document.getElementById('edit-primary-genre');
    if (!sel) return;
    sel.innerHTML = ['<option value="">Detected automatically</option>']
        .concat(allGenres.map(g => `<option value="${g.slug}">${escHtml(g.label)}</option>`)).join('');
    sel.value = game.GenreLocked == 1 ? (game.PrimaryGenre || '') : '';
    _updateGenreNote(game);
    sel.onchange = () => _updateGenreNote(game);
}

function _updateGenreNote(game) {
    const note = document.getElementById('edit-genre-note');
    const sel  = document.getElementById('edit-primary-genre');
    if (!note || !sel) return;
    if (sel.value) {
        note.textContent = 'Pinned by you, genre scans will leave this game alone.';
    } else {
        const detected = genreLabel(game.PrimaryGenre);
        note.textContent = detected ? `Currently detected as ${detected}.` : 'No genre detected yet.';
    }
}

function _makeLauncherRow(label, cmd, managed = false) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:6px; align-items:center;';
    const ro = managed ? ' readonly' : '';
    const dim = managed ? ' opacity:.6; cursor:default;' : '';
    const tip = managed ? ' title="Managed by Installer, install and launch are handled for you."' : '';
    row.innerHTML =
        `<input type="text" class="lnch-label" placeholder="Label" value="${escHtml(label)}"${ro}${tip} style="width:140px; font-size:11px; padding:6px 8px; flex-shrink:0; background:var(--bg_input,rgba(255,255,255,0.07)); border:1px solid var(--border_solid); border-radius:4px; color:var(--text_main);${dim}">` +
        `<input type="text" class="lnch-cmd" placeholder="Command or URL" value="${escHtml(cmd)}"${ro}${tip} style="flex:1; font-size:11px; padding:6px 8px; background:var(--bg_input,rgba(255,255,255,0.07)); border:1px solid var(--border_solid); border-radius:4px; color:var(--text_main);${dim}">` +
        `<button class="lnch-remove" title="Remove" style="flex-shrink:0; padding:4px 9px; font-size:12px; background:transparent; border:1px solid var(--text_dim); color:var(--text_dim); border-radius:4px; cursor:pointer; line-height:1;">✕</button>`;
    row.querySelector('.lnch-remove').addEventListener('click', () => row.remove());
    return row;
}

document.getElementById('btn-add-launcher').addEventListener('click', () => {
    const list = document.getElementById('edit-launchers-list');
    const row = _makeLauncherRow('', '');
    list.appendChild(row);
    row.querySelector('.lnch-label').focus();
});

// --- DETAILED VIEW / EDIT LOGIC ---
function openDetails(game) {
    currentGameId = game.id;
    currentLaunchCmd = game.LaunchCommand || '';
    let displayStore = game.Store ? game.Store.replace(/EPIC/i, 'Epic').replace(/GOG/i, 'GOG') : '';

    document.getElementById('edit-name').value = game.Game || '';
    document.getElementById('edit-store').value = displayStore;
    _renderLauncherList(game);
    document.getElementById('edit-genre').value = game.GENRE || '';
    _renderGenrePicker(game);
    document.getElementById('edit-released').value = game.RELEASED || '';
    document.getElementById('edit-appid').value = game.SteamAppID || '';
    document.getElementById('edit-proton').value = game.ProtonTier || '';
    document.getElementById('edit-meta').value = game.METACRITIC || '';
    document.getElementById('edit-hltb').value = game.HLTB_Main || '';
    document.getElementById('edit-dev').value = game.DEV || '';
    document.getElementById('edit-pub').value = game.PUB || '';
    document.getElementById('edit-coop').value = game.Coop || '';
    document.getElementById('edit-players').value = game.NumPlayers || '';
    document.getElementById('edit-tags').value = game.Tags || '';
    document.getElementById('edit-similar').value = game.SimilarGames || '';
    document.getElementById('edit-franchise').value = game.Franchise || '';
    document.getElementById('edit-desc').value = game.Description || '';

    document.getElementById('edit-fav').checked = game.FAV === 'YES';
    document.getElementById('edit-want').checked = game.WANT_TO_PLAY === 'YES';

    updateInstallerRow(game);

    // Populate Left Column Asset Previews
    const coverDiv = document.getElementById('ui-cover');
    if (game.CoverArt && game.CoverArt.trim() !== "") { coverDiv.innerHTML = `<img src="${getSafePath(game.CoverArt)}" style="width: 100%; height: 100%; object-fit: cover;">`; } else { coverDiv.innerHTML = 'Cover Art'; }

    const heroDiv = document.getElementById('ui-hero');
    if (game.HeroArt && game.HeroArt.trim() !== "") { heroDiv.innerHTML = `<img src="${getSafePath(game.HeroArt)}" style="width: 100%; height: 100%; object-fit: cover;">`; } else { heroDiv.innerHTML = 'Hero Art'; }

    const logoDiv = document.getElementById('ui-logo');
    if (game.Logo && game.Logo.trim() !== "") { logoDiv.innerHTML = `<img src="${getSafePath(game.Logo)}" style="width: 100%; height: 100%; object-fit: contain; padding: 10px;">`; } else { logoDiv.innerHTML = 'Logo'; }

    const iconDiv = document.getElementById('ui-icon');
    if (game.Icon && game.Icon.trim() !== "") { iconDiv.innerHTML = `<img src="${getSafePath(game.Icon)}" style="width: 100%; height: 100%; object-fit: contain; padding: 10px;">`; } else { iconDiv.innerHTML = 'Icon'; }

    clearInterval(detailScreenshotInterval);
    const screenDiv = document.getElementById('ui-screenshot');
    if (game.Screenshot && game.Screenshot.trim() !== "") {
        const screens = String(game.Screenshot).split('|').filter(s => s.trim() !== "");
        if (screens.length > 0) {
            screenDiv.innerHTML = `<img id=\"detail-ss-img\" src=\"${getSafePath(screens[0])}\" style=\"width: 100%; height: 100%; object-fit: cover; transition: opacity 0.5s ease;\">`;
            if (screens.length > 1) {
                let ssIdx = 0;
                detailScreenshotInterval = setInterval(() => {
                    const imgEl = document.getElementById('detail-ss-img');
                    if (!imgEl) { clearInterval(detailScreenshotInterval); return; }
                    imgEl.style.opacity = '0';
                    setTimeout(() => { ssIdx = (ssIdx + 1) % screens.length; imgEl.src = getSafePath(screens[ssIdx]); imgEl.style.opacity = '1'; }, 500);
                }, 4000);
            }
        } else { screenDiv.innerHTML = 'Screenshot'; }
    } else { screenDiv.innerHTML = 'Screenshot'; }

    switchView('view-details');
}

// --- ASSET DELETERS ---
document.getElementById('btn-delete-cover').addEventListener('click', () => { const g = allGames.find(g => g.id === currentGameId); if(g) { g.CoverArt = ""; document.getElementById('ui-cover').innerHTML = 'Cover Art'; } });
document.getElementById('btn-delete-hero').addEventListener('click', () => { const g = allGames.find(g => g.id === currentGameId); if(g) { g.HeroArt = ""; document.getElementById('ui-hero').innerHTML = 'Hero Art'; } });
document.getElementById('btn-delete-logo').addEventListener('click', () => { const g = allGames.find(g => g.id === currentGameId); if(g) { g.Logo = ""; document.getElementById('ui-logo').innerHTML = 'Logo'; } });
document.getElementById('btn-delete-icon').addEventListener('click', () => { const g = allGames.find(g => g.id === currentGameId); if(g) { g.Icon = ""; document.getElementById('ui-icon').innerHTML = 'Icon'; } });
document.getElementById('btn-delete-screenshot').addEventListener('click', () => { clearInterval(detailScreenshotInterval); const g = allGames.find(g => g.id === currentGameId); if(g) { g.Screenshot = ""; document.getElementById('ui-screenshot').innerHTML = 'Screenshot'; } });

document.getElementById('btn-delete-trailer').addEventListener('click', async () => {
    const gameName = document.getElementById('edit-name').value;
    if (!gameName) return;
    const success = await window.api.deleteTrailer(gameName);
    await showAlert(success ? t('alert.trailer_deleted') : t('alert.no_trailer'));
});

document.getElementById('btn-clear-meta').addEventListener('click', () => {
    document.getElementById('edit-genre').value = ""; document.getElementById('edit-released').value = "";
    document.getElementById('edit-appid').value = ""; document.getElementById('edit-proton').value = "";
    document.getElementById('edit-meta').value = ""; document.getElementById('edit-hltb').value = "";
    document.getElementById('edit-dev').value = ""; document.getElementById('edit-pub').value = "";
    document.getElementById('edit-coop').value = ""; document.getElementById('edit-players').value = "";
    document.getElementById('edit-tags').value = ""; document.getElementById('edit-similar').value = ""; document.getElementById('edit-franchise').value = "";
    document.getElementById('edit-desc').value = "";
});


// --- LOCAL ASSET SELECTORS ---
async function handleLocalAsset(type, targetDivId, objFit = 'cover', doPadding = false) {
    if (!currentGameId) return;
    const newPath = await window.api.selectLocalImage(currentGameId, type);
    if (newPath) {
        const div = document.getElementById(targetDivId);
        let padStr = doPadding ? 'padding: 10px;' : '';
        div.innerHTML = `<img src="${getSafePath(newPath)}" style="width: 100%; height: 100%; object-fit: ${objFit}; ${padStr}">`;
        const game = allGames.find(g => g.id === currentGameId);
        if (game) {
            if(type === 'cover') game.CoverArt = newPath;
            else if(type === 'hero') game.HeroArt = newPath;
            else if(type === 'logo') game.Logo = newPath;
            else if(type === 'icon') game.Icon = newPath;
            else if(type === 'screenshot') { clearInterval(detailScreenshotInterval); game.Screenshot = newPath; }
        }
    }
}
document.getElementById('btn-local-cover').addEventListener('click', () => handleLocalAsset('cover', 'ui-cover', 'cover'));
document.getElementById('btn-local-hero').addEventListener('click', () => handleLocalAsset('hero', 'ui-hero', 'cover'));
document.getElementById('btn-local-logo').addEventListener('click', () => handleLocalAsset('logo', 'ui-logo', 'contain', true));
document.getElementById('btn-local-icon').addEventListener('click', () => handleLocalAsset('icon', 'ui-icon', 'contain', true));
document.getElementById('btn-local-screenshot').addEventListener('click', () => handleLocalAsset('screenshot', 'ui-screenshot', 'cover'));


// --- SGDB DYNAMIC FETCHERS ---
let currentSgdbAssetType = 'cover';

async function triggerSgdbModal(assetType) {
    const apiKey = await window.api.getSetting('steamgriddb_api');
    if (!apiKey) { document.getElementById('modal-sgdb-api').classList.add('active'); return; }
    document.getElementById('sgdb-manual-search-input').value = "";
    openSgdbModal(apiKey, assetType, null);
}

document.getElementById('btn-sgdb-cover').addEventListener('click', () => triggerSgdbModal('cover'));
document.getElementById('btn-sgdb-hero').addEventListener('click', () => triggerSgdbModal('hero'));
document.getElementById('btn-sgdb-logo').addEventListener('click', () => triggerSgdbModal('logo'));
document.getElementById('btn-sgdb-icon').addEventListener('click', () => triggerSgdbModal('icon'));

document.getElementById('btn-save-sgdb-api').addEventListener('click', async () => {
    const key = document.getElementById('sgdb-api-input').value.trim();
    if (key) {
        await window.api.setSetting('steamgriddb_api', key);
        document.getElementById('modal-sgdb-api').classList.remove('active');
        openSgdbModal(key, currentSgdbAssetType, null);
    }
});

document.getElementById('btn-close-sgdb-api').addEventListener('click', () => { document.getElementById('modal-sgdb-api').classList.remove('active'); });
document.getElementById('btn-close-sgdb').addEventListener('click', () => { document.getElementById('modal-sgdb').classList.remove('active'); });

document.getElementById('btn-sgdb-manual-search').addEventListener('click', async () => {
    const query = document.getElementById('sgdb-manual-search-input').value.trim();
    if (query) {
        const apiKey = await window.api.getSetting('steamgriddb_api');
        openSgdbModal(apiKey, currentSgdbAssetType, query);
    }
});

async function openSgdbModal(apiKey, assetType, manualQuery) {
    currentSgdbAssetType = assetType;
    document.getElementById('modal-sgdb').classList.add('active');
    const grid = document.getElementById('sgdb-grid');
    const stat = document.getElementById('sgdb-status');
    grid.innerHTML = '';
    stat.innerText = t('sgdb.searching', {type: assetType.toUpperCase()});

    const capturedGameId = currentGameId;
    const gameName = manualQuery || document.getElementById('edit-name').value;
    const appId = manualQuery ? null : document.getElementById('edit-appid').value;

    const results = await window.api.sgdbSearch(gameName, apiKey, appId, assetType);

    if (results.length === 0) { stat.innerText = t('sgdb.no_art'); return; }

    stat.innerText = t('sgdb.select', {type: assetType.toUpperCase()});
    results.forEach(res => {
        const img = document.createElement('img');
        img.src = res.thumb;
        img.style.width = "100%";
        img.style.borderRadius = "8px";
        img.style.cursor = "pointer";
        img.style.border = "2px solid transparent";
        img.style.transition = "transform 0.2s, border 0.2s";

        if (assetType === 'logo' || assetType === 'icon') {
            img.style.objectFit = 'contain';
            img.style.background = 'rgba(0,0,0,0.5)';
            img.style.padding = '10px';
        }

        img.addEventListener('mouseover', () => { img.style.transform = "scale(1.05)"; img.style.borderColor = "var(--accent)"; });
        img.addEventListener('mouseout', () => { img.style.transform = "scale(1)"; img.style.borderColor = "transparent"; });

        img.addEventListener('click', async () => {
            stat.innerText = t('sgdb.downloading');
            grid.style.opacity = "0.5"; grid.style.pointerEvents = "none";

            const newPath = await window.api.sgdbApply(capturedGameId, res.url, assetType);
            if (newPath) {
                const game = allGames.find(g => g.id === capturedGameId);
                if (game) {
                    if (assetType === 'cover') {
                        game.CoverArt = newPath;
                        document.getElementById('ui-cover').innerHTML = `<img src="${getSafePath(newPath)}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    } else if (assetType === 'hero') {
                        game.HeroArt = newPath;
                        document.getElementById('ui-hero').innerHTML = `<img src="${getSafePath(newPath)}" style="width: 100%; height: 100%; object-fit: cover;">`;
                    } else if (assetType === 'logo') {
                        game.Logo = newPath;
                        document.getElementById('ui-logo').innerHTML = `<img src="${getSafePath(newPath)}" style="width: 100%; height: 100%; object-fit: contain; padding: 10px;">`;
                    } else if (assetType === 'icon') {
                        game.Icon = newPath;
                        document.getElementById('ui-icon').innerHTML = `<img src="${getSafePath(newPath)}" style="width: 100%; height: 100%; object-fit: contain; padding: 10px;">`;
                    }
                }
                document.getElementById('modal-sgdb').classList.remove('active');
            } else {
                stat.innerText = t('sgdb.failed');
            }
            grid.style.opacity = "1"; grid.style.pointerEvents = "";
        });
        grid.appendChild(img);
    });
}

// --- IGDB SCREENSHOTS BROWSER ---
document.getElementById('btn-igdb-screenshots').addEventListener('click', () => openIgdbScreenshotsModal(null));
document.getElementById('btn-close-igdb-screenshots').addEventListener('click', () => document.getElementById('modal-igdb-screenshots').classList.remove('active'));

document.getElementById('btn-igdb-ss-search').addEventListener('click', async () => {
    const query = document.getElementById('igdb-ss-search-input').value.trim();
    if (query) await igdbSsSearchAndPick(query);
});
document.getElementById('igdb-ss-search-input').addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { const q = document.getElementById('igdb-ss-search-input').value.trim(); if (q) await igdbSsSearchAndPick(q); }
});

document.getElementById('btn-igdb-ss-save-keys').addEventListener('click', async () => {
    const clientId     = document.getElementById('igdb-ss-client-id').value.trim();
    const clientSecret = document.getElementById('igdb-ss-client-secret').value.trim();
    const keyStatus    = document.getElementById('igdb-ss-key-status');
    if (!clientId || !clientSecret) { keyStatus.textContent = 'Both fields are required.'; return; }
    keyStatus.textContent = '';
    await window.api.setSetting('igdb_client_id', clientId);
    await window.api.setSetting('igdb_client_secret', clientSecret);
    igdbSsShowNoKey(false);
    await igdbSsSearchAndPick(document.getElementById('igdb-ss-search-input').value.trim());
});

function igdbSsShowNoKey(show) {
    document.getElementById('igdb-ss-no-key-panel').style.display = show ? 'flex' : 'none';
    document.getElementById('igdb-ss-search-row').style.display   = show ? 'none' : 'flex';
}

async function openIgdbScreenshotsModal(manualQuery) {
    document.getElementById('modal-igdb-screenshots').classList.add('active');
    document.getElementById('igdb-ss-game-list').innerHTML = '';
    document.getElementById('igdb-ss-grid').innerHTML = '';
    document.getElementById('igdb-ss-status').textContent = '';
    document.getElementById('igdb-ss-key-status').textContent = '';
    igdbSsShowNoKey(false);
    const gameName = document.getElementById('edit-name').value;
    document.getElementById('igdb-ss-search-input').value = manualQuery || gameName;
    await igdbSsSearchAndPick(manualQuery || gameName);
}

async function igdbSsSearchAndPick(query) {
    const stat     = document.getElementById('igdb-ss-status');
    const gameList = document.getElementById('igdb-ss-game-list');
    const grid     = document.getElementById('igdb-ss-grid');
    gameList.innerHTML = '';
    grid.innerHTML = '';
    stat.style.color = 'var(--text_dim)';
    stat.textContent = 'Searching IGDB…';

    const { error, results } = await window.api.igdbSearchList(query);
    if (error === 'no_key') {
        igdbSsShowNoKey(true);
        return;
    }
    if (!results || !results.length) { stat.textContent = 'No results found.'; return; }
    if (results.length === 1) { await igdbSsLoadScreenshots(results[0]); return; }

    stat.textContent = 'Select the correct game:';
    results.forEach(game => {
        const btn = document.createElement('button');
        btn.textContent = game.year ? `${game.name} (${game.year})` : game.name;
        btn.style.cssText = 'background:var(--bg_menu); color:var(--text_main); border:1px solid var(--border_solid); padding:5px 10px; border-radius:4px; font-size:11px; cursor:pointer; font-family:var(--ui-font,Raleway),sans-serif; font-weight:700;';
        btn.addEventListener('mouseover', () => { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; });
        btn.addEventListener('mouseout',  () => { btn.style.borderColor = 'var(--border_solid)'; btn.style.color = 'var(--text_main)'; });
        btn.addEventListener('click', () => igdbSsLoadScreenshots(game));
        gameList.appendChild(btn);
    });
}

async function igdbSsLoadScreenshots(game) {
    const stat     = document.getElementById('igdb-ss-status');
    const gameList = document.getElementById('igdb-ss-game-list');
    const grid     = document.getElementById('igdb-ss-grid');
    gameList.innerHTML = '';
    grid.innerHTML = '';
    stat.style.color = 'var(--text_dim)';
    stat.textContent = `Loading: ${game.name}${game.year ? ` (${game.year})` : ''}…`;

    const { error, screenshots } = await window.api.igdbFetchScreenshots(game.id);
    if (error === 'no_key') {
        igdbSsShowNoKey(true);
        return;
    }
    if (!screenshots || !screenshots.length) {
        stat.textContent = `No screenshots available for ${game.name}.`;
        return;
    }
    stat.style.color = 'var(--text_dim)';
    stat.textContent = `${screenshots.length} screenshot${screenshots.length > 1 ? 's' : ''}, click to add`;

    const capturedGameId = currentGameId;
    screenshots.forEach(ss => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative; border-radius:6px; overflow:hidden; cursor:pointer; border:2px solid transparent; transition:border 0.15s;';

        const img = document.createElement('img');
        img.src = ss.thumb;
        img.style.cssText = 'width:100%; aspect-ratio:16/9; object-fit:cover; display:block;';
        img.addEventListener('mouseover', () => { if (!wrap.dataset.saved) wrap.style.borderColor = 'var(--accent)'; });
        img.addEventListener('mouseout',  () => { if (!wrap.dataset.saved) wrap.style.borderColor = 'transparent'; });

        wrap.appendChild(img);
        wrap.addEventListener('click', async () => {
            if (wrap.dataset.saving || wrap.dataset.saved) return;
            wrap.dataset.saving = '1';
            wrap.style.opacity = '0.5';
            const result = await window.api.igdbSaveScreenshot(capturedGameId, ss.full);
            wrap.style.opacity = '1';
            delete wrap.dataset.saving;
            if (result) {
                wrap.dataset.saved = '1';
                wrap.style.borderColor = '#66bb6a';
                const check = document.createElement('div');
                check.textContent = '✓';
                check.style.cssText = 'position:absolute; top:6px; right:8px; color:#66bb6a; font-size:20px; font-weight:900; text-shadow:0 1px 4px #000;';
                wrap.appendChild(check);
                const game = allGames.find(g => g.id === capturedGameId);
                if (game) {
                    game.Screenshot = result;
                    const first = result.split('|')[0];
                    document.getElementById('ui-screenshot').innerHTML = `<img src="${getSafePath(first)}" style="width:100%; height:100%; object-fit:cover;">`;
                }
                stat.style.color = '#66bb6a';
                stat.textContent = 'Added! Click more screenshots to keep adding.';
            }
        });
        grid.appendChild(wrap);
    });
}

// --- SAVE & AUTO-FETCH LOGIC ---
document.getElementById('btn-save-game').addEventListener('click', async () => {
    if (!currentGameId) return;
    const game = allGames.find(g => g.id === currentGameId);

    // Serialize launcher list → LaunchCommand (primary/first) + LaunchCommands (full JSON if multiple)
    const _launcherRows = document.querySelectorAll('#edit-launchers-list > div');
    const _launchers = [];
    _launcherRows.forEach(row => {
        const lbl = row.querySelector('.lnch-label')?.value?.trim() || '';
        const cmd = row.querySelector('.lnch-cmd')?.value?.trim()   || '';
        if (cmd) _launchers.push({ label: lbl, cmd });
    });
    const _primaryCmd      = _launchers.length > 0 ? _launchers[0].cmd : '';
    const _launchCommandsJson = _launchers.length > 1 ? JSON.stringify(_launchers) : null;

    const data = {
        Game: document.getElementById('edit-name').value,
                                                          Store: document.getElementById('edit-store').value,
                                                          LaunchCommand: _primaryCmd,
                                                          LaunchCommands: _launchCommandsJson,
                                                          GENRE: document.getElementById('edit-genre').value,
                                                          RELEASED: document.getElementById('edit-released').value,
                                                          SteamAppID: document.getElementById('edit-appid').value,
                                                          ProtonTier: document.getElementById('edit-proton').value,
                                                          METACRITIC: document.getElementById('edit-meta').value,
                                                          HLTB_Main: document.getElementById('edit-hltb').value,
                                                          DEV: document.getElementById('edit-dev').value,
                                                          PUB: document.getElementById('edit-pub').value,
                                                          Coop: document.getElementById('edit-coop').value,
                                                          NumPlayers: document.getElementById('edit-players').value,
                                                          Tags: document.getElementById('edit-tags').value,
                                                          SimilarGames: document.getElementById('edit-similar').value,
                                                          Franchise: document.getElementById('edit-franchise').value,
                                                          Description: document.getElementById('edit-desc').value,
                                                          FAV: document.getElementById('edit-fav').checked ? 'YES' : 'NO',
                                                          WANT_TO_PLAY: document.getElementById('edit-want').checked ? 'YES' : 'NO',

                                                          CoverArt: game ? game.CoverArt : "",
                                                          Screenshot: game ? game.Screenshot : "",
                                                          HeroArt: game ? game.HeroArt : "",
                                                          Logo: game ? game.Logo : "",
                                                          Icon: game ? game.Icon : "",
                                                          SteamDesc: game ? game.SteamDesc : "",
                                                          SteamTrailer: game ? game.SteamTrailer : ""
    };

    const success = await window.api.updateGame(currentGameId, data);
    // The filter genre lives in its own table, so it saves separately. An empty pick
    // clears the override and lets the next scan decide again.
    const _pinned = document.getElementById('edit-primary-genre')?.value || '';
    try { await window.api.setGameGenres(currentGameId, _pinned ? [_pinned] : []); } catch (e) {}
    if (success) {
        await loadGenres();
        await loadGames();
        const updatedGame = allGames.find(g => g.id === currentGameId);
        if (updatedGame) openGamepage(updatedGame); else switchView('view-gallery');
    } else {
        await showAlert(t('alert.save_failed'));
    }
});

document.getElementById('btn-delete-game').addEventListener('click', async () => {
    if (!currentGameId) return;
    if (await showConfirm(t('confirm.delete_game'), 'Delete', true)) {
        const success = await window.api.deleteGame(currentGameId);
        if (success) {
            loadGames();
            switchView('view-gallery');
        }
    }
});

let _fetchMode = 'full'; // 'full' | 'text'

function _fetchBtn() {
    return document.getElementById(_fetchMode === 'text' ? 'btn-fetch-text-meta' : 'btn-auto-fetch');
}

function triggerAutoFetchSearch(gameId, gameName) {
    const btn = _fetchBtn();
    btn.innerText = t('status.searching'); btn.disabled = true;

    window.api.searchSteam(gameName).then(results => {
        if (results.length === 0) {
            document.getElementById('modal-refine-search').classList.add('active');
            document.getElementById('refine-search-input').value = gameName;
            btn.innerText = _fetchMode === 'text' ? 'SCRAPE TEXT' : t('status.auto_fetch');
            btn.disabled = false; return;
        }
        if (results.length === 1) {
            btn.innerText = t('status.fetching_auto');
            executeAutoFetch(gameId, gameName, results[0].id);
        } else {
            openSteamResultsModal(gameId, gameName, results);
            btn.innerText = _fetchMode === 'text' ? 'SCRAPE TEXT' : t('status.auto_fetch');
            btn.disabled = false;
        }
    });
}

document.getElementById('btn-auto-fetch').addEventListener('click', () => {
    if (!currentGameId) return;
    _fetchMode = 'full';
    const gameName = document.getElementById('edit-name').value.trim();
    triggerAutoFetchSearch(currentGameId, gameName);
});

document.getElementById('btn-fetch-text-meta')?.addEventListener('click', () => {
    if (!currentGameId) return;
    _fetchMode = 'text';
    const gameName = document.getElementById('edit-name').value.trim();
    triggerAutoFetchSearch(currentGameId, gameName);
});

document.getElementById('btn-refine-search-submit').addEventListener('click', () => {
    const newName = document.getElementById('refine-search-input').value.trim();
    document.getElementById('modal-refine-search').classList.remove('active');
    if (newName) triggerAutoFetchSearch(currentGameId, newName);
});

document.getElementById('btn-close-refine-search').addEventListener('click', () => { document.getElementById('modal-refine-search').classList.remove('active'); });

function openSteamResultsModal(gameId, gameName, results) {
    document.getElementById('modal-steam-results').classList.add('active');
    const list = document.getElementById('steam-results-list');
    list.innerHTML = '';
    results.forEach(res => {
        const btn = document.createElement('button');
        btn.innerText = `${res.name} (${res.id})`;
        btn.style.width = '100%'; btn.style.textAlign = 'left';
        btn.addEventListener('click', () => {
            document.getElementById('modal-steam-results').classList.remove('active');
            document.getElementById('btn-auto-fetch').innerText = t('status.fetching_auto');
            document.getElementById('btn-auto-fetch').disabled = true;
            executeAutoFetch(gameId, gameName, res.id);
        });
        list.appendChild(btn);
    });
}
document.getElementById('btn-close-steam-results').addEventListener('click', () => { document.getElementById('modal-steam-results').classList.remove('active'); });

async function executeAutoFetch(gameId, gameName, appId) {
    const isText = _fetchMode === 'text';
    const btn = _fetchBtn();
    const result = isText
        ? await window.api.autoFetchText(gameId, gameName, appId)
        : await window.api.autoFetch(gameId, gameName, appId);
    await showAlert(result.message);
    if (result.success) {
        await loadGames();
        const updatedGame = allGames.find(g => g.id === gameId);
        if (updatedGame) openDetails(updatedGame);
    }
    btn.textContent = isText ? 'SCRAPE TEXT' : t('status.auto_fetch');
    btn.disabled = false;
    _fetchMode = 'full';
}

// --- EXTERNAL FETCHERS (HLTB/ProtonDB/Youtube) ---
document.getElementById('btn-fetch-hltb').addEventListener('click', async () => {
    const gameName = document.getElementById('edit-name').value;
    if (!gameName) return;
    document.getElementById('btn-fetch-hltb').textContent = '…';
    const result = await window.api.fetchHltb(gameName);
    document.getElementById('edit-hltb').value = result;
    document.getElementById('btn-fetch-hltb').innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    if (result === "API Offline" || result === "Error" || result === "Unknown") {
        window.api.openWebPopup(`https://howlongtobeat.com/?q=${encodeURIComponent(gameName)}`);
    }
});

document.getElementById('btn-fetch-proton').addEventListener('click', async () => {
    const appId = document.getElementById('edit-appid').value;
    if (!appId) { await showAlert(t('alert.proton_id_required')); return; }
    document.getElementById('btn-fetch-proton').textContent = '…';
    const result = await window.api.fetchProton(appId);
    document.getElementById('edit-proton').value = result.toUpperCase();
    document.getElementById('btn-fetch-proton').innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    if (result === "ERROR" || result === "UNKNOWN") {
        window.api.openWebPopup(`https://www.protondb.com/app/${appId}`);
    }
});

let _currentTrailerGame = '';

function openVideoPlayer(gameName, url) {
    _currentTrailerGame = gameName;
    const vid = document.getElementById('detail-video-player');
    vid.src = url;
    document.getElementById('modal-trailer-player').classList.add('active');
    vid.play();
}

// Used in Detailed View (Edit Mode) and as shared entry-point for all trailer buttons
document.getElementById('btn-watch-trailer').addEventListener('click', async () => {
    const gameName = document.getElementById('edit-name').value;
    if(!gameName) return;
    const localUrl = await window.api.checkLocalTrailer(gameName);
    if (localUrl) {
        openVideoPlayer(gameName, localUrl);
    } else {
        document.getElementById('modal-trailer-search').classList.add('active');
        const lst = document.getElementById('yt-search-list'); const stat = document.getElementById('yt-search-status');
        lst.innerHTML = '';

        // IGDB result is local, show it immediately if available
        const game = allGames.find(g => g.id === currentGameId);
        const igdbId = game?.IGDBTrailer;
        const renderResult = (res) => {
            const div = document.createElement('div');
            div.className = 'yt-search-item';
            if (res.official) div.style.cssText = 'border: 2px solid var(--accent); border-radius: 8px;';
            div.innerHTML = `<img src="${res.thumbnail}" style="width: 120px; border-radius: 4px;"><div style="color: ${res.official ? 'var(--accent)' : 'var(--text_main)'}; font-weight: bold;">${res.title}</div>`;
            div.addEventListener('click', () => { document.getElementById('modal-trailer-search').classList.remove('active'); openTrailerProgress(gameName, res.id); });
            lst.appendChild(div);
        };

        if (igdbId) {
            renderResult({ id: igdbId, thumbnail: `https://img.youtube.com/vi/${igdbId}/hqdefault.jpg`, title: '🎬 Official Trailer (via IGDB)', official: true });
            stat.innerText = 'Official trailer found. Also searching YouTube...';
        } else {
            stat.innerText = t('status.searching_yt', {name: gameName});
        }

        // YouTube search runs in parallel, results appended when ready
        const ytResults = await window.api.searchYoutube(gameName);
        const filtered = ytResults.filter(r => r.id !== igdbId);
        filtered.forEach(res => renderResult(res));

        const total = (igdbId ? 1 : 0) + filtered.length;
        if (total === 0) { stat.innerText = t('status.no_yt'); return; }
        stat.innerText = t('status.select_video');
    }
});

function openTrailerProgress(gameName, videoId) {
    document.getElementById('modal-trailer-progress').classList.add('active');
    document.getElementById('dl-progress-game').innerText = gameName;
    document.getElementById('dl-progress-fill').style.width = "0%"; document.getElementById('dl-progress-text').innerText = "0%";
    window.api.downloadTrailer(gameName, videoId).then(success => {
        document.getElementById('modal-trailer-progress').classList.remove('active');
        showAlert(success ? t('status.download_complete') : t('status.download_failed'));
    });
}
window.api.onDownloadProgress((percentage) => {
    const fill = document.getElementById('dl-progress-fill'); const text = document.getElementById('dl-progress-text');
    if (fill && text) { fill.style.width = `${percentage}%`; text.innerText = `${Math.floor(percentage)}%`; }
});

document.getElementById('btn-close-yt-search').addEventListener('click', () => document.getElementById('modal-trailer-search').classList.remove('active'));
document.getElementById('btn-close-player').addEventListener('click', () => {
    document.getElementById('modal-trailer-player').classList.remove('active');
    const vid = document.getElementById('detail-video-player');
    vid.pause(); vid.removeAttribute('src'); vid.load();
    _currentTrailerGame = '';
});

document.getElementById('btn-delete-player').addEventListener('click', async () => {
    if (!_currentTrailerGame) return;
    const confirmed = await showConfirm(
        `Delete the downloaded trailer for "${_currentTrailerGame}"?\n\nThis will remove the video file from your hard drive. You can download it again at any time.`,
        'Delete', true
    );
    if (!confirmed) return;
    const success = await window.api.deleteTrailer(_currentTrailerGame);
    if (success) {
        document.getElementById('btn-close-player').click();
    } else {
        await showAlert('Could not delete the trailer file.');
    }
});


// --- ADMIN TOOLS ---
// Connections now live inside the Control Panel (Connections pane); the old
// #modal-connect is folded in by cpInit(). Every layout's "Connect" button
// clicks #btn-open-connect, so repointing this one handler reroutes them all.
async function _cpPrefillConnections() {
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set('steam-id', await window.api.getSetting('steam_id'));
    set('steam-api-key', await window.api.getSetting('steam_api_key'));
    set('igdb-client-id', await window.api.getSetting('igdb_client_id'));
    if (await window.api.getSetting('igdb_client_secret')) set('igdb-client-secret', '••••••••');
    if (await window.api.getSetting('steamgriddb_api')) set('connect-sgdb-key', '••••••••');
    const cs = document.getElementById('connect-sgdb-status'); if (cs) cs.innerText = '';
    const is = document.getElementById('igdb-status'); if (is) is.innerText = '';
}
document.getElementById('btn-open-connect')?.addEventListener('click', () => openToolsModal('connections'));

document.getElementById('btn-connect-save-sgdb').addEventListener('click', async () => {
    const key    = document.getElementById('connect-sgdb-key').value.trim();
    const status = document.getElementById('connect-sgdb-status');
    if (!key || key === '••••••••') { status.style.color = '#f57c00'; status.innerText = 'Paste your API key above.'; return; }
    await window.api.setSetting('steamgriddb_api', key);
    document.getElementById('sgdb-api-input').value = key;
    document.getElementById('connect-sgdb-key').value = '••••••••';
    status.style.color = '#66bb6a'; status.innerText = '✓ Key saved!';
});

document.getElementById('btn-save-igdb').addEventListener('click', async () => {
    const clientId = document.getElementById('igdb-client-id').value.trim();
    const secret   = document.getElementById('igdb-client-secret').value.trim();
    const statusEl = document.getElementById('igdb-status');
    if (!clientId || !secret || secret === '••••••••') { statusEl.style.color = '#f57c00'; statusEl.innerText = 'Enter both Client ID and Secret.'; return; }
    await window.api.setSetting('igdb_client_id', clientId);
    await window.api.setSetting('igdb_client_secret', secret);
    // Clear cached token so it gets refreshed with new credentials
    await window.api.setSetting('igdb_token', ''); await window.api.setSetting('igdb_token_expiry', '0');
    statusEl.style.color = 'var(--text_dim)'; statusEl.innerText = 'Testing...';
    const result = await window.api.igdbTest();
    statusEl.style.color = result.success ? '#4caf50' : '#f44336';
    statusEl.innerText = result.message;
});


// ── PICO-8 CONNECT HANDLERS ───────────────────────────────────────────────

async function refreshPico8Status() {
    const status = await window.api.getPico8Status();
    const el = document.getElementById('pico8-bin-status');
    if (el) el.innerText = status.bin ? `✓ ${status.bin}` : 'Not detected, place pico8 binary in GameManagerConfig/pico8/';
}

document.getElementById('btn-pico8-browse')?.addEventListener('click', async () => {
    const p = await window.api.browsePico8Binary();
    if (p) refreshPico8Status();
});

document.getElementById('btn-pico8-splore')?.addEventListener('click', async () => {
    const ok = await window.api.launchPico8Splore();
    if (!ok) showAlert('PICO-8 binary not found. Place pico8 in GameManagerConfig/pico8/ or use Browse Binary.');
});

document.getElementById('btn-pico8-open-bbs')?.addEventListener('click', () => {
    closeTools();
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff77a8';
    window.api.launchPico8Bbs(accent);
});

window.api.onPico8CartDownloaded(({ name }) => {
    loadGames();
    // Toast in Clarity window
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--bg_menu);border:1px solid var(--accent);color:var(--accent);padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:1px;box-shadow:0 6px 24px rgba(0,0,0,0.8);transition:opacity 0.4s;pointer-events:none;white-space:nowrap;';
    toast.textContent = `✓ ${name}, added to PICO-8 library`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
});

// Refresh PICO-8 status when Connect opens
(function patchConnectOpen() {
    const connectBtn = document.getElementById('btn-open-connect');
    if (connectBtn) connectBtn.addEventListener('click', () => setTimeout(refreshPico8Status, 50));
})();

// ── SEE FILTER VISIBILITY CONFIG ─────────────────────────────────────────

const SEE_FILTERS = [
    { filter: 'all',        label: 'All Games'   },
    { filter: 'installed',  label: 'Installed'   },
    { filter: 'favs',       label: 'Favs'        },
    { filter: 'want',       label: 'Want to Play' },
    { filter: 'steam',      label: 'Steam'       },
    { filter: 'epic',       label: 'Epic Games'  },
    { filter: 'gog',        label: 'GOG'         },
    { filter: 'flatpak',    label: 'Flatpak'     },
    { filter: 'pico8',      label: 'PICO-8'      },
    { filter: 'itch',       label: 'itch.io'     },
    { filter: 'physical',   label: 'Physical'    },
    { filter: 'others',     label: 'Others'      },
    { filter: 'emulation',  label: 'Emulation'   },
    { filter: 'apps',       label: 'Apps'        },
];

async function applySeeFilterVisibility() {
    for (const { filter } of SEE_FILTERS) {
        const val = await window.api.getSetting(`filter_vis_${filter}`);
        const hidden = val === '0';
        [
            document.querySelector(`#panel-stores-grid [data-filter="${filter}"]`),
            document.querySelector(`#split-filter-strip .split-ftab[data-filter="${filter}"]`),
        ].forEach(el => { if (el) el.style.display = hidden ? 'none' : ''; });
    }
}

async function openSeeConfig() {
    const grid = document.getElementById('see-config-grid');
    grid.innerHTML = '';
    for (const { filter, label } of SEE_FILTERS) {
        const val = await window.api.getSetting(`filter_vis_${filter}`);
        const isOn = val !== '0';
        const btn = document.createElement('button');
        btn.dataset.filter = filter;
        btn.textContent = label;
        btn.style.cssText = `font-size:14px; font-weight:700; padding:7px 10px; border-radius:5px; cursor:pointer; letter-spacing:0.5px; transition:all 0.15s; text-align:left; border:1px solid ${isOn ? 'var(--accent)' : 'var(--border_solid)'}; background:${isOn ? 'var(--accent)' : 'transparent'}; color:${isOn ? 'var(--bg)' : 'var(--text_dim)'};`;
        btn.addEventListener('click', async () => {
            const nowOn = btn.style.background !== 'transparent' && btn.style.background !== '';
            const next = !nowOn;
            btn.style.border = `1px solid ${next ? 'var(--accent)' : 'var(--border_solid)'}`;
            btn.style.background = next ? 'var(--accent)' : 'transparent';
            btn.style.color = next ? 'var(--bg)' : 'var(--text_dim)';
            await window.api.setSetting(`filter_vis_${filter}`, next ? '1' : '0');
            [
                document.querySelector(`#panel-stores-grid [data-filter="${filter}"]`),
                document.querySelector(`#split-filter-strip .split-ftab[data-filter="${filter}"]`),
            ].forEach(el => { if (el) el.style.display = next ? '' : 'none'; });
        });
        grid.appendChild(btn);
    }
    document.getElementById('see-config-panel').style.display = 'flex';
    const btn = document.getElementById('btn-see-config');
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

const _closeSeeConfig = () => {
    document.getElementById('see-config-panel').style.display = 'none';
    const btn = document.getElementById('btn-see-config');
    if (btn) btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
};
['btn-see-config'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', openSeeConfig));
document.getElementById('btn-see-config-close')?.addEventListener('click', _closeSeeConfig);
document.getElementById('see-config-panel')?.addEventListener('click', e => { if (e.target === e.currentTarget) _closeSeeConfig(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('see-config-panel')?.style.display === 'flex') _closeSeeConfig(); });

// ── COMMAND BAR WIRING ────────────────────────────────────────────────────
const CP_KEYWORDS = {
    'all': 'all', 'everything': 'all',
    'installed': 'installed',
    'favs': 'favs', 'favorites': 'favs', 'favourites': 'favs',
    'want': 'want', 'wishlist': 'want',
    'steam': 'steam', 'epic': 'epic', 'gog': 'gog',
    'flatpak': 'flatpak', 'pico8': 'pico8', 'pico-8': 'pico8',
    'itch': 'itch', 'itch.io': 'itch',
    'physical': 'physical', 'others': 'others', 'custom': 'others',
    'emulation': 'emulation', 'emulated': 'emulation', 'retro': 'emulation',
    'apps': 'apps',
    'openbor': 'openbor', 'bor': 'openbor', 'beat em up': 'openbor',
};


// ── PICO-8 HERO BUTTONS ───────────────────────────────────────────────────

// ── FILTER & MODAL HELPERS ────────────────────────────────────────────────
function resetFilters() {
    activeFilters.clear();
    currentPlaylistId = null;
    currentPlaylistGames = null;
    syncFilterActiveStates();
    applyFilters();
}

function toggleFavFilter() {
    if (activeFilters.has('favs')) activeFilters.delete('favs');
    else activeFilters.add('favs');
    syncFilterActiveStates();
    applyFilters();
}

function toggleWantFilter() {
    if (activeFilters.has('want')) activeFilters.delete('want');
    else activeFilters.add('want');
    syncFilterActiveStates();
    applyFilters();
}

function openConnectModal() {
    document.getElementById('btn-open-connect')?.click();
}

// ── STEAM / Installer / ITCH / STORE HERO BUTTONS ──────────────────────────

function getThemeColors() {
    const s = getComputedStyle(document.documentElement);
    return {
        bg:          s.getPropertyValue('--bg').trim(),
        bgMenu:      s.getPropertyValue('--bg_menu').trim(),
        accent:      s.getPropertyValue('--accent').trim(),
        textDim:     s.getPropertyValue('--text_dim').trim(),
        borderSolid: s.getPropertyValue('--border_solid').trim()
    };
}

document.getElementById('btn-steam-open-hero')?.addEventListener('click', () => window.api.openInstallUrl('steam://open/main'));
document.getElementById('btn-itch-open-hero')?.addEventListener('click', () => window.api.openInstallUrl('itch://library'));
document.getElementById('btn-gog-store-hero')?.addEventListener('click', () => window.api.openStoreBrowser('gog', getThemeColors()));
document.getElementById('btn-epic-store-hero')?.addEventListener('click', () => window.api.openStoreBrowser('epic', getThemeColors()));
document.getElementById('btn-flathub-hero')?.addEventListener('click', () => window.api.openStoreBrowser('flathub', getThemeColors()));

document.getElementById('btn-hero-update-steam')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-hero-update-steam');
    const steamId  = await window.api.getSetting('steam_id');
    const steamKey = await window.api.getSetting('steam_api_key');
    if (!steamId || !steamKey) { await showAlert(t('alert.steam_id_required')); return; }
    btn.style.animation = 'spin 0.6s linear infinite';
    await window.api.syncSteam(steamId, steamKey);
    btn.style.animation = '';
    loadGames();
});

// Sync runs in-process now, `installer-refresh-owned` already did the whole job
// (syncOwnedLibrary plus pruning refunds out of the CN library); it simply had no
// caller. The spinner runs for as long as the sync actually takes.
async function _syncOwnedLibrary(btnId) {
    const btn = document.getElementById(btnId);
    if (btn?.dataset.busy) return;
    if (btn) { btn.dataset.busy = '1'; btn.style.animation = 'spin 1s linear infinite'; }
    try {
        const r = await window.api.installerRefreshOwned();
        if (!r?.available)  { await showAlert('Installer data is not set up yet, connect GOG or Epic first.'); return; }
        if (r.error)        { await showAlert('Could not refresh your library: ' + r.error); return; }
        await loadGames();
    } finally {
        if (btn) { delete btn.dataset.busy; btn.style.animation = ''; }
    }
}
document.getElementById('btn-hero-update-gog')?.addEventListener('click', () => _syncOwnedLibrary('btn-hero-update-gog'));

document.getElementById('btn-hero-update-epic')?.addEventListener('click', () => _syncOwnedLibrary('btn-hero-update-epic'));

document.getElementById('btn-hero-update-others')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-hero-update-others');
    btn.style.animation = 'spin 0.6s linear infinite';
    await syncInstallerInstalled();
    btn.style.animation = '';
    loadGames();
});

document.getElementById('btn-p8-splore-hero')?.addEventListener('click', async () => {
    const ok = await window.api.launchPico8Splore();
    if (!ok) showAlert('PICO-8 binary not found. Configure it in PICO-8 Configuration (gear button).');
});

document.getElementById('btn-p8-bbs-hero')?.addEventListener('click', () => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff77a8';
    window.api.launchPico8Bbs(accent);
});

document.getElementById('btn-p8-folder-hero')?.addEventListener('click', () => window.api.openPico8Folder());

// ── PICO-8 CONFIG MODAL ───────────────────────────────────────────────────

async function openPico8Config() {
    const status = await window.api.getPico8Status();
    const binEl = document.getElementById('pico8-cfg-bin-status');
    if (binEl) binEl.innerText = status.bin ? `✓ ${status.bin}` : 'Not detected, place pico8 binary in GameManagerConfig/pico8/';

    const opts = await window.api.getPico8Opts();
    _p8SetToggle('p8-opt-windowed',  opts.windowed);
    _p8SetToggle('p8-opt-mute',      opts.mute);
    _p8SetToggle('p8-opt-pixel',     opts.pixelPerfect);
    _p8SetToggle('p8-opt-joystick',  opts.joystick);

    document.getElementById('p8-config-panel').style.display = 'flex';
}

function _p8SetToggle(id, isOn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('on', isOn);
    btn.textContent = isOn ? btn.dataset.on : btn.dataset.off;
}

document.getElementById('btn-p8-config')?.addEventListener('click', openPico8Config);
document.getElementById('p8-config-panel')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) _closePico8Config(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('p8-config-panel')?.style.display === 'flex') _closePico8Config(); });

const _closePico8Config = () => { document.getElementById('p8-config-panel').style.display = 'none'; };
document.getElementById('btn-pico8-config-close')?.addEventListener('click',  _closePico8Config);
document.getElementById('btn-pico8-config-close2')?.addEventListener('click', _closePico8Config);
document.getElementById('btn-pico8-cfg-browse')?.addEventListener('click', async () => {
    const p = await window.api.browsePico8Binary();
    if (p) {
        document.getElementById('pico8-cfg-bin-status').innerText = `✓ ${p}`;
        refreshPico8Status(); // also update Connect card
    }
});

// Toggle buttons, each click toggles and saves immediately
document.querySelectorAll('.p8-opt-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const isOn = !btn.classList.contains('on');
        _p8SetToggle(btn.id, isOn);
        await window.api.setPico8Opt(btn.dataset.key, isOn);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

document.getElementById('btn-sync-itch')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-sync-itch');
    const statusEl = document.getElementById('itch-sync-status');
    btn.disabled = true; btn.innerText = 'Syncing…'; statusEl.innerText = '';
    const result = await window.api.syncItch();
    btn.disabled = false; btn.innerText = 'Sync itch.io Library';
    statusEl.style.color = result.success ? 'var(--accent)' : '#f57c00';
    statusEl.innerText = result.message;
    if (result.success) { await loadGames(); syncInstallerInstalled(); }
});

document.getElementById('btn-sync-steam').addEventListener('click', async () => {
    const steamId = document.getElementById('steam-id').value.trim();
    const apiKey = document.getElementById('steam-api-key').value.trim();
    if (!steamId || !apiKey) { await showAlert(t('alert.steam_id_required')); return; }
    await window.api.setSetting('steam_id', steamId); await window.api.setSetting('steam_api_key', apiKey);
    const btn = document.getElementById('btn-sync-steam');
    btn.innerText = t('status.fetching'); btn.disabled = true;
    const result = await window.api.syncSteam(steamId, apiKey);
    await showAlert(result.message);
    if (result.success) loadGames();
    btn.innerText = t('status.fetch_steam'); btn.disabled = false;
});


document.getElementById('btn-tools-add-game')?.addEventListener('click', () => {
    closeTools();
    openAddGameDialog();
});

async function updateLibraryFlow({ quiet = false } = {}) {
    const statusEl = document.getElementById('update-library-status');
    statusEl.innerHTML = '';
    cpTaskStart('Updating library…');
    cpTaskProgress(20);

    const line = (html) => { statusEl.innerHTML += (statusEl.innerHTML ? '<br>' : '') + html; };

    const steamId  = await window.api.getSetting('steam_id');
    const steamKey = await window.api.getSetting('steam_api_key');
    let anySuccess = false;
    const beforeIds = new Set(allGames.map(g => g.id)); // snapshot to detect games added by this sync

    // Steam sync, only if credentials are already saved
    if (steamId && steamKey) {
        line('🔄 Syncing Steam...');
        const steamResult = await window.api.syncSteam(steamId, steamKey);
        if (steamResult.success) {
            anySuccess = true;
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Syncing Steam...', `✅ Steam: ${steamResult.message}`);
        } else {
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Syncing Steam...', `⚠️ Steam: ${steamResult.message}`);
        }
    } else if (!quiet) {
        line('⚠️ Steam: not configured');
        document.getElementById('update-info-body').innerHTML = `<div style="padding: 12px; background: rgba(0,0,0,0.2); border-radius: 8px; border-left: 3px solid #66c0f4;">
            <strong style="color: #66c0f4;">Steam not configured</strong>
            <p style="margin: 6px 0 0 0;">Go to <strong>Connect → Steam API Import</strong> and enter your SteamID64 and API Key.<br>
            Get your free API key at:<br>
            <span style="color: var(--text_main); font-size: 12px;">steamcommunity.com/dev/apikey</span></p>
        </div>`;
        document.getElementById('modal-update-info').classList.add('active');
    }

    // Headless store refresh, pull newly-bought GOG/Epic games from the stores
    // into Installer's DB (import-only, not install) so the Installer sync below picks
    // them up into Clarity's library.
    cpTaskProgress(45);
    line('🔄 Refreshing GOG/Epic library...');
    try {
        const ro = await window.api.installerRefreshOwned();
        if (!ro || ro.available === false) {
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Refreshing GOG/Epic library...', '⚪ GOG/Epic: Installer not found');
        } else {
            const parts = [];
            const tally = (label, s) => `${label} +${s.added || 0}${s.removed ? ` −${s.removed}` : ''}`;
            if (ro.gog?.loggedIn)  parts.push(tally('GOG', ro.gog));
            if (ro.epic?.loggedIn) parts.push(tally('Epic', ro.epic));
            const msg = parts.length ? parts.join(', ') : 'not logged in to GOG/Epic';
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Refreshing GOG/Epic library...', `✅ Stores: ${msg}`);
            if ((ro.gog?.added || 0) + (ro.epic?.added || 0) > 0) anySuccess = true;
        }
    } catch (e) {
        statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Refreshing GOG/Epic library...', `⚠️ GOG/Epic: ${e.message}`);
    }

    // Installer sync, always attempt if Installer is present
    cpTaskProgress(60);
    line('🔄 Syncing Installer...');
    const gs = await window.api.installerStatus();
    if (!gs.found) {
        statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Syncing Installer...', '⚪ Installer: not found');
    } else {
        try {
            let gSynced = 0;
            if (gs.allGames?.length) {
                const r = await window.api.syncAllInstallerGames(gs.allGames, gs.path);
                gSynced = r.synced ?? 0;
            } else if (gs.installedGames?.length) {
                const r = await window.api.syncInstallerInstalled(gs.installedGames);
                gSynced = r.synced ?? 0;
            }
            anySuccess = true;
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Syncing Installer...', `✅ Installer: ${gSynced} game(s) updated`);
        } catch(e) {
            statusEl.innerHTML = statusEl.innerHTML.replace('🔄 Syncing Installer...', `⚠️ Installer: ${e.message}`);
        }
    }

    cpTaskEnd('Library updated');
    await loadGames();
    // Offer to scrape ONLY the games this sync added, never re-scrape the whole library
    const newGames = gamesMissingData(allGames.filter(g => !beforeIds.has(g.id)));
    if (newGames.length && await showConfirm(`Fetch artwork & metadata for ${newGames.length} newly-added game${newGames.length !== 1 ? 's' : ''}?`, 'Fetch Now')) {
        runBatchScrape(newGames, 'Scraping new games');
    }
    return anySuccess;
}

document.getElementById('btn-update-library').addEventListener('click', async () => {
    const btn = document.getElementById('btn-update-library');
    btn.disabled = true;
    btn.querySelector('span').innerText = t('status.updating_library');
    await updateLibraryFlow({ quiet: false });
    btn.disabled = false;
    btn.querySelector('span').innerText = t('html.btn_update_library');
});

document.getElementById('btn-close-update-info').addEventListener('click', () => {
    document.getElementById('modal-update-info').classList.remove('active');
});

document.getElementById('btn-clear-data').addEventListener('click', async () => {
    if (await showConfirm(t('confirm.clear_browser'), 'Clear', true)) {
        const result = await window.api.clearBrowserData(); await showAlert(result.message);
    }
});

// Image Cleanup Handlers
document.getElementById('btn-clean-images').addEventListener('click', async () => {
    if (await showConfirm(t('confirm.clean_images'), 'Clean', true)) {
        const result = await window.api.cleanUnusedImages();
        await showAlert(result.message);
    }
});

document.getElementById('btn-clear-all-images').addEventListener('click', async () => {
    if (await showConfirm(t('confirm.clear_all_images'), 'Clear All', true)) {
        const result = await window.api.clearAllImages();
        await showAlert(result.message);
        loadGames();
    }
});


window.api.onZipStarted(() => { document.getElementById('modal-tools').classList.remove('active'); document.getElementById('modal-zip-progress').classList.add('active'); });

document.getElementById('btn-backup-zip').addEventListener('click', async () => {
    const result = await window.api.backupZip();
    document.getElementById('modal-zip-progress').classList.remove('active');
    if (result.message) await showAlert(result.message);
});

document.getElementById('btn-restore-zip').addEventListener('click', async () => {
    if (await showConfirm(t('confirm.restore_backup'), 'Restore', true)) {
        const result = await window.api.restoreZip();
        document.getElementById('modal-zip-progress').classList.remove('active');
        if (result.message) await showAlert(result.message);
    }
});

const modalTools = document.getElementById('modal-tools');
function openToolsModal(pane = 'welcome') {
    // Used directly as a click handler too, an Event lands in `pane`; treat it as default.
    if (typeof pane !== 'string') pane = 'welcome';
    modalTools.classList.add('active');
    document.getElementById('batch-status').innerText = '';
    document.getElementById('install-menu-status').innerText = '';
    _cpSelectPane(pane);
    _cpPrefillConnections();
    _cpPrefillInstallDir();
}

// ── Control Panel: global install folder ─────────────────────────────────────
// Stored in library.db as `default_install_dir`, the same key the Installer face reads, so
// both faces (and the per-game override in the install dialog) agree on one location.
async function _cpPrefillInstallDir() {
    const el = document.getElementById('install-dir-current');
    if (!el) return;
    try { el.value = (await window.api.installerDefaultDir()) || ''; } catch { el.value = ''; }
    const s = document.getElementById('install-dir-status');
    if (s) s.innerText = '';
}
(() => {
    const input = () => document.getElementById('install-dir-current');
    const say = (msg, ok) => {
        const s = document.getElementById('install-dir-status');
        if (!s) return;
        s.style.color = ok ? '#66bb6a' : '#ef5350';
        s.innerText = msg;
        setTimeout(() => { if (s.innerText === msg) s.innerText = ''; }, 4000);
    };
    const save = async (dir, okMsg) => {
        const res = await window.api.installerSetDefaultDir(dir);
        if (res && res.ok) { input().value = res.dir || ''; say(okMsg, true); }
        else say((res && res.error) || 'Could not save the install folder.', false);
    };
    document.getElementById('btn-install-dir-change')?.addEventListener('click', async () => {
        const dir = await window.api.installerPickDir(input().value);
        if (dir) save(dir, 'Install folder saved.');
    });
    document.getElementById('btn-install-dir-reset')?.addEventListener('click', () =>
        save('', 'Reset to the default folder.'));
})();
['btn-open-tools', 'btn-open-tools-sb'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', openToolsModal));

document.getElementById('btn-install-menu').addEventListener('click', async () => {
    const btn = document.getElementById('btn-install-menu');
    const status = document.getElementById('install-menu-status');
    btn.disabled = true; btn.querySelector('span').innerText = t('status.installing'); status.style.color = 'var(--text_dim)'; status.innerText = '';
    const result = await window.api.installToMenu();
    btn.disabled = false; btn.querySelector('span').innerText = t('status.add_to_menu');
    status.style.color = result.success ? '#66bb6a' : '#ef5350';
    status.innerText = result.message;
});

// Opt-in: auto-start Couch (fullscreen) on login, reflects the autostart entry's presence.
(() => {
    const chk = document.getElementById('chk-couch-autostart');
    if (!chk) return;
    window.api.getCouchAutostart().then(on => { chk.checked = !!on; }).catch(() => {});
    chk.addEventListener('change', async () => {
        const res = await window.api.setCouchAutostart(chk.checked);
        if (!res || !res.ok) { chk.checked = !chk.checked; }   // revert on failure
    });
})();
// ── Installer tool card ──────────────────────────────────────────────────────────
checkInstallerConnect();

document.getElementById('btn-check-installer')?.addEventListener('click', checkInstallerConnect);

// Sync ALL Installer games into Clarity (installed + not installed).
// Called on startup and after any library sync.
async function syncInstallerInstalled() {
    const s = await window.api.installerStatus();
    if (!s.found) return;
    // Match/import all Installer games AND reconcile install status from Installer (the source of truth).
    if (s.allGames?.length) {
        await window.api.syncAllInstallerGames(s.allGames, s.path);
    } else if (s.installedGames?.length) {
        await window.api.syncInstallerInstalled(s.installedGames);
    }
    await loadGames();   // always re-render so Installer-reconciled install state replaces the stored/restored flag
}

async function checkInstallerConnect() {
    const statusEl = document.getElementById('installer-connect-status');
    if (!statusEl) return;
    // What users actually care about here is whether their stores are connected.
    await renderStoreAuthStatus(statusEl);
}

document.getElementById('btn-connect-login-gog')?.addEventListener('click',  (e) =>
    runStoreLogin('gog',  e.currentTarget, document.getElementById('installer-connect-status')));
document.getElementById('btn-connect-login-epic')?.addEventListener('click', (e) =>
    runStoreLogin('epic', e.currentTarget, document.getElementById('installer-connect-status')));

// ── Installer row in detail panel ────────────────────────────────────────────────
async function updateInstallerRow(game) {
    const row       = document.getElementById('installer-launch-row');
    const statusEl  = document.getElementById('installer-launch-status');
    const openBtn   = document.getElementById('btn-open-installer-detail');
    if (!row) return;

    const epicMatch = (game.LaunchCommand || '').match(/installer:\/\/launch\/epic\/([^"\s]+)/i);
    const gogMatch  = (game.LaunchCommand || '').match(/installer:\/\/launch\/gog\/([^"\s]+)/i);
    const storeMatch = epicMatch || gogMatch;
    const isCustomInstaller = !storeMatch && !!game.InstallerGameId;
    const s = await window.api.installerStatus();

    // Show for GOG/Epic games AND custom Others games managed by Installer
    if ((!storeMatch && !isCustomInstaller) || !s.found) { row.style.display = 'none'; return; }

    row.style.display = 'flex';
    openBtn.style.display = 'none';

    // Custom/Others games: always Installer-managed
    if (isCustomInstaller) {
        statusEl.textContent = '✓ Installer, default launcher';
        statusEl.style.color = '#66bb6a';
        openBtn.style.display = '';
        openBtn.onclick = () => _openCompatFor(game);
        return;
    }

    const installerGameId = epicMatch ? `epic_${epicMatch[1]}` : `gog_${gogMatch[1]}`;
    const inInstaller = s.installedGames?.includes(installerGameId);
    // GOG/Epic always launch via Installer
    openBtn.style.display = '';
    openBtn.onclick = () => _openCompatFor(game);
    if (game.InstallerGameId || inInstaller) {
        statusEl.textContent = '✓ Installer, default launcher';
        statusEl.style.color = '#66bb6a';
    } else {
        statusEl.textContent = 'Not yet linked in Installer';
        statusEl.style.color = 'var(--text_dim)';
    }
}

function closeTools() {
    modalTools.classList.remove('active');
}
document.getElementById('btn-close-tools').addEventListener('click', closeTools);
modalTools.addEventListener('click', e => { if (e.target === modalTools) closeTools(); });

// ── CONTROL PANEL: fold Connections in + reparent cards into category panes ──
// The 9 tool cards and the former #modal-connect cards may sit anywhere in the
// DOM; move each into its rail category so every id, handler and per-layout
// theme survives untouched. Runs once at load (before the haystack pre-cache).
(function cpInit() {
    const pane = (p) => document.querySelector(`#tools-cards-container .cp-pane[data-pane="${p}"]`);
    const card = (childId) => document.getElementById(childId)?.closest('.tool-card');
    // ⚠️ EVERY card must appear here. A card that is not listed is never moved, and
    // because `.cp-pane { display:none }` hides panes rather than the cards outside
    // them, an unlisted card renders on TOP of whichever page is showing, on all of
    // them. Seven cards were in that state (game updates, the display picker, Omarchy,
    // source ports, DOSBox, genres and Mac-Native), which is why the panel still read
    // as one flat list even though the panes were already built.
    const CARD_PANES = [
        ['btn-update-library', 'library'],
        ['btn-storage-installer', 'library'],
        ['btn-install-dir-change', 'library'],
        ['btn-tools-add-game', 'library'],
        ['btn-scan-updates', 'library'],
        ['btn-scan-genres', 'library'],
        ['btn-theme-switch', 'appearance'],
        ['history-segmented-control', 'behavior'],
        ['recently-imported-segmented-control', 'behavior'],
        ['pico8-vis-control', 'behavior'],
        ['freegames-vis-control', 'behavior'],   // Show/Hide toggles live together in Behavior
        ['btn-open-hidden-games', 'behavior'],
        ['notify-segmented-control', 'behavior'],
        ['btn-custom-install', 'ports'],
        ['dosbox-mode-control', 'ports'],
        ['display-card', 'desktop'],
        ['omarchy-card', 'desktop'],
        ['mac-native-tool-card', 'desktop'],
        ['btn-backup-zip', 'system'],
        ['btn-clean-images', 'danger'],
    ];
    CARD_PANES.forEach(([id, p]) => { const c = card(id), pn = pane(p); if (c && pn) pn.appendChild(c); });
    const connPane = pane('connections');
    if (connPane) document.querySelectorAll('#modal-connect .connect-section').forEach(c => {
        c.classList.add('tools-section'); connPane.appendChild(c);
    });
    document.getElementById('modal-connect')?.remove();
    // Anything still sitting outside a pane would render on every page, report it.
    const stray = [...document.querySelectorAll('#tools-cards-container > .tool-card')];
    if (stray.length) console.warn('[control panel] card(s) not filed into a pane:',
        stray.map(c => c.querySelector('.tool-card-title')?.textContent?.trim() || c.dataset.search || '?'));
})();

function _cpSelectPane(pane) {
    document.querySelectorAll('#cp-rail .cp-rail-item').forEach(b => b.classList.toggle('active', b.dataset.pane === pane));
    document.querySelectorAll('#tools-cards-container .cp-pane').forEach(s => s.classList.toggle('active', s.dataset.pane === pane));
}

document.querySelectorAll('#cp-rail .cp-rail-item').forEach(btn =>
    btn.addEventListener('click', () => {
        _cpSelectPane(btn.dataset.pane);
    }));

// Keyboard: ↑/↓ move the rail, Esc closes (ignored while typing in a field)
document.addEventListener('keydown', e => {
    if (!modalTools.classList.contains('active')) return;
    if (e.key === 'Escape') { closeTools(); return; }
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (inField || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const items = [...document.querySelectorAll('#cp-rail .cp-rail-item')];
    const cur = items.findIndex(i => i.classList.contains('active'));
    if (cur === -1 && e.key !== 'ArrowDown') return;   // on the welcome splash, ↓ enters the rail
    const next = cur === -1 ? 0 : e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
    _cpSelectPane(items[next].dataset.pane);
    e.preventDefault();
});

// ── Operations task bar (footer): progress that follows you across panes ────
let _cpBatchCancel = false;
let _cpTaskTimer = null;
function cpTaskStart(label, stoppable = false) {
    opToast(label, 0);   // mirror to the always-visible global toast (visible from any layout)
    const tb = document.getElementById('cp-taskbar'); if (!tb) return;
    clearTimeout(_cpTaskTimer);
    tb.classList.add('active');
    document.getElementById('cp-taskbar-label').innerText = label;
    document.getElementById('cp-taskbar-fill').style.width = '0%';
    document.getElementById('cp-taskbar-stop').style.display = stoppable ? '' : 'none';
}
function cpTaskProgress(pct, label) {
    opToast(label, pct);
    const fill = document.getElementById('cp-taskbar-fill'); if (fill) fill.style.width = pct + '%';
    if (label != null) document.getElementById('cp-taskbar-label').innerText = label;
}
function cpTaskEnd(label) {
    opToastDone(label);
    const tb = document.getElementById('cp-taskbar'); if (!tb) return;
    if (label != null) document.getElementById('cp-taskbar-label').innerText = label;
    document.getElementById('cp-taskbar-fill').style.width = '100%';
    _cpTaskTimer = setTimeout(() => tb.classList.remove('active'), 2500);
}
document.getElementById('cp-taskbar-stop')?.addEventListener('click', () => { _cpBatchCancel = true; });

// Upgraded Batch Fetcher, filter helper + reusable runner
function gamesMissingData(list) {
    const hasImg = (v) => v && String(v).startsWith('GameManagerConfig');
    const hasText = (v) => v && String(v).trim() !== '';
    // Carts carry their own art and never want scraping, but a row that is PICO-8 *and*
    // something else is a real game that does, so only a pure cart is skipped.
    const isPico8 = (g) => _isPico8Only(g.store || g.Store);
    return list.filter(g =>
        !isPico8(g) && (
        !hasImg(g.CoverArt) || !hasImg(g.HeroArt) || !hasImg(g.Logo) ||
        !hasImg(g.Icon) || !hasImg(g.Screenshot) ||
        !hasText(g.Description) || !hasText(g.DEV) || !hasText(g.GENRE) ||
        !hasText(g.SimilarGames) || !hasText(g.Franchise)));
}

async function runBatchScrape(gamesToFetch, label) {
    const btn = document.getElementById('btn-batch-fetch');
    const statusText = document.getElementById('batch-status');
    const progressWrap = document.getElementById('batch-progress-wrap');
    const progressFill = document.getElementById('batch-progress-fill');

    if (!gamesToFetch.length) { statusText.innerText = t('status.all_up_to_date'); return; }

    btn.disabled = true;
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    _cpBatchCancel = false;
    cpTaskStart(label || 'Batch Scrape', true);

    for (let i = 0; i < gamesToFetch.length; i++) {
        if (_cpBatchCancel) break;
        const game = gamesToFetch[i];
        const pct = Math.round(((i + 1) / gamesToFetch.length) * 100);
        statusText.innerText = t('status.fetching_progress', {i: i + 1, total: gamesToFetch.length, name: game.Game});
        progressFill.style.width = `${pct}%`;
        cpTaskProgress(pct, `Scraping ${i + 1}/${gamesToFetch.length} · ${game.Game}`);
        await window.api.autoFetch(game.id, game.Game, game.SteamAppID);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    const _scrapeStopped = _cpBatchCancel;
    progressFill.style.width = '100%';
    statusText.innerText = _scrapeStopped ? 'Scrape stopped' : t('status.batch_done', {n: gamesToFetch.length});
    cpTaskEnd(_scrapeStopped ? 'Scrape stopped' : 'Scrape complete');
    setTimeout(() => { progressWrap.style.display = 'none'; progressFill.style.width = '0%'; }, 2000);
    btn.disabled = false;
    loadGames();
}

// Standalone button: scrape every game missing data
document.getElementById('btn-batch-fetch').addEventListener('click', () => runBatchScrape(gamesMissingData(allGames), 'Batch Scrape'));

document.getElementById('btn-check-install').addEventListener('click', async () => {
    const btn = document.getElementById('btn-check-install');
    const statusEl = document.getElementById('check-install-status');
    btn.disabled = true;
    btn.querySelector('span').innerText = t('status.checking');
    statusEl.innerText = '';
    const result = await window.api.checkAllInstallStatus();
    await syncInstallerInstalled();   // reconcile GOG/Epic install state from Installer (the source of truth)
    btn.disabled = false;
    btn.querySelector('span').innerText = t('html.btn_check_install');
    statusEl.style.color = '#66bb6a';
    statusEl.innerText = `✅ ${t('status.install_check_done', { n: result.updated })}`;
    setTimeout(() => { statusEl.innerText = ''; }, 5000);
    loadGames();
});

document.getElementById('btn-add-game').addEventListener('click', () => openAddGameDialog());

document.getElementById('btn-template-csv').addEventListener('click', async () => { const result = await window.api.downloadCsvTemplate(); if (result?.message) await showAlert(result.message); });
document.getElementById('btn-export-csv').addEventListener('click', async () => { const result = await window.api.exportCsv(); if (result?.message) await showAlert(result.message); });
document.getElementById('btn-import-csv').addEventListener('click', async () => {
    const btn = document.getElementById('btn-import-csv');
    btn.querySelector('span').innerText = t('status.importing'); btn.disabled = true;
    const result = await window.api.importCsv();
    if (result?.message) { await showAlert(result.message); if (result.success) loadGames(); }
    btn.querySelector('span').innerText = t('status.import_csv'); btn.disabled = false;
});

// --- THEME ENGINE ---

let _lastMosaicKey = '';
function updateHeroMosaic(filtered) {
    // Always update count labels (cheap)
    const countEl = document.getElementById('gallery-category-count');
    if (countEl) countEl.innerText = `${filtered.length} ${filtered.length === 1 ? t('game.singular') : t('game.plural')}`;
    const searchCountEl = document.getElementById('gallery-search-count');
    if (searchCountEl) searchCountEl.textContent = `${filtered.length} ${filtered.length === 1 ? t('game.singular') : t('game.plural')}`;
    const searchEl = document.getElementById('gallery-search');
    const clearBtn = document.getElementById('btn-gsearch-clear');
    if (clearBtn) clearBtn.style.display = searchEl?.value ? 'flex' : 'none';
    if (searchEl && !searchEl.value) {
        const active = [...activeFilters];
        const label = active.length === 0 ? 'All Games'
            : active.length === 1 ? (document.querySelector(`.panel-filter-btn[data-filter="${active[0]}"]`)?.textContent || active[0])
            : 'Selection';
        searchEl.placeholder = `Search ${label}…`;
    }
    // Skip full mosaic rebuild if filter + game set is identical to last render
    const mosaicKey = `${currentPlaylistId ? 'pl:' + currentPlaylistId : ([...activeFilters].join(',') || 'all')}:${filtered.length}:${filtered[0]?.id ?? ''}:${filtered[filtered.length - 1]?.id ?? ''}`;
    if (mosaicKey === _lastMosaicKey) return;
    _lastMosaicKey = mosaicKey;

    clearInterval(heroKbInterval);
    const iconContainer = document.getElementById('hero-icon');
    const kbImg = document.getElementById('hero-kb-img');
    const nameEl = document.getElementById('hero-game-name');

    const filterMap = {
        'all': { text: t('filter.all'), icon: 'all_games' }, 'playable': { text: t('filter.playable'), icon: 'playable' },
        'favs': { text: t('filter.favorites'), icon: 'favs' }, 'want': { text: t('filter.want'), icon: 'want_to_play' },
        'steam': { text: 'STEAM', icon: 'steam' }, 'epic': { text: 'EPIC', icon: 'epic' },
        'gog': { text: 'GOG', icon: 'gog' }, 'flatpak': { text: 'FLATPAK', icon: 'flatpak' }, 'pico8': { text: 'PICO-8', icon: 'pico8' }, 'itch': { text: 'ITCH.IO', icon: 'itch' },
        'physical': { text: t('filter.physical'), icon: 'physical' },
        'others': { text: t('filter.others'), icon: 'others' }, 'emulation': { text: t('filter.emulation'), icon: 'emulation' },
        'apps': { text: t('filter.apps'), icon: 'apps' },
        'openbor': { text: 'OPENBOR', icon: 'openbor' },
        'installed': { text: 'INSTALLED', icon: 'installed' }
    };
    const active = [...activeFilters];
    let displayText, displayIcon;
    if (currentPlaylistId !== null) {
        const pl = allPlaylists.find(p => p.id === currentPlaylistId);
        displayText = pl ? pl.name.toUpperCase() : 'PLAYLIST';
        displayIcon = 'all_games';
    } else if (active.length === 0) {
        displayText = t('filter.all'); displayIcon = 'all_games';
    } else if (active.length === 1) {
        const cat = filterMap[active[0]] || { text: active[0].toUpperCase(), icon: active[0] };
        displayText = cat.text; displayIcon = cat.icon;
    } else {
        displayText = active.map(f => filterMap[f]?.text || f.toUpperCase()).join(' + ');
        displayIcon = 'all_games';
    }
    document.getElementById('gallery-category-text').innerText = displayText;
    const iconPath = getSafePath(`assets/logos/${displayIcon}.png`);
    document.getElementById('gallery-category-icon').style.webkitMaskImage = `url('${iconPath}')`;

    let mediaPool = [];
    filtered.forEach(g => {
        if (g.Screenshot && String(g.Screenshot).trim() !== "") {
            String(g.Screenshot).split('|').filter(s => s.trim() !== "").forEach(s => mediaPool.push({ path: s, name: g.Game }));
        } else if (g.HeroArt && String(g.HeroArt).trim() !== "") {
            mediaPool.push({ path: g.HeroArt, name: g.Game });
        } else if (g.CoverArt && String(g.CoverArt).trim() !== "") {
            mediaPool.push({ path: g.CoverArt, name: g.Game });
        }
    });

    if (mediaPool.length > 0) {
        iconContainer.style.display = 'none'; kbImg.style.display = 'block';
        mediaPool.sort(() => Math.random() - 0.5);
        let idx = 0;
        function showNextImage() {
            kbImg.style.opacity = '0';
            setTimeout(() => {
                let item = mediaPool[idx]; kbImg.src = getSafePath(item.path); nameEl.innerText = item.name;
                kbImg.style.opacity = '0.5'; idx = (idx + 1) % mediaPool.length;
            }, 500);
        }
        showNextImage(); heroKbInterval = setInterval(showNextImage, 5000);
    } else {
        kbImg.style.display = 'none'; nameEl.innerText = ''; iconContainer.style.display = 'block';
    }
}

const THEMES = {
    "DARK GRAY": {bg: "#141414", bg_panel: "rgba(0,0,0,0.5)", bg_menu: "#222222", accent: "#ffffff", accent_menu: "#00e5ff", text_main: "#ffffff", text_sec: "#bbbbbb", text_dim: "#777777", border: "rgba(255,255,255,0.1)", border_solid: "#555555"},
    "Couch": {bg: "#2C1E16", bg_panel: "rgba(67, 40, 24, 0.6)", bg_menu: "#432818", accent: "#D4A373", accent_menu: "#D4A373", text_main: "#FFE6A7", text_sec: "#E6CC98", text_dim: "#A47148", border: "rgba(212, 163, 115, 0.2)", border_solid: "#8B5A2B"},
    "CYBERPUNK": {bg: "#09090b", bg_panel: "rgba(26, 26, 46, 0.7)", bg_menu: "#1a1a2e", accent: "#f3e600", accent_menu: "#00ffcc", text_main: "#00ffcc", text_sec: "#e0e0e0", text_dim: "#ff003c", border: "rgba(243, 230, 0, 0.2)", border_solid: "#ff003c"},
    "VAPOUR OS": {bg: "#171a21", bg_panel: "rgba(27, 40, 56, 0.7)", bg_menu: "#1b2838", accent: "#66c0f4", accent_menu: "#66c0f4", text_main: "#c7d5e0", text_sec: "#8f98a0", text_dim: "#556b82", border: "rgba(102, 192, 244, 0.2)", border_solid: "#2a475e"},
    "PSIV BLUE": {bg: "#000022", bg_panel: "rgba(0, 67, 156, 0.4)", bg_menu: "#001144", accent: "#ffffff", accent_menu: "#0070cc", text_main: "#ffffff", text_sec: "#aaaaaa", text_dim: "#666666", border: "rgba(0, 112, 204, 0.3)", border_solid: "#00439c"},

    "GREEN BOX": {bg: "#0e0e0e", bg_panel: "rgba(82, 176, 67, 0.10)", bg_menu: "#111111", accent: "#52b043", accent_menu: "#107C10", text_main: "#ffffff", text_sec: "#a8d8a4", text_dim: "#3d8030", border: "rgba(82, 176, 67, 0.22)", border_solid: "#1a3d1a"},
    "MOVIESFLIX": {bg: "#141414", bg_panel: "rgba(255, 255, 255, 0.07)", bg_menu: "#000000", accent: "#e50914", accent_menu: "#e50914", text_main: "#ffffff", text_sec: "#b3b3b3", text_dim: "#6d6d6d", border: "rgba(229, 9, 20, 0.30)", border_solid: "#404040"},
    "SNOW": {bg: "#0a1628", bg_panel: "rgba(32, 68, 110, 0.65)", bg_menu: "#0f2040", accent: "#93d0f0", accent_menu: "#b8e4f8", text_main: "#e8f4ff", text_sec: "#8bbbd8", text_dim: "#4a7898", border: "rgba(147, 208, 240, 0.18)", border_solid: "#1c4060"},

    // Retired from the picker when the "Systems" family landed (superseded by "WINDOWS XP"),
    // but kept defined so configs still set to it keep resolving instead of falling back.
    "WIN XP": {bg: "#003399", bg_panel: "rgba(236, 233, 216, 0.2)", bg_menu: "#0054E3", accent: "#ffd700", accent_menu: "#ffd700", text_main: "#FFFFFF", text_sec: "#ECE9D8", text_dim: "#99B4D1", border: "rgba(236, 233, 216, 0.4)", border_solid: "#4fcc3a"},

    "PSIII CLASSIC": {bg: "#000000", bg_panel: "rgba(25, 25, 25, 0.7)", bg_menu: "#111111", accent: "#dcdcdc", accent_menu: "#ffffff", text_main: "#ffffff", text_sec: "#aaaaaa", text_dim: "#666666", border: "rgba(255, 255, 255, 0.2)", border_solid: "#444444"},
    "PSIII RED": {bg: "#2b0000", bg_panel: "rgba(40, 0, 0, 0.7)", bg_menu: "#1a0000", accent: "#ff4d4d", accent_menu: "#ff4d4d", text_main: "#ffffff", text_sec: "#ffcccc", text_dim: "#cc6666", border: "rgba(255, 77, 77, 0.2)", border_solid: "#800000"},
    "PSIII GREEN": {bg: "#001a00", bg_panel: "rgba(0, 30, 0, 0.7)", bg_menu: "#000d00", accent: "#4dff4d", accent_menu: "#4dff4d", text_main: "#ffffff", text_sec: "#ccffcc", text_dim: "#66cc66", border: "rgba(77, 255, 77, 0.2)", border_solid: "#004d00"},
    "PSIII BLUE": {bg: "#000a1a", bg_panel: "rgba(0, 15, 30, 0.7)", bg_menu: "#00050d", accent: "#4d94ff", accent_menu: "#4d94ff", text_main: "#ffffff", text_sec: "#cce0ff", text_dim: "#66a3ff", border: "rgba(77, 148, 255, 0.2)", border_solid: "#003380"},
    "PSIII PURPLE": {bg: "#1a001a", bg_panel: "rgba(30, 0, 30, 0.7)", bg_menu: "#0d000d", accent: "#d24dff", accent_menu: "#d24dff", text_main: "#ffffff", text_sec: "#f0ccff", text_dim: "#c266cc", border: "rgba(210, 77, 255, 0.2)", border_solid: "#800080"},
    "PSIII GOLD": {bg: "#261a00", bg_panel: "rgba(40, 25, 0, 0.7)", bg_menu: "#130d00", accent: "#ffcc00", accent_menu: "#ffcc00", text_main: "#ffffff", text_sec: "#ffeecc", text_dim: "#cca300", border: "rgba(255, 204, 0, 0.2)", border_solid: "#997300"},
    "PSIII SILVER": {bg: "#1a1a1a", bg_panel: "rgba(35, 35, 35, 0.7)", bg_menu: "#0d0d0d", accent: "#cccccc", accent_menu: "#cccccc", text_main: "#ffffff", text_sec: "#e6e6e6", text_dim: "#999999", border: "rgba(204, 204, 204, 0.2)", border_solid: "#666666"},

    "DRACULA": {bg: "#282a36", bg_panel: "rgba(68, 71, 90, 0.7)", bg_menu: "#44475a", accent: "#bd93f9", accent_menu: "#ff79c6", text_main: "#f8f8f2", text_sec: "#8be9fd", text_dim: "#8290bc", border: "rgba(189, 147, 249, 0.2)", border_solid: "#8290bc"},
    "GRUVBOX": {bg: "#282828", bg_panel: "rgba(60, 56, 54, 0.8)", bg_menu: "#3c3836", accent: "#fabd2f", accent_menu: "#fe8019", text_main: "#ebdbb2", text_sec: "#b8bb26", text_dim: "#a89984", border: "rgba(250, 189, 47, 0.2)", border_solid: "#504945"},
    "NORD": {bg: "#2e3440", bg_panel: "rgba(59, 66, 82, 0.8)", bg_menu: "#3b4252", accent: "#88c0d0", accent_menu: "#81a1c1", text_main: "#eceff4", text_sec: "#e5e9f0", text_dim: "#7a8ba0", border: "rgba(136, 192, 208, 0.2)", border_solid: "#5e6f84"},
    "SOLARIZED DARK": {bg: "#002b36", bg_panel: "rgba(7, 54, 66, 0.8)", bg_menu: "#073642", accent: "#2aa198", accent_menu: "#268bd2", text_main: "#839496", text_sec: "#93a1a1", text_dim: "#7a9196", border: "rgba(42, 161, 152, 0.2)", border_solid: "#1a5060"},
    "CATPPUCCIN MOCHA": {bg: "#1e1e2e", bg_panel: "rgba(30, 30, 46, 0.8)", bg_menu: "#181825", accent: "#cba6f7", accent_menu: "#f5c2e7", text_main: "#cdd6f4", text_sec: "#bac2de", text_dim: "#6c7086", border: "rgba(203, 166, 247, 0.2)", border_solid: "#313244"},
    "CATPPUCCIN MACCHIATO": {bg: "#24273a", bg_panel: "rgba(36, 39, 58, 0.8)", bg_menu: "#1e2030", accent: "#c6a0f6", accent_menu: "#f4b8e4", text_main: "#cad3f5", text_sec: "#b8c0e0", text_dim: "#6e738d", border: "rgba(198, 160, 246, 0.2)", border_solid: "#363a4f"},
    "CATPPUCCIN FRAPPÉ": {bg: "#303446", bg_panel: "rgba(48, 52, 70, 0.8)", bg_menu: "#292c3c", accent: "#ca9ee6", accent_menu: "#f2d5cf", text_main: "#c6d0f5", text_sec: "#b5bfe2", text_dim: "#737994", border: "rgba(202, 158, 230, 0.2)", border_solid: "#414559"},
    "TOKYO NIGHT": {bg: "#1a1b26", bg_panel: "rgba(36, 40, 59, 0.8)", bg_menu: "#16161e", accent: "#7aa2f7", accent_menu: "#bb9af7", text_main: "#c0caf5", text_sec: "#a9b1d6", text_dim: "#7885ac", border: "rgba(122, 162, 247, 0.2)", border_solid: "#3d4468"},
    "EVERFOREST": {bg: "#2b3339", bg_panel: "rgba(50, 56, 62, 0.8)", bg_menu: "#2f383e", accent: "#a7c080", accent_menu: "#e67e80", text_main: "#d3c6aa", text_sec: "#a7c080", text_dim: "#859289", border: "rgba(167, 192, 128, 0.2)", border_solid: "#4b565c"},
    "ROSÉ PINE": {bg: "#191724", bg_panel: "rgba(31, 29, 46, 0.8)", bg_menu: "#1f1d2e", accent: "#c4a7e7", accent_menu: "#ebbcba", text_main: "#e0def4", text_sec: "#9ccfd8", text_dim: "#6e6a86", border: "rgba(196, 167, 231, 0.2)", border_solid: "#26233a"},

    "GAME BOY DMG": {bg: "#0f380f", bg_panel: "rgba(48, 98, 48, 0.70)", bg_menu: "#1a4a1a", accent: "#9bbc0f", accent_menu: "#8bac0f", text_main: "#9bbc0f", text_sec: "#8bac0f", text_dim: "#306230", border: "rgba(155, 188, 15, 0.25)", border_solid: "#306230"},
    "PIP BOY": {bg: "#000000", bg_panel: "rgba(0, 20, 0, 0.7)", bg_menu: "#001100", accent: "#14ff00", accent_menu: "#14ff00", text_main: "#14ff00", text_sec: "#0ea000", text_dim: "#0a6000", border: "rgba(20, 255, 0, 0.2)", border_solid: "#0ea000"},
    "SEVASTOPOL": {bg: "#050d05", bg_panel: "rgba(10, 25, 10, 0.7)", bg_menu: "#081808", accent: "#f5e6b3", accent_menu: "#ff0000", text_main: "#f5e6b3", text_sec: "#a39977", text_dim: "#4d594d", border: "rgba(245, 230, 179, 0.1)", border_solid: "#1a331a"},
    "RIP AND TEAR CLASSIC": {bg: "#110000", bg_panel: "rgba(80, 5, 5, 0.78)", bg_menu: "#1a0000", accent: "#ff0000", accent_menu: "#cc0000", text_main: "#f5d020", text_sec: "#d0a000", text_dim: "#7a4400", border: "rgba(255, 0, 0, 0.22)", border_solid: "#5a0000"},
    "SUPER BROTHERS": {bg: "#5C94FC", bg_panel: "rgba(0, 0, 0, 0.75)", bg_menu: "#000070", accent: "#F8D820", accent_menu: "#F87020", text_main: "#ffffff", text_sec: "#F8D820", text_dim: "#6898F8", border: "rgba(248, 216, 32, 0.30)", border_solid: "#000000"},
    "GREEN HILL": {bg: "#0044AA", bg_panel: "rgba(0, 60, 0, 0.82)", bg_menu: "#003300", accent: "#F8D020", accent_menu: "#F8D020", text_main: "#ffffff", text_sec: "#A8E888", text_dim: "#50A050", border: "rgba(248, 208, 32, 0.30)", border_solid: "#006600"},
    "NES": {bg: "#18181A", bg_panel: "rgba(40, 38, 42, 0.85)", bg_menu: "#222024", accent: "#C42020", accent_menu: "#CC3030", text_main: "#F0F0F0", text_sec: "#C0B8C0", text_dim: "#706870", border: "rgba(196, 32, 32, 0.22)", border_solid: "#3C3A3E"},
    "SNES": {bg: "#1E1828", bg_panel: "rgba(50, 42, 80, 0.72)", bg_menu: "#160E20", accent: "#8060C8", accent_menu: "#A888E8", text_main: "#E8E0F0", text_sec: "#A890C8", text_dim: "#605090", border: "rgba(128, 96, 200, 0.22)", border_solid: "#302050"},
    "BLOODBORNE": {bg: "#0a0606", bg_panel: "rgba(60, 20, 10, 0.78)", bg_menu: "#150808", accent: "#c0952a", accent_menu: "#d4a838", text_main: "#e8d8b0", text_sec: "#b09070", text_dim: "#604830", border: "rgba(192, 149, 42, 0.22)", border_solid: "#4a1818"},
    "METROID PRIME": {bg: "#050a12", bg_panel: "rgba(255, 120, 20, 0.12)", bg_menu: "#080f1a", accent: "#ff6a00", accent_menu: "#ff8a30", text_main: "#e0f0ff", text_sec: "#60c8e0", text_dim: "#304858", border: "rgba(255, 106, 0, 0.22)", border_solid: "#1a2a3a"},
    "SILENT HILL": {bg: "#141210", bg_panel: "rgba(80, 50, 35, 0.72)", bg_menu: "#1a1510", accent: "#c85020", accent_menu: "#e06030", text_main: "#e0d0c0", text_sec: "#a09080", text_dim: "#605040", border: "rgba(200, 80, 32, 0.22)", border_solid: "#4a3020"},
    "DIABLO": {bg: "#0c0808", bg_panel: "rgba(80, 20, 0, 0.75)", bg_menu: "#140808", accent: "#e84000", accent_menu: "#c03000", text_main: "#f0d898", text_sec: "#c0a060", text_dim: "#705028", border: "rgba(232, 64, 0, 0.22)", border_solid: "#4a1a00"},
    "HALF-LIFE": {bg: "#141618", bg_panel: "rgba(245, 130, 32, 0.12)", bg_menu: "#1c1e20", accent: "#f58320", accent_menu: "#ff9a40", text_main: "#f0f0f0", text_sec: "#b0b8c0", text_dim: "#606870", border: "rgba(245, 131, 32, 0.22)", border_solid: "#2a3038"},
    "SHOVEL KNIGHT": {bg: "#1a1a2e", bg_panel: "rgba(30, 40, 80, 0.75)", bg_menu: "#100c20", accent: "#f8d840", accent_menu: "#f0c020", text_main: "#e8f0ff", text_sec: "#88b8f8", text_dim: "#4060a0", border: "rgba(248, 216, 64, 0.28)", border_solid: "#202858"},

    "EARTHY & ORGANIC": {bg: "#3E4E3A", bg_panel: "rgba(91, 107, 85, 0.7)", bg_menu: "#4F5D48", accent: "#D4B28C", accent_menu: "#A9C298", text_main: "#F3EDE4", text_sec: "#D8D3C8", text_dim: "#8E9E88", border: "rgba(212, 178, 140, 0.2)", border_solid: "#6b7d63"},

    "DOPAMINE BRIGHTS": {bg: "#080810", bg_panel: "rgba(255, 50, 120, 0.12)", bg_menu: "#100820", accent: "#FF2D78", accent_menu: "#00F5D4", text_main: "#ffffff", text_sec: "#FF80C0", text_dim: "#6030A0", border: "rgba(255, 45, 120, 0.28)", border_solid: "#2A0850"},
    "RETRO REVIVAL": {bg: "#2A1A10", bg_panel: "rgba(80, 50, 30, 0.70)", bg_menu: "#1E1008", accent: "#E8883A", accent_menu: "#4AAA98", text_main: "#F8E8C8", text_sec: "#C8A878", text_dim: "#7A5838", border: "rgba(232, 136, 58, 0.22)", border_solid: "#5A3820"},
    "VAPORWAVE": {bg: "#0d0221", bg_panel: "rgba(80, 10, 100, 0.65)", bg_menu: "#150330", accent: "#ff71ce", accent_menu: "#01cdfe", text_main: "#f0e0ff", text_sec: "#c080ff", text_dim: "#6030a0", border: "rgba(255, 113, 206, 0.25)", border_solid: "#35005a"},
    "AURORA": {bg: "#0a1520", bg_panel: "rgba(0, 80, 80, 0.55)", bg_menu: "#081018", accent: "#00e8c8", accent_menu: "#b060ff", text_main: "#d0f8f0", text_sec: "#78d8c8", text_dim: "#306858", border: "rgba(0, 232, 200, 0.20)", border_solid: "#0a4040"},
    "NOIR": {bg: "#0a0a0a", bg_panel: "rgba(45, 45, 45, 0.78)", bg_menu: "#151515", accent: "#d4a030", accent_menu: "#f0b838", text_main: "#e8e0d0", text_sec: "#a09888", text_dim: "#606058", border: "rgba(212, 160, 48, 0.20)", border_solid: "#303028"},
    "BIOLUMINESCENCE": {bg: "#020810", bg_panel: "rgba(0, 120, 120, 0.42)", bg_menu: "#030c18", accent: "#00e8a8", accent_menu: "#00ffc0", text_main: "#c0f8f0", text_sec: "#60d8c8", text_dim: "#206858", border: "rgba(0, 232, 168, 0.22)", border_solid: "#0a3838"},
    "BRUTALIST": {bg: "#1a1a1a", bg_panel: "rgba(80, 80, 80, 0.55)", bg_menu: "#222222", accent: "#e03000", accent_menu: "#ff4010", text_main: "#f0f0f0", text_sec: "#c0c0c0", text_dim: "#808080", border: "rgba(224, 48, 0, 0.25)", border_solid: "#404040"},
    "OXOCARBON": {bg: "#161616", bg_panel: "rgba(38, 38, 38, 0.85)", bg_menu: "#262626", accent: "#0f62fe", accent_menu: "#4589ff", text_main: "#f4f4f4", text_sec: "#c6c6c6", text_dim: "#8d8d8d", border: "rgba(15, 98, 254, 0.25)", border_solid: "#393939"},
    "MATERIAL DARK": {bg: "#1a1c1e", bg_panel: "rgba(40, 48, 56, 0.80)", bg_menu: "#212325", accent: "#4fc3f7", accent_menu: "#0288d1", text_main: "#e1e2e8", text_sec: "#c1c2cb", text_dim: "#8589a0", border: "rgba(79, 195, 247, 0.18)", border_solid: "#3a3f4a"},
    "N7": {bg: "#080c14", bg_panel: "rgba(20, 30, 60, 0.78)", bg_menu: "#0c1428", accent: "#cc0000", accent_menu: "#4488cc", text_main: "#e8eeff", text_sec: "#7aa0cc", text_dim: "#3d5880", border: "rgba(204, 0, 0, 0.25)", border_solid: "#1a2848"},
    "TRON LEGACY": {bg: "#000000", bg_panel: "rgba(0, 200, 255, 0.08)", bg_menu: "#000508", accent: "#00c8ff", accent_menu: "#ff8c00", text_main: "#ffffff", text_sec: "#80d8ff", text_dim: "#204858", border: "rgba(0, 200, 255, 0.28)", border_solid: "#0a1a20"},
    "DEAD SPACE": {bg: "#020202", bg_panel: "rgba(255, 100, 20, 0.10)", bg_menu: "#050505", accent: "#ff6400", accent_menu: "#ff8030", text_main: "#f0f0f0", text_sec: "#ff9060", text_dim: "#602010", border: "rgba(255, 100, 32, 0.25)", border_solid: "#200800"},
    "COLONY SHIP": {bg: "#10120e", bg_panel: "rgba(50, 60, 40, 0.72)", bg_menu: "#141810", accent: "#c8b040", accent_menu: "#e0c850", text_main: "#d8e0c0", text_sec: "#909a70", text_dim: "#485840", border: "rgba(200, 176, 64, 0.22)", border_solid: "#303820"},
    "NECROMORPH": {bg: "#030808", bg_panel: "rgba(0, 80, 20, 0.60)", bg_menu: "#040a04", accent: "#80ff20", accent_menu: "#60c010", text_main: "#c8ffc0", text_sec: "#70c060", text_dim: "#306020", border: "rgba(128, 255, 32, 0.22)", border_solid: "#0a2808"},
    "CRIMSON PEAK": {bg: "#120508", bg_panel: "rgba(80, 15, 30, 0.75)", bg_menu: "#1a080c", accent: "#d4904a", accent_menu: "#e0b060", text_main: "#f0e0d8", text_sec: "#c0909a", text_dim: "#7a3848", border: "rgba(212, 144, 74, 0.22)", border_solid: "#5a1520"},
    "LAKESIDE CURSE": {bg: "#0c0a08", bg_panel: "rgba(60, 40, 20, 0.72)", bg_menu: "#141008", accent: "#e09030", accent_menu: "#f0b040", text_main: "#f0e8d0", text_sec: "#b09070", text_dim: "#706050", border: "rgba(224, 144, 48, 0.22)", border_solid: "#402808"},
    "THE BACKROOMS": {bg: "#1a1810", bg_panel: "rgba(220, 200, 100, 0.10)", bg_menu: "#201e14", accent: "#d4c840", accent_menu: "#f0e050", text_main: "#f0e8c8", text_sec: "#b0a870", text_dim: "#706840", border: "rgba(212, 200, 64, 0.22)", border_solid: "#3a3820"},

    "PAPER": {bg: "#f9f7f4", bg_panel: "rgba(232,228,222,0.75)", bg_menu: "#eeebe6", accent: "#1a1a1a", accent_menu: "#444444", text_main: "#1a1a1a", text_sec: "#444444", text_dim: "#999999", border: "rgba(0,0,0,0.08)", border_solid: "#cccccc"},
    "SOLARIZED LIGHT": {bg: "#fdf6e3", bg_panel: "rgba(238,232,213,0.80)", bg_menu: "#eee8d5", accent: "#268bd2", accent_menu: "#2aa198", text_main: "#586e75", text_sec: "#657b83", text_dim: "#93a1a1", border: "rgba(38,139,210,0.20)", border_solid: "#cfc9aa"},
    "CATPPUCCIN LATTE": {bg: "#eff1f5", bg_panel: "rgba(220,224,232,0.80)", bg_menu: "#e6e9ef", accent: "#8839ef", accent_menu: "#ea76cb", text_main: "#4c4f69", text_sec: "#5c5f77", text_dim: "#9ca0b0", border: "rgba(136,57,239,0.16)", border_solid: "#c4c8da"},
    "GITHUB LIGHT": {bg: "#ffffff", bg_panel: "rgba(234,238,242,0.80)", bg_menu: "#f6f8fa", accent: "#0969da", accent_menu: "#8250df", text_main: "#1f2328", text_sec: "#656d76", text_dim: "#9198a1", border: "rgba(9,105,218,0.15)", border_solid: "#d0d7de"},
    "GRUVBOX LIGHT": {bg: "#fbf1c7", bg_panel: "rgba(235,219,178,0.80)", bg_menu: "#f2e5bc", accent: "#af3a03", accent_menu: "#b57614", text_main: "#3c3836", text_sec: "#504945", text_dim: "#a89984", border: "rgba(175,58,3,0.18)", border_solid: "#d5c4a1"},
    "ROSÉ PINE DAWN": {bg: "#faf4ed", bg_panel: "rgba(242,232,228,0.78)", bg_menu: "#f2e9e1", accent: "#b4637a", accent_menu: "#d7827e", text_main: "#575279", text_sec: "#797593", text_dim: "#9893a5", border: "rgba(180,99,122,0.18)", border_solid: "#dfd9e2"},
    "NORD LIGHT": {bg: "#eceff4", bg_panel: "rgba(216,222,233,0.78)", bg_menu: "#e5e9f0", accent: "#5e81ac", accent_menu: "#81a1c1", text_main: "#2e3440", text_sec: "#3b4252", text_dim: "#7b8899", border: "rgba(94,129,172,0.20)", border_solid: "#c0cad8"},
    "DAYBREAK": {bg: "#fff9f0", bg_panel: "rgba(255,236,205,0.75)", bg_menu: "#ffefd8", accent: "#c05b18", accent_menu: "#d47820", text_main: "#3a2510", text_sec: "#6a4520", text_dim: "#b08060", border: "rgba(192,91,24,0.18)", border_solid: "#e8c898"},
    // Oakanizer (imported from the OAKANIZER project built-ins)
    "OAKANIZER LIGHT": {bg: "#f5f0f8", bg_panel: "rgba(228,219,237,0.75)", bg_menu: "#e4dbed", accent: "#46295a", accent_menu: "#46295a", text_main: "#1e0a30", text_sec: "#6b547b", text_dim: "#907f9c", border: "rgba(70,41,90,0.12)", border_solid: "#c0b4cc"},
    "OAKANIZER DARK": {bg: "#120a1a", bg_panel: "rgba(35,20,45,0.6)", bg_menu: "#23142d", accent: "#b5a9bd", accent_menu: "#b5a9bd", text_main: "#dad4de", text_sec: "#907f9c", text_dim: "#6b547b", border: "rgba(181,169,189,0.2)", border_solid: "#46295a"},
    // BrewBalance (imported from the BrewBalance app, espresso & latte brand set)
    "BREWBALANCE DARK": {bg: "#17100a", bg_panel: "rgba(30, 21, 13, 0.6)", bg_menu: "#1e150d", accent: "#d4a373", accent_menu: "#d4a373", text_main: "#efe3d2", text_sec: "#b89b7d", text_dim: "#7a5f45", border: "rgba(212, 163, 115, 0.2)", border_solid: "#3f2d1c"},
    "BREWBALANCE LIGHT": {bg: "#fbf7ef", bg_panel: "rgba(243, 235, 221, 0.75)", bg_menu: "#f3ebdd", accent: "#b5651d", accent_menu: "#b5651d", text_main: "#2a241c", text_sec: "#7c6b53", text_dim: "#9a8a72", border: "rgba(181, 101, 29, 0.12)", border_solid: "#d6c6ab"},
    "MOCHA": {bg: "#1a1210", bg_panel: "rgba(36, 24, 19, 0.6)", bg_menu: "#241813", accent: "#c98a5e", accent_menu: "#c98a5e", text_main: "#f0dfcf", text_sec: "#c7a98f", text_dim: "#8a6a54", border: "rgba(201, 138, 94, 0.2)", border_solid: "#4a3226"},
    "FLAT WHITE": {bg: "#f6f1e9", bg_panel: "rgba(253, 250, 244, 0.75)", bg_menu: "#fdfaf4", accent: "#8a5a2b", accent_menu: "#8a5a2b", text_main: "#33291f", text_sec: "#6b5a48", text_dim: "#a4917a", border: "rgba(138, 90, 43, 0.12)", border_solid: "#e0d4c0"},
    "MATCHA": {bg: "#12160f", bg_panel: "rgba(26, 32, 21, 0.6)", bg_menu: "#1a2015", accent: "#9bbf6b", accent_menu: "#9bbf6b", text_main: "#e6efd8", text_sec: "#b3c79b", text_dim: "#6d8556", border: "rgba(155, 191, 107, 0.2)", border_solid: "#33422a"},

    // Systems (imported from LatteWrite), retro-OS palettes; each carries its era `font` (applied as --ui-font while active)
    "MS-DOS": {bg: "#0a0a0a", bg_panel: "rgba(0, 0, 0, 0.6)", bg_menu: "#000000", accent: "#ffffff", accent_menu: "#ffffff", text_main: "#d2d2d2", text_sec: "#a2a2a2", text_dim: "#7e7e7e", border: "rgba(255, 255, 255, 0.25)", border_solid: "#4a4a4a", font: 'PxPlus IBM VGA8'},
    "COMMODORE 64": {bg: "#0000aa", bg_panel: "rgba(0, 0, 170, 0.6)", bg_menu: "#0000aa", accent: "#b9b6ff", accent_menu: "#b9b6ff", text_main: "#d0ccff", text_sec: "#9e9beb", text_dim: "#7976db", border: "rgba(185, 182, 255, 0.25)", border_solid: "#4341c5", font: 'C64 Pro Mono'},
    "MACOS 1.0": {bg: "#ffffff", bg_panel: "rgba(255, 255, 255, 0.6)", bg_menu: "#ffffff", accent: "#000000", accent_menu: "#000000", text_main: "#000000", text_sec: "#3d3d3d", text_dim: "#6b6b6b", border: "rgba(0, 0, 0, 0.25)", border_solid: "#adadad", font: 'Chicago'},
    "CLASSIC MACOS": {bg: "#cfcfcf", bg_panel: "rgba(228, 228, 228, 0.6)", bg_menu: "#e4e4e4", accent: "#2b2b9c", accent_menu: "#2b2b9c", text_main: "#000000", text_sec: "#323232", text_dim: "#575757", border: "rgba(43, 43, 156, 0.25)", border_solid: "#8d8d8d", font: 'Chicago'},
    "WINDOWS 95": {bg: "#c0c0c0", bg_panel: "rgba(192, 192, 192, 0.6)", bg_menu: "#c0c0c0", accent: "#000080", accent_menu: "#000080", text_main: "#000000", text_sec: "#2e2e2e", text_dim: "#515151", border: "rgba(0, 0, 128, 0.25)", border_solid: "#838383", font: 'Inter'},
    "AMIGA WORKBENCH": {bg: "#a6a6a6", bg_panel: "rgba(178, 178, 178, 0.6)", bg_menu: "#b2b2b2", accent: "#2b5db0", accent_menu: "#2b5db0", text_main: "#000000", text_sec: "#282828", text_dim: "#464646", border: "rgba(43, 93, 176, 0.25)", border_solid: "#717171", font: 'BigBlue Terminal'},
    "WINDOWS XP": {bg: "#ece9d8", bg_panel: "rgba(244, 243, 239, 0.6)", bg_menu: "#f4f3ef", accent: "#2f6fd6", accent_menu: "#2f6fd6", text_main: "#000000", text_sec: "#393834", text_dim: "#63625b", border: "rgba(47, 111, 214, 0.25)", border_solid: "#a09e93", font: 'Inter'},
    "BEOS": {bg: "#d8d8d0", bg_panel: "rgba(234, 234, 226, 0.6)", bg_menu: "#eaeae2", accent: "#2855b0", accent_menu: "#2855b0", text_main: "#000000", text_sec: "#343432", text_dim: "#5b5b57", border: "rgba(40, 85, 176, 0.25)", border_solid: "#93938d", font: 'Inter'},
    "NEXTSTEP": {bg: "#dedede", bg_panel: "rgba(255, 255, 255, 0.6)", bg_menu: "#ffffff", accent: "#26408b", accent_menu: "#26408b", text_main: "#000000", text_sec: "#353535", text_dim: "#5d5d5d", border: "rgba(38, 64, 139, 0.25)", border_solid: "#979797", font: 'Inter'},
    "ZX SPECTRUM": {bg: "#000000", bg_panel: "rgba(0, 0, 0, 0.6)", bg_menu: "#000000", accent: "#00d8d8", accent_menu: "#00d8d8", text_main: "#ffffff", text_sec: "#c2c2c2", text_dim: "#949494", border: "rgba(0, 216, 216, 0.25)", border_solid: "#525252", font: 'BigBlue Terminal'},
    "ATARI ST": {bg: "#ffffff", bg_panel: "rgba(255, 255, 255, 0.6)", bg_menu: "#ffffff", accent: "#007000", accent_menu: "#007000", text_main: "#000000", text_sec: "#3d3d3d", text_dim: "#6b6b6b", border: "rgba(0, 112, 0, 0.25)", border_solid: "#adadad", font: 'PxPlus IBM VGA8'},
    "AMBER CRT": {bg: "#140d00", bg_panel: "rgba(20, 13, 0, 0.6)", bg_menu: "#140d00", accent: "#ffcc44", accent_menu: "#ffcc44", text_main: "#ffb000", text_sec: "#c78900", text_dim: "#9c6c00", border: "rgba(255, 204, 68, 0.25)", border_solid: "#5f4100", font: 'PxPlus IBM VGA8'},
    "GREEN CRT": {bg: "#001400", bg_panel: "rgba(0, 20, 0, 0.6)", bg_menu: "#001400", accent: "#7dff9e", accent_menu: "#7dff9e", text_main: "#37ff6a", text_sec: "#2ac751", text_dim: "#209c3d", border: "rgba(125, 255, 158, 0.25)", border_solid: "#125f22", font: 'PxPlus IBM VGA8'},
    "TELETEXT": {bg: "#000000", bg_panel: "rgba(0, 0, 0, 0.6)", bg_menu: "#000000", accent: "#ffff00", accent_menu: "#ffff00", text_main: "#ffffff", text_sec: "#c2c2c2", text_dim: "#949494", border: "rgba(255, 255, 0, 0.25)", border_solid: "#525252", font: 'BigBlue Terminal'},
    "WINDOWS 3.1": {bg: "#c0c0c0", bg_panel: "rgba(192, 192, 192, 0.6)", bg_menu: "#c0c0c0", accent: "#000080", accent_menu: "#000080", text_main: "#000000", text_sec: "#2e2e2e", text_dim: "#515151", border: "rgba(0, 0, 128, 0.25)", border_solid: "#838383", font: 'Inter'},
    "OS/2 WARP": {bg: "#cececa", bg_panel: "rgba(214, 214, 208, 0.6)", bg_menu: "#d6d6d0", accent: "#00337f", accent_menu: "#00337f", text_main: "#000000", text_sec: "#313130", text_dim: "#575755", border: "rgba(0, 51, 127, 0.25)", border_solid: "#8c8c89", font: 'Inter'},
    "IBM 3270": {bg: "#051005", bg_panel: "rgba(5, 16, 5, 0.6)", bg_menu: "#051005", accent: "#66ff66", accent_menu: "#66ff66", text_main: "#33cc33", text_sec: "#289f28", text_dim: "#207d20", border: "rgba(102, 255, 102, 0.25)", border_solid: "#144c14", font: 'BigBlue Terminal'},
    "SOLARIS CDE": {bg: "#aeb6c2", bg_panel: "rgba(188, 196, 208, 0.6)", bg_menu: "#bcc4d0", accent: "#33518a", accent_menu: "#33518a", text_main: "#000000", text_sec: "#2a2c2f", text_dim: "#494c51", border: "rgba(51, 81, 138, 0.25)", border_solid: "#767c84", font: 'Inter'},
    "RISC OS": {bg: "#d7d7c8", bg_panel: "rgba(232, 232, 220, 0.6)", bg_menu: "#e8e8dc", accent: "#005a9c", accent_menu: "#005a9c", text_main: "#000000", text_sec: "#343430", text_dim: "#5a5a54", border: "rgba(0, 90, 156, 0.25)", border_solid: "#929288", font: 'Inter'},
    "GEOS": {bg: "#ffffff", bg_panel: "rgba(255, 255, 255, 0.6)", bg_menu: "#ffffff", accent: "#000000", accent_menu: "#000000", text_main: "#000000", text_sec: "#3d3d3d", text_dim: "#6b6b6b", border: "rgba(0, 0, 0, 0.25)", border_solid: "#adadad", font: 'Chicago'},
};

const THEME_CATEGORIES = {
    "Originals & System": ["DARK GRAY", "Couch", "CYBERPUNK", "SNOW", "MOVIESFLIX", "VAPOUR OS", "PSIV BLUE", "GREEN BOX", "OAKANIZER DARK"],
    "BrewBalance": ["BREWBALANCE DARK", "BREWBALANCE LIGHT", "MOCHA", "FLAT WHITE", "MATCHA"],
    "Light & Minimal": ["PAPER", "SOLARIZED LIGHT", "CATPPUCCIN LATTE", "GITHUB LIGHT", "GRUVBOX LIGHT", "ROSÉ PINE DAWN", "NORD LIGHT", "DAYBREAK", "OAKANIZER LIGHT"],
    "Gaming Legends": ["GAME BOY DMG", "PIP BOY", "SEVASTOPOL", "RIP AND TEAR CLASSIC", "SUPER BROTHERS", "GREEN HILL", "NES", "SNES", "BLOODBORNE", "METROID PRIME", "SILENT HILL", "DIABLO", "HALF-LIFE", "SHOVEL KNIGHT"],
    "Aesthetics": ["EARTHY & ORGANIC", "DOPAMINE BRIGHTS", "RETRO REVIVAL", "VAPORWAVE", "AURORA", "NOIR", "BIOLUMINESCENCE", "BRUTALIST"],
    "Linux Ricing": ["DRACULA", "GRUVBOX", "NORD", "SOLARIZED DARK", "CATPPUCCIN FRAPPÉ", "CATPPUCCIN MACCHIATO", "CATPPUCCIN MOCHA", "TOKYO NIGHT", "EVERFOREST", "ROSÉ PINE", "OXOCARBON", "MATERIAL DARK"],
    "Sci-Fi Universes": ["N7", "TRON LEGACY", "DEAD SPACE", "COLONY SHIP", "NECROMORPH"],
    "Horror Realm": ["CRIMSON PEAK", "LAKESIDE CURSE", "THE BACKROOMS"],
    "PSIII Colors": ["PSIII CLASSIC", "PSIII RED", "PSIII GREEN", "PSIII BLUE", "PSIII PURPLE", "PSIII GOLD", "PSIII SILVER"],
    "Systems": ["MS-DOS", "COMMODORE 64", "MACOS 1.0", "CLASSIC MACOS", "WINDOWS 95", "AMIGA WORKBENCH", "WINDOWS XP", "BEOS", "NEXTSTEP", "ZX SPECTRUM", "ATARI ST", "AMBER CRT", "GREEN CRT", "TELETEXT", "WINDOWS 3.1", "OS/2 WARP", "IBM 3270", "SOLARIS CDE", "RISC OS", "GEOS"]
};

let activeTheme = "MOCHA";   // default color scheme (BrewBalance · Mocha)

// Interface font: the user's font-picker choice (family name); '' = the Poppins default.
// A theme may carry its own era `font` which wins while that theme is active.
let _uiFont = '';
function _uiFontVal(name) { return `'${name || 'Poppins'}'`; }   // Poppins is the default interface font
function applyUiFont() {
    const themeFont = THEMES[activeTheme] && THEMES[activeTheme].font;
    document.documentElement.style.setProperty('--ui-font', _uiFontVal(themeFont || _uiFont));
}
function setUiFont(name) {
    _uiFont = name || '';
    window.api.setSetting('ui_font', _uiFont);
    applyUiFont();
}

// A light theme (bg luminance > 0.5) → buttons highlight with the accent on hover instead of
// the global "invert to text_main" (which is near-black on light themes → looks broken).
function _isLightBg(hex) {
    try {
        const c = String(hex).replace('#', ''); const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
        const [r, g, b] = [0, 2, 4].map(i => { const v = parseInt(n.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 0.5;
    } catch { return false; }
}

function applyTheme(themeName) {
    const tConfig = THEMES[themeName];
    if (!tConfig) return;
    const root = document.documentElement;
    Object.keys(tConfig).forEach(key => { if (key !== 'font') root.style.setProperty(`--${key}`, tConfig[key]); });
    activeTheme = themeName;
    try { applyOmarchyGeometry(themeName === OMARCHY_THEME_KEY); } catch {}
    document.body.classList.toggle('sys-xp', themeName === 'WINDOWS XP');   // light chrome text on the Luna-blue titlebar+rail
    document.body.classList.toggle('theme-light', _isLightBg(tConfig.bg));  // accent hover instead of near-black invert
    applyUiFont();                         // theme's era font wins; otherwise the picker's ui_font
    window.api.setSetting('clarity_theme', themeName);
    try { localStorage.setItem('clarity_theme_cache', JSON.stringify(tConfig)); } catch(e) {}
}

document.getElementById('btn-theme-switch').addEventListener('click', () => {
    document.getElementById('modal-tools').classList.remove('active');
    document.getElementById('modal-themes').classList.add('active');
    renderThemeCategories();
});
document.getElementById('btn-close-themes').addEventListener('click', () => {
    document.getElementById('modal-themes').classList.remove('active');
});
document.getElementById('btn-theme-back').addEventListener('click', () => {
    document.getElementById('modal-themes').classList.remove('active');
    document.getElementById('modal-tools').classList.add('active');
});
document.getElementById('btn-close-themes').addEventListener('mouseover', () => {
    const el = document.getElementById('btn-close-themes');
    el.style.background = '#c62828'; el.style.borderColor = '#c62828'; el.style.color = '#fff';
});
document.getElementById('btn-close-themes').addEventListener('mouseout', () => {
    const el = document.getElementById('btn-close-themes');
    el.style.background = 'rgba(0,0,0,0.35)'; el.style.borderColor = ''; el.style.color = '';
});

function renderThemeCategories() {
    const cats = document.getElementById('theme-cats');
    const grid = document.getElementById('theme-grid');
    const backBtn = document.getElementById('btn-theme-back');
    if (!cats || !grid) return;
    backBtn.style.display = 'none';
    cats.innerHTML = '';
    grid.innerHTML = '';
    Object.keys(THEME_CATEGORIES).forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'theme-cat-btn';
        btn.textContent = cat;
        btn.addEventListener('click', () => {
            cats.querySelectorAll('.theme-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderThemesInCategory(cat);
        });
        cats.appendChild(btn);
    });
    cats.querySelector('.theme-cat-btn')?.classList.add('active');
    renderThemesInCategory(Object.keys(THEME_CATEGORIES)[0]);
}

function renderThemesInCategory(category) {
    const grid = document.getElementById('theme-grid');
    const backBtn = document.getElementById('btn-theme-back');
    if (!grid) return;
    backBtn.style.display = '';
    grid.innerHTML = '';
    (THEME_CATEGORIES[category] || []).forEach(name => {
        const t = THEMES[name];
        if (!t) return;
        const label = themeLabel(name);
        const wrap = document.createElement('div');
        wrap.className = 'theme-swatch' + (name === activeTheme ? ' active' : '');
        wrap.dataset.themeKey = name;
        wrap.title = label;
        wrap.innerHTML = `
            <div style="background:${t.bg}; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
                <div style="background:${t.bg_menu}; border-radius:4px; padding:6px 8px; border:1px solid ${t.border_solid};">
                    <div style="font-size:9px; font-weight:900; color:${t.accent}; letter-spacing:1px; text-transform:uppercase; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="theme-swatch-name">${label}</div>
                </div>
                <div style="display:flex; gap:5px; align-items:center;">
                    <div style="width:14px; height:14px; border-radius:50%; background:${t.accent}; flex-shrink:0;"></div>
                    <div style="font-size:9px; color:${t.text_sec};">Aa</div>
                    <div style="font-size:9px; color:${t.text_dim}; margin-left:auto;">Bb</div>
                </div>
            </div>`;
        wrap.addEventListener('click', () => {
            applyTheme(name);
            grid.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('active'));
            wrap.classList.add('active');
        });
        grid.appendChild(wrap);
    });
}

window.api.getSetting('ui_font').then(f => {   // re-resolve --ui-font regardless of load order vs applyTheme
    _uiFont = f || ''; applyUiFont();
    const sel = document.getElementById('ui-font-select'); if (sel) sel.value = _uiFont || 'Poppins';
});
// ── Zoom shortcuts ───────────────────────────────────────────────────────────
// ⚠️ The escape hatch for a UI that is too big to operate. The scale lives in the Control
// Panel, which is opened from the icon rail, so when the interface is too large for the
// window, the control that fixes it is exactly the one you cannot reach. That actually
// happened on a 1152x720 laptop screen.
//
// Ctrl +/-/0 works regardless of what is on screen or reachable, which is the whole point.
// Saved like any other choice, so it survives a restart.
const ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5];
let _zoomNow = 1.0;

// ⚠️ Shared by the startup re-derive and by setZoom below, so both stamp the same thing.
// Filled from the main process at startup, `window.screen` is the wrong source (it describes
// whichever display the window sits on, and on a fresh install that is Electron's unreliable
// idea of the primary); see 'ui-screen-info' in main.js.
//
// `layout` names the monitor SET, so dragging the window to another screen is no longer
// mistaken for another machine. The `window.screen` fallback keeps the old single-screen
// shape, which is also what pre-existing stamps were written in.
function setZoom(v) {
    _zoomNow = v;
    window.api.setZoomLevel(v);
    try { localStorage.setItem('clarity_ui_scale_cache_v2', String(v)); } catch {}
    window.api.setSetting('clarity_ui_scale', String(v));
    document.querySelectorAll('.ui-scale-btn').forEach(btn =>
        btn.classList.toggle('active', parseFloat(btn.getAttribute('data-val')) === v));
    if (typeof opToast === 'function') { opToast(`Interface scale: ${Math.round(v * 100)}%`); setTimeout(opToastHide, 1400); }
}

window.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.altKey) return;
    const i = ZOOM_STEPS.indexOf(_zoomNow);
    if (e.key === '-' || e.key === '_') {
        e.preventDefault(); setZoom(ZOOM_STEPS[Math.max(0, (i < 0 ? 2 : i) - 1)]);
    } else if (e.key === '+' || e.key === '=') {
        e.preventDefault(); setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 2 : i) + 1)]);
    } else if (e.key === '0') {
        e.preventDefault(); setZoom(1.0);
    }
});

// ── Compact chrome ───────────────────────────────────────────────────────────
// Under a tiling WM the titlebar is dead weight: you cannot drag a tiled window, and the
// compositor owns close/minimise/maximise. So the bar goes and what was useful in it moves
// into the icon rail.
//
// ⚠️ The controls are MOVED, not recreated. appendChild relocates a live node together with
// its event listeners, so nothing needs rebinding and there is never a second copy to keep in
// sync, which is what a "build a duplicate rail button" approach would have cost.
// Navigation belongs in the rail. It is a column of navigation already. The two pills are a
// different kind of thing: they are wide, branded and horizontal, and squeezed into a 48px
// column they looked like an afterthought. They go over the hero's top-right corner instead.
const RAIL_IDS = ['btn-titlebar-home', 'btn-titlebar-library', 'btn-titlebar-downloads'];
const PILL_IDS = ['support-cta', 'couch-cta'];

function applyCompactChrome(on) {
    const rail = document.getElementById('rail-chrome');
    const pills = document.getElementById('hero-pills');
    const bar  = document.getElementById('titlebar');
    const controls = bar?.querySelector('.titlebar-controls');
    if (!rail || !pills || !bar || !controls) return;

    document.documentElement.classList.toggle('compact-chrome', !!on);
    const move = (ids, target) => {
        for (const id of ids) {
            const el = document.getElementById(id);
            // The window controls themselves are in neither list and stay in the hidden bar:
            // they are the one thing a tiling compositor genuinely replaces.
            if (el && el.parentElement !== target) target.appendChild(el);
        }
    };
    move(RAIL_IDS,  on ? rail  : controls);
    move(PILL_IDS,  on ? pills : controls);
    if (on) placeHeroPills();
    // Mirrored for the pre-paint script in index.html, see the comment there. Written on
    // every call, so the cache cannot drift from what is actually on screen.
    try { localStorage.setItem('clarity_compact_chrome', on ? '1' : '0'); } catch {}
}

// ⚠️ Applied synchronously, right here, from the cache the pre-paint script also reads.
// Scripts block rendering, so this still runs before the first paint, which is the whole
// point: the buttons are relocated before the window is ever shown, instead of visibly
// rearranging themselves a couple of seconds later. The IPC round trip below still runs and
// corrects this if the stored setting disagrees.
//
// ⚠️ Must sit AFTER the const declarations above: applyCompactChrome reads RAIL_IDS/PILL_IDS,
// and a const is in its temporal dead zone until execution reaches it.
try { applyCompactChrome(localStorage.getItem('clarity_compact_chrome') === '1'); } catch {}

// ⚠️ The pills belong IN the hero, not floating over the window at a fixed offset. Fixed
// looked right until the gallery was scrolled: the hero moved away and the pills stayed,
// hovering over the game grid. Re-parenting them into the hero means they scroll with it and
// sit in its corner properly.
//
// Not every view has a hero, the list view and the split layout do not, so the container
// falls back to <body>, where the CSS switches it to a fixed corner. One node either way,
// which keeps the listeners intact.
function placeHeroPills() {
    const pills = document.getElementById('hero-pills');
    if (!pills || !document.documentElement.classList.contains('compact-chrome')) return;
    const activeView = document.querySelector('#main-content .view.active');
    const hero = activeView?.querySelector('.hero-display');
    const target = hero || document.body;
    if (pills.parentElement !== target) target.appendChild(pills);
}

// ── Responsive shell ─────────────────────────────────────────────────────────
// A tiling WM makes a narrow window ordinary rather than exceptional, half of a 1440px
// screen is 720px. Driven by the WINDOW's width via ResizeObserver rather than CSS media
// queries, because a media query reads the screen, and on a tiled desktop the two numbers
// have nothing to do with each other.
const NARROW_AT = 900;      // the filter row starts wrapping and the split list narrows
const VERY_NARROW_AT = 680; // the split list is no longer worth the space it costs

// Height matters as much as width here and for a different reason: the hero is a fixed 350px,
// which on a 680px-tall tile is half the window before a single cover is drawn.
const SHORT_AT = 820;

function applyWidthClasses(w, h) {
    // ⚠️ On documentElement, not body. The compact-chrome class has to be set by the inline
    // script in <head>, where document.body does not exist yet, and a compound selector like
    // `.narrow.compact-chrome` only matches when both classes sit on the SAME element. Keeping
    // every layout class on <html> is what makes that work.
    const r = document.documentElement.classList;
    r.toggle('narrow', w < NARROW_AT);
    r.toggle('very-narrow', w < VERY_NARROW_AT);
    if (typeof h === 'number') r.toggle('short', h < SHORT_AT);
}

try {
    // Observing documentElement rather than window.resize: it fires for the element actually
    // being laid out, which is what a compositor changes when it retiles around a new window.
    const ro = new ResizeObserver(entries => {
        for (const e of entries) applyWidthClasses(e.contentRect.width, e.contentRect.height);
    });
    ro.observe(document.documentElement);
    applyWidthClasses(document.documentElement.clientWidth, document.documentElement.clientHeight);
} catch {
    window.addEventListener('resize', () => applyWidthClasses(window.innerWidth, window.innerHeight));
    applyWidthClasses(window.innerWidth, window.innerHeight);
}

// ── The Omarchy card ─────────────────────────────────────────────────────────
// Everything Omarchy-specific in one Control Panel card. On any other host the card is
// REMOVED, not hidden, the Control Panel used to reset `display` on every .tools-section in three
// places, so an inline display:none lasts exactly until the panel is opened. That is the
// Mac-Native bug from 1.8.0, and the display picker above had it too.
async function initOmarchyCard() {
    const card = document.getElementById('omarchy-card');
    if (!card) return;

    let s = null;
    try { s = await window.api.omarchyStatus(); } catch {}
    if (!s || !s.detected) { card.remove(); return; }

    card.style.display = '';
    await renderOmarchyCard(s);
}

// Split out from init so the Re-check button can redraw from fresh data. Re-reading is the
// whole point: an install happens in a terminal the app does not own, so the app cannot know
// it finished, and telling someone to restart when a button could just look again is a poor
// trade. Everything here is derived from status, so a redraw is the only state update needed.
async function renderOmarchyCard(s) {
    const listEl   = document.getElementById('omarchy-tools-list');
    const btnAll   = document.getElementById('btn-omarchy-install');
    const statusEl = document.getElementById('omarchy-status');
    const steamBlk = document.getElementById('omarchy-steam-block');
    const recheck  = document.getElementById('btn-omarchy-recheck');
    if (!listEl) return;

    const runAndPrompt = async (fn, label) => {
        const r = await fn();
        statusEl.style.color = r?.ok ? 'var(--text_sec)' : '#ef5350';
        statusEl.textContent = r?.ok
            ? `${label} is running in a terminal, finish it there, then press Re-check.`
            : (r?.error || 'Could not open a terminal.');
        return r;
    };

    // Steam gets its own block: the library is built from it, and Omarchy's installer brings
    // the right graphics drivers with it, which ours would not.
    const steam = (s.installers || []).find(i => i.key === 'steam');
    if (steam && !steam.present) {
        steamBlk.style.display = '';
        document.getElementById('btn-omarchy-steam').onclick = () =>
            runAndPrompt(() => window.api.omarchyRunInstaller('steam'), 'Omarchy\'s Steam installer');
    } else if (steamBlk) {
        steamBlk.style.display = 'none';
    }

    // Required first, then what is merely missing, then what is already there.
    const rank = { true: 0, false: 1 };
    const rows = [
        ...(s.tools || []).map(t => ({ ...t, kind: 'tool' })),
        ...(s.installers || []).filter(i => i.key !== 'steam').map(i => ({ ...i, kind: 'installer', required: false })),
    ].sort((a, b) => (rank[!!a.required] - rank[!!b.required]) || (a.present - b.present));

    listEl.innerHTML = '';
    for (const r of rows) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:flex-start; gap:7px; font-size:11px; line-height:1.45;';
        const tier = r.required ? 'needed' : (r.extra ? 'extra' : 'optional');
        const info = document.createElement('span');
        info.style.cssText = 'flex:1; min-width:0;';
        info.innerHTML = `
            <b style="color:var(--text_main);">${r.label}</b>
            <span style="color:var(--text_dim);"> · ${r.present ? 'installed' : tier}</span>
            ${r.present ? '' : `<div style="color:var(--text_dim); margin-top:1px;">${r.why || ''}</div>`}`;

        const mark = document.createElement('span');
        mark.style.cssText = `color:${r.present ? '#66bb6a' : (r.required ? '#ef5350' : 'var(--text_dim)')}; font-weight:900; flex-shrink:0;`;
        mark.textContent = r.present ? '✓' : '✗';

        row.appendChild(mark);
        row.appendChild(info);

        // One button per missing item, so the optionals and extras are installable
        // individually rather than only as part of "everything the app needs".
        if (!r.present) {
            const b = document.createElement('button');
            b.textContent = 'Install';
            b.style.cssText = 'flex-shrink:0; font-size:10px; padding:3px 9px; letter-spacing:.5px;';
            b.onclick = () => runAndPrompt(
                () => r.kind === 'installer' ? window.api.omarchyRunInstaller(r.key)
                                             : window.api.omarchyInstallTools([r.key]),
                r.label);
            row.appendChild(b);
        }
        listEl.appendChild(row);
    }

    // The bulk button covers only what the app itself needs. Extras are listed and
    // individually installable, but installing things the suite never calls without being
    // asked is not ours to decide.
    const wanted = (s.tools || []).filter(t => !t.present && !t.extra).map(t => t.key);
    if (wanted.length) {
        btnAll.style.display = '';
        btnAll.textContent = `Install What's Missing (${wanted.length})`;
        btnAll.onclick = () => runAndPrompt(() => window.api.omarchyInstallTools(wanted), 'The install');
    } else {
        btnAll.style.display = 'none';
        if (!steam || steam.present) {
            statusEl.style.color = '#66bb6a';
            statusEl.textContent = 'Everything this app needs is installed.';
        }
    }

    // ── System tuning ────────────────────────────────────────────────────────
    // Reported, never changed. An entry whose value could not be read at all is shown as
    // unknown rather than guessed at, a missing /proc entry means the kernel does not have
    // that knob, which is not the same as it being wrong.
    const tuneBlock = document.getElementById('omarchy-tuning-block');
    const tuneList  = document.getElementById('omarchy-tuning-list');
    const tuneBtn   = document.getElementById('btn-omarchy-tuning');
    if (tuneBlock && tuneList && Array.isArray(s.tuning) && s.tuning.length) {
        tuneBlock.style.display = '';
        tuneList.innerHTML = '';
        for (const t of s.tuning) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; align-items:flex-start; gap:7px; font-size:11px; line-height:1.45;';
            const mark = t.ok === null ? '?' : (t.ok ? '✓' : '✗');
            const col  = t.ok === null ? 'var(--text_dim)' : (t.ok ? '#66bb6a' : '#e0a030');
            row.innerHTML = `
                <span style="color:${col}; font-weight:900; flex-shrink:0;">${mark}</span>
                <span style="flex:1; min-width:0;">
                    <b style="color:var(--text_main);">${t.label}</b>
                    <span style="color:var(--text_dim);"> · ${t.ok === null ? 'not readable on this kernel' : (t.ok ? 'already set' : `is ${t.value}, wants ${t.want}`)}</span>
                    ${t.ok === false ? `<div style="color:var(--text_dim); margin-top:1px;">${t.why || ''}</div>` : ''}
                </span>`;
            tuneList.appendChild(row);
        }
        const anyOff = s.tuning.some(t => t.ok === false);
        tuneBtn.style.display = anyOff && s.tuningCommand ? '' : 'none';
        if (anyOff) {
            tuneBtn.onclick = () => runAndPrompt(() => window.api.omarchyApplyTuning(), 'The tuning command');
        }
    } else if (tuneBlock) {
        tuneBlock.style.display = 'none';
    }

    if (recheck) {
        recheck.onclick = async () => {
            recheck.disabled = true;
            const prev = recheck.textContent;
            recheck.textContent = 'Checking…';
            statusEl.textContent = '';
            let fresh = null;
            try { fresh = await window.api.omarchyStatus(); } catch {}
            recheck.disabled = false;
            recheck.textContent = prev;
            if (fresh?.detected) await renderOmarchyCard(fresh);
        };
    }

    // Compact chrome. Default ON when Omarchy is detected. It is the right default for a
    // tiling desktop, but stored the moment it is toggled, so a deliberate choice sticks.
    const chromeBox = document.getElementById('omarchy-compact-chrome');
    if (chromeBox) {
        const saved = await window.api.getSetting('omarchy_compact_chrome').catch(() => null);
        const on = saved === null || saved === undefined ? true : saved === '1';
        chromeBox.checked = on;
        applyCompactChrome(on);
        chromeBox.onchange = () => {
            applyCompactChrome(chromeBox.checked);
            window.api.setSetting('omarchy_compact_chrome', chromeBox.checked ? '1' : '0');
        };
    }

    // How a game's window opens. Applied by the main process at startup, because Hyprland rules
    // cannot be withdrawn once set for a session, so this stores the choice and the hint says
    // when it takes effect rather than implying it is live.
    const gameWinCtl = document.getElementById('omarchy-game-window-control');
    if (gameWinCtl) {
        const HINTS = {
            fullscreen: 'The game gets the whole screen the moment it opens, which is what it wants and what stops it settling on some other monitor\u2019s resolution. A game that shows a small setup window first will have that fullscreened too \u2014 switch to Floating if one does.',
            float: 'The game opens at whatever size it asked for, centred, and you send it fullscreen yourself. Use this for a game whose launcher or configuration window needs to stay small.',
            tile: 'No rule at all: the window manager treats a game like any other window and fits it into the layout. Honest, and almost never what you want for a game.',
        };
        let saved = await window.api.getSetting('omarchy_game_window').catch(() => null);
        if (!HINTS[saved]) {
            // The old boolean, translated the same way the main process translates it.
            const legacy = await window.api.getSetting('omarchy_float_games').catch(() => null);
            saved = legacy === null || legacy === undefined ? 'fullscreen' : (legacy === '0' ? 'tile' : 'float');
        }
        const paint = (val) => {
            gameWinCtl.querySelectorAll('.omarchy-game-window-btn')
                .forEach(b => b.classList.toggle('active', b.dataset.val === val));
            const hint = document.getElementById('omarchy-game-window-hint');
            // ⚠️ "next time the app starts" was wrong and made this look broken: a rule set for
            // the session outlives the app, so a new one only wins from the next LOGIN, or
            // from the button below, which is why the button exists.
            if (hint) hint.innerHTML = `${HINTS[val]} <i>Takes effect at your next login, or press the button below.</i>`;
        };
        paint(saved);
        gameWinCtl.querySelectorAll('.omarchy-game-window-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                paint(btn.dataset.val);
                window.api.setSetting('omarchy_game_window', btn.dataset.val);
            }));

        // Without this the setting looks broken: switching from Fullscreen to Floating leaves
        // the fullscreen rule in place, still winning, and nothing appears to have happened.
        const applyBtn = document.getElementById('btn-omarchy-apply-rules');
        const applyStatus = document.getElementById('omarchy-apply-rules-status');
        applyBtn?.addEventListener('click', async () => {
            applyBtn.disabled = true;
            const was = applyStatus.innerHTML;
            applyStatus.style.color = 'var(--text_dim)';
            applyStatus.textContent = 'Reloading Hyprland\u2019s config\u2026';
            let res = null;
            try { res = await window.api.applyHyprlandRulesNow(); } catch (e) {}
            applyBtn.disabled = false;
            if (!res || !res.ok) {
                applyStatus.style.color = '#ef5350';
                applyStatus.textContent = (res && res.error) || 'Could not apply it.';
                setTimeout(() => { applyStatus.style.color = 'var(--text_dim)'; applyStatus.innerHTML = was; }, 6000);
                return;
            }
            applyStatus.style.color = '#66bb6a';
            applyStatus.textContent = `Live now \u2014 games open ${res.mode}. Try one.`;
            setTimeout(() => { applyStatus.style.color = 'var(--text_dim)'; applyStatus.innerHTML = was; }, 8000);
        });
    }

    const themeBtn = document.getElementById('btn-omarchy-theme');
    const label = document.getElementById('omarchy-theme-name');
    if (label) label.textContent = _omarchyThemeName || 'none found';

    if (themeBtn) {
        const themeAvailable = !!THEMES[OMARCHY_THEME_KEY];
        themeBtn.disabled = !themeAvailable;
        const sync = () => {
            const on = activeTheme === OMARCHY_THEME_KEY;
            themeBtn.textContent = omarchyButtonLabel(themeAvailable, on);
            themeBtn.classList.toggle('primary', on);
        };
        sync();
        themeBtn.onclick = () => {
            if (!THEMES[OMARCHY_THEME_KEY]) return;
            applyTheme(OMARCHY_THEME_KEY);
            sync();
        };
    }
}

// ⚠️ The call that kicks this off lives *below* the theme block, not here: it needs
// _omarchyThemeReady, and a const is in its temporal dead zone until execution reaches the
// declaration. Calling it here threw a ReferenceError before the window ever painted.

// ── The Omarchy theme ────────────────────────────────────────────────────────
// Not a copy of an Omarchy theme and not the nearest of ours: the user's actual palette,
// read from their current theme's colors.toml and mapped into our own shape. It appears as
// one entry named after whichever theme they are on, and it follows `omarchy theme set`.
//
// ⚠️ It has to be registered *before* the saved theme is read, or someone whose saved theme
// is OMARCHY silently falls back to the default on every start, THEMES[saved] would not
// exist yet. Hence the promise this chains from rather than a parallel fetch.
const OMARCHY_THEME_KEY = 'OMARCHY';
let _omarchyThemeName = '';

// What a theme is CALLED, which is not always what it is keyed by. The desktop entry is
// keyed OMARCHY so that the saved-theme setting survives `omarchy theme set`: the key has to
// stay put while the palette underneath it changes. Nobody chooses a theme called "OMARCHY"
// though. They choose the one their desktop is already wearing, so that is the name drawn on
// it. Falls back to the key on a desktop whose theme has no readable name.
function themeLabel(key) {
    return key === OMARCHY_THEME_KEY && _omarchyThemeName ? _omarchyThemeName : key;
}

// The words on the "wear my desktop palette" button. One function because two places set it:
// the card when it is built, and the live follow when `omarchy theme set` renames the palette
// underneath it. Naming the theme is the point: "Matching your Omarchy theme" reports a state
// you can already see, where "Wearing tokyo-night" reports WHICH, which is the thing you would
// otherwise go and look up. The generic wording stays for a desktop whose theme has no
// readable name.
function omarchyButtonLabel(themeAvailable, wearing) {
    const n = _omarchyThemeName;
    if (!themeAvailable) return 'No palette to read from this theme';
    if (wearing) return n ? `✓ Wearing ${n}` : '✓ Matching your Omarchy theme';
    return n ? `Wear ${n}` : 'Match My Omarchy Theme';
}

// Keep a swatch already on screen in step with `omarchy theme set`, without rebuilding the
// grid underneath someone's cursor.
function refreshOmarchySwatch() {
    const el = document.querySelector(`#theme-grid .theme-swatch[data-theme-key="${OMARCHY_THEME_KEY}"]`);
    const nameEl = el && el.querySelector('.theme-swatch-name');
    if (!el || !nameEl) return;
    nameEl.textContent = themeLabel(OMARCHY_THEME_KEY);
    el.title = themeLabel(OMARCHY_THEME_KEY);
}

// Applied alongside the palette rather than on its own: "match my desktop" means both, and
// tying it to the theme choice means it needs no toggle of its own. Cleared when the user
// picks any other theme, so a CN theme keeps CN's shape.
let _omarchyRadius = null;
function applyOmarchyGeometry(active) {
    const on = !!active && _omarchyRadius !== null;
    document.documentElement.classList.toggle('omarchy-geometry', on);
    if (on) document.documentElement.style.setProperty('--omarchy-radius', _omarchyRadius + 'px');
    else document.documentElement.style.removeProperty('--omarchy-radius');
    try {
        if (on) localStorage.setItem('clarity_omarchy_geometry', String(_omarchyRadius));
        else localStorage.removeItem('clarity_omarchy_geometry');
    } catch {}
}

function _registerOmarchyTheme(d) {
    if (!d || !d.available || !d.theme) return false;
    THEMES[OMARCHY_THEME_KEY] = d.theme;
    if (!THEME_CATEGORIES['Your Desktop']) {
        // Put it first: it is the one theme that is about *this* machine.
        const rebuilt = { 'Your Desktop': [OMARCHY_THEME_KEY], ...THEME_CATEGORIES };
        Object.keys(THEME_CATEGORIES).forEach(k => delete THEME_CATEGORIES[k]);
        Object.assign(THEME_CATEGORIES, rebuilt);
    }
    return true;
}

const _omarchyThemeReady = (window.api.omarchyTheme ? window.api.omarchyTheme() : Promise.resolve(null))
    .then(d => {
        const ok = _registerOmarchyTheme(d);
        if (ok) _omarchyThemeName = d.name || '';
        return ok;
    })
    .catch(() => false);

// Following a live theme switch. Only re-applies if the user is actually on the Omarchy
// theme, someone who picked CYBERPUNK deliberately does not want their desktop overriding
// it, so the entry is kept up to date but nothing is forced.
window.api.onOmarchyThemeChanged?.(d => {
    if (!_registerOmarchyTheme(d)) return;
    _omarchyThemeName = d.name || '';
    if (activeTheme === OMARCHY_THEME_KEY) applyTheme(OMARCHY_THEME_KEY);
    const label = document.getElementById('omarchy-theme-name');
    if (label) label.textContent = _omarchyThemeName || '-';
    refreshOmarchySwatch();
    // ⚠️ Relabelled in place rather than by re-running initOmarchyCard(): that function
    // removes the whole card when a status probe comes back empty, and renaming a palette is
    // no reason to risk losing it.
    const themeBtn = document.getElementById('btn-omarchy-theme');
    if (themeBtn) themeBtn.textContent = omarchyButtonLabel(!!THEMES[OMARCHY_THEME_KEY], activeTheme === OMARCHY_THEME_KEY);
});

_omarchyThemeReady.then(initOmarchyCard).catch(() => {});

// ⚠️ Applied at startup as well as in the card, or the layout would only correct itself once
// the user happened to open the Control Panel, a first run would show the titlebar it is
// meant to be hiding.
(async () => {
    try {
        const s = await window.api.omarchyStatus();
        if (!s || !s.detected) return;
        if (s.geometry && typeof s.geometry.rounding === 'number') {
            _omarchyRadius = s.geometry.rounding;
            applyOmarchyGeometry(activeTheme === OMARCHY_THEME_KEY);
        }
        const saved = await window.api.getSetting('omarchy_compact_chrome').catch(() => null);
        applyCompactChrome(saved === null || saved === undefined ? true : saved === '1');
    } catch {}
})();

_omarchyThemeReady.then(ok => window.api.getSetting('clarity_theme').then(saved => ({ ok, saved })))
    .then(({ ok, saved }) => {
    // On Omarchy, matching the desktop is the better default, but only as a *default*.
    // A saved theme is a deliberate choice and always wins, so this fires on a fresh
    // install and never overrides someone who went and picked CYBERPUNK on purpose.
    const saved2 = (!saved && ok && THEMES[OMARCHY_THEME_KEY]) ? OMARCHY_THEME_KEY : saved;
    applyTheme(saved2 && THEMES[saved2] ? saved2 : activeTheme);
    window.api.signalReady();
    loadPlaylists();
    loadGenres();
    return window.api.getSetting('welcome_shown');
}).then(shown => {
    if (!shown) { _welcomeModal.classList.add('active'); renderWelcomeDetection(); }
    // Auto-sync Installer installed status on every startup
    syncInstallerInstalled();
});

