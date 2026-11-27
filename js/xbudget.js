// Separate budgets, like a budget sheet of one person's own (one of the spreadsheet's sheets): one person's
// pay, what it goes on in groups (Home, Living, Food…), a doughnut of how much each group costs
// with what's left over, and each cost as a share of the pay. They sit beside the main budget
// (Budget → the switch at the top) and don't change Pots, Owings or the main budget.
//
// One shared document "xbudgets" (merged field by field, like everything else):
//   b:<bid>        → { name, owner: 'a'|'b'|'j', pay: { amt, freq } | null, note?, order }
//   g:<bid>:<gid>  → { name, emoji, slot: 0…7, order }   slot = the group's colour, kept for good
//   i:<bid>:<iid>  → { name, amt, freq, groups: { <gid>: share }, note?, order }
//     share: how much of it is in that group, 0…1 (public transport: half Work, half Travel).
//     Whatever isn't in a group counts as "Not in a group".

import * as store from './store.js';
import * as M from './model.js';
import { nameOf, ownerColor, ownerTag, bothSlots, pref, setPref } from './people.js';
import { esc, money, money0, r2, uid, toast, openSheet, closeSheet, confirmSheet, parseMoney } from './ui.js';

const DOC = 'xbudgets';
const SLOTS = 8;   // the chart's eight colours (app.css --viz-1…8); a ninth group is drawn grey
export const STARTER_GROUPS = [['Home', '🏠'], ['Living', '🛋️'], ['Work', '💼'], ['Food', '🍜'], ['Travel & car', '🚗'], ['Fun', '🎉'], ['Subscriptions', '📺'], ['Other', '✨']];
const GROUP_EMOJI = ['🏠', '🛋️', '💼', '🍜', '🚗', '🎉', '📺', '✨', '🩺', '🐾', '🎁', '✈️', '📚', '💪', '🧾', '💞'];
const PERIODS = [['w', 'Week'], ['f', 'Fortnight'], ['m', 'Month'], ['y', 'Year']];

const byOrder = (x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name));
const vals = () => M.vals(DOC);
export const xbudgets = () => Object.entries(vals()).filter(([k]) => k.startsWith('b:')).map(([k, b]) => ({ id: k.slice(2), ...b })).sort(byOrder);
export const xbudget = id => { const b = vals()['b:' + id]; return b ? { id, ...b } : null; };
const under = (bid, kind) => {
  const pre = `${kind}:${bid}:`;
  return Object.entries(vals()).filter(([k]) => k.startsWith(pre)).map(([k, x]) => ({ id: k.slice(pre.length), ...x })).sort(byOrder);
};
export const xgroups = bid => under(bid, 'g');
export const xitems = bid => under(bid, 'i');
const colorOf = g => (g && g.slot != null && g.slot < SLOTS ? `var(--viz-${g.slot + 1})` : 'var(--viz-more)');

/** Each group's yearly cost (an item split between groups counts its share in each), what isn't in a group, the pay and what's left. */
export function xtotals(bid) {
  const b = xbudget(bid), gs = xgroups(bid), sum = new Map(gs.map(g => [g.id, 0]));
  let loose = 0;
  for (const i of xitems(bid)) {
    const y = M.perYear(i.amt, i.freq);
    let inGroups = 0;
    for (const [gid, share] of Object.entries(i.groups || {})) if (sum.has(gid) && +share > 0) { sum.set(gid, sum.get(gid) + y * share); inGroups += +share; }
    if (inGroups < 0.999) loose += y * (1 - Math.min(1, inGroups));
  }
  const groups = gs.map(g => ({ ...g, yearly: r2(sum.get(g.id)) }));
  const costs = r2(groups.reduce((t, g) => t + g.yearly, 0) + loose);
  const pay = b?.pay && +b.pay.amt ? M.perYear(b.pay.amt, b.pay.freq) : null;
  return { b, groups, loose: r2(loose), pay, costs, left: pay == null ? null : r2(pay - costs) };
}

