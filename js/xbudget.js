// The pie chart budget: each of you can have your own budget (your pay, what it goes on in groups,
// and a doughnut of where it goes), and a cost can be shared between you (half each, or not evenly).
// The switch at the top shows All (both budgets together), one of you (your own costs plus your
// share of the shared ones), or just the Shared costs. It sits beside the basic budget (Budget → the
// switch at the very top) and doesn't change Pots, Owings or the basic budget.
//
// One shared document "xbudgets" (merged field by field, like everything else):
//   b:<bid>        → { name, owner: 'a'|'b'|'j', pay: { amt, freq } | null, note?, order }
//   g:<bid>:<gid>  → { name, emoji, slot: 0…7, order }
//   i:<bid>:<iid>  → { name, amt, freq, groups: { <gid>: share }, who?: 'j', split?, note?, order }
//     share: how much of it is in that group, 0…1 (public transport: half Work, half Travel).
//     Whatever isn't in a group counts as "Not in a group".
//     who 'j': a cost the two of you share; split = the first person's (a's) part of it, 0…1 (half
//     each when there's none). Everything in a budget whose owner is 'j' is shared.
// Groups with the same name in different budgets are one group wherever budgets are put together, with
// one colour for good (--viz-1…8 by slot: the first budget's slot, a later name a free one, a ninth grey).

import * as store from './store.js';
import * as M from './model.js';
import { nameOf, ownerColor, ownerTag, bothSlots, pref, setPref, whoSeg } from './people.js';
import { esc, money, r2, uid, toast, openSheet, closeSheet, confirmSheet, parseMoney } from './ui.js';

const DOC = 'xbudgets';
const SLOTS = 8;   // the chart's eight colours (app.css --viz-1…8); a ninth group is drawn grey
export const STARTER_GROUPS = [['Home', '🏠'], ['Living', '🛋️'], ['Work', '💼'], ['Food', '🍜'], ['Travel & car', '🚗'], ['Fun', '🎉'], ['Subscriptions', '📺'], ['Other', '✨']];
const GROUP_EMOJI = ['🏠', '🛋️', '💼', '🍜', '🚗', '🎉', '📺', '✨', '🩺', '🐾', '🎁', '✈️', '📚', '💪', '🧾', '💞'];
const PERIODS = [['w', 'Week'], ['f', 'Fortnight'], ['m', 'Month'], ['y', 'Year']];

const byOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name));
const vals = () => M.vals(DOC);
export const xbudgets = () => Object.entries(vals()).filter(([k]) => k.startsWith('b:')).map(([k, b]) => ({ id: k.slice(2), ...b })).sort(byOrder);
export const xbudget = id => { const b = id && vals()['b:' + id]; return b ? { id, ...b } : null; };
const under = (bid, kind) => {
  const pre = `${kind}:${bid}:`;
  return Object.entries(vals()).filter(([k]) => k.startsWith(pre)).map(([k, x]) => ({ id: k.slice(pre.length), ...x })).sort(byOrder);
};
export const xgroups = bid => under(bid, 'g');
export const xitems = bid => under(bid, 'i');
const colorOf = g => (g && g.slot != null && g.slot < SLOTS ? `var(--viz-${g.slot + 1})` : 'var(--viz-more)');

const keyOf = n => String(n || '').trim().toLowerCase();
const isShared = (i, b) => i.who === 'j' || b.owner === 'j';
const splitOf = i => (i.split != null ? +i.split : 0.5);
const payOf = b => (b && b.pay && +b.pay.amt ? M.perYear(b.pay.amt, b.pay.freq) : 0);
export const budgetsOf = s => xbudgets().filter(b => b.owner === s);

/** A cost a year: all of it, and each of you's part (a shared cost by its split; your own is all yours). */
export function xshares(i, b) {
  const y = M.perYear(i.amt, i.freq);
  if (isShared(i, b)) { const a = r2(y * splitOf(i)); return { whole: y, a, b: r2(y - a), shared: true }; }
  return { whole: y, a: b.owner === 'a' ? y : 0, b: b.owner === 'b' ? y : 0, shared: false };
}

/** Every budget's groups, one per name: Map name → { key, name, emoji, slot, ids: ['<bid>:<gid>'], n }. */
export function xregistry() {
  const reg = new Map();
  let n = 0;
  for (const b of xbudgets()) for (const g of xgroups(b.id)) {
    const k = keyOf(g.name);
    if (!reg.has(k)) reg.set(k, { key: k, name: g.name, emoji: g.emoji, want: g.slot, slot: null, ids: [], n: n++ });
    reg.get(k).ids.push(`${b.id}:${g.id}`);
  }
  // Each name keeps its own colour when nobody before it has that one; the rest take a free one (a ninth is grey).
  const used = new Set(), list = [...reg.values()];
  for (const r of list) if (r.want != null && r.want < SLOTS && !used.has(r.want)) { r.slot = r.want; used.add(r.want); }
  for (const r of list) if (r.slot == null) { let s = 0; while (s < SLOTS && used.has(s)) s++; r.slot = s; if (s < SLOTS) used.add(s); }
  return reg;
}
const freeSlot = reg => { const used = new Set([...reg.values()].map(r => r.slot)); for (let s = 0; s < SLOTS; s++) if (!used.has(s)) return s; return SLOTS; };

