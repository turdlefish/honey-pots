// Small shared helpers: escaping, money and dates, the bottom sheet and the toast.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b) => Math.abs(a - b) < 0.005;

/** $1,234 or $1,234.50 (cents only when there are some). opts.cents forces them, opts.sign shows +. */
export function money(n, { cents = null, sign = false } = {}) {
  n = r2(n);
  const show = cents === null ? !near(n, Math.round(n)) : cents;
  const s = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: show ? 2 : 0, maximumFractionDigits: show ? 2 : 0 });
  return (n < 0 ? '−$' : sign && n > 0 ? '+$' : '$') + s;
}
/** Whole dollars, for big round totals. */
export const money0 = n => money(Math.round(Number(n) || 0), { cents: false });

/** "$1,234.50", "1234.5", "1.2k" → 1234.5 (null when there's no number). */
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  let t = String(s ?? '').trim().toLowerCase().replace(/[$,\s]/g, '').replace('−', '-');
  if (!t) return null;
  let mult = 1;
  if (t.endsWith('k')) { mult = 1000; t = t.slice(0, -1); }
  const n = Number(t);
  return isFinite(n) ? r2(n * mult) : null;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Dates (always the phone's own day, never UTC) ────────────────────────
const pad = n => String(n).padStart(2, '0');
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const thisYM = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MON = MONTHS.map(m => m.slice(0, 3));
export const monthName = ym => MONTHS[+ym.slice(5, 7) - 1];
export const monShort = ym => MON[+ym.slice(5, 7) - 1];
export const ymLabel = ym => `${monthName(ym)} ${ym.slice(0, 4)}`;
export const dayOf = iso => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
export const weekday = iso => dayOf(iso).toLocaleDateString('en-AU', { weekday: 'short' });
export const niceDay = iso => dayOf(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

// ── Sheet ────────────────────────────────────────────────────────────────
const sheetEl = () => document.getElementById('sheet');
let onSheetClose = null;
export function openSheet(html, { onClose } = {}) {
  const s = sheetEl();
  s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  onSheetClose = onClose || null;
  const f = s.querySelector('[autofocus]') || s.querySelector('input:not([type=checkbox]):not([type=radio]),textarea');
  if (f && matchMedia('(pointer: fine)').matches) f.focus();
  return s.firstElementChild;
}
export function closeSheet() {
  const s = sheetEl();
  if (s.hidden) return;
  s.hidden = true; s.innerHTML = '';
  const f = onSheetClose; onSheetClose = null;
  if (f) f();
}
export const sheetOpen = () => !sheetEl().hidden;

// ── Toast (with an optional button, e.g. Undo) ───────────────────────────
let toastT;
export function toast(text, act) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(text)}</span>${act ? `<button>${esc(act.label)}</button>` : ''}`;
  el.hidden = false;
  if (act) el.querySelector('button').onclick = () => { el.hidden = true; act.run(); };
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, act ? 5000 : 2800);
}

export async function copyText(text) {
  // In the Android app, the phone's own clipboard (the web one isn't always allowed there).
  if (window.PotsNative && window.PotsNative.copy) { try { if (window.PotsNative.copy(String(text))) return true; } catch (e) {} }
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}

/** A sheet asking for one amount. Resolves { value, scope } or null. scopes: [[key, label], …] */
export function askAmount({ title, sub = '', value = null, scopes = null, allowClear = true, okLabel = 'Save' }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); closeSheet(); };
    const el = openSheet(`<div class="sheet-top"><h3>${esc(title)}</h3></div>
      ${sub ? `<p class="muted small">${sub}</p>` : ''}
      <form class="field" id="amtf"><input class="inp money" id="amt" inputmode="decimal" autocomplete="off" placeholder="$0" value="${value == null ? '' : esc(String(r2(value)))}" autofocus></form>
      ${scopes ? `<div class="seg wide" id="scope">${scopes.map(([k, l], i) => `<button type="button" data-scope="${k}" aria-pressed="${i === 0}">${esc(l)}</button>`).join('')}</div>` : ''}
      <p class="err" id="amterr" hidden></p>
      <div class="row-btns end">${allowClear && value != null ? '<button class="btn ghost sm" data-clear>Clear</button><span class="grow"></span>' : ''}<button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
      { onClose: () => { if (!done) { done = true; resolve(null); } } });
    const inp = el.querySelector('#amt');
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const scope = () => (el.querySelector('#scope [aria-pressed="true"]') || {}).dataset?.scope;
    const ok = () => {
      const v = parseMoney(inp.value);
      if (v == null && inp.value.trim()) { const e = el.querySelector('#amterr'); e.hidden = false; e.textContent = 'That doesn’t look like an amount.'; return; }
      finish({ value: v, scope: scope() });
    };
    el.onclick = e => {
      const s = e.target.closest('[data-scope]');
      if (s) { el.querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b === s))); return; }
      if (e.target.closest('[data-ok]')) ok();
      if (e.target.closest('[data-cancel]')) finish(null);
      if (e.target.closest('[data-clear]')) finish({ value: null, scope: scope(), cleared: true });
    };
    el.querySelector('#amtf').onsubmit = e => { e.preventDefault(); ok(); };
  });
}

/** A yes/no sheet. Resolves true/false. */
export function confirmSheet({ title, text = '', yes = 'Yes', no = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    let done = false;
    const el = openSheet(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
      <div class="row-btns end"><button class="btn ghost" data-no>${esc(no)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button></div>`,
      { onClose: () => { if (!done) { done = true; resolve(false); } } });
    el.onclick = e => {
      if (e.target.closest('[data-yes]')) { done = true; resolve(true); closeSheet(); }
      if (e.target.closest('[data-no]')) { done = true; resolve(false); closeSheet(); }
    };
  });
}