// ── The page ─────────────────────────────────────────────────────────────
/** Budget → a separate budget. `bookSeg` is the switch between the budgets (drawn at the top). */
export function renderXBudget(view, ctx, bid, bookSeg) {
  const t = xtotals(bid), b = t.b;
  const per = pref('budgetPer', 'm'), perWord = M.FREQ_LABEL[per], inP = y => M.fromYear(y, per);
  const base = t.pay || t.costs || 1, pct = y => { const p = (y / base) * 100; return p > 0 && p < 0.5 ? '<1%' : `${Math.round(p)}%`; };
  const items = xitems(bid), groups = t.groups;
  const gname = Object.fromEntries(groups.map(g => [g.id, g.name]));

  // Every part of the ring, in the groups' own order (that keeps each colour beside the same neighbours).
  const parts = groups.filter(g => g.yearly > 0.004).map(g => ({ id: g.id, name: g.name, emoji: g.emoji, yearly: g.yearly, color: colorOf(g) }));
  if (t.loose > 0.004) parts.push({ id: '_loose', name: 'Not in a group', emoji: '•', yearly: t.loose, color: 'var(--viz-more)' });
  const leftRow = t.left != null ? { id: '_left', name: t.left >= 0 ? 'Left over' : 'Over the pay', emoji: t.left >= 0 ? '🍯' : '⚠️', yearly: Math.abs(t.left), color: 'var(--viz-track)', left: true } : null;

  const ranked = [...parts].sort((x, z) => z.yearly - x.yearly);
  const meter = p => `<button class="xrow${p.left ? ' leftrow' : ''}" data-part="${esc(p.id)}" ${p.id === '_left' || p.id === '_loose' ? '' : `data-gfocus="${esc(p.id)}"`}>
      <span class="sw" style="background:${p.color}"></span><span class="nm">${esc(p.emoji || '')} ${esc(p.name)}</span>
      <span class="xbar"><i style="width:${Math.min(100, (p.yearly / base) * 100)}%;background:${p.color}"></i></span>
      <span class="num">${money(inP(p.yearly), { cents: false })}</span><span class="pct num">${pct(p.yearly)}</span></button>`;
  const head = `<section class="card pcol span xcard" style="--pc:${esc(ownerColor(b.owner))}"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>🍩 ${esc(b.name)}</h3>${ownerTag(b.owner)}<button class="iconbtn" data-xedit aria-label="Change this budget">✎</button></div>
      <div class="xtop">${doughnut(parts, t, inP, perWord)}
        <div class="xsum">
          <div class="r"><span>Pay</span><b>${t.pay == null ? '<button class="linkbtn" data-xedit>set it ›</button>' : `${money(inP(t.pay), { cents: false })}`}</b></div>
          <div class="r"><span>Everything it goes on</span><b>${money(inP(t.costs), { cents: false })}${t.pay ? ` <small class="muted">${pct(t.costs)}</small>` : ''}</b></div>
          <div class="r left"><span>${t.left == null || t.left >= 0 ? 'Left over' : 'Over the pay'}</span><b class="${t.left != null && t.left < 0 ? 'bad' : ''}">${t.left == null ? '—' : money(inP(Math.abs(t.left)), { cents: false })}${t.pay ? ` <small class="muted">${pct(Math.abs(t.left))}</small>` : ''}</b></div>
          <p class="hint">A ${esc(perWord)}${b.note ? ` · ${esc(b.note)}` : ''}. Tap a group to see what’s in it.</p>
        </div></div>
      <div class="xlist" role="list" aria-label="What it goes on, biggest first">${ranked.map(meter).join('')}${leftRow ? meter(leftRow) : ''}</div>
    </section>`;

  const itemRow = (i, gid) => {
    const inKnown = Object.entries(i.groups || {}).filter(([k]) => gname[k]).reduce((s, [, x]) => s + (+x || 0), 0);
    const y = M.perYear(i.amt, i.freq), share = gid === '_loose' ? Math.max(0, 1 - inKnown) : +(i.groups?.[gid] || 0);
    const mine = r2(y * share), others = Object.keys(i.groups || {}).filter(g => g !== gid && gname[g]);
    const meta = [
      i.freq !== per ? `<span>${money(i.amt)} a ${esc(M.FREQ_LABEL[i.freq])}</span>` : '',
      share < 0.999 ? `<span>${share === 0.5 ? 'half' : `${Math.round(share * 100)}%`} of ${money(inP(y))}</span>` : '',
      others.length ? `<span>· also in ${others.map(g => esc(gname[g])).join(', ')}</span>` : '',
    ].filter(Boolean).join('');
    return `<button class="bitem" data-xitem="${esc(i.id)}"><div class="grow"><div class="nm">${esc(i.name)}</div>${meta ? `<div class="meta">${meta}</div>` : ''}${i.note ? `<div class="tiny muted">${esc(i.note)}</div>` : ''}</div>
      <div class="amt">${money(inP(mine))}<small>${pct(mine)} of ${t.pay ? 'pay' : 'it all'}</small></div></button>`;
  };
  const groupCard = g => {
    const list = g.id === '_loose' ? items.filter(i => Object.entries(i.groups || {}).filter(([k]) => gname[k]).reduce((s, [, x]) => s + (+x || 0), 0) < 0.999)
      : items.filter(i => +(i.groups?.[g.id] || 0) > 0);
    return `<section class="card flat" id="xg-${esc(g.id)}"><div class="card-head"><h3><span class="sw" style="background:${g.id === '_loose' ? 'var(--viz-more)' : colorOf(g)}"></span> ${esc(g.emoji || '')} ${esc(g.name)}</h3>
        <span class="small num" style="font-weight:800">${money(inP(g.yearly))}<span class="muted">/${esc(perWord)}</span></span>
        ${g.id === '_loose' ? '' : `<button class="iconbtn" data-xgroup="${esc(g.id)}" aria-label="Edit group">✎</button>`}</div>
      ${list.length ? `<div class="bitems">${list.map(i => itemRow(i, g.id)).join('')}</div>` : '<p class="small muted">Nothing in this group yet.</p>'}
      ${g.id === '_loose' ? '' : `<button class="addline" data-xadd="${esc(g.id)}">＋ Add to ${esc(g.name)}</button>`}</section>`;
  };

  view.innerHTML = `${bookSeg}
    <div class="toprow"><div class="seg" role="group" aria-label="Show amounts per">${PERIODS.map(([k, l]) => `<button data-per="${k}" aria-pressed="${per === k}">${l}</button>`).join('')}</div>
      <div class="row-btns"><button class="btn sm ghost" data-xnewgroup>＋ Group</button><button class="btn sm" data-xadd="">＋ A cost</button></div></div>
    <div class="cols">${head}
      ${groups.map(groupCard).join('')}
      ${t.loose > 0.004 ? groupCard({ id: '_loose', name: 'Not in a group', emoji: '', yearly: t.loose }) : ''}
      ${!items.length ? '<div class="empty span">No costs yet. Add what the pay goes on with <b>＋ A cost</b>.</div>' : ''}
    </div>`;

  wireDoughnut(view, parts, t, inP, perWord);
  view.onclick = e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.book != null) { setPref('budgetBook', el.dataset.book); return ctx.render(); }
    if (el.hasAttribute('data-newbook')) return editXBudget(null, ctx);
    if (el.dataset.per) { setPref('budgetPer', el.dataset.per); return ctx.render(true); }
    if (el.hasAttribute('data-xedit')) return editXBudget(b, ctx);
    if (el.dataset.gfocus) { const c = view.querySelector('#xg-' + CSS.escape(el.dataset.gfocus)); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (el.dataset.xgroup) return editXGroup(bid, groups.find(g => g.id === el.dataset.xgroup), ctx);
    if (el.hasAttribute('data-xnewgroup')) return editXGroup(bid, null, ctx);
    if (el.dataset.xitem) return editXItem(bid, items.find(i => i.id === el.dataset.xitem), null, ctx);
    if (el.dataset.xadd != null) return editXItem(bid, null, el.dataset.xadd || null, ctx);
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
  return `<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(`Where the pay goes each ${perWord}: ${summary}${t.left != null ? `; ${t.left >= 0 ? 'left over' : 'over the pay'} ${money(inP(Math.abs(t.left)), { cents: false })}` : ''}`)}">
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
function nextSlot(bid) {
  const used = new Set(xgroups(bid).map(g => g.slot));
  for (let s = 0; s < SLOTS; s++) if (!used.has(s)) return s;
  return SLOTS;   // the grey one
}

/** A new budget (with the usual groups to start with), or this one's name, whose it is and the pay. */
export function editXBudget(b, ctx) {
  const isNew = !b, cur = b ? { ...b } : { id: uid(), name: '', owner: store.me(), pay: null, order: Date.now() / 1e13 };
  const el = openSheet(`<h3>${isNew ? 'A separate budget' : esc(cur.name)}</h3>
    ${isNew ? '<p class="muted small">One person’s own budget, apart from your shared one: their pay, what it goes on in groups, and a doughnut of where it goes.</p>' : ''}
    <label class="field"><span>Name</span><input class="inp" id="xb-name" value="${esc(cur.name)}" placeholder="e.g. My own budget" autocomplete="off"></label>
    <div class="field"><span>Whose</span><div class="seg wide" id="xb-who">${[...bothSlots(), 'j'].map(o => `<button type="button" data-who="${o}" aria-pressed="${o === cur.owner}">${o === 'j' ? 'Shared' : esc(nameOf(o))}</button>`).join('')}</div></div>
    <div class="fields2"><label class="field"><span>Pay (after tax)</span><input class="inp money" id="xb-pay" inputmode="decimal" placeholder="$0" value="${cur.pay?.amt != null ? esc(String(cur.pay.amt)) : ''}"></label>
      <label class="field"><span>Every</span><select class="inp" id="xb-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === (cur.pay?.freq || 'm') ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    ${isNew ? `<label class="toggle"><input type="checkbox" id="xb-starter" checked> Start with groups: ${STARTER_GROUPS.map(([n]) => esc(n)).join(', ')}</label>` : ''}
    <label class="field"><span>Note (optional)</span><input class="inp" id="xb-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#xb-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      if (!(await confirmSheet({ title: `Delete ${cur.name}?`, text: 'Its groups and costs go too. Nothing else changes.', yes: 'Delete', danger: true }))) return;
      const gone = { ['b:' + cur.id]: null };
      for (const k of Object.keys(vals())) if (k.startsWith(`g:${cur.id}:`) || k.startsWith(`i:${cur.id}:`)) gone[k] = null;
      store.setFields(DOC, gone);
      setPref('budgetBook', '');
      return ctx.render();
    }
    if (!e.target.closest('[data-save]')) return;
    const name = el.querySelector('#xb-name').value.trim();
    if (!name) return toast('Give it a name');
    const amt = parseMoney(el.querySelector('#xb-pay').value), note = el.querySelector('#xb-note').value.trim();
    const { id, ...rest } = cur;
    const fields = { ['b:' + id]: { ...rest, name, owner: el.querySelector('#xb-who [aria-pressed="true"]').dataset.who, pay: amt ? { amt, freq: el.querySelector('#xb-freq').value } : null, note: note || undefined } };
    if (isNew && el.querySelector('#xb-starter').checked) STARTER_GROUPS.forEach(([n, emoji], i) => { fields[`g:${id}:${uid()}${i}`] = { name: n, emoji, slot: i, order: i + 1 }; });
    store.setFields(DOC, fields);
    closeSheet();
    if (isNew) { setPref('budgetBook', id); toast(`${name} is ready`); }
    ctx.render(true);
  };
}