/**
 * One view of the pie budget: 'all' (both budgets, every cost in full), 'a' / 'b' (that person's own
 * costs plus their share of the shared ones, against their pay) or 'j' (the shared costs in full).
 */
export function pieView(who) {
  const bs = xbudgets(), reg = xregistry(), gk = new Map();
  for (const r of reg.values()) r.ids.forEach(id => gk.set(id, r.key));
  const solo = who === 'a' || who === 'b', rows = [];
  for (const b of bs) for (const i of xitems(b.id)) {
    const sh = xshares(i, b);
    const inView = who === 'all' || (who === 'j' ? sh.shared : sh.shared || b.owner === who);
    if (!inView) continue;
    const part = who === 'all' || who === 'j' ? sh.whole : sh[who];
    const groups = Object.entries(i.groups || {}).map(([gid, s]) => [gk.get(`${b.id}:${gid}`), +s]).filter(([k, s]) => k && s > 0);
    rows.push({ i, b, sh, part: r2(part), groups, inG: Math.min(1, groups.reduce((t, [, s]) => t + s, 0)) });
  }
  const sum = new Map([...reg.keys()].map(k => [k, 0]));
  let loose = 0;
  for (const r of rows) {
    for (const [k, s] of r.groups) sum.set(k, sum.get(k) + r.part * s);
    if (r.inG < 0.999) loose += r.part * (1 - r.inG);
  }
  const groups = [...reg.values()].sort((x, z) => x.n - z.n).map(r => ({ ...r, yearly: r2(sum.get(r.key)) }));
  const costs = r2(groups.reduce((t, g) => t + g.yearly, 0) + loose);
  const payBs = who === 'j' ? [] : bs.filter(b => who === 'all' || b.owner === who);
  const pay = payBs.some(payOf) ? r2(payBs.reduce((t, b) => t + payOf(b), 0)) : null;
  const tot = f => r2(rows.filter(f).reduce((t, r) => t + r.part, 0));
  return {
    who, reg, rows, groups, loose: r2(loose), pay, costs, left: pay == null ? null : r2(pay - costs), payBs,
    own: solo ? budgetsOf(who) : [], ownPart: tot(r => !r.sh.shared), sharedPart: tot(r => r.sh.shared),
    split: Object.fromEntries(bothSlots().map(s => [s, r2(rows.filter(r => r.sh.shared).reduce((t, r) => t + r.sh[s], 0))])),
  };
}

/** Whose pie budget is on show (per phone): you, if you have one, else all of it. */
function pieWho() {
  const w = pref('pieWho', null);
  if (['all', 'a', 'b', 'j'].includes(w)) return w;
  return budgetsOf(store.me()).length ? store.me() : 'all';
}

