// Bringing in the old spreadsheet. tools/sheet-to-seed.js turns it into
// Honey_Pots/private/honey-pots-seed.json, which only the dev server hands out
// (GET /__seed); the website never has it. The seed is written as if Adri were
// person "a" and Joe person "b"; if it's the other way round in your space,
// everything is swapped over as it comes in. Running it again just rewrites the
// same pots, months and purchases (they keep their ids), so nothing doubles up.

import * as store from './store.js';
import * as M from './model.js';
import { person, setPref } from './people.js';
import { esc, toast, openSheet, closeSheet } from './ui.js';

let seedP = null;
export function seedAvailable() {
  if (!seedP) seedP = fetch('/__seed', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(s => (s && !s.missing ? s : null)).catch(() => null);
  return seedP;
}

const SW = { a: 'b', b: 'a' };
const sw = s => SW[s] || s;
const swapMap = m => (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).map(([k, v]) => [sw(k), v])) : m);
const swapCov = c => (c === 'a' || c === 'b' ? sw(c) : c);

/** The same seed with persons a and b the other way round. */
function swapped(seed) {
  const out = JSON.parse(JSON.stringify(seed));
  for (const p of Object.values(out.pots)) {
    p.owner = sw(p.owner);
    if (p.goal) p.goal = swapMap(p.goal);
    if (p.start) p.start = swapMap(p.start);
  }
  for (const [y, f] of Object.entries(out.years)) {
    const nf = {};
    for (const [k, v] of Object.entries(f)) {
      if (k.startsWith('c:')) { const [c, id, s, ym] = k.split(':'); nf[`${c}:${id}:${sw(s)}:${ym}`] = v; }
      else if (k.startsWith('py:')) nf[k] = { ...v, target: swapMap(v.target), ...(v.carry ? { carry: swapMap(v.carry) } : {}) };
      else if (k.startsWith('w:')) nf[k] = swapMap(v);
      else nf[k] = v;
    }
    out.years[y] = nf;
  }
  out.totals = Object.fromEntries(Object.entries(out.totals).map(([k, v]) => { const [s, ym] = k.split(':'); return [`${sw(s)}:${ym}`, v]; }));
  const b = {};
  for (const [k, v] of Object.entries(out.budget)) {
    if (k.startsWith('inc:')) b['inc:' + sw(k.slice(4))] = v;
    else if (k.startsWith('i:')) b[k] = { ...v, who: sw(v.who), ...(v.split != null ? { split: Math.round((1 - v.split) * 10000) / 10000 } : {}) };
    else b[k] = v;
  }
  out.budget = b;
  for (const [ym, f] of Object.entries(out.owings)) {
    const nf = {};
    for (const [k, v] of Object.entries(f)) {
      if (k.startsWith('pd:')) { const [pd, id, s] = k.split(':'); nf[`${pd}:${id}:${sw(s)}`] = v; }
      else if (k.startsWith('e:')) nf[k] = { ...v, by: sw(v.by), cov: swapCov(v.cov), ...(v.lines ? { lines: v.lines.map(l => ({ ...l, cov: swapCov(l.cov) })) } : {}) };
      else nf[k] = v;
    }
    out.owings[ym] = nf;
  }
  if (out.xbudgets) out.xbudgets = swapX(out.xbudgets);
  out.people = { a: seed.people.b, b: seed.people.a };
  return out;
}

export async function importSheet(ctx) {
  const seed = await seedAvailable();
  if (!seed) return toast('No spreadsheet import found');
  const me = person(store.me()), meName = me.name.toLowerCase();
  // Who's who: guess from your name here, and ask.
  const guess = meName.startsWith(seed.people.b.toLowerCase()) ? 'b' : 'a';
  const el = openSheet(`<h3>Bring in the spreadsheet</h3>
    <p class="small">${esc(seed.summary)}</p>
    <div class="field"><span>Which one is you?</span><div class="seg wide" id="im-who">${['a', 'b'].map(k => `<button type="button" data-who="${k}" aria-pressed="${k === guess}">I’m ${esc(seed.people[k])}</button>`).join('')}</div></div>
    <details><summary class="small" style="font-weight:800;cursor:pointer">What it brought in, and what to check (${seed.notes.length})</summary>
      <ul class="small" style="padding-left:18px;margin:8px 0 0">${seed.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>
    <p class="hint">It adds to what’s here. Bringing it in again only updates the same pots, months and purchases.</p>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go-import>Bring it in</button></div>`);
  el.onclick = e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#im-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (!e.target.closest('[data-go-import]')) return;
    const iAm = el.querySelector('#im-who [aria-pressed="true"]').dataset.who;
    // The seed calls Adri "a". If you're the seed's iAm and your slot isn't that letter, swap.
    const s = iAm === store.me() ? seed : swapped(seed);
    const n = write(s);
    closeSheet();
    toast(`Brought in ${n} things from the spreadsheet`);
    ctx.go('pots');
  };
}

function write(s) {
  let n = 0;
  const put = (doc, fields) => { if (Object.keys(fields).length) { store.setFields(doc, fields); n += Object.keys(fields).length; } };
  put('pots', s.pots);
  for (const [y, f] of Object.entries(s.years)) put('y' + y, f);
  put('totals', s.totals);
  put('budget', s.budget);
  put('settings', s.settings);
  for (const [ym, f] of Object.entries(s.owings)) put('o' + ym, f);
  if (s.xbudgets) n += writeXBudgets(s.xbudgets);
  return n;
}

/**
 * The separate budgets from the spreadsheet (one person's own budget sheet), on their own: only what
 * isn't here yet, so bringing it in again never undoes a change you've made since.
 */
function writeXBudgets(fields) {
  const have = M.vals('xbudgets'), fresh = Object.fromEntries(Object.entries(fields).filter(([k]) => !(k in have)));
  if (Object.keys(fresh).length) store.setFields('xbudgets', fresh);
  return Object.keys(fresh).length;
}
const swapX = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k.startsWith('b:') ? { ...v, owner: sw(v.owner) } : v]));
export async function importXBudgets(ctx) {
  const seed = await seedAvailable();
  if (!seed?.xbudgets) return toast('No separate budget in the import');
  const names = Object.entries(seed.xbudgets).filter(([k]) => k.startsWith('b:')).map(([, b]) => b.name).join(', ');
  const me = person(store.me()).name.toLowerCase(), guess = me.startsWith(seed.people.b.toLowerCase()) ? 'b' : 'a';
  const el = openSheet(`<h3>Bring in ${esc(names)}</h3>
    <p class="small">From the spreadsheet’s separate budget sheet: the pay, every cost in its groups, and the doughnut. It only adds what isn’t here yet, and nothing else changes.</p>
    <div class="field"><span>Which one is you?</span><div class="seg wide" id="ix-who">${['a', 'b'].map(k => `<button type="button" data-who="${k}" aria-pressed="${k === guess}">I’m ${esc(seed.people[k])}</button>`).join('')}</div></div>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-go-import>Bring it in</button></div>`);
  el.onclick = e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#ix-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (!e.target.closest('[data-go-import]')) return;
    const iAm = el.querySelector('#ix-who [aria-pressed="true"]').dataset.who;
    const n = writeXBudgets(iAm === store.me() ? seed.xbudgets : swapX(seed.xbudgets));
    closeSheet();
    toast(n ? `Brought in ${n} things: Budget → 🍩 Pie chart budget` : 'It’s all here already');
    setPref('budgetBook', 'pie');
    ctx.go('budget');
  };
}