function editXGroup(bid, g, ctx) {
  const isNew = !g, cur = g ? { ...g } : { id: uid(), name: '', emoji: '🧾', slot: nextSlot(bid), order: Date.now() / 1e13 };
  const el = openSheet(`<h3>${isNew ? 'A new group' : 'Edit group'}</h3>
    <label class="field"><span>Name</span><input class="inp" id="xg-name" value="${esc(cur.name)}" placeholder="e.g. Health, Pets" autocomplete="off"></label>
    <div class="field"><span>Little picture</span><div class="chips" id="xg-emo">${GROUP_EMOJI.map(x => `<button type="button" class="chip" data-emo="${x}" aria-pressed="${x === cur.emoji}">${x}</button>`).join('')}</div></div>
    ${cur.slot >= SLOTS ? '<p class="hint">The doughnut has eight colours, all taken, so this group shows grey.</p>' : ''}
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete group</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const em = e.target.closest('[data-emo]');
    if (em) { el.querySelectorAll('#xg-emo [data-emo]').forEach(x => x.setAttribute('aria-pressed', String(x === em))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      const n = xitems(bid).filter(i => i.groups?.[cur.id]).length;
      if (!(await confirmSheet({ title: `Delete ${cur.name}?`, text: n ? `Its ${n} cost${n === 1 ? '' : 's'} stay, as “Not in a group” (or in their other group).` : '', yes: 'Delete', danger: true }))) return;
      const f = { [`g:${bid}:${cur.id}`]: null };
      xitems(bid).filter(i => i.groups?.[cur.id]).forEach(({ id, ...i }) => { const gs = { ...i.groups }; delete gs[cur.id]; f[`i:${bid}:${id}`] = { ...i, groups: gs }; });
      store.setFields(DOC, f);
      return ctx.render(true);
    }
    if (!e.target.closest('[data-save]')) return;
    const { id, ...rest } = cur;
    store.setField(DOC, `g:${bid}:${id}`, { ...rest, name: el.querySelector('#xg-name').value.trim() || 'Group', emoji: el.querySelector('#xg-emo [aria-pressed="true"]')?.dataset.emo || cur.emoji });
    closeSheet(); ctx.render(true);
  };
}

/** A cost: what it is, how much and how often, and its group (or split between two). */
function editXItem(bid, item, groupId, ctx) {
  const isNew = !item, groups = xgroups(bid);
  const cur = item ? JSON.parse(JSON.stringify(item)) : { id: uid(), name: '', amt: null, freq: 'm', groups: groupId ? { [groupId]: 1 } : {}, order: Date.now() / 1e13 };
  const gs = Object.entries(cur.groups || {}).filter(([k]) => groups.some(g => g.id === k)).sort((x, z) => z[1] - x[1]);
  const g1 = gs[0]?.[0] || groupId || '', g2 = gs[1]?.[0] || '', split = !!g2, share1 = gs[0] ? Math.round(gs[0][1] * 100) : 100;
  const gsel = (id, val, none) => `<select class="inp" id="${id}">${none ? `<option value="">${none}</option>` : ''}${groups.map(g => `<option value="${esc(g.id)}" ${g.id === val ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select>`;
  const el = openSheet(`<h3>${isNew ? 'A cost' : esc(cur.name)}</h3>
    <label class="field"><span>What it is</span><input class="inp" id="xi-name" value="${esc(cur.name)}" placeholder="e.g. Rent, Gym, Netflix" autocomplete="off"></label>
    <div class="fields2"><label class="field"><span>Amount</span><input class="inp money" id="xi-amt" inputmode="decimal" placeholder="$0.00" value="${cur.amt != null ? esc(String(cur.amt)) : ''}"></label>
      <label class="field"><span>Every</span><select class="inp" id="xi-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <label class="field"><span>Group</span>${gsel('xi-g1', g1, 'Not in a group')}</label>
    <label class="toggle"><input type="checkbox" id="xi-split" ${split ? 'checked' : ''}> Split it with another group (like public transport: half Work, half Travel)</label>
    <div class="fields2" id="xi-splitbox" ${split ? '' : 'hidden'}><label class="field"><span>And</span>${gsel('xi-g2', g2, 'Choose a group')}</label>
      <label class="field"><span>How much in the first group</span><input class="inp" id="xi-share" inputmode="numeric" value="${split ? share1 : 50}" aria-label="Percent in the first group"><span class="hint">% (the rest goes in the second)</span></label></div>
    <label class="field"><span>Note (optional)</span><input class="inp" id="xi-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  const $ = s => el.querySelector(s);
  $('#xi-split').addEventListener('change', () => { $('#xi-splitbox').hidden = !$('#xi-split').checked; });
  el.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      store.setField(DOC, `i:${bid}:${cur.id}`, null);
      toast('Deleted', { label: 'Undo', run: () => { const { id, ...rest } = item; store.setField(DOC, `i:${bid}:${id}`, rest); ctx.render(true); } });
      return ctx.render(true);
    }
    if (!e.target.closest('[data-save]')) return;
    const a = $('#xi-g1').value, b2 = $('#xi-split').checked ? $('#xi-g2').value : '';
    const groupsOut = {};
    if (a && b2 && b2 !== a) {
      const p = Math.min(100, Math.max(0, parseFloat($('#xi-share').value) || 50)) / 100;
      if (p > 0) groupsOut[a] = r2(p * 10000) / 10000;
      if (p < 1) groupsOut[b2] = r2((1 - p) * 10000) / 10000;
    } else if (a) groupsOut[a] = 1;
    const { id, ...rest } = cur;
    store.setField(DOC, `i:${bid}:${id}`, { ...rest, name: $('#xi-name').value.trim() || 'Untitled', amt: parseMoney($('#xi-amt').value) || 0, freq: $('#xi-freq').value, groups: groupsOut, note: $('#xi-note').value.trim() || undefined });
    closeSheet(); ctx.render(true);
  };
}
