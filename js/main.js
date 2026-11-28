// Start-up, routing (#pots, #pot-<id>[@year], #owings[@YYYY-MM], #budget, #years, #plan-<year>, #us),
// the top bar, and redrawing when your partner's changes arrive.

import * as store from './store.js';
import * as M from './model.js';
import { CONFIG } from './config.js';
import { runOnboarding } from './onboarding.js';
import { person } from './people.js';
import { renderPots, renderPot, renderMonthPlan } from './pots.js';
import { renderOwings } from './owings.js';
import { renderBudget } from './budget.js';
import { renderYears, renderPlanner } from './years.js';
import { renderUs } from './us.js';
import { esc, closeSheet, sheetOpen, bigEmoji } from './ui.js';

const view = document.getElementById('view');
const topbarEl = document.getElementById('topbar');
const TABS = ['pots', 'owings', 'budget', 'years', 'us'];
let route = 'pots';

const BRAND = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="19" y="9" width="26" height="8" rx="3" fill="#F7A9C4"/><path d="M20 17h24l3.2 4.4c1.2 1.6 1.8 3.5 1.8 5.5V45a9 9 0 0 1-9 9H24a9 9 0 0 1-9-9V26.9c0-2 .6-3.9 1.8-5.5z" fill="var(--surface)" stroke="#E7C98A" stroke-width="2.4"/><path d="M16 33c5 3 9-2 16 0s11 3 16 0v12a9 9 0 0 1-9 9H24a9 9 0 0 1-9-9z" fill="#FFC23D"/><path d="M31.8 46.2c-2.6-2.1-4.3-3.5-4.3-5.2 0-1.7 1.3-2.9 2.8-2.9.7 0 1.3.4 1.5.9.2-.5.8-.9 1.5-.9 1.5 0 2.8 1.2 2.8 2.9 0 1.7-1.7 3.1-4.3 5.2z" fill="#fff" opacity=".9"/></svg>';

const topbar = {
  set(title, { back, backLabel } = {}) {
    const me = person(store.me()), them = person(store.partner());
    topbarEl.innerHTML = `${back ? `<button class="backbtn" data-go="${back}">‹ ${esc(backLabel || 'Back')}</button><h2>${esc(title)}</h2>`
      : `<span class="brand">${BRAND}<span>${esc(title)}</span></span><span class="spacer"></span>`}
      ${CONFIG.mock ? '<span class="mock-badge">test server</span>' : ''}
      <span class="sync" id="syncDot" data-state="${store.getStatus().state}" title="Sync: ${esc(store.getStatus().state)}"></span>
      <button class="duo" data-go="us" aria-label="You, your partner and sync">
        <span style="background:${esc(me.color)}">${esc(me.name[0])}</span>${them.here ? `<span style="background:${esc(them.color)}">${esc(them.name[0])}</span>` : ''}
      </button>`;
  },
};

const ctx = {
  topbar,
  go(r) { closeSheet(); route = r; try { history.replaceState(null, '', '#' + r); } catch (e) {} render(); },
  render: keep => render(keep),
};

function tabOf(r) {
  if (r.startsWith('pot-') || r.startsWith('months-')) return 'pots';
  if (r.startsWith('plan-')) return r.endsWith('@pots') ? 'pots' : 'years';
  if (r.startsWith('owings')) return 'owings';
  return TABS.includes(r) ? r : 'pots';
}

function render(keepScroll) {
  const st = view.scrollTop;
  const tab = tabOf(route);
  view.dataset.route = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', String(b.dataset.go === tab)));
  view.onclick = view.onchange = view.oninput = view.onsubmit = null;
  try {
    if (route.startsWith('pot-')) { if (!renderPot(view, ctx, route.slice(4))) { route = 'pots'; return render(); } }
    else if (route.startsWith('months-')) { if (!renderMonthPlan(view, ctx, route.slice(7))) { route = 'pots'; return render(); } }
    else if (route.startsWith('plan-')) { if (!renderPlanner(view, ctx, route.slice(5))) { route = 'years'; return render(); } }
    else if (tab === 'owings') renderOwings(view, ctx, route.split('@')[1]);
    else if (tab === 'budget') renderBudget(view, ctx);
    else if (tab === 'years') renderYears(view, ctx);
    else if (tab === 'us') renderUs(view, ctx);
    else renderPots(view, ctx);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty">Something went wrong drawing this page.<br><span class="small">${esc(e.message)}</span></div>`;
  }
  badges();
  view.scrollTop = keepScroll ? st : 0;
  setScrollbarRoom();
}