// ── The page ─────────────────────────────────────────────────────────────
/** Budget → 🍩 Pie chart budget. `bookSeg` is the switch between the basic and the pie budget (drawn at the top). */
export function renderPie(view, ctx, bookSeg) {
  const bs = xbudgets(), who = pieWho(), solo = who === 'a' || who === 'b', me = store.me();
  const per = pref('budgetPer', 'm'), perWord = M.FREQ_LABEL[per], inP = y => M.fromYear(y, per);
  const v = pieView(who), reg = v.reg;
  // Where a new cost or group goes: the budget of the person on show, else yours, else the other one's.
  const home = (solo && v.own[0]) || budgetsOf(me)[0] || bs.find(b => b.owner !== 'j') || bs[0] || null;
  const newWho = solo ? (v.own.length ? who : 'j') : who === 'j' ? 'j' : budgetsOf(me).length ? me : 'j';
  const base = v.pay || v.costs || 1, pct = y => { const p = (y / base) * 100; return p > 0 && p < 0.5 ? '<1%' : `${Math.round(p)}%`; };
  const m = y => money(inP(y), { cents: false });

  // Every part of the ring, in the groups' own order (that keeps each colour beside the same neighbours).
  const parts = v.groups.filter(g => g.yearly > 0.004).map(g => ({ id: g.key, name: g.name, emoji: g.emoji, yearly: g.yearly, color: colorOf(g) }));
  if (v.loose > 0.004) parts.push({ id: '_loose', name: 'Not in a group', emoji: '•', yearly: v.loose, color: 'var(--viz-more)' });
  const leftRow = v.left != null ? { id: '_left', name: v.left >= 0 ? 'Left over' : 'Over the pay', emoji: v.left >= 0 ? '🍯' : '⚠️', yearly: Math.abs(v.left), color: 'var(--viz-track)', left: true } : null;
  const ranked = [...parts].sort((x, z) => z.yearly - x.yearly);
  const meter = p => `<button class="xrow${p.left ? ' leftrow' : ''}" data-part="${esc(p.id)}" ${p.id === '_left' ? '' : `data-gfocus="${esc(p.id)}"`}>
      <span class="sw" style="background:${p.color}"></span><span class="nm">${esc(p.emoji || '')} ${esc(p.name)}</span>
      <span class="xbar"><i style="width:${Math.min(100, (p.yearly / base) * 100)}%;background:${p.color}"></i></span>
      <span class="num">${m(p.yearly)}</span><span class="pct num">${pct(p.yearly)}</span></button>`;

  // The card at the top: the doughnut and where the money goes.
  const title = who === 'all' ? 'Both budgets together' : who === 'j' ? 'Shared costs' : v.own.length === 1 ? v.own[0].name : `${nameOf(who)}’s budget`;
  const payLine = () => {
    if (who === 'all') return `<div class="r"><span>Pay</span><b>${v.pay == null ? '—' : m(v.pay)}</b></div>
      ${v.payBs.length > 1 ? `<div class="r sub"><span>${v.payBs.map(b => `${esc(b.owner === 'j' ? b.name : nameOf(b.owner))} ${payOf(b) ? m(payOf(b)) : '—'}`).join(' · ')}</span><b></b></div>` : ''}`;
    if (!v.own.length) return '';
    return `<div class="r"><span>Pay</span><b>${v.pay == null ? `<button class="linkbtn" data-xedit="${esc(v.own[0].id)}">set it ›</button>` : `<button class="linkbtn" style="color:inherit;padding:0" data-xedit="${esc(v.own[0].id)}">${m(v.pay)} ✎</button>`}</b></div>`;
  };
  const sumRows = who === 'j'
    ? `<div class="r"><span>Shared costs</span><b>${m(v.costs)}</b></div>
       ${bothSlots().map(s => `<div class="r sub"><span>${esc(nameOf(s))} pays</span><b>${m(v.split[s])}</b></div>`).join('')}`
    : `${payLine()}
       ${v.sharedPart > 0.004 && v.ownPart > 0.004
        ? `<div class="r"><span>Own costs</span><b>${m(v.ownPart)}</b></div><div class="r"><span>${solo ? 'Share of shared costs' : 'Shared costs'}</span><b>${m(v.sharedPart)}</b></div>`
        : `<div class="r"><span>${v.sharedPart > 0.004 && solo ? 'Share of shared costs' : 'Everything it goes on'}</span><b>${m(v.costs)}${v.pay ? ` <small class="muted">${pct(v.costs)}</small>` : ''}</b></div>`}
       ${v.pay != null ? `<div class="r left"><span>${v.left >= 0 ? 'Left over' : 'Over the pay'}</span><b class="${v.left < 0 ? 'bad' : ''}">${m(Math.abs(v.left))} <small class="muted">${pct(Math.abs(v.left))}</small></b></div>` : ''}`;
  const hint = who === 'j' ? 'Costs you share, in full, with what each of you pays.'
    : who === 'all' ? 'Both of your budgets together: every cost in full, a shared one once.'
      : `${esc(nameOf(who))}’s own costs, plus ${esc(nameOf(who))}’s share of the shared ones.`;
  const cardCls = solo ? 'pcol' : who === 'j' ? 'c-mint' : 'c-honey', cardStyle = solo ? ` style="--pc:${esc(ownerColor(who))}"` : '';
  const makeBtn = s => `<button class="btn sm" data-xmake="${s}">＋ Make ${esc(nameOf(s))}’s budget</button>`;
  let head;
  if (!bs.length) {
    head = `<section class="card c-honey span"><span class="tape" aria-hidden="true"></span><div class="card-head"><h3>🍩 Pie chart budget</h3></div>
      <p class="small">Each of you can have one: your pay, what it goes on in groups, and a doughnut of where it goes. A cost you share (like health insurance) counts in both, half each or however you split it.</p>
      <div class="row-btns">${bothSlots().map(makeBtn).join('')}</div></section>`;
  } else if (solo && !v.own.length && !v.rows.length) {
    head = `<section class="card ${cardCls} span"${cardStyle}><span class="tape" aria-hidden="true"></span><div class="card-head"><h3>🍩 ${esc(nameOf(who))}’s budget</h3></div>
      <p class="small">${esc(nameOf(who))} doesn’t have a pie chart budget yet: pay, what it goes on in groups, and a doughnut of where it goes. Costs you share show in it too, at ${esc(nameOf(who))}’s share.</p>
      <div class="row-btns">${makeBtn(who)}</div></section>`;
  } else {
    head = `<section class="card ${cardCls} span xcard"${cardStyle}><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>🍩 ${esc(title)}</h3>${solo && v.own.length ? `<button class="iconbtn" data-xedit="${esc(v.own[0].id)}" aria-label="Change this budget">✎</button>` : ''}</div>
      <div class="xtop">${doughnut(parts, v, inP, perWord)}
        <div class="xsum">${sumRows}
          <p class="hint">Amounts per ${esc(perWord)}. ${hint} Tap a group to see what’s in it.${solo && v.own[0]?.note ? ` · ${esc(v.own[0].note)}` : ''}</p>
          ${solo && !v.own.length ? `<div class="row-btns">${makeBtn(who)}</div>` : ''}
        </div></div>
      ${ranked.length ? `<div class="xlist" role="list" aria-label="What it goes on, biggest first">${ranked.map(meter).join('')}${leftRow ? meter(leftRow) : ''}</div>` : ''}
    </section>`;
  }

  // Each group: its costs for whoever's on show.
  const rowsIn = k => v.rows.filter(r => (k === '_loose' ? r.inG < 0.999 : r.groups.some(([g]) => g === k)));
  const itemRow = (r, k) => {
    const gshare = k === '_loose' ? Math.max(0, 1 - r.inG) : r.groups.find(([g]) => g === k)?.[1] || 0;
    const amt = r2(r.part * gshare), others = r.groups.filter(([g]) => g !== k).map(([g]) => reg.get(g)?.name).filter(Boolean);
    const even = Math.abs(splitOf(r.i) - 0.5) <= 0.004;
    const whoBit = r.sh.shared
      ? `${ownerTag('j')}<span>${solo ? `${even ? 'half' : money(inP(r.part))} of ${money(inP(r.sh.whole))}` : bothSlots().map(s => `${esc(nameOf(s))} ${money(inP(r.sh[s]))}`).join(' · ')}</span>`
      : who === 'all' ? ownerTag(r.b.owner) : '';
    const meta = [whoBit,
      r.i.freq !== per ? `<span>${money(r.i.amt)} a ${esc(M.FREQ_LABEL[r.i.freq])}</span>` : '',
      gshare < 0.999 ? `<span>${gshare === 0.5 ? 'half' : `${Math.round(gshare * 100)}%`} here${others.length ? ` · the rest in ${others.map(esc).join(', ')}` : ''}</span>` : '',
    ].filter(Boolean).join('');
    return `<button class="bitem" data-xitem="${esc(r.b.id)}|${esc(r.i.id)}"><div class="grow"><div class="nm">${esc(r.i.name)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${r.i.note ? `<div class="tiny muted">${esc(r.i.note)}</div>` : ''}</div>
      <div class="amt">${money(inP(amt))}<small>${pct(amt)} of ${v.pay ? 'pay' : 'it all'}</small></div></button>`;
  };
  const ownKeys = new Set(v.own.flatMap(b => xgroups(b.id).map(g => keyOf(g.name))));
  const shown = v.groups.filter(g => g.yearly > 0.004 || rowsIn(g.key).length || who === 'all' || (solo && ownKeys.has(g.key)));
  const groupCard = g => {
    const list = rowsIn(g.key), loose = g.key === '_loose';
    return `<section class="card flat" data-gcard="${esc(g.key)}"><div class="card-head"><h3><span class="sw" style="background:${loose ? 'var(--viz-more)' : colorOf(g)}"></span> ${esc(g.emoji || '')} ${esc(g.name)}</h3>
        <span class="small num" style="font-weight:800">${money(inP(g.yearly))}<span class="muted">/${esc(perWord)}</span></span>
        ${loose ? '' : `<button class="iconbtn" data-xgroup="${esc(g.key)}" aria-label="Edit group">✎</button>`}</div>
      ${list.length ? `<div class="bitems">${list.map(r => itemRow(r, g.key)).join('')}</div>` : '<p class="small muted">Nothing in this group yet.</p>'}
      ${loose || !home ? '' : `<button class="addline" data-xadd="${esc(g.key)}">＋ Add to ${esc(g.name)}</button>`}</section>`;
  };

  view.innerHTML = `${bookSeg}
    ${bs.length ? whoSeg(who, 'xwho', 'Whose budget') : ''}
    ${bs.length ? `<div class="toprow"><div class="seg" role="group" aria-label="Show amounts per">${PERIODS.map(([k, l]) => `<button data-per="${k}" aria-pressed="${per === k}">${l}</button>`).join('')}</div>
      ${home ? '<div class="row-btns"><button class="btn sm ghost" data-xnewgroup>＋ Group</button><button class="btn sm" data-xadd="">＋ A cost</button></div>' : ''}</div>` : ''}
    <div class="cols">${head}
      ${bs.length && (v.rows.length || !solo || v.own.length) ? shown.map(groupCard).join('') : ''}
      ${v.loose > 0.004 ? groupCard({ key: '_loose', name: 'Not in a group', emoji: '', yearly: v.loose }) : ''}
      ${bs.length && !v.rows.length && (!solo || v.own.length) ? `<div class="empty span">${who === 'j' ? 'No shared costs yet. When you add a cost, choose <b>Shared</b> under Whose.' : 'No costs yet. Add what the pay goes on with <b>＋ A cost</b>.'}</div>` : ''}
    </div>`;

  wireDoughnut(view, parts, v, inP, perWord);
  view.onclick = e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.book != null) { setPref('budgetBook', el.dataset.book); return ctx.render(); }
    if (el.dataset.xwho) { setPref('pieWho', el.dataset.xwho); return ctx.render(); }
    if (el.dataset.per) { setPref('budgetPer', el.dataset.per); return ctx.render(true); }
    if (el.dataset.xedit) return editXBudget(xbudget(el.dataset.xedit), ctx);
    if (el.dataset.xmake) return editXBudget(null, ctx, { owner: el.dataset.xmake });
    if (el.dataset.gfocus) { const c = view.querySelector(`[data-gcard="${CSS.escape(el.dataset.gfocus)}"]`); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (el.dataset.xgroup) return editXGroup(el.dataset.xgroup, ctx);
    if (el.hasAttribute('data-xnewgroup')) return editXGroup(null, ctx, home);
    if (el.dataset.xitem) { const [bid, iid] = el.dataset.xitem.split('|'), b = xbudget(bid); return editXItem(xitems(bid).find(i => i.id === iid), b, {}, ctx); }
    if (el.dataset.xadd != null) return editXItem(null, home, { group: el.dataset.xadd || null, who: newWho }, ctx);
  };
}

