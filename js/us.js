// The Us tab: the two of you, your space code, sync, the look, and the owings settings.

import * as store from './store.js';
import * as M from './model.js';
import { CONFIG, VERSION, APP, WEBSITE, canSync } from './config.js';
import { person, COLORS, nameOf } from './people.js';
import { esc, toast, copyText, openSheet, closeSheet, confirmSheet, uid } from './ui.js';
import { jointName } from './owings.js';
import { importSheet, importXBudgets, seedAvailable } from './importer.js';
import { mountFeedback } from './feedback.js';

const isNative = () => !!window.PotsNative;
const siteName = () => WEBSITE.replace(/^https?:\/\//, '').replace(/\/$/, '');
/** The website: open it (from the app; on the website you're on it already) or copy its link. */
const siteRow = () => `<div class="site-row"><p class="small">💻 ${isNative()
    ? `<b>On the website too:</b> <b class="site-addr">${esc(siteName())}</b>. Put in your space code there and it’s the same space, synced with the app both ways.`
    : `<b>The website:</b> <b class="site-addr">${esc(siteName())}</b>. The same space as the Android app, synced both ways.`}</p>
  <div class="row-btns">${isNative() ? `<a class="btn sm" href="${esc(WEBSITE)}" target="_blank" rel="noopener">🌐 Open the website ↗</a>` : ''}<button class="btn sm ghost" data-act="copysite">📋 Copy the link</button></div></div>`;

const themeNow = () => { try { return localStorage.getItem('pots:theme') || 'auto'; } catch (e) { return 'auto'; } };
function setTheme(t) {
  try { if (t === 'auto') localStorage.removeItem('pots:theme'); else localStorage.setItem('pots:theme', t); } catch (e) {}
  if (window.potsApplyLook) window.potsApplyLook();
}

export function renderUs(view, ctx) {
  ctx.topbar.set('Us');
  const s = store.getSession(), me = person(store.me()), them = person(store.partner()), st = store.getStats();
  const sync = store.getStatus().state;
  const cats = M.cats();
  view.innerHTML = `<div class="cols">
    <section class="card pcol" style="--pc:${esc(me.color)}"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>You two</h3></div>
      <div class="kv">
        <div><span class="k">You</span><button class="linkbtn" data-act="name" style="color:var(--ink);font-size:15px">${esc(me.name)} ✎</button></div>
        <div><span class="k">Your colour</span><div class="swatches">${COLORS.map(c => `<button class="sw" style="background:${c}" data-color="${c}" aria-pressed="${c === me.color}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
        <div><span class="k">Partner</span><span>${them.here ? `<b>${esc(them.name)}</b>` : '<span class="muted">Not here yet: send them the code below</span>'}</span></div>
      </div>
      <div class="field"><span>Your space code</span><div class="code">${esc(s.space)}</div>
        <span class="hint">The same code as in Human Being and your other apps. Keep it between the two of you.</span></div>
      <div class="row-btns"><button class="btn sm" data-act="copy">Copy the code</button>${canSync() ? '<button class="btn sm ghost" data-act="sync">Sync now</button>' : ''}</div>
    </section>
    <div class="stack">
    <section class="card flat">
      <div class="card-head"><h3>This phone</h3></div>
      <div class="kv">
        <div><span class="k">Version</span><span class="small">${APP} ${VERSION} · ${window.PotsNative ? 'Android app' : 'website'}</span></div>
        <div><span class="k">Sync</span><span class="small">${canSync() ? `${esc(sync)} · ${st.requests} requests · ${(st.down / 1024).toFixed(1)} KB down` : '<b>Only on this device for now</b>'}</span></div>
      </div>
      ${!canSync() ? `<p class="note-box small">Honey Pots doesn’t send anything to the database yet: that waits until the database keeps your rows private (see SUPABASE-SETUP.md). Until then everything stays on this device.</p>` : ''}
      <div class="field"><span>Look</span><div class="seg wide" role="group">${[['light', 'Meadow'], ['dark', 'Night hive'], ['auto', 'Auto']].map(([k, t]) => `<button data-theme-pick="${k}" aria-pressed="${themeNow() === k}">${t}</button>`).join('')}</div>
        <span class="hint">Auto follows your phone’s light or dark setting.</span></div>
      ${siteRow()}
    </section>
    <section class="card flat c-lav fb-card" id="fbCard"></section>
    <section class="card flat">
      <div class="card-head"><h3>Owings</h3></div>
      <label class="field"><span>Your joint account is called</span><input class="inp" id="us-joint" value="${esc(jointName())}" placeholder="Joint account" autocomplete="off"></label>
      <div class="field"><span>Kinds of purchase</span><div class="lines" id="us-cats">${cats.map(c => `<div class="catrow" data-cat="${esc(c.id)}"><input class="inp emo" data-cemo value="${esc(c.emoji)}" aria-label="Picture"><input class="inp" data-cname value="${esc(c.name)}" aria-label="Name"><button class="linkbtn" data-cdel="${esc(c.id)}" aria-label="Remove">✕</button></div>`).join('')}</div>
        <div class="row-btns"><button class="btn sm ghost" data-act="addcat">＋ Add a kind</button><button class="btn sm" data-act="savecats">Save kinds</button></div></div>
    </section>
    </div>
    ${CONFIG.isLocalHost ? `<section class="card flat c-peach" id="us-dev"><div class="card-head"><h3>${CONFIG.mock ? 'Test server' : 'On this computer'}</h3></div>
      ${CONFIG.mock ? '<p class="small muted">Only on the test server. Open <b>127.0.0.1</b> instead of localhost in a second tab to be your partner.</p>' : ''}
      <div class="row-btns" id="us-seed"><span class="small muted">Looking for the spreadsheet import…</span></div></section>` : ''}
    <section class="card flat"><button class="btn danger" data-act="signout">Sign out on this phone</button></section>
  </div>`;

  mountFeedback(view.querySelector('#fbCard'));
  if (CONFIG.isLocalHost) seedAvailable().then(seed => {
    const box = view.querySelector('#us-seed');
    if (!box) return;
    box.innerHTML = seed ? `<button class="btn sm" data-act="import">📥 Bring in the spreadsheet</button>${seed.xbudgets ? '<button class="btn sm ghost" data-act="importx">🍩 Bring in just the separate budget</button>' : ''}<span class="small muted">${esc(seed.summary || '')}</span>` : '<span class="small muted">No spreadsheet import found (Honey_Pots/private/honey-pots-seed.json).</span>';
  });

  view.onchange = e => {
    if (e.target.id === 'us-joint') { store.setField('settings', 'jointName', e.target.value.trim() || null); toast('Saved'); }
  };
  view.onclick = async e => {
    const tp = e.target.closest('[data-theme-pick]');
    if (tp) { setTheme(tp.dataset.themePick); return ctx.render(true); }
    const col = e.target.closest('[data-color]');
    if (col) { store.setFields('profile', { color: col.dataset.color }); return ctx.render(true); }
    const cd = e.target.closest('[data-cdel]');
    if (cd) { cd.closest('.catrow').remove(); return; }
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'copy') toast((await copyText(s.space)) ? 'Code copied' : 'Select the code to copy it');
    if (a === 'copysite') toast((await copyText(WEBSITE)) ? 'Website link copied' : `The website is ${siteName()}`);
    if (a === 'importx') return importXBudgets(ctx);
    if (a === 'sync') { await store.syncNow(); toast('Synced'); ctx.render(true); }
    if (a === 'name') return editName(ctx);
    if (a === 'addcat') {
      const row = document.createElement('div');
      row.className = 'catrow'; row.dataset.cat = uid();
      row.innerHTML = '<input class="inp emo" data-cemo value="✨" aria-label="Picture"><input class="inp" data-cname placeholder="Name" aria-label="Name"><button class="linkbtn" data-cdel aria-label="Remove">✕</button>';
      view.querySelector('#us-cats').appendChild(row);
      row.querySelector('[data-cname]').focus();
    }
    if (a === 'savecats') {
      const list = [...view.querySelectorAll('#us-cats .catrow')].map(r => ({ id: r.dataset.cat, emoji: r.querySelector('[data-cemo]').value.trim() || '•', name: r.querySelector('[data-cname]').value.trim() })).filter(c => c.name);
      M.setCats(list); toast('Kinds saved'); ctx.render(true);
    }
    if (a === 'import') return importSheet(ctx);
    if (a === 'signout') {
      if (!(await confirmSheet({ title: 'Sign out on this phone?', text: canSync() ? 'Everything stays safe in your space. Sign in again with the space code.' : '<b>Honey Pots isn’t syncing yet, so this deletes everything on this device.</b>', yes: 'Sign out', danger: true }))) return;
      await store.flush(); store.signOut(); location.reload();
    }
  };
}

function editName(ctx) {
  const el = openSheet(`<h3>What should we call you?</h3><form id="nm"><input class="inp" id="nm-in" value="${esc(nameOf(store.me()))}" autocomplete="given-name"></form>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  const save = () => { const v = el.querySelector('#nm-in').value.trim(); if (v) store.setFields('profile', { name: v }); closeSheet(); ctx.render(true); };
  el.querySelector('#nm').onsubmit = e => { e.preventDefault(); save(); };
  el.onclick = e => { if (e.target.closest('[data-close]')) closeSheet(); if (e.target.closest('[data-save]')) save(); };
}