// How much room the page's scroll bar takes (none on a phone), so the top bar can line up with the page.
function setScrollbarRoom() {
  const w = Math.max(0, view.offsetWidth - view.clientWidth);
  document.documentElement.style.setProperty('--sbw', w + 'px');
}
// The scroll bar comes and goes as the page gets longer or shorter, or the window changes size.
if (window.ResizeObserver) new ResizeObserver(setScrollbarRoom).observe(view);

// On a computer, two fingers spreading on the touchpad zoom the whole tab in (a pinch, not the browser's zoom, so
// there's no zoom sign by the address): the page then runs past the window's edges, with the top bar out of sight.
// A page can't undo that itself, so while it lasts a note says how. Not on a phone or tablet, where pinching is normal.
function watchPinchZoom() {
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia('(pointer: fine)').matches) return;
  const keys = /Mac/i.test(navigator.platform || '') ? '⌘ 0' : 'Ctrl + 0';
  const note = document.createElement('div');
  note.className = 'zoomnote'; note.hidden = true; note.setAttribute('role', 'status');
  note.innerHTML = `<span>🔍 Zoomed in · <b>${keys}</b> fits the window</span><button type="button" aria-label="Hide this note">✕</button>`;
  document.body.appendChild(note);
  let shut = false;
  note.querySelector('button').onclick = () => { shut = true; place(); };
  function place() {
    const zoomed = vv.scale > 1.01;
    if (!zoomed) shut = false;                     // zoom in again later and it comes back
    note.hidden = !zoomed || shut;
    if (note.hidden) return;
    // Fixed things stay on the unzoomed page, so move it to the bottom middle of the part you can see, at its usual size.
    note.style.transform = `translate(${vv.offsetLeft + vv.width / 2}px, ${vv.offsetTop + vv.height - 18 / vv.scale}px) scale(${1 / vv.scale}) translate(-50%, -100%)`;
  }
  vv.addEventListener('resize', place);
  vv.addEventListener('scroll', place);
  place();
}

// The little count on Owings: purchases this month you still have to pay back.
function badges() {
  const b = document.getElementById('b-owings');
  if (!b) return;
  const ym = M.nowYM(), mine = store.me();
  const n = M.monthOwes(ym).pairs.filter(p => p.from === mine).reduce((t, p) => t + p.open.length, 0);
  b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); b.title = 'Still to pay back this month';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-go]');
  if (t && !t.closest('#ob')) { ctx.go(t.dataset.go); return; }
  // Tapping outside a sheet, or its Cancel / Close (even if the sheet's own buttons have a problem).
  if (e.target.id === 'sheet' || (e.target.closest('[data-close]') && e.target.closest('#sheet'))) closeSheet();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
window.addEventListener('hashchange', () => {
  const h = decodeURIComponent((location.hash || '').slice(1));
  if (!store.getSession() || !h || h === route) return;
  closeSheet(); route = h; render();
});

// The Android app's back button: close a sheet, then go back to Pots; false lets the app close.
window.potsBack = () => {
  if (sheetOpen()) { closeSheet(); return true; }
  if (!store.getSession()) return false;
  if (route.startsWith('pot-') || route.startsWith('months-')) { ctx.go('pots'); return true; }
  if (route.startsWith('plan-')) { ctx.go(route.endsWith('@pots') ? 'pots' : 'years'); return true; }
  if (route !== 'pots') { ctx.go('pots'); return true; }
  return false;
};
// The Android app is going into the background: send anything not yet saved.
window.potsFlush = () => { try { store.flush(); } catch (e) {} };

store.onStatus(st => { const d = document.getElementById('syncDot'); if (d) { d.dataset.state = st.state; d.title = 'Sync: ' + st.state; } });
// Your partner's changes show as they arrive (but not while you're typing or in a sheet).
store.on((doc, source) => {
  if (source !== 'remote') return;
  const typing = document.activeElement && document.activeElement.matches('input,textarea,select');
  if (!sheetOpen() && !typing) render(true);
});

function start() {
  document.getElementById('app').hidden = false;
  const h = decodeURIComponent((location.hash || '').slice(1));
  if (h) route = h;
  render();
  store.startSync().then(() => render(true));
}

bigEmoji();
watchPinchZoom();
if (store.getSession()) start();
else runOnboarding(start);