// ── The doughnut ─────────────────────────────────────────────────────────
// The ring is the pay (or everything it goes on, when that's more): each group an arc, in the
// groups' order from the top, with a 2px gap between them; what's left over is the empty track.
// Touch or hover a part to see it in the middle.
const R = 52, SW = 18, C = 2 * Math.PI * R, GAP = 1.6;
function doughnut(parts, t, inP, perWord) {
  const whole = Math.max(t.pay || 0, t.costs) || 1;
  let at = 0;
  const arcs = parts.map((p, i) => {
    const len = (p.yearly / whole) * C, dash = Math.max(0, len - GAP);
    const s = `<circle class="arc" data-arc="${i}" cx="70" cy="70" r="${R}" stroke="${p.color}" stroke-width="${SW}" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}" tabindex="0"
      aria-label="${esc(`${p.name}: ${money(inP(p.yearly), { cents: false })} a ${perWord}, ${Math.round((p.yearly / (t.pay || t.costs || 1)) * 100)}%`)}"><title>${esc(`${p.name}: ${money(inP(p.yearly), { cents: false })} a ${perWord}`)}</title></circle>`;
    at += len;
    return s;
  }).join('');
  const summary = parts.map(p => `${p.name} ${money(inP(p.yearly), { cents: false })}`).join(', ');
  return `<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(`${t.pay ? 'Where the pay goes' : 'What it goes on'} each ${perWord}: ${summary}${t.left != null ? `; ${t.left >= 0 ? 'left over' : 'over the pay'} ${money(inP(Math.abs(t.left)), { cents: false })}` : ''}`)}">
      <circle class="track" cx="70" cy="70" r="${R}" stroke-width="${SW}"></circle>
      <g transform="rotate(-90 70 70)">${arcs}</g></svg>
    <div class="dmid" aria-hidden="true"><b id="dm-amt"></b><span id="dm-lbl"></span></div></div>`;
}
function wireDoughnut(view, parts, t, inP, perWord) {
  const amt = view.querySelector('#dm-amt'), lbl = view.querySelector('#dm-lbl');
  if (!amt) return;
  const base = t.pay || t.costs || 1;
  const rest = () => {
    view.querySelectorAll('.arc.on, .xrow.on').forEach(x => x.classList.remove('on'));
    view.querySelector('.donut')?.classList.remove('focus');
    if (t.left == null) { amt.textContent = money(inP(t.costs), { cents: false }); lbl.textContent = `a ${perWord} in all`; return; }
    amt.textContent = money(inP(Math.abs(t.left)), { cents: false });
    lbl.textContent = t.left >= 0 ? `left over a ${perWord}` : `over the pay a ${perWord}`;
  };
  const show = i => {
    const p = parts[i];
    if (!p) return rest();
    view.querySelectorAll('.arc.on, .xrow.on').forEach(x => x.classList.remove('on'));
    view.querySelector('.donut')?.classList.add('focus');
    view.querySelector(`.arc[data-arc="${i}"]`)?.classList.add('on');
    view.querySelector(`.xrow[data-part="${CSS.escape(p.id)}"]`)?.classList.add('on');
    amt.textContent = money(inP(p.yearly), { cents: false });
    lbl.textContent = `${p.name} · ${Math.round((p.yearly / base) * 100)}%`;
  };
  rest();
  view.querySelectorAll('.arc').forEach(a => {
    const i = +a.dataset.arc;
    a.addEventListener('pointerenter', () => show(i));
    a.addEventListener('focus', () => show(i));
    a.addEventListener('click', e => { e.stopPropagation(); show(i); });
    a.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') rest(); });
    a.addEventListener('blur', rest);
  });
  view.querySelectorAll('.xrow[data-part]').forEach(r => {
    const i = parts.findIndex(p => p.id === r.dataset.part);
    if (i < 0) return;
    r.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(i); });
    r.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') rest(); });
  });
}

// ── Editing ──────────────────────────────────────────────────────────────
/** A new budget for one of you (with the groups you already use), or this one's name, whose it is and the pay. */
export function editXBudget(b, ctx, { owner = null } = {}) {
  const isNew = !b, reg = xregistry();
  const own = owner || store.me();
  const cur = b ? { ...b } : { id: uid(), name: own === 'j' ? 'Shared budget' : `${nameOf(own)}’s budget`, owner: own, pay: null, order: Date.now() / 1e13 };
  // A new budget starts with the groups already in use (so the two of you line up), else the usual ones.
  const starters = reg.size ? [...reg.values()].sort((x, z) => x.n - z.n).map(r => [r.name, r.emoji, r.slot]) : STARTER_GROUPS.map(([n, e], i) => [n, e, i]);
  const el = openSheet(`<h3>${isNew ? `🍩 ${cur.owner === 'j' ? 'A shared budget' : `${esc(nameOf(cur.owner))}’s budget`}` : esc(cur.name)}</h3>
    ${isNew ? '<p class="muted small">Your pay, what it goes on in groups, and a doughnut of where it goes. A cost you share counts in both of your budgets, at each of your shares.</p>' : ''}
    <label class="field"><span>Name</span><input class="inp" id="xb-name" value="${esc(cur.name)}" placeholder="e.g. My own budget" autocomplete="off"></label>
    <div class="field"><span>Whose</span><div class="seg wide" id="xb-who">${[...bothSlots(), 'j'].map(o => `<button type="button" data-who="${o}" aria-pressed="${o === cur.owner}">${o === 'j' ? 'Shared' : esc(nameOf(o))}</button>`).join('')}</div></div>
    <div class="fields2"><label class="field"><span>Pay (after tax)</span><input class="inp money" id="xb-pay" inputmode="decimal" placeholder="$0" value="${cur.pay?.amt != null ? esc(String(cur.pay.amt)) : ''}"></label>
      <label class="field"><span>Every</span><select class="inp" id="xb-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === (cur.pay?.freq || 'm') ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${isNew ? `<label class="toggle"><input type="checkbox" id="xb-starter" checked> Start with the groups: ${starters.map(([n]) => esc(n)).join(', ')}</label>` : ''}
    <label class="field"><span>Note (optional)</span><input class="inp" id="xb-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#xb-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      if (!(await confirmSheet({ title: `Delete ${cur.name}?`, text: 'Its groups and costs go too (shared ones included). Nothing else changes.', yes: 'Delete', danger: true }))) return;
      const gone = { ['b:' + cur.id]: null };
      for (const k of Object.keys(vals())) if (k.startsWith(`g:${cur.id}:`) || k.startsWith(`i:${cur.id}:`)) gone[k] = null;
      store.setFields(DOC, gone);
      setPref('pieWho', 'all');
      return ctx.render();
    }
    if (!e.target.closest('[data-save]')) return;
    const name = el.querySelector('#xb-name').value.trim();
    if (!name) return toast('Give it a name');
    const amt = parseMoney(el.querySelector('#xb-pay').value), note = el.querySelector('#xb-note').value.trim();
    const { id, ...rest } = cur, whose = el.querySelector('#xb-who [aria-pressed="true"]').dataset.who;
    const fields = { ['b:' + id]: { ...rest, name, owner: whose, pay: amt ? { amt, freq: el.querySelector('#xb-freq').value } : null, note: note || undefined } };
    if (isNew && el.querySelector('#xb-starter').checked) starters.forEach(([n, emoji, slot], i) => { fields[`g:${id}:${uid()}${i}`] = { name: n, emoji, slot, order: i + 1 }; });
    store.setFields(DOC, fields);
    closeSheet();
    if (isNew) { setPref('budgetBook', 'pie'); setPref('pieWho', whose); toast(`${name} is ready`); }
    ctx.render(true);
  };
}

/** A group (the same name in every budget): its name and little picture, or a new one (into `home`). */
function editXGroup(key, ctx, home = null) {
  const reg = xregistry(), r = key ? reg.get(key) : null, isNew = !r;
  if (isNew && !home) return toast('Make a budget first');
  const cur = r ? { name: r.name, emoji: r.emoji, slot: r.slot } : { name: '', emoji: '🧾', slot: freeSlot(reg) };
  const el = openSheet(`<h3>${isNew ? 'A new group' : 'Edit group'}</h3>
    <label class="field"><span>Name</span><input class="inp" id="xg-name" value="${esc(cur.name)}" placeholder="e.g. Health, Pets" autocomplete="off"></label>
    <div class="field"><span>Little picture</span><div class="chips" id="xg-emo">${GROUP_EMOJI.map(x => `<button type="button" class="chip" data-emo="${x}" aria-pressed="${x === cur.emoji}">${x}</button>`).join('')}</div></div>
    ${cur.slot >= SLOTS ? '<p class="hint">The doughnut has eight colours, all taken, so this group shows grey.</p>' : ''}
    ${!isNew && r.ids.length > 1 ? '<p class="hint">It’s in both of your budgets: a new name or picture changes it in both.</p>' : ''}
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete group</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const em = e.target.closest('[data-emo]');
    if (em) { el.querySelectorAll('#xg-emo [data-emo]').forEach(x => x.setAttribute('aria-pressed', String(x === em))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      const f = {};
      let n = 0;
      for (const id of r.ids) {
        const [bid, gid] = id.split(':');
        f[`g:${bid}:${gid}`] = null;
        xitems(bid).filter(i => i.groups?.[gid]).forEach(({ id: iid, ...i }) => { const gs = { ...i.groups }; delete gs[gid]; f[`i:${bid}:${iid}`] = { ...i, groups: gs }; n++; });
      }
      if (!(await confirmSheet({ title: `Delete ${cur.name}?`, text: n ? `Its ${n} cost${n === 1 ? '' : 's'} stay, as “Not in a group” (or in their other group).` : '', yes: 'Delete', danger: true }))) return;
      store.setFields(DOC, f);
      return ctx.render(true);
    }
    if (!e.target.closest('[data-save]')) return;
    const name = el.querySelector('#xg-name').value.trim() || 'Group', emoji = el.querySelector('#xg-emo [aria-pressed="true"]')?.dataset.emo || cur.emoji;
    if (isNew) store.setField(DOC, `g:${home.id}:${uid()}`, { name, emoji, slot: cur.slot, order: Date.now() / 1e13 });
    else {
      const f = {};
      for (const id of r.ids) { const [bid, gid] = id.split(':'), g = xgroups(bid).find(x => x.id === gid); if (g) { const { id: _, ...rest } = g; f[`g:${bid}:${gid}`] = { ...rest, name, emoji }; } }
      store.setFields(DOC, f);
    }
    closeSheet(); ctx.render(true);
  };
}

/**
 * A cost: what it is, how much and how often, whose (one of you, or shared: half each or not evenly),
 * and its group (or split between two). `home` is the budget it's in (or goes into, for a new one).
 */
function editXItem(item, home, { group = null, who = null } = {}, ctx) {
  if (!home) return toast('Make a budget first');
  const isNew = !item, reg = xregistry(), regList = [...reg.values()].sort((x, z) => x.n - z.n);
  const people = bothSlots().filter(s => budgetsOf(s).length);
  const curWho = item ? (isShared(item, home) ? 'j' : home.owner) : who && (who === 'j' || people.includes(who)) ? who : 'j';
  const cur = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), name: '', amt: null, freq: 'm', groups: {}, order: Date.now() / 1e13 };
  const hg = xgroups(home.id);
  const keys = item ? Object.entries(item.groups || {}).map(([gid, s]) => [keyOf(hg.find(g => g.id === gid)?.name), +s]).filter(([k]) => k && reg.has(k)).sort((x, z) => z[1] - x[1]) : [];
  const g1 = keys[0]?.[0] || group || '', g2 = keys[1]?.[0] || '', two = !!g2, share1 = keys[0] ? Math.round(keys[0][1] * 100) : 100;
  const custom = curWho === 'j' && item && item.split != null && Math.abs(item.split - 0.5) > 0.004;
  const aPart = item && item.amt ? r2(item.amt * splitOf(item)) : '';
  const gsel = (id, val, none) => `<select class="inp" id="${id}">${none ? `<option value="">${none}</option>` : ''}${regList.map(g => `<option value="${esc(g.key)}" ${g.key === val ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select>`;
  const el = openSheet(`<h3>${isNew ? 'A cost' : esc(cur.name)}</h3>
    <label class="field"><span>What it is</span><input class="inp" id="xi-name" value="${esc(cur.name)}" placeholder="e.g. Rent, Gym, Health insurance" autocomplete="off"></label>
    <div class="fields2"><label class="field"><span>Amount</span><input class="inp money" id="xi-amt" inputmode="decimal" placeholder="$0.00" value="${cur.amt != null ? esc(String(cur.amt)) : ''}"></label>
      <label class="field"><span>Every</span><select class="inp" id="xi-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="field"><span>Whose</span><div class="seg wide" id="xi-who">${[...people, 'j'].map(o => `<button type="button" data-who="${o}" aria-pressed="${o === curWho}">${o === 'j' ? 'Shared' : esc(nameOf(o))}</button>`).join('')}</div>
      <span class="hint">Shared: it counts in both of your budgets, at each of your shares.</span></div>
    <div class="field" id="xi-sharebox" ${curWho === 'j' ? '' : 'hidden'}><span>Split</span>
      <div class="seg wide" id="xi-even"><button type="button" data-even="1" aria-pressed="${!custom}">Half each</button><button type="button" data-even="0" aria-pressed="${custom}">Not evenly</button></div>
      <div class="fields2" id="xi-custom" ${custom ? '' : 'hidden'}><label class="field"><span>${esc(nameOf('a'))} pays</span><input class="inp money" id="xi-a" inputmode="decimal" value="${custom ? esc(String(aPart)) : ''}"></label>
        <label class="field"><span>${esc(nameOf('b'))} pays</span><input class="inp money" id="xi-b" inputmode="decimal" value="${custom && cur.amt ? esc(String(r2(cur.amt - aPart))) : ''}"></label></div></div>
    <label class="field"><span>Group</span>${gsel('xi-g1', g1, 'Not in a group')}</label>
    <label class="toggle"><input type="checkbox" id="xi-split" ${two ? 'checked' : ''}> Split it with another group (like public transport: half Work, half Travel)</label>
    <div class="fields2" id="xi-splitbox" ${two ? '' : 'hidden'}><label class="field"><span>And</span>${gsel('xi-g2', g2, 'Choose a group')}</label>
      <label class="field"><span>How much in the first group</span><input class="inp" id="xi-share" inputmode="numeric" value="${two ? share1 : 50}" aria-label="Percent in the first group"><span class="hint">% (the rest goes in the second)</span></label></div>
    <label class="field"><span>Note (optional)</span><input class="inp" id="xi-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  const $ = s => el.querySelector(s);
  const whoNow = () => el.querySelector('#xi-who [aria-pressed="true"]')?.dataset.who || 'j';
  $('#xi-split').addEventListener('change', () => { $('#xi-splitbox').hidden = !$('#xi-split').checked; });
  // Typing the amount keeps an uneven split's two parts adding up.
  $('#xi-amt').addEventListener('input', () => {
    if ($('#xi-custom').hidden) return;
    const v = parseMoney($('#xi-amt').value) || 0, a = parseMoney($('#xi-a').value) || 0, b = parseMoney($('#xi-b').value) || 0;
    const s = a + b > 0 ? a / (a + b) : 0.5;
    $('#xi-a').value = r2(v * s) || ''; $('#xi-b').value = r2(v - r2(v * s)) || '';
  });
  el.onclick = async e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#xi-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); $('#xi-sharebox').hidden = w.dataset.who !== 'j'; return; }
    const ev = e.target.closest('[data-even]');
    if (ev) {
      el.querySelectorAll('#xi-even [data-even]').forEach(x => x.setAttribute('aria-pressed', String(x === ev)));
      $('#xi-custom').hidden = ev.dataset.even === '1';
      if (ev.dataset.even === '0' && !$('#xi-a').value) { const v = parseMoney($('#xi-amt').value) || 0; $('#xi-a').value = r2(v / 2) || ''; $('#xi-b').value = r2(v - r2(v / 2)) || ''; }
      return;
    }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      store.setField(DOC, `i:${home.id}:${cur.id}`, null);
      toast('Deleted', { label: 'Undo', run: () => { const { id, ...rest } = item; store.setField(DOC, `i:${home.id}:${id}`, rest); ctx.render(true); } });
      return ctx.render(true);
    }
    if (!e.target.closest('[data-save]')) return;
    const whose = whoNow();
    // Its budget: one of yours when it's yours; a shared cost stays where it is (a new one goes in `home`).
    const target = whose === 'j' ? home : home.owner === whose ? home : budgetsOf(whose)[0];
    if (!target) return toast(`${nameOf(whose)} needs a budget first`);
    const fields = {};
    const gidFor = k => {
      const g = xgroups(target.id).find(x => keyOf(x.name) === k);
      if (g) return g.id;
      const r = reg.get(k), id = uid();
      fields[`g:${target.id}:${id}`] = { name: r.name, emoji: r.emoji, slot: r.slot, order: Date.now() / 1e13 };
      return id;
    };
    const a = $('#xi-g1').value, b2 = $('#xi-split').checked ? $('#xi-g2').value : '';
    const groupsOut = {};
    if (a && b2 && b2 !== a) {
      const p = Math.min(100, Math.max(0, parseFloat($('#xi-share').value) || 50)) / 100;
      if (p > 0) groupsOut[gidFor(a)] = r2(p * 10000) / 10000;
      if (p < 1) groupsOut[gidFor(b2)] = r2((1 - p) * 10000) / 10000;
    } else if (a) groupsOut[gidFor(a)] = 1;
    let amt = parseMoney($('#xi-amt').value) || 0, split;
    if (whose === 'j' && el.querySelector('#xi-even [aria-pressed="true"]').dataset.even === '0') {
      const pa = parseMoney($('#xi-a').value) || 0, pb = parseMoney($('#xi-b').value) || 0;
      if (pa + pb > 0) { split = r2(pa / (pa + pb) * 10000) / 10000; if (!amt) amt = r2(pa + pb); }
    }
    const { id, who: _w, split: _s, ...rest } = cur;
    const out = { ...rest, name: $('#xi-name').value.trim() || 'Untitled', amt, freq: $('#xi-freq').value, groups: groupsOut, note: $('#xi-note').value.trim() || undefined };
    if (whose === 'j' && target.owner !== 'j') out.who = 'j';
    if (whose === 'j' && split != null && Math.abs(split - 0.5) > 0.004) out.split = split;
    if (!isNew && target.id !== home.id) fields[`i:${home.id}:${id}`] = null;
    fields[`i:${target.id}:${id}`] = out;
    store.setFields(DOC, fields);
    closeSheet(); ctx.render(true);
  };
}
