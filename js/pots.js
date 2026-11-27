// The Pots tab (this month's money into pots, and every pot as a jar) and a pot's own page.

import * as store from './store.js';
import * as M from './model.js';
import { jar } from './jar.js';
import { person, bothSlots, ownerName, ownerColor, ownerTag, ownerPossessive, nameOf, pref, setPref, COLORS } from './people.js';
import { esc, money, money0, r2, uid, toast, openSheet, closeSheet, askAmount, confirmSheet, parseMoney, monthName, monShort, ymLabel, MON, isoDay } from './ui.js';

let month = null;            // the month shown on Pots (YYYY-MM)
let allYear = null;          // the year shown on "All pots"
const potYearShown = {};     // pot id → the year shown on its page

const EMOJIS = ['🍯', '🏡', '🛟', '🩺', '🧠', '💇', '🎨', '🎮', '👗', '🎟️', '🎁', '🏖️', '✈️', '⛽', '🚗', '🔧', '💞', '🧳', '🎄', '💪', '🧺', '🚚', '🧮', '🔑', '💍', '🎂', '☕', '🛁', '🍜', '🚆', '📈', '⚡', '🐾', '📚', '🦷', '🎵'];

const lidFor = o => ownerColor(o);
const jarOf = (pot, y, size) => {
  const st = M.potStats(pot, y), lv = M.jarLevels(st);
  return jar({ ...lv, size, emoji: pot.emoji || '🍯', lid: lidFor(pot.owner), reached: st.tot.reached });
};
/** The year to show a pot in: this year if it has one, else the nearest before (or after). */
export function defaultYear(pot) {
  const now = M.nowYear();
  if (pot.type !== 'year') return now;
  const ys = M.yearsOfPot(pot);
  if (!ys.length || ys.includes(now)) return now;
  const before = ys.filter(y => y < now);
  return before.length ? before[before.length - 1] : ys[0];
}
const yearTag = (pot, y) => (pot.type === 'year' ? (M.potYear(pot.id, y)?.label || String(y)) : 'Goal');
/** "⚠ short by Mar": the plan won't have enough by a date the pot's money is needed. */
export const shortTag = (pot, y) => {
  const c = M.firstShort(pot, y);
  return c ? `<span class="tag c-peach" title="${esc(money(c.shortTot))} short by ${esc(ymLabel(c.due.ym))}">⚠ short by ${esc(monShort(c.due.ym))}</span>` : '';
};

// ── The Pots tab ─────────────────────────────────────────────────────────
/** Opens Pots on a month (from the year's month-by-month check). */
export function showMonth(ym) { month = ym; setPref('potsView', 'month'); }

export function renderPots(view, ctx) {
  ctx.topbar.set('Pots');
  if (!month) month = M.nowYM();
  const mode = pref('potsView', 'month');
  if (allYear == null) allYear = M.nowYear();
  // Whose pots to show (per phone): everyone's, one of you (your own plus the shared ones), or only the shared ones.
  const w = pref('potsWho', 'all'), who = ['all', 'a', 'b', 'j'].includes(w) ? w : 'all';
  const whoSeg = `<div class="seg wide" role="group" aria-label="Whose pots">${[['all', 'All'], ...bothSlots().map(s => [s, nameOf(s)]), ['j', 'Shared']]
    .map(([k, l]) => `<button data-pwho="${k}" aria-pressed="${who === k}">${esc(l)}</button>`).join('')}</div>`;
  const planFor = who === 'a' || who === 'b' ? who : 'both', planYear = mode === 'all' ? allYear : M.yearOfYM(month);
  const head = `${whoSeg}<div class="toprow"><div class="seg" role="group" aria-label="Show">
      ${[['month', 'This month'], ['all', 'All pots'], ['accounts', 'Accounts']].map(([k, l]) => `<button data-mode="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
      <div class="row-btns">${mode === 'accounts' ? '<button class="btn sm ghost" data-act="new-acct">＋ Account</button>'
        : `<button class="btn sm" data-plangrid="${planFor}" data-py="${planYear}">📅 Plan by month</button><button class="btn sm ghost" data-act="new-pot">＋ New pot</button>`}</div></div>`;
  view.innerHTML = head + (mode === 'accounts' ? accountsView(who) : featured() + (mode === 'month' ? monthView(who) : allView(who)));

  view.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pwho) { setPref('potsWho', t.dataset.pwho); return ctx.render(); }
    if (t.dataset.mode) { setPref('potsView', t.dataset.mode); return ctx.render(); }
    if (t.dataset.recordout) return recordFromAccount(t.dataset.recordout, 'out', ctx);
    if (t.dataset.recordin) return recordFromAccount(t.dataset.recordin, 'in', ctx);
    if (t.dataset.acctin || t.dataset.acctout) { const acc = M.accounts().find(a => a.id === (t.dataset.acctin || t.dataset.acctout)), ps = acc.pots.map(M.getPot).filter(Boolean); return moneyMove(null, null, t.dataset.acctin ? 'in' : 'out', ctx, { pots: ps, acct: acc, ym: month }); }
    if (t.dataset.hist) return editHistory(t.dataset.hist, ctx);
    if (t.dataset.allhist) return historySheet(t.dataset.allhist, ctx);
    if (t.dataset.m) { month = t.dataset.m === '0' ? M.nowYM() : M.addMonths(month, +t.dataset.m); return ctx.render(true); }
    if (t.dataset.ay) { allYear = +t.dataset.ay; return ctx.render(true); }
    if (t.dataset.edityear) return ctx.go(`plan-${t.dataset.edityear}@pots`);
    if (t.dataset.plangrid) return ctx.go(`months-${t.dataset.plangrid}-${t.dataset.py || M.yearOfYM(month)}`);
    if (t.dataset.pot) return ctx.go('pot-' + t.dataset.pot + (t.dataset.year ? '@' + t.dataset.year : ''));
    if (t.dataset.done) {
      const [potId, y, slot, ym] = t.dataset.done.split('|');
      const c = M.cellsOf(potId, +y)[slot][ym] || {};
      M.setCell(potId, +y, slot, ym, { done: !c.done });
      return ctx.render(true);
    }
    if (t.dataset.cell) return editCell(t.dataset.cell, ctx);
    if (t.dataset.total) return editTotal(t.dataset.total, month, ctx);
    if (t.dataset.alldone) {
      const slot = t.dataset.alldone, lines = M.monthLines(slot, month).filter(l => !l.cell.done && M.cellPlan(l.cell) > 0);
      const byYear = {};
      lines.forEach(l => { (byYear[l.year] = byYear[l.year] || {})[l.key] = { ...l.cell, done: true }; });
      Object.entries(byYear).forEach(([y, f]) => M.setYearFields(+y, f));
      toast(`${lines.length} marked done`, { label: 'Undo', run: () => { Object.entries(byYear).forEach(([y, f]) => M.setYearFields(+y, Object.fromEntries(Object.keys(f).map(k => [k, lines.find(l => l.key === k).cell])))); ctx.render(true); } });
      return ctx.render(true);
    }
    if (t.dataset.addto) return addToMonth(t.dataset.addto, month, ctx);
    if (t.dataset.act === 'new-pot') return newPot(ctx, { year: mode === 'all' ? allYear : M.nowYear() });
    if (t.dataset.act === 'archived') return archivedSheet(ctx);
    if (t.dataset.act === 'new-acct') return editAccount(null, ctx);
    if (t.dataset.acct) return editAccount(M.accounts().find(a => a.id === t.dataset.acct), ctx);
    if (t.dataset.interest) return editAccountMonth(t.dataset.interest, month, 'interest', ctx);
    if (t.dataset.balance) return editAccountMonth(t.dataset.balance, month, 'balance', ctx);
  };
}

/** Pots kept apart (like the house deposit): what's in so far and who put it in, at the top of Pots. */
function featured() {
  return M.allPots().filter(p => p.separate).map(p => {
    const life = M.lifetime(p), slots = M.slotsOf(p), balance = r2(life.tot.put + life.tot.extra - life.tot.used);
    const y = defaultYear(p), st = M.potStats(p, y);
    const goal = p.type === 'goal' ? p.goal || {} : st.py?.target || {};
    const goalTot = slots.every(s => goal[s] != null) ? slots.reduce((t, s) => t + goal[s], 0) : null;
    return `<button class="card featured c-honey" data-pot="${p.id}" data-year="${y}"><span class="tape" aria-hidden="true"></span>
      <div class="pothead">${jarOf(p, y, 62)}<div class="grow">
        <div class="eyebrow">Kept apart from savings</div>
        <div class="ftitle">${esc(p.name)}</div>
        <div class="bigamt">${money0(balance)}<small>${goalTot ? `of ${money0(goalTot)}` : 'saved so far'}</small></div>
        ${life.tot.extra ? `<div class="tiny muted">${money0(life.tot.put - life.tot.used)} through the pot + ${money0(life.tot.extra)} in your own accounts</div>` : ''}</div></div>
      ${whoPut(p, life, goal)}</button>`;
  }).join('');
}

/** A two-colour bar and each person's share of what's gone into a shared pot (own-account money included). */
export function whoPut(p, life = M.lifetime(p), goal = {}) {
  const slots = M.slotsOf(p);
  if (slots.length < 2) return '';
  const mine = s => (life.per[s].put || 0) + (life.per[s].extra || 0);
  const tot = slots.reduce((t, s) => t + mine(s), 0);
  const pct = s => (tot ? Math.round(mine(s) / tot * 100) : 0);
  return `<div class="whoput"><div class="splitbar">${slots.map(s => `<i style="width:${tot ? (mine(s) / tot) * 100 : 50}%;background:${esc(ownerColor(s))}"></i>`).join('')}</div>
    <div class="whorows">${slots.map(s => `<div><span class="dot" style="background:${esc(ownerColor(s))}"></span><b>${esc(nameOf(s))}</b>
      <span class="num">${money0(mine(s))}</span><span class="muted">${pct(s)}%</span>${goal[s] != null ? `<span class="muted small">of ${money0(goal[s])}</span>` : ''}
      ${life.per[s].extra ? `<span class="muted tiny">(${money0(life.per[s].extra)} in own account)</span>` : ''}</div>`).join('')}</div>
    ${life.tot.used ? `<div class="tiny muted">${money0(life.tot.used)} of it has been used.</div>` : ''}</div>`;
}

// ── Savings accounts ─────────────────────────────────────────────────────
function accountsView(who = 'all') {
  const now = M.nowYM(), list = M.accounts().filter(a => who === 'all' || a.owner === who);
  const inAny = new Set(list.flatMap(a => a.pots));
  const loose = M.allPots().filter(p => !inAny.has(p.id));
  const card = a => {
    const st = M.accountStats(a, month), mo = M.accountMonth(a.id, month);
    const diff = st.diff;
    return `<section class="card ${a.owner === 'j' ? 'c-honey' : 'pcol'}"${a.owner !== 'j' ? ` style="--pc:${esc(ownerColor(a.owner))}"` : ''}><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>🏦 ${esc(a.name)}</h3>${ownerTag(a.owner, a.owner === 'j' ? 'Both of us' : nameOf(a.owner))}<button class="iconbtn" data-acct="${a.id}" aria-label="Edit account">✎</button></div>
      <div class="bigamt">${money(st.total)}<small>in it, by the app</small></div>
      <div class="hint">Pots ${money(st.inPots)}${st.interest.all ? ` + interest ${money(st.interest.all)}` : ''}${st.outside ? ` ${st.outside < 0 ? '−' : '+'} ${money(Math.abs(st.outside))} outside the pots` : ''}${a.note ? ` · ${esc(a.note)}` : ''}</div>
      ${st.perPot.length ? `<div class="chips">${st.perPot.map(x => `<button class="chip" data-pot="${x.pot.id}">${esc(x.pot.emoji || '🍯')} ${esc(x.pot.name)} <span class="muted">${money0(x.now)}</span></button>`).join('')}</div>`
        : '<p class="small muted">No pots ticked yet. Tap ✎ to choose which pots live here.</p>'}
      <div class="kv">
        <div><span class="k">Interest in ${esc(monthName(month))}</span>${mo.interest != null ? `<button class="amtbtn" data-interest="${a.id}"><b>${money(mo.interest, { cents: true })}</b><span class="pen">✎</span></button>` : `<button class="btn sm" data-interest="${a.id}">＋ Add it</button>`}</div>
        <div><span class="k">Interest so far in ${esc(month.slice(0, 4))}</span><b class="num">${money(st.interest.year, { cents: true })}</b></div>
        <div><span class="k">What the bank says <span class="tiny">(optional)</span></span>${mo.balance != null ? `<button class="amtbtn" data-balance="${a.id}"><b>${money(mo.balance, { cents: true })}</b><span class="pen">✎</span></button>` : `<button class="linkbtn" data-balance="${a.id}">＋ Add the balance</button>`}</div>
      </div>
      ${diff != null ? `<div class="sumline ${Math.abs(diff) < 1 ? 'ok' : diff > 0 ? 'short' : 'over'}">${Math.abs(diff) < 1 ? '✓ The bank matches the app' : diff > 0
        ? `The bank has ${money(diff)} more than the app (${esc(ymLabel(st.bank.ym))})` : `The bank has ${money(-diff)} less than the app: something taken out isn’t recorded yet?`}</div>` : ''}
      ${diff != null && Math.abs(diff) >= 1 ? `<div class="row-btns">${diff < 0 ? `<button class="btn sm" data-recordout="${a.id}">− Record money taken out</button>`
        : `<button class="btn sm ghost" data-recordin="${a.id}">＋ Record money put in</button>`}</div>` : ''}
      <hr class="divider"><div class="eyebrow">Money in &amp; out by hand</div>
      ${histRows(a, M.accountHistory(a).slice(0, 4))}
      <div class="row-btns"><button class="btn sm" data-acctin="${a.id}">＋ Put money in</button><button class="btn sm" data-acctout="${a.id}">− Take money out</button>
        ${M.accountHistory(a).length > 4 ? `<button class="linkbtn" data-allhist="${a.id}">See all ${M.accountHistory(a).length} ›</button>` : ''}</div>
    </section>`;
  };
  return `<div class="stepper"><button class="iconbtn" data-m="-1" aria-label="Month before">‹</button>
      <button class="label" data-m="0">${esc(ymLabel(month))}<span class="tiny">${month === now ? 'this month' : month < now ? 'gone by' : 'coming up'}</span></button>
      <button class="iconbtn" data-m="1" aria-label="Month after">›</button></div>
    ${list.length ? `<div class="cols">${list.map(card).join('')}</div>` : `<div class="empty">Add your bank savings accounts, tick which pots live in each, and note the interest each month.<br><button class="btn sm" data-act="new-acct" style="margin-top:10px">＋ Add a savings account</button></div>`}
    ${list.length && loose.length ? `<details class="hint"><summary>${loose.length} pot${loose.length === 1 ? ' isn’t' : 's aren’t'} in an account yet</summary>${loose.map(p => esc(p.name)).join(', ')}. Tap ✎ on an account to add them.</details>` : ''}
    <p class="hint">“By the app” is what should be there: this year’s money in each yearly pot (and anything brought over), everything in a goal, less what was used, plus interest and anything put in or taken out of the account outside the pots.</p>`;
}

function editAccount(acc, ctx) {
  const isNew = !acc, cur = acc ? { ...acc, pots: [...acc.pots] } : { id: uid(), name: '', owner: store.me(), pots: [], order: Date.now() / 1e13 };
  const others = Object.fromEntries(M.accounts().filter(a => a.id !== cur.id).flatMap(a => a.pots.map(p => [p, a.name])));
  const group = (o, label) => {
    const ps = M.allPots().filter(p => p.owner === o);
    return ps.length ? `<div class="eyebrow" style="margin-top:6px">${esc(label)}</div>${ps.map(p => `<label class="toggle potpick"><input type="checkbox" data-pp="${p.id}" ${cur.pots.includes(p.id) ? 'checked' : ''}>
      ${esc(p.emoji || '🍯')} ${esc(p.name)}${others[p.id] ? ` <span class="tiny faint">(now in ${esc(others[p.id])})</span>` : ''}</label>`).join('')}` : '';
  };
  const el = openSheet(`<h3>${isNew ? 'A savings account' : esc(cur.name)}</h3>
    <label class="field"><span>Name</span><input class="inp" id="ac-name" value="${esc(cur.name)}" placeholder="e.g. ING Savings, Up Saver" autocomplete="off"><span class="hint">Just a name, no account numbers needed.</span></label>
    <div class="field"><span>Whose</span><div class="seg wide" id="ac-owner">${[...bothSlots(), 'j'].map(o => `<button type="button" data-owner="${o}" aria-pressed="${o === cur.owner}">${o === 'j' ? 'Both of us' : esc(nameOf(o))}</button>`).join('')}</div></div>
    <div class="field"><span>Pots that live in it</span><div class="potlist">${group(store.me(), `${nameOf(store.me())}’s`)}${group(store.partner(), `${nameOf(store.partner())}’s`)}${group('j', 'Ours')}</div></div>
    <label class="field"><span>Note (optional)</span><input class="inp" id="ac-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const o = e.target.closest('[data-owner]');
    if (o) { el.querySelectorAll('#ac-owner [data-owner]').forEach(x => x.setAttribute('aria-pressed', String(x === o))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      if (await confirmSheet({ title: `Delete ${cur.name}?`, text: 'Its interest notes go too. The pots stay as they are.', yes: 'Delete', danger: true })) { M.deleteAccount(cur.id); ctx.render(true); }
      return;
    }
    if (!e.target.closest('[data-save]')) return;
    const name = el.querySelector('#ac-name').value.trim();
    if (!name) return toast('Give the account a name');
    M.saveAccount({ ...cur, name, owner: el.querySelector('#ac-owner [aria-pressed="true"]').dataset.owner,
      pots: [...el.querySelectorAll('[data-pp]:checked')].map(i => i.dataset.pp), note: el.querySelector('#ac-note').value.trim() || undefined });
    closeSheet(); ctx.render(true);
  };
}

/** An account's dated money in and out: its own entries and its pots'. Tap one to change it. */
function histRows(acc, list) {
  if (!list.length) return '<p class="small muted">Nothing yet. Add past deposits or withdrawals with their dates: into a pot, or just the account (like an opening balance).</p>';
  const when = x => esc(x.date ? new Date(x.date + 'T12:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ymLabel(x.ym));
  return `<div class="uses">${list.map(x => `<button class="urow plainrow" data-hist="${acc.id}|${x.kind}|${esc(x.id)}">
      <span class="tag ${x.dir === 'in' ? 'c-mint' : 'plain'}">${x.dir === 'in' ? '＋ in' : '− out'}</span>
      <div class="grow"><b>${esc(x.note || (x.dir === 'in' ? 'Put in' : 'Taken out'))}</b><div class="tiny muted">${when(x)} · ${x.potName ? `${esc(x.potName)}` : 'not in a pot'}</div></div>
      <b class="num ${x.dir === 'in' ? 'good' : ''}">${x.dir === 'in' ? '+' : '−'}${money(x.amt)}</b></button>`).join('')}</div>`;
}
function historySheet(id, ctx) {
  const acc = M.accounts().find(a => a.id === id);
  const el = openSheet(`<h3>🏦 ${esc(acc.name)}: money in &amp; out</h3>${histRows(acc, M.accountHistory(acc))}<div class="row-btns end"><button class="btn ghost" data-close>Close</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const h = e.target.closest('[data-hist]');
    if (h) { closeSheet(); editHistory(h.dataset.hist, ctx); }
  };
}
function editHistory(key, ctx) {
  const [id, kind, eid] = key.split('|'), acc = M.accounts().find(a => a.id === id);
  const x = M.accountHistory(acc).find(h => h.kind === kind && h.id === eid);
  if (!x) return;
  const pots = acc.pots.map(M.getPot).filter(Boolean);
  if (x.kind === 'account') return moneyMove(null, null, x.dir, ctx, { pots, acct: acc, entry: x });
  const pot = M.getPot(x.potId);
  moneyMove(pot, x.py, x.dir, ctx, { pots, acct: acc, entry: x });
}

/** The bank and the pots don't match: record the difference as money taken out of (or put into) one of the account's pots. */
function recordFromAccount(id, kind, ctx) {
  const acc = M.accounts().find(a => a.id === id), st = M.accountStats(acc, month);
  const pots = st.pots, diff = Math.abs(st.diff || 0);
  moneyMove(pots[0] || null, null, kind, ctx, { pots, amt: diff, ym: month, acct });
}

async function editAccountMonth(id, ym, what, ctx) {
  const acc = M.accounts().find(a => a.id === id), cur = M.accountMonth(id, ym);
  const r = await askAmount({
    title: what === 'interest' ? `Interest in ${ymLabel(ym)}` : `${acc.name}: the bank’s balance`,
    sub: what === 'interest' ? `What ${esc(acc.name)} earned in ${esc(monthName(ym))} (it’s on the statement or in the banking app).` : `What the bank shows for ${esc(acc.name)}, around the end of ${esc(monthName(ym))}. It’s only to compare with the pots.`,
    value: cur[what] ?? null,
  });
  if (!r) return;
  M.setAccountMonth(id, ym, { [what]: r.cleared ? null : r.value });
  ctx.render(true);
}

function monthView(who = 'all') {
  const now = M.nowYM();
  const sub = month === now ? 'this month' : month < now ? 'gone by' : 'coming up';
  return `<div class="stepper"><button class="iconbtn" data-m="-1" aria-label="Month before">‹</button>
      <button class="label" data-m="0">${esc(ymLabel(month))}<span class="tiny">${sub}</span></button>
      <button class="iconbtn" data-m="1" aria-label="Month after">›</button></div>
    <div class="cols">${bothSlots().filter(s => who === 'all' || who === 'j' || who === s).map(s => monthCard(s, who === 'j')).join('')}</div>`;
}

function monthCard(slot, sharedOnly = false) {
  const p = person(slot), sum = M.monthSummary(slot, month), mine = slot === store.me();
  const tot = sum.total;
  const totLine = tot.amt == null
    ? `<button class="btn sm" data-total="${slot}">Set how much ${mine ? 'you put' : esc(p.name) + ' puts'} into savings</button>`
    : `<div><button class="amtbtn bigamt" data-total="${slot}">${money(tot.amt)}<span class="pen">✎</span></button><small>into savings in ${esc(monthName(month))}</small></div>
       ${!tot.own ? `<div class="hint">The same as ${esc(ymLabel(tot.from))}. Tap the amount to change it.</div>` : ''}`;
  const row = l => {
    const plan = M.cellPlan(l.cell), done = !!l.cell.done, other = l.year !== M.yearOfYM(month) && l.pot.type === 'year';
    const st = M.potStats(l.pot, l.year);
    const meta = [
      l.pot.owner === 'j' ? ownerTag('j', 'ours') : '',
      other ? `<span class="tag c-lav">for ${esc(yearTag(l.pot, l.year))}</span>` : '',
      st.tot.target ? `<span>${money0(st.tot.have)} of ${money0(st.tot.target)}</span>` : st.tot.have ? `<span>${money0(st.tot.balance)} in it</span>` : '',
      l.cell.amt != null && l.cell.amt !== plan ? `<span>(planned ${money(plan)})</span>` : '',
      shortTag(l.pot, l.year),
    ].filter(Boolean).join('');
    const key = `${l.pot.id}|${l.year}|${slot}|${month}`;
    return `<div class="arow${done ? ' is-done' : ''}">
      <button class="amtbtn" data-pot="${l.pot.id}" data-year="${l.year}" aria-label="Open ${esc(l.pot.name)}">${jarOf(l.pot, l.year, 38)}</button>
      <div><div class="nm"><button data-pot="${l.pot.id}" data-year="${l.year}">${esc(l.pot.name)}</button></div><div class="meta">${meta}</div></div>
      <button class="amtbtn amt" data-cell="${key}">${money(done && l.cell.amt != null ? l.cell.amt : plan)}</button>
      <button class="check" data-done="${key}" aria-pressed="${done}" aria-label="${done ? 'Done' : 'Mark done'}">✓</button></div>`;
  };
  const only = list => (sharedOnly ? list.filter(l => l.pot.owner === 'j') : list);
  const rows = only(sum.inSavings).map(row).join(''), apartRows = only(sum.apartLines).map(row).join('');
  let sumline = '';
  if (!sharedOnly && tot.amt != null && sum.inSavings.length) {
    const g = sum.gap;
    sumline = Math.abs(g) < 0.5 ? `<div class="sumline ok">✓ Every dollar has a pot</div>`
      : g > 0 ? `<div class="sumline short">${money(g)} isn’t in a pot yet</div>`
        : `<div class="sumline over">The pots add up to ${money(-g)} more than ${mine ? 'you’re' : esc(p.name) + ' is'} saving</div>`;
  }
  const doneLine = sum.lines.length && !sharedOnly ? `<div class="row-btns">${sum.left ? `<button class="btn sm" data-alldone="${slot}">✓ Mark all ${sum.left} done</button>` : `<span class="small good"><b>All done for ${esc(monthName(month))}</b> · ${money(sum.done)} in</span>`}
      <span class="grow"></span><button class="linkbtn" data-addto="${slot}">＋ Add a pot</button></div>` : '';
  const shown = only(sum.inSavings).length + only(sum.apartLines).length;
  return `<section class="card pcol" style="--pc:${esc(p.color)}"><span class="tape" aria-hidden="true"></span>
    <div class="card-head"><h3>${sharedOnly ? `${esc(ownerPossessive(slot))} share of our pots` : `${esc(ownerPossessive(slot))} savings`}</h3><span class="sub">${esc(monthName(month))}</span></div>
    ${sharedOnly ? '' : totLine}
    ${only(sum.inSavings).length ? `<div class="alloc">${rows}</div>` : shown ? '' : `<div class="empty small">Nothing planned for ${esc(monthName(month))} yet.<br><button class="btn sm" data-addto="${slot}" style="margin-top:10px">＋ Put money in a pot</button></div>`}
    ${sumline}
    ${apartRows ? `<div class="eyebrow" style="margin-top:4px">Kept apart · not part of the ${tot.amt != null ? money(tot.amt) : 'savings'}</div><div class="alloc">${apartRows}</div>` : ''}
    ${doneLine}</section>`;
}

/** Every pot in one year: that year's yearly pots, and the goals. */
function allView(who = 'all') {
  const y = allYear, now = M.nowYear();
  const years = [...new Set([...M.dataYears(), now, now + 1])].sort();
  const prev = years.filter(v => v < y).pop(), next = years.find(v => v > y);
  const yearly = M.yearPots(y), goals = M.allPots().filter(p => p.type === 'goal' && !p.separate && (who === 'all' || p.owner === who));
  const groups = who === 'all' ? [...bothSlots(), 'j'] : [who];
  const archived = M.allPots({ archived: true }).filter(p => p.archived).length;
  const notCopied = M.yearPots(y).filter(p => !M.potYear(p.id, y + 1)).length;
  const card = (p, py) => {
    const st = M.potStats(p, py), t = st.tot;
    const later = p.type === 'year' && M.potYear(p.id, py + 1) && py === now;
    return `<button class="jcard${t.reached ? ' done-y' : ''}" data-pot="${p.id}" data-year="${py}">${jarOf(p, py, 46)}
      <div class="grow"><div class="t">${esc(p.name)}</div>
      <div class="s">${t.target ? `${money0(t.have)} of ${money0(t.target)}` : `${money0(t.balance)} in it`}</div>
      <div class="tags"><span class="tag ${p.type === 'year' ? 'plain' : 'c-mint'}">${esc(p.type === 'year' ? yearTag(p, py) : 'Goal')}</span>${later ? `<span class="tag c-lav">${py + 1} started</span>` : ''}${shortTag(p, py)}</div></div></button>`;
  };
  // Does what's filled in work? Each month against the savings amount, and money needed by a date.
  const checks = bothSlots().map(s => {
    const bad = M.yearMonthCheck(s, y).filter(r => !r.ok);
    return bad.length ? `<button class="sumline short" data-edityear="${y}">⚠ ${esc(nameOf(s))}: ${bad.length === 12 ? `none of ${y}’s months add up yet` : `${bad.length === 1 ? '1 month' : `${bad.length} months`} of ${y} ${bad.length === 1 ? 'doesn’t' : 'don’t'} add up (${bad.map(r => monShort(r.ym)).join(', ')})`} ›</button>`
      : `<div class="sumline ok">✓ ${esc(nameOf(s))}: every month of ${y} adds up</div>`;
  }).join('') + yearly.map(p => ({ p, c: M.firstShort(p, y) })).filter(x => x.c).map(({ p, c }) =>
    `<button class="sumline over" data-pot="${p.id}" data-year="${y}">⚠ ${esc(p.name)}: ${money(c.shortTot)} short of what’s needed by ${esc(ymLabel(c.due.ym))} ›</button>`).join('');
  const sec = (o, list, py) => (list.length ? `<div class="group-h"><h3>${esc(ownerPossessive(o))} pots</h3><span class="small muted">${list.length}</span></div>
      <div class="jargrid">${list.map(p => card(p, py)).join('')}</div>` : '');
  return `<div class="stepper"><button class="iconbtn" data-ay="${prev ?? ''}" ${prev == null ? 'disabled' : ''} aria-label="Year before">‹</button>
      <span class="label">${y}<span class="tiny">${yearly.length} yearly pot${yearly.length === 1 ? '' : 's'}</span></span>
      <button class="iconbtn" data-ay="${next ?? ''}" ${next == null ? 'disabled' : ''} aria-label="Year after">›</button></div>
    <div class="row-btns" style="justify-content:center"><button class="btn sm" data-edityear="${y}">✎ Change ${y}’s pots</button>
      ${notCopied ? `<button class="btn sm ghost" data-edityear="${y + 1}">Copy ${notCopied} to ${y + 1} ›</button>` : ''}</div>
    <div class="checks">${checks}</div>
    ${yearly.length ? groups.map(o => sec(o, yearly.filter(p => p.owner === o), y)).join('')
      : `<div class="empty">No yearly pots in ${y} yet.${M.yearPots(y - 1).length ? `<br><button class="btn sm" data-edityear="${y}" style="margin-top:10px">Copy ${y - 1}’s pots into ${y}</button>` : ''}</div>`}
    ${goals.length ? `<div class="group-h" style="margin-top:6px"><h3>Goals</h3><span class="small muted">keep going year to year</span></div>
      <div class="jargrid">${goals.map(p => card(p, Math.min(y, now))).join('')}</div>` : ''}
    ${archived ? `<button class="linkbtn" data-act="archived">Put-away pots (${archived}) ›</button>` : ''}`;
}

function archivedSheet(ctx) {
  const list = M.allPots({ archived: true }).filter(p => p.archived);
  const el = openSheet(`<h3>Put-away pots</h3><p class="muted small">They keep their history in Years. Open one to bring it back.</p>
    ${list.map(p => `<button class="opt" data-open="${p.id}">${p.emoji || '🍯'} ${esc(p.name)} <span class="grow"></span>${ownerTag(p.owner)}</button>`).join('')}
    <button class="btn ghost" data-close>Close</button>`);
  el.onclick = e => {
    const o = e.target.closest('[data-open]');
    if (o) { closeSheet(); ctx.go('pot-' + o.dataset.open); }
    if (e.target.closest('[data-close]')) closeSheet();
  };
}

// ── Editing money ────────────────────────────────────────────────────────
async function editCell(key, ctx, { rest = null, restLabel = null } = {}) {
  const [potId, ys, slot, ym] = key.split('|'), y = +ys, pot = M.getPot(potId);
  const c = M.cellsOf(potId, y)[slot][ym] || {};
  const done = !!c.done;
  const scopes = rest && rest.length ? [['one', 'Just this month'], ['rest', restLabel || `The rest of ${y} too`]] : null;
  // How this month's savings amount is shared out, so you can see what's left for this pot.
  const sum = M.monthSummary(slot, ym), tot = sum.total.amt;
  let share = '';
  if (pot.separate) share = `<br>It’s kept apart, so it comes on top of the ${tot != null ? money(tot) : 'monthly'} savings.`;
  else if (tot != null) {
    const others = r2(sum.planned - M.cellPlan(c)), free = r2(tot - others);
    share = `<br>${esc(monthName(ym))}: ${money(tot)} into savings, ${money(others)} in other pots, so <b>${free >= 0 ? `${money(free)} is free` : `it’s already ${money(-free)} over`}</b>.`;
  }
  const r = await askAmount({
    title: `${pot.emoji || '🍯'} ${pot.name} · ${monShort(ym)} ${ym.slice(0, 4)}`,
    sub: (done ? `Marked done. Change it if a different amount went in.` : `How much ${slot === store.me() ? 'you’ll' : esc(nameOf(slot)) + ' will'} put in${pot.owner === 'j' ? ' (their share)' : ''}.`) + share,
    value: done ? (c.amt ?? c.plan ?? null) : (c.plan ?? null), scopes,
  });
  if (!r) return;
  const v = r.value || 0;
  if (r.scope === 'rest') {
    const f = {};
    [ym, ...rest].forEach(m => {
      const cur = M.cellsOf(potId, y)[slot][m] || {};
      if (cur.done && m !== ym) return;
      f[M.cellKey(potId, slot, m)] = v ? { ...cur, plan: v } : (cur.done ? cur : null);
    });
    M.setYearFields(y, f);
  } else if (done) M.setCell(potId, y, slot, ym, v ? { amt: v, plan: c.plan || v } : { plan: 0, amt: null, done: false });
  else M.setCell(potId, y, slot, ym, { plan: v });
  ctx.render(true);
}

async function editTotal(slot, ym, ctx) {
  const cur = M.monthTotal(slot, ym);
  const r = await askAmount({
    title: `${ownerPossessive(slot)} savings · ${ymLabel(ym)}`,
    sub: 'Everything that goes into savings this month. Split it into pots below.',
    value: cur.amt, allowClear: false,
    scopes: [['on', 'From this month on'], ['just', 'Just this month']],
  });
  if (!r || r.value == null) return;
  M.setMonthTotal(slot, ym, r.value, r.scope);
  ctx.render(true);
}

function potChoices(slot, ym) {
  // Pots this person can put money in this month: theirs and yours together, for this year or next.
  const y = M.yearOfYM(ym), out = [];
  for (const p of M.allPots()) {
    if (!M.isMine(p, slot)) continue;
    if (p.type === 'goal') { out.push({ pot: p, year: y }); continue; }
    const ys = M.yearsOfPot(p).filter(v => v >= y && v <= y + 1);
    (ys.length ? ys : [y]).forEach(v => out.push({ pot: p, year: v }));
  }
  const taken = new Set(M.monthLines(slot, ym).map(l => l.pot.id + '|' + l.year));
  return out.filter(o => !taken.has(o.pot.id + '|' + o.year));
}

function addToMonth(slot, ym, ctx) {
  const list = potChoices(slot, ym);
  const el = openSheet(`<h3>Put money in a pot · ${esc(monthName(ym))}</h3>
    <p class="muted small">${slot === store.me() ? 'Your' : esc(nameOf(slot)) + '’s'} pots and the ones you share. Pick one, then the amount.</p>
    ${list.length ? list.map(o => `<button class="opt" data-pick="${o.pot.id}|${o.year}">${o.pot.emoji || '🍯'} ${esc(o.pot.name)}<span class="grow"></span>
      ${o.pot.type === 'year' ? `<span class="tag ${o.year > M.yearOfYM(ym) ? 'c-lav' : 'plain'}">${o.year > M.yearOfYM(ym) ? 'for ' : ''}${o.year}</span>` : '<span class="tag c-mint">Goal</span>'}${o.pot.owner === 'j' ? ownerTag('j', 'ours') : ''}</button>`).join('')
      : '<p class="empty small">Every pot already has money planned this month.</p>'}
    <div class="row-btns end"><button class="btn ghost" data-close>Close</button><button class="btn" data-new>＋ New pot</button></div>`);
  el.onclick = e => {
    const pk = e.target.closest('[data-pick]');
    if (pk) {
      const [potId, y] = pk.dataset.pick.split('|');
      closeSheet();
      if (!M.potYear(potId, +y) && M.getPot(potId).type === 'year') M.setPotYear(potId, +y, { target: {} });
      return editCell(`${potId}|${y}|${slot}|${ym}`, ctx);
    }
    if (e.target.closest('[data-close]')) closeSheet();
    if (e.target.closest('[data-new]')) { closeSheet(); newPot(ctx, { owner: slot }); }
  };
}

// ── New pot / edit pot ───────────────────────────────────────────────────
function potForm(p, { isNew, year }) {
  const owners = [...bothSlots(), 'j'];
  const locked = !isNew && hasMoney(p);
  return `<div class="field"><span>Name</span><input class="inp" id="pf-name" value="${esc(p.name || '')}" placeholder="e.g. Health, Holiday, Christmas" autocomplete="off"></div>
    <div class="field"><span>Little picture</span><div class="chips" id="pf-emo">${EMOJIS.map(x => `<button type="button" class="chip" data-emo="${x}" aria-pressed="${x === (p.emoji || '🍯')}">${x}</button>`).join('')}</div></div>
    <div class="field"><span>Whose pot</span><div class="seg wide" id="pf-owner">${owners.map(o => `<button type="button" data-owner="${o}" aria-pressed="${o === p.owner}" ${locked && o !== p.owner ? 'disabled' : ''}>${o === 'j' ? 'Both of us' : esc(nameOf(o))}</button>`).join('')}</div></div>
    <div class="field"><span>Kind</span><div class="seg wide" id="pf-type"><button type="button" data-type="year" aria-pressed="${p.type !== 'goal'}" ${locked && p.type === 'goal' ? 'disabled' : ''}>Every year</button><button type="button" data-type="goal" aria-pressed="${p.type === 'goal'}" ${locked && p.type !== 'goal' ? 'disabled' : ''}>A goal</button></div>
      <span class="hint" id="pf-typehint"></span></div>
    ${locked ? '<p class="hint">It already has money in it, so whose it is and its kind stay as they are.</p>' : ''}
    <div class="field" id="pf-amt" data-year="${year}"></div>
    ${isNew ? `<label class="field"><span>Save it by (optional)</span><input class="inp" type="month" id="pf-by"><span class="hint">If the money is needed by a month (car insurance in March), the plan fills the months up to then.</span></label>` : ''}
    <label class="toggle"><input type="checkbox" id="pf-sep" ${p.separate ? 'checked' : ''}> Kept apart from the monthly savings (its own account, like a house deposit)</label>
    <div class="field"><span>Note (optional)</span><input class="inp" id="pf-note" value="${esc(p.note || '')}" autocomplete="off"></div>`;
}
const hasMoney = p => M.yearsOfPot(p).some(y => M.potStats(p, y).tot.have || M.potStats(p, y).tot.plan);

function amountFields(el, p, isNew) {
  const owner = el.querySelector('#pf-owner [aria-pressed="true"]').dataset.owner;
  const type = el.querySelector('#pf-type [aria-pressed="true"]').dataset.type;
  el.querySelector('#pf-typehint').textContent = type === 'year'
    ? 'A new amount each year (health, presents, car insurance). You look back on it at the end of the year.'
    : 'Keeps growing until you get there (a house deposit, a wedding, a safety net).';
  const y = +el.querySelector('#pf-amt').dataset.year || M.nowYear();
  const cur = type === 'goal' ? (p.goal || {}) : (isNew ? {} : (M.potYear(p.id, y)?.target || {}));
  const box = (s, attr = 'data-amt', vals = cur) => `<input class="inp money" ${attr}="${s}" inputmode="decimal" placeholder="$0" value="${vals[s] != null ? esc(String(vals[s])) : ''}">`;
  const slots = owner === 'j' ? ['a', 'b'] : [owner];
  const pair = (attr, vals) => (slots.length > 1
    ? `<div class="fields2">${slots.map(s => `<label class="field"><span>${esc(nameOf(s))}</span>${box(s, attr, vals)}</label>`).join('')}</div>`
    : box(slots[0], attr, vals));
  const from = spreadFrom(y);
  el.querySelector('#pf-amt').innerHTML = (type === 'goal'
    ? `<span>Goal${slots.length > 1 ? ' · each of you' : ''} (optional)</span>${pair('data-amt', cur)}
       <span style="margin-top:6px">Already saved before you started tracking${slots.length > 1 ? ' · each of you' : ''}</span>${pair('data-start', p.start || {})}`
    : `<span>Target for ${y}${slots.length > 1 ? ' · each of you' : ''}</span>${pair('data-amt', cur)}`)
    + (isNew && type === 'year' ? `<label class="toggle"><input type="checkbox" id="pf-spread" checked> Plan it monthly from ${esc(monShort(from))} to Dec ${y}</label>` : '');
}
/** Where a new year's monthly plan starts: January, or this month if the year's already going. */
export const spreadFrom = y => (M.ymOf(y, 1) > M.nowYM() || y < M.nowYear() ? M.ymOf(y, 1) : M.nowYM());

function readAmounts(el, attr = 'amt') {
  const out = {};
  el.querySelectorAll(`[data-${attr}]`).forEach(i => { const v = parseMoney(i.value); if (v != null) out[i.dataset[attr]] = v; });
  return out;
}

/** A new pot. year: the year its target (and monthly plan) is for. */
export function newPot(ctx, { owner = store.me(), year = M.nowYear(), then = null } = {}) {
  const p = { name: '', emoji: '🍯', owner, type: 'year' };
  const el = openSheet(`<h3>A new pot</h3>${potForm(p, { isNew: true, year })}<p class="err" id="pf-err" hidden></p>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Make the pot</button></div>`);
  wireForm(el, p, true);
  el.querySelector('[data-save]').onclick = () => {
    const name = el.querySelector('#pf-name').value.trim();
    if (!name) { const er = el.querySelector('#pf-err'); er.hidden = false; er.textContent = 'Give it a name.'; return; }
    const id = uid(), owner2 = el.querySelector('#pf-owner [aria-pressed="true"]').dataset.owner;
    const type = el.querySelector('#pf-type [aria-pressed="true"]').dataset.type, amts = readAmounts(el);
    const pot = { id, name, emoji: el.querySelector('#pf-emo [aria-pressed="true"]')?.dataset.emo || '🍯', owner: owner2, type,
      separate: el.querySelector('#pf-sep').checked || undefined, note: el.querySelector('#pf-note').value.trim() || undefined, order: Date.now() / 1e13 };
    if (type === 'goal') { pot.goal = amts; const st = readAmounts(el, 'start'); if (Object.keys(st).length) pot.start = st; }
    M.savePot(pot);
    if (type === 'year') {
      M.setPotYear(id, year, { target: amts });
      if (el.querySelector('#pf-spread')?.checked && !el.querySelector('#pf-by')?.value) M.slotsOf(pot).forEach(s => { if (amts[s]) M.spreadPlan(pot, year, s, amts[s], spreadFrom(year), M.ymOf(year, 12)); });
    }
    // Saved by a month: that's when it's needed, and the months up to then get the money.
    const by = el.querySelector('#pf-by')?.value, need = r2(Object.values(amts).reduce((t, v) => t + v, 0));
    if (/^\d{4}-\d{2}$/.test(by) && need > 0) {
      M.setDues(M.getPot(id), year, [{ id: uid(), ym: by, amt: need }]);
      M.replanForDues(M.getPot(id), year);
    }
    closeSheet();
    toast(`${pot.emoji} ${name} is ready`);
    if (then) then(pot); else ctx.go(`pot-${id}@${year}`);
  };
}

function wireForm(el, p, isNew) {
  const pickIn = (sel, attr) => el.querySelector(sel).addEventListener('click', e => {
    const b = e.target.closest(`[${attr}]`);
    if (!b || b.disabled) return;
    el.querySelectorAll(`${sel} [${attr}]`).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    if (attr !== 'data-emo') amountFields(el, p, isNew);
  });
  pickIn('#pf-emo', 'data-emo'); pickIn('#pf-owner', 'data-owner'); pickIn('#pf-type', 'data-type');
  amountFields(el, p, isNew);
  el.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
}

/** Name, picture, whose, kind, kept apart, and the target for the year on show (or the goal). */
function editPot(pot, ctx, year = M.nowYear()) {
  const el = openSheet(`<h3>Edit ${esc(pot.name)}</h3>${potForm(pot, { isNew: false, year })}
    <div class="row-btns"><button class="btn danger sm" data-archive>${pot.archived ? 'Bring it back' : 'Put it away'}</button>${hasMoney(pot) ? '' : '<button class="btn danger sm" data-delete>Delete</button>'}</div>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  wireForm(el, pot, false);
  el.querySelector('[data-save]').onclick = () => {
    const name = el.querySelector('#pf-name').value.trim() || pot.name;
    const owner = el.querySelector('#pf-owner [aria-pressed="true"]').dataset.owner;
    const type = el.querySelector('#pf-type [aria-pressed="true"]').dataset.type, amts = readAmounts(el);
    const next = { ...pot, name, owner, type, emoji: el.querySelector('#pf-emo [aria-pressed="true"]')?.dataset.emo || pot.emoji,
      separate: el.querySelector('#pf-sep').checked || undefined, note: el.querySelector('#pf-note').value.trim() || undefined };
    if (type === 'goal') { next.goal = amts; const st = readAmounts(el, 'start'); if (Object.keys(st).length) next.start = st; else delete next.start; }
    else { delete next.goal; delete next.start; }
    M.savePot(next);
    if (type === 'year') { const py = M.potYear(pot.id, year); if (py || Object.keys(amts).length) M.setPotYear(pot.id, year, { ...(py || {}), target: amts }); }
    closeSheet(); ctx.render(true);
  };
  el.querySelector('[data-archive]').onclick = () => { M.savePot({ ...pot, archived: !pot.archived }); closeSheet(); toast(pot.archived ? 'It’s back' : 'Put away. Its history stays in Years.'); ctx.render(true); };
  const del = el.querySelector('[data-delete]');
  if (del) del.onclick = async () => {
    closeSheet();
    if (!(await confirmSheet({ title: `Delete ${pot.name}?`, text: 'It has no money in it, so nothing else changes.', yes: 'Delete', danger: true }))) return;
    store.setField('pots', pot.id, null);
    M.yearsOfPot(pot).forEach(y => { if (M.potYear(pot.id, y)) M.setPotYear(pot.id, y, null); });
    ctx.go('pots');
  };
}

// ── A pot's page ─────────────────────────────────────────────────────────
export function renderPot(view, ctx, arg) {
  const [id, yArg] = arg.split('@'), pot = M.getPot(id);
  if (!pot) return false;
  if (yArg) potYearShown[id] = +yArg;
  const y = potYearShown[id] || defaultYear(pot);
  ctx.topbar.set(pot.name, { back: 'pots', backLabel: 'Pots' });
  const st = M.potStats(pot, y), t = st.tot, slots = M.slotsOf(pot);
  // A yearly pot steps through its years; a goal through the years it has money in (and this one).
  const ys = pot.type === 'year' ? M.yearsOfPot(pot) : [...new Set([...M.yearsOfPot(pot), M.nowYear()])].sort();
  const prev = ys.filter(v => v < y).pop(), next = ys.find(v => v > y);
  const yearSel = `<div class="stepper"><button class="iconbtn" data-y="${prev ?? ''}" ${prev == null ? 'disabled' : ''} aria-label="Year before">‹</button>
      <span class="label">${esc(pot.type === 'year' ? yearTag(pot, y) : String(y))}${pot.type === 'year' && !ys.includes(y) ? '<span class="tiny">not planned yet</span>' : pot.type === 'goal' ? '<span class="tiny">month by month</span>' : ''}</span>
      ${next != null ? `<button class="iconbtn" data-y="${next}" aria-label="Year after">›</button>` : pot.type === 'year' ? `<button class="btn sm" data-plan-next="${y + 1}">Plan ${y + 1} ›</button>` : '<button class="iconbtn" disabled aria-label="Year after">›</button>'}</div>`;
  const stat = (k, v, x = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${x ? `<div class="x">${x}</div>` : ''}</div>`;
  const f = st.per;
  const doneMonths = slots.reduce((n, s) => n + f[s].done, 0), allMonths = slots.reduce((n, s) => n + f[s].months, 0);
  const added = r2(slots.reduce((n, s) => n + (f[s].added || 0), 0));
  // A shared pot where only one of you has set a goal shows that one.
  const partial = !t.target && t.partTarget ? slots.filter(s => f[s].target != null) : null;
  const goalVal = t.target ? money0(t.target) : partial ? money0(partial.reduce((x, s) => x + f[s].target, 0)) : '<span class="faint">none</span>';
  const stats = `<div class="stats">
    ${stat(pot.type === 'goal' ? 'Goal' : 'Target', goalVal, `${partial ? `${partial.map(s => esc(nameOf(s))).join(' & ')}’s only · ` : ''}<button class="linkbtn" data-target>✎ ${t.target || partial ? 'change' : 'set one'}</button>`)}
    ${stat(pot.type === 'goal' ? `Saved in ${y}` : 'Saved', money(t.saved), [allMonths ? `${doneMonths} of ${allMonths} months done` : '', added ? `${money(added)} put in by hand` : ''].filter(Boolean).join(' · '))}
    ${t.carry ? stat(pot.type === 'goal' ? `Before ${y}${M.extrasList(pot).length ? ' + own accounts' : ''}` : `From ${y - 1}`, money(t.carry)) : ''}
    ${stat('Used', money(t.used))}
    ${stat('In the pot', money(t.balance))}
    ${t.target ? stat('Still to save', money(t.left), t.unplanned > 0.5 ? `<span class="warn">${money(t.unplanned)} not planned yet</span>` : 'all planned') : ''}
  </div>`;
  // Shared pots: who's put what in (a goal: everything so far; a yearly pot: this year).
  let perPerson = '';
  if (pot.owner === 'j') {
    const life = pot.type === 'goal' ? M.lifetime(pot)
      : { per: Object.fromEntries(slots.map(s => [s, { put: f[s].have }])), tot: { put: t.have, used: t.used } };
    const goal = Object.fromEntries(slots.filter(s => f[s].target != null).map(s => [s, f[s].target]));
    perPerson = `<div class="eyebrow">Who’s put in${pot.type === 'goal' ? ' so far' : ` · ${esc(yearTag(pot, y))}`}</div>${whoPut(pot, life, goal)}`;
  }
  const dues = M.duesOf(pot, y);
  const acts = `<div class="row-btns potacts"><button class="btn sm" data-putin>＋ Put money in</button><button class="btn sm" data-takeout>− Take money out</button>
    <button class="btn sm ghost" data-adddue>💳 ${dues.length ? 'Another date' : 'Save it by a date'}</button></div>`;

  const acct = M.accountOfPot(pot.id);
  view.innerHTML = `<div class="cols">
    <section class="card pcol span" style="--pc:${esc(ownerColor(pot.owner))}"><span class="tape" aria-hidden="true"></span>
      <div class="pothead">${jarOf(pot, y, 86)}<div class="grow"><h1>${esc(pot.name)}</h1>
        <div class="line">${ownerTag(pot.owner, pot.owner === 'j' ? 'Both of us' : nameOf(pot.owner))}<span class="tag ${pot.type === 'goal' ? 'c-mint' : 'plain'}">${pot.type === 'goal' ? 'Goal' : 'Every year'}</span>${pot.separate ? '<span class="tag c-honey">kept apart</span>' : ''}${acct ? `<span class="tag plain">🏦 ${esc(acct.name)}</span>` : ''}${pot.archived ? '<span class="tag c-peach">put away</span>' : ''}</div>
        ${pot.note ? `<p class="small muted" style="margin-top:6px">${esc(pot.note)}</p>` : ''}</div>
        <button class="iconbtn" data-edit aria-label="Edit pot">✎</button></div>
      ${yearSel}${stats}${acts}${perPerson}
    </section>
    ${dues.length ? dueCard(pot, y) : ''}
    ${pot.type === 'goal' ? extrasCard(pot) : ''}
    ${planCard(pot, y)}
    ${inOutCard(pot, y)}
  </div>`;

  view.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.y) { potYearShown[id] = +b.dataset.y; return ctx.render(); }
    if (b.dataset.planNext) return planYearOf(pot, +b.dataset.planNext, ctx);
    if (b.hasAttribute('data-edit')) return editPot(pot, ctx, y);
    if (b.hasAttribute('data-target')) return editTarget(pot, y, ctx);
    if (b.dataset.done) {
      const [, , slot, ym] = b.dataset.done.split('|'), c = M.cellsOf(pot.id, y)[slot][ym] || {};
      M.setCell(pot.id, y, slot, ym, { done: !c.done });
      return ctx.render(true);
    }
    if (b.dataset.cell) {
      const ym = b.dataset.cell.split('|')[3];
      const rest = M.monthsOf(y).filter(m => m > ym);
      return editCell(b.dataset.cell, ctx, { rest });
    }
    if (b.hasAttribute('data-spread')) return spreadSheet(pot, y, ctx);
    if (b.hasAttribute('data-putin')) return moneyMove(pot, y, 'in', ctx);
    if (b.hasAttribute('data-takeout')) return moneyMove(pot, y, 'out', ctx);
    if (b.dataset.dep) return moneyMove(pot, y, 'in', ctx, { entry: M.manualDeposits(pot.id, y).find(d => d.id === b.dataset.dep) });
    if (b.dataset.use) return moneyMove(pot, y, 'out', ctx, { entry: M.manualUses(pot.id, y).find(u => u.id === b.dataset.use) });
    if (b.dataset.owing) return ctx.go('owings@' + b.dataset.owing);
    if (b.hasAttribute('data-adddue')) return editDue(pot, y, null, ctx);
    if (b.dataset.due) return editDue(pot, y, b.dataset.due, ctx);
    if (b.hasAttribute('data-replan')) {
      const years = pot.type === 'year' ? [y] : [...new Set([...M.yearsOfPot(pot), ...M.duesOf(pot, y).map(d => M.yearOfYM(d.ym)), M.nowYear()])];
      const before = Object.fromEntries(years.map(yr => [yr, JSON.parse(JSON.stringify(M.cellsOf(pot.id, yr)))]));
      const failed = M.replanForDues(pot, y);
      toast(failed.length ? `Re-planned, but ${failed.map(d => monShort(d.ym)).join(' and ')} has already gone by` : 'Re-planned so there’s enough in time',
        { label: 'Undo', run: () => { Object.entries(before).forEach(([yr, old]) => undoCells(pot, +yr, old)); ctx.render(true); } });
      return ctx.render(true);
    }
    if (b.hasAttribute('data-addextra')) return editExtra(pot, null, ctx);
    if (b.dataset.extra) return editExtra(pot, b.dataset.extra, ctx);
  };
  return true;
}

// ── Money in and out by hand ─────────────────────────────────────────────
/** Everything outside the monthly plan for the year on show: money put in by hand, money taken out (by hand or through Owings). */
function inOutCard(pot, y) {
  const slots = M.slotsOf(pot), amt = x => r2(slots.reduce((t, s) => t + (+x[s] || 0), 0));
  const rows = [...M.manualDeposits(pot.id, y).map(d => ({ ...d, dir: 'in' })), ...M.usesOf(pot.id, y).map(u => ({ ...u, dir: 'out' }))]
    .sort((x, z) => String(z.date || z.ym).localeCompare(String(x.date || x.ym)));
  const when = r => esc(r.date ? new Date(String(r.date).length === 10 ? r.date + 'T12:00' : r.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ymLabel(r.ym));
  return `<section class="card"><div class="card-head"><h3>Money in &amp; out by hand</h3></div>
    <div class="row-btns"><button class="btn sm" data-putin>＋ Put money in</button><button class="btn sm" data-takeout>− Take money out</button></div>
    ${rows.length ? `<div class="uses">${rows.map(r => `<button class="urow plainrow" ${r.dir === 'in' ? `data-dep="${esc(r.id)}"` : r.kind === 'owing' ? `data-owing="${esc(r.ym)}"` : `data-use="${esc(r.id)}"`}>
      <span class="tag ${r.dir === 'in' ? 'c-mint' : r.kind === 'owing' ? 'c-peach' : 'plain'}">${r.dir === 'in' ? '＋ in' : r.kind === 'owing' ? '🧾 owings' : '− out'}</span>
      <div class="grow"><b>${esc(r.note || (r.dir === 'in' ? 'Put in' : 'Taken out'))}</b><div class="tiny muted">${when(r)}${slots.length > 1 ? ` · ${slots.filter(s => +r[s]).map(s => `${esc(nameOf(s))} ${money(r[s])}`).join(' · ')}` : ''}</div></div>
      <b class="num ${r.dir === 'in' ? 'good' : ''}">${r.dir === 'in' ? '+' : '−'}${money(amt(r))}</b></button>`).join('')}</div>`
      : `<p class="small muted">Nothing ${pot.type === 'year' ? `for ${y}` : `in ${y}`} yet. Put money in for past months (or a lump sum), and take money out when you spend from it. Purchases on Owings that come out of this pot show here too.</p>`}
  </section>`;
}

/**
 * Put money in (a past deposit, a lump sum) or take money out of a pot, by either of you.
 * opts.pots: let them pick which pot (from a savings account); opts.entry: change one already there.
 */
function moneyMove(pot, y, kind, ctx, { pots = null, amt = null, ym = null, entry = null, acct = null } = {}) {
  const out = kind === 'out', ACCT = '_acct';
  // cur is a pot, or ACCT for money in a savings account that isn't in any pot.
  let cur = entry?.kind === 'account' ? ACCT : pot || ACCT;
  const potOpts = acct ? [ACCT, ...(pots || [])] : (pots || []);
  const firstDay = entry?.date || (entry?.ym ? entry.ym + '-01' : ym && ym !== M.nowYM() ? ym + '-01' : isoDay());
  const el = openSheet(`<h3 id="mm-title"></h3>
    ${potOpts.length > 1 ? `<label class="field"><span>${acct ? 'In which pot' : 'Which pot'}</span><select class="inp" id="mm-pot">${potOpts.map(p => p === ACCT
      ? `<option value="${ACCT}" ${cur === ACCT ? 'selected' : ''}>🏦 Just ${esc(acct.name)} (not in a pot)</option>`
      : `<option value="${p.id}" ${cur !== ACCT && p.id === cur.id ? 'selected' : ''}>${esc(p.emoji || '🍯')} ${esc(p.name)}</option>`).join('')}</select></label>` : ''}
    <div class="field" id="mm-amts"></div>
    <label class="field"><span>Date</span><input class="inp" type="date" id="mm-date" value="${esc(firstDay)}"></label>
    <label class="field"><span>${out ? 'What for' : 'Note (optional)'}</span><input class="inp" id="mm-note" value="${esc(entry?.note || '')}" placeholder="${out ? 'e.g. Dentist, car insurance' : 'e.g. Tax refund, opening balance'}" autocomplete="off"></label>
    <p class="hint" id="mm-hint"></p>
    <div class="row-btns end">${entry ? '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  const dateNow = () => el.querySelector('#mm-date').value || isoDay();
  const draw = () => {
    const isAcct = cur === ACCT, slots = isAcct ? [] : M.slotsOf(cur);
    const name = isAcct ? acct?.name || 'the account' : cur.name;
    el.querySelector('#mm-title').textContent = entry ? (out ? 'Money taken out' : 'Money put in') : out ? `Take money out of ${name}` : `Put money into ${name}`;
    el.querySelector('#mm-hint').textContent = isAcct ? `It counts in ${name}’s total, outside the pots.`
      : out ? 'It comes off what’s in the pot.' : 'It counts as saved on that date, on top of the monthly plan (that month’s savings check doesn’t change).';
    const val = s => (entry && entry.pot === cur.id && entry[s] != null ? entry[s] : '');
    const box = (s, label) => `<label class="field"><span>${esc(label)}</span><input class="inp money" data-mm="${s}" inputmode="decimal" placeholder="$0" value="${esc(String(val(s)))}"></label>`;
    let html;
    if (isAcct) html = `<span>How much</span><input class="inp money" data-mm="acct" inputmode="decimal" placeholder="$0" value="${esc(String(entry?.kind === 'account' ? entry.amt : amt ?? ''))}">`;
    else if (slots.length === 1) html = `<span>How much</span><input class="inp money" data-mm="${slots[0]}" inputmode="decimal" placeholder="$0" value="${esc(String(val(slots[0]) || (amt ?? '')))}">`;
    else if (out) html = `<span>How much</span><input class="inp money" id="mm-total" inputmode="decimal" placeholder="$0" value="${esc(String(entry && entry.pot === cur.id ? r2((+entry.a || 0) + (+entry.b || 0)) : amt ?? ''))}">
      <div class="fields2">${slots.map(s => box(s, `From ${nameOf(s)}’s share`)).join('')}</div><span class="hint">Split by how you share this pot. Change it if one of you covers more.</span>`;
    else html = `<span>Who put it in</span><div class="fields2">${slots.map(s => box(s, nameOf(s))).join('')}</div><span class="hint">Fill in either of you, or both.</span>`;
    el.querySelector('#mm-amts').innerHTML = html;
    const total = el.querySelector('#mm-total');
    if (total) {
      const share = () => M.jointShare(cur, cur.type === 'year' ? (y && cur.id === pot?.id ? y : M.potYearFor(cur, dateNow())) : M.nowYear());
      const split = () => { const v = parseMoney(total.value) || 0, a = r2(v * share()); el.querySelector('[data-mm="a"]').value = a || ''; el.querySelector('[data-mm="b"]').value = r2(v - a) || ''; };
      total.addEventListener('input', split);
      if (!(entry && entry.pot === cur.id) && total.value) split();
    }
  };
  draw();
  el.querySelector('#mm-pot')?.addEventListener('change', e => { cur = e.target.value === ACCT ? ACCT : M.getPot(e.target.value); draw(); });
  const removeOld = () => {
    if (!entry) return;
    if (entry.kind === 'account') M.deleteAccountEntry(entry.id);
    else if (out) M.deleteUse(entry.py, entry.id);
    else M.deleteDeposit(entry.py, entry.id);
  };
  el.onclick = e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) { removeOld(); closeSheet(); return ctx.render(true); }
    if (!e.target.closest('[data-save]')) return;
    const date = dateNow(), ymv = date.slice(0, 7), note = el.querySelector('#mm-note').value.trim();
    if (cur === ACCT) {
      const a = parseMoney(el.querySelector('[data-mm="acct"]').value);
      if (!a) return toast('How much?');
      if (entry && entry.kind !== 'account') removeOld();
      M.saveAccountEntry({ id: entry?.kind === 'account' ? entry.id : uid(), acct: acct.id, date, ym: ymv, amt: a, dir: out ? 'out' : 'in', ...(note ? { note } : {}) });
      closeSheet(); toast(out ? `${money(a)} taken out of ${acct.name}` : `${money(a)} put into ${acct.name}`);
      return ctx.render(true);
    }
    const slots = M.slotsOf(cur), rec = { id: entry && entry.kind !== 'account' ? entry.id : uid(), pot: cur.id, date, ym: ymv };
    slots.forEach(s => { const v = parseMoney(el.querySelector(`[data-mm="${s}"]`).value); if (v) rec[s] = v; });
    if (!slots.some(s => rec[s])) return toast('How much?');
    if (note) rec.note = note;
    // A yearly pot's money goes to the year on show (or, from an account, the year that date belongs to); a goal's to the date's year.
    const yy = cur.type === 'goal' ? M.yearOfYM(ymv) : (y && cur.id === pot?.id ? y : M.potYearFor(cur, ymv));
    if (entry && (entry.kind === 'account' || entry.py !== yy || entry.pot !== cur.id)) removeOld();
    if (out) M.saveUse(yy, rec); else M.saveDeposit(yy, rec);
    closeSheet();
    const sum = slots.reduce((t, s) => t + (rec[s] || 0), 0);
    toast(out ? `${money(sum)} taken out of ${cur.name}` : `${money(sum)} put into ${cur.name}`);
    ctx.render(true);
  };
}

/** Puts a pot-year's months back the way they were (for Undo). */
function undoCells(pot, y, old) {
  const now = M.cellsOf(pot.id, y), fields = {};
  for (const s of M.slotsOf(pot)) {
    for (const m of new Set([...Object.keys(now[s] || {}), ...Object.keys(old[s] || {})])) fields[M.cellKey(pot.id, s, m)] = old[s]?.[m] || null;
  }
  M.setYearFields(y, fields);
}

// ── When a yearly pot's money is needed ──────────────────────────────────
function dueCard(pot, y) {
  const checks = M.dueCheck(pot, y), slots = M.slotsOf(pot), anyShort = checks.some(c => !c.ok);
  const sum = o => r2(slots.reduce((t, s) => t + (o[s] || 0), 0));
  return `<section class="card ${anyShort ? 'c-peach' : 'c-mint'}"><div class="card-head"><h3>💳 When it’s needed</h3><button class="btn sm" data-adddue>＋ A date</button></div>
    ${checks.length ? `<div class="dues">${checks.map(c => `<button class="duerow" data-due="${esc(c.due.id)}">
        <div class="when"><b>${esc(monShort(c.due.ym))}</b><span>${esc(c.due.ym.slice(0, 4))}</span></div>
        <div class="grow"><div><b>${money(c.due.amt)}</b>${c.due.note ? ` · ${esc(c.due.note)}` : ''}${c.cum !== +c.due.amt ? ` <span class="muted small">(${money(c.cum)} in all by then)</span>` : ''}</div>
          <div class="small ${c.ok ? 'good' : 'bad'}" style="font-weight:800">${c.ok ? `✓ Enough by then: ${money(sum(c.have))} planned by the end of ${esc(monthName(c.due.ym))}`
            : `⚠ Only ${money(sum(c.have))} by the end of ${esc(monthName(c.due.ym))}: ${money(c.shortTot)} short${slots.length > 1 ? ` (${slots.filter(s => c.short[s] > 0).map(s => `${esc(nameOf(s))} ${money(c.short[s])}`).join(', ')})` : ''}`}</div></div></button>`).join('')}</div>
      ${anyShort ? `<div class="row-btns"><button class="btn sm primary" data-replan>Re-plan the months to fit</button><span class="hint grow">Puts enough into the months before each date${pot.type === 'year' ? ' and spreads the rest after' : ''}. Months ticked done stay as they are.</span></div>` : ''}`
    : `<p class="small muted">If this pot pays for something at a set time (car insurance in March, Christmas in December), add the date. You’ll see a ⚠ when the months you’ve filled in won’t have enough by then.</p>`}
  </section>`;
}

function editDue(pot, y, id, ctx) {
  const list = M.duesOf(pot, y), cur = list.find(d => d.id === id) || null;
  const st = M.potStats(pot, y), earlier = r2(list.filter(d => d !== cur).reduce((t, d) => t + (+d.amt || 0), 0));
  const goalAll = pot.type === 'goal' ? r2(Object.values(pot.goal || {}).reduce((t, v) => t + (+v || 0), 0)) : st.tot.target;
  const amt = cur ? cur.amt : (goalAll ? Math.max(0, r2(goalAll - earlier)) : '');
  const el = openSheet(`<h3>${cur ? 'When it’s needed' : `When ${esc(pot.name)}’s money is needed`}</h3>
    <div class="fields2"><label class="field"><span>Needed by the end of</span><input class="inp" type="month" id="du-ym" value="${esc(cur?.ym || (pot.type === 'goal' ? M.ymOf(M.nowYear() + 1, 12) : M.ymOf(y, 3)))}"></label>
      <label class="field"><span>How much</span><input class="inp money" id="du-amt" inputmode="decimal" placeholder="$0" value="${esc(String(amt))}"></label></div>
    <label class="field"><span>What for (optional)</span><input class="inp" id="du-note" value="${esc(cur?.note || '')}" placeholder="e.g. Car insurance renewal" autocomplete="off"></label>
    ${pot.owner === 'j' ? `<p class="hint">You each need your share by then: ${Math.round(M.jointShare(pot, y) * 100)}% ${esc(nameOf('a'))}, ${100 - Math.round(M.jointShare(pot, y) * 100)}% ${esc(nameOf('b'))} (by your targets).</p>` : ''}
    <div class="row-btns end">${cur ? '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) { M.setDues(pot, y, list.filter(d => d.id !== cur.id)); closeSheet(); return ctx.render(true); }
    if (!e.target.closest('[data-save]')) return;
    const ym = el.querySelector('#du-ym').value, a = parseMoney(el.querySelector('#du-amt').value);
    if (!/^\d{4}-\d{2}$/.test(ym) || !a) return toast('Which month, and how much?');
    const next = { id: cur?.id || uid(), ym, amt: a, note: el.querySelector('#du-note').value.trim() || undefined };
    M.setDues(pot, y, [...list.filter(d => d.id !== next.id), next]);
    closeSheet(); ctx.render(true);
  };
}

// ── A goal's money in your own accounts ──────────────────────────────────
function extrasCard(pot) {
  const list = M.extrasList(pot), slots = M.slotsOf(pot);
  return `<section class="card"><div class="card-head"><h3>🏦 In your own accounts too</h3><button class="btn sm" data-addextra>＋ Add</button></div>
    ${list.length ? `<div class="uses">${list.map(x => `<button class="urow plainrow" data-extra="${esc(x.id)}"><span class="dot" style="background:${esc(ownerColor(x.slot))}"></span>
        <div class="grow"><b>${esc(x.label || 'Own savings')}</b><div class="tiny muted">${esc(nameOf(x.slot))}</div></div><b class="num">${money(x.amt)}</b></button>`).join('')}</div>
      <p class="hint">These count on top of what’s gone through the pot. Change the amount whenever the account does.</p>`
    : `<p class="small muted">Money for ${esc(pot.name)} that’s already sitting in ${slots.length > 1 ? 'either of your' : 'your'} own savings account. It counts on top of what’s been saved through the pot.</p>`}
  </section>`;
}

function editExtra(pot, id, ctx) {
  const list = M.extrasList(pot), cur = list.find(x => x.id === id) || null, slots = M.slotsOf(pot);
  let who = cur?.slot || (slots.includes(store.me()) ? store.me() : slots[0]);
  const el = openSheet(`<h3>${cur ? 'Money in your own account' : `Add money for ${esc(pot.name)}`}</h3>
    ${slots.length > 1 ? `<div class="field"><span>Whose account</span><div class="seg wide" id="ex-who">${slots.map(s => `<button type="button" data-who="${s}" aria-pressed="${s === who}">${esc(nameOf(s))}</button>`).join('')}</div></div>` : ''}
    <label class="field"><span>Which account</span><input class="inp" id="ex-label" value="${esc(cur?.label || '')}" placeholder="e.g. My house savings" autocomplete="off"></label>
    <label class="field"><span>How much is in it for this</span><input class="inp money" id="ex-amt" inputmode="decimal" placeholder="$0" value="${cur ? esc(String(cur.amt)) : ''}"></label>
    <div class="row-btns end">${cur ? '<button class="btn danger sm" data-del>Remove</button><span class="grow"></span>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = e => {
    const w = e.target.closest('[data-who]');
    if (w) { who = w.dataset.who; el.querySelectorAll('#ex-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    const save = extras => { M.savePot({ ...pot, extras: extras.length ? extras : undefined }); closeSheet(); ctx.render(true); };
    if (e.target.closest('[data-del]')) return save(list.filter(x => x.id !== cur.id));
    if (!e.target.closest('[data-save]')) return;
    const amt = parseMoney(el.querySelector('#ex-amt').value);
    if (!amt) return toast('How much is in it?');
    const next = { id: cur?.id || uid(), slot: who, label: el.querySelector('#ex-label').value.trim() || undefined, amt };
    save([...list.filter(x => x.id !== next.id), next]);
  };
}

function planCard(pot, y) {
  const slots = M.slotsOf(pot), cells = M.cellsOf(pot.id, y), now = M.nowYM();
  const months = new Set(M.monthsOf(y));
  slots.forEach(s => Object.keys(cells[s]).forEach(m => months.add(m)));
  const list = [...months].sort();
  const dueMonths = new Set(M.duesOf(pot, y).map(d => d.ym));
  let lastYear = null, rows = '', overSeen = false;
  for (const m of list) {
    const my = +m.slice(0, 4);
    if (my !== y && my !== lastYear) rows += `<div class="early">${my < y ? `Saved early, in ${my}` : `In ${my}`}</div>`;
    if (my === y && lastYear !== null && lastYear !== y) rows += `<div class="early">${y}</div>`;
    lastYear = my;
    rows += `<div class="m${m === now ? ' now' : ''}">${MON[+m.slice(5, 7) - 1]}${my !== y ? ` <span class="tiny faint">&nbsp;’${String(my).slice(2)}</span>` : ''}${dueMonths.has(m) ? ' <span title="Money needed by the end of this month">💳</span>' : ''}</div>` + slots.map(s => {
      const c = cells[s][m], plan = M.cellPlan(c), shown = c?.done && c.amt != null ? c.amt : plan, key = `${pot.id}|${y}|${s}|${m}`;
      // That month, this person's pots add up to more than they put into savings.
      const over = !pot.separate && shown && (M.monthSummary(s, m).gap ?? 0) < -0.5;
      if (over) overSeen = true;
      return `<div class="cell${over ? ' over' : ''}"${over ? ` title="${esc(nameOf(s))}’s pots add up to more than the savings amount in ${esc(monthName(m))}"` : ''}><button class="amtbtn${shown ? '' : ' none'}" data-cell="${key}">${shown ? money(shown) : '—'}</button>
        <button class="check sm" data-done="${key}" aria-pressed="${!!c?.done}" ${shown ? '' : 'disabled'} aria-label="Done">✓</button></div>`;
    }).join('');
  }
  const st = M.potStats(pot, y);
  const totals = `<div class="tot k">Total</div>` + slots.map(s => `<div class="tot">${money(st.per[s].plan)}<div class="tiny muted">${money(st.per[s].saved)} in</div></div>`).join('');
  return `<section class="card"><div class="card-head"><h3>Month by month${pot.type === 'year' ? ` · ${esc(yearTag(pot, y))}` : ` · ${y}`}</h3><button class="btn sm" data-spread>Spread it out</button></div>
    <p class="hint">Tap an amount to change it. Tick a month once the money is in.${overSeen ? ' <span class="bad">Red amounts: that month’s pots add up to more than the savings amount.</span>' : ''}</p>
    <div class="plan" style="--cols:${slots.length}"><div class="h"></div>${slots.map(s => `<div class="h">${slots.length > 1 ? esc(nameOf(s)) : 'Amount'}</div>`).join('')}${rows}${totals}</div></section>`;
}

async function editTarget(pot, y, ctx) {
  const slots = M.slotsOf(pot), py = M.potYear(pot.id, y) || {};
  const cur = pot.type === 'goal' ? (pot.goal || {}) : (py.target || {});
  const el = openSheet(`<h3>${pot.type === 'goal' ? 'Goal' : `Target for ${esc(yearTag(pot, y))}`}</h3>
    <div class="${slots.length > 1 ? 'fields2' : ''}">${slots.map(s => `<label class="field"><span>${slots.length > 1 ? esc(nameOf(s)) : 'Amount'}</span><input class="inp money" data-amt="${s}" inputmode="decimal" placeholder="$0" value="${cur[s] != null ? esc(String(cur[s])) : ''}"></label>`).join('')}</div>
    ${pot.type === 'year' ? `<p class="hint">After saving, <b>Spread it out</b> fills in the months.</p>` : ''}
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) closeSheet();
    if (!e.target.closest('[data-save]')) return;
    const amts = readAmounts(el);
    if (pot.type === 'goal') M.savePot({ ...pot, goal: amts });
    else M.setPotYear(pot.id, y, { ...py, target: amts });
    closeSheet(); ctx.render(true);
  };
}

function spreadSheet(pot, y, ctx) {
  const slots = M.slotsOf(pot), st = M.potStats(pot, y), now = M.nowYM();
  const first = M.ymOf(y, 1) > now ? M.ymOf(y, 1) : (now.slice(0, 4) == y ? now : M.ymOf(y, 1));
  const monthsSel = (id, val) => `<select class="inp" id="${id}">${M.monthsBetween(M.ymOf(y - 1, 1), M.ymOf(y, 12)).map(m => `<option value="${m}" ${m === val ? 'selected' : ''}>${monShort(m)} ${m.slice(0, 4)}</option>`).join('')}</select>`;
  const el = openSheet(`<h3>Spread it out</h3>
    <p class="muted small">Split an amount evenly over months. Months already ticked done stay as they are and count towards it.</p>
    <div class="${slots.length > 1 ? 'fields2' : ''}">${slots.map(s => {
      const p = st.per[s], amount = p.target != null ? Math.max(0, r2(p.target - p.carry)) : '';
      return `<label class="field"><span>${slots.length > 1 ? esc(nameOf(s)) + '’s amount' : 'Amount'}</span><input class="inp money" data-amt="${s}" inputmode="decimal" placeholder="$0" value="${amount === '' ? '' : esc(String(amount))}"></label>`;
    }).join('')}</div>
    <div class="fields2"><label class="field"><span>From</span>${monthsSel('sp-from', first)}</label><label class="field"><span>To</span>${monthsSel('sp-to', M.ymOf(y, 12))}</label></div>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Spread</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) closeSheet();
    if (!e.target.closest('[data-save]')) return;
    const from = el.querySelector('#sp-from').value, to = el.querySelector('#sp-to').value;
    if (from > to) return toast('“From” needs to come before “To”.');
    const amts = readAmounts(el);
    let n = 0;
    slots.forEach(s => { if (amts[s] != null) n = M.spreadPlan(pot, y, s, amts[s], from, to); });
    if (pot.type === 'year' && !M.potYear(pot.id, y)) M.setPotYear(pot.id, y, { target: amts });
    closeSheet(); toast(`Spread over ${n} month${n === 1 ? '' : 's'}`); ctx.render(true);
  };
}

// ── Planning another year of one pot ─────────────────────────────────────
function planYearOf(pot, y, ctx) {
  const prev = M.potStats(pot, y - 1), slots = M.slotsOf(pot);
  const el = openSheet(`<h3>${esc(pot.name)} in ${y}</h3>
    <p class="muted small">Start with last year’s target, or change it. You can also do every pot at once from <b>Years</b>.</p>
    <div class="${slots.length > 1 ? 'fields2' : ''}">${slots.map(s => `<label class="field"><span>${slots.length > 1 ? esc(nameOf(s)) : 'Target'}</span><input class="inp money" data-amt="${s}" inputmode="decimal" value="${prev.per[s].target != null ? esc(String(prev.per[s].target)) : ''}" placeholder="$0"></label>`).join('')}</div>
    ${prev.tot.balance > 0.5 ? `<label class="toggle"><input type="checkbox" id="py-carry"> Bring over what’s left from ${y - 1} (${money(prev.tot.balance)})</label>` : ''}
    <label class="toggle"><input type="checkbox" id="py-spread" checked> Spread it over ${y}’s months</label>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Plan ${y}</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) closeSheet();
    if (!e.target.closest('[data-save]')) return;
    const target = readAmounts(el), carry = el.querySelector('#py-carry')?.checked;
    const data = { target };
    if (carry) data.carry = Object.fromEntries(slots.map(s => [s, Math.max(0, prev.per[s].balance)]));
    M.setPotYear(pot.id, y, data);
    if (el.querySelector('#py-spread').checked) {
      const from = M.ymOf(y, 1) > M.nowYM() ? M.ymOf(y, 1) : M.nowYM();
      slots.forEach(s => { if (target[s]) M.spreadPlan(pot, y, s, Math.max(0, target[s] - (data.carry?.[s] || 0)), from, M.ymOf(y, 12)); });
    }
    potYearShown[pot.id] = y;
    closeSheet(); ctx.render();
  };
}

// ── Plan by month: pots for a year, each with its twelve months ──────────
// Route months-<a|b|both>-<year>. Like filling in the spreadsheet: every pot's amount for every
// month, with each month's total checked against what goes into savings that month.
// "both" shows the two of you together: shared pots get a row for each of you.
export function renderMonthPlan(view, ctx, arg) {
  const [who, ys] = String(arg).split('-'), y = +ys;
  if (!['a', 'b', 'both'].includes(who) || !y) return false;
  ctx.topbar.set('Plan by month', { back: 'pots', backLabel: 'Pots' });
  const slots = who === 'both' ? bothSlots() : [who];
  const months = M.monthsOf(y), now = M.nowYM();
  const perSlot = Object.fromEntries(slots.map(s => [s, M.yearMonthCheck(s, y)]));
  // Each month: the savings amount and the pots, for one of you or both together.
  const checks = months.map((ym, i) => {
    const rs = slots.map(s => perSlot[s][i]);
    const total = rs.every(r => r.total == null) ? null : r2(rs.reduce((t, r) => t + (r.total || 0), 0));
    const planned = r2(rs.reduce((t, r) => t + r.planned, 0)), gap = total == null ? null : r2(total - planned);
    return { ym, total, planned, gap, ok: gap == null || Math.abs(gap) < 0.5, over: Object.fromEntries(slots.map((s, k) => [s, (rs[k].gap ?? 0) < -0.5])) };
  });

  // Every pot either of you puts money into in this year, plus this year's yearly pots with nothing planned yet.
  const lines = new Map();
  for (const s of slots) for (const m of months) for (const l of M.monthLines(s, m)) lines.set(`${l.pot.id}|${l.year}`, { pot: l.pot, year: l.year });
  for (const p of M.yearPots(y)) if (slots.some(s => M.isMine(p, s)) && !lines.has(`${p.id}|${y}`)) lines.set(`${p.id}|${y}`, { pot: p, year: y });
  const rank = p => (p.separate ? 3 : p.owner === 'j' ? 2 : p.owner === slots[0] ? 0 : 1);
  const list = [...lines.values()].sort((x, z) => rank(x.pot) - rank(z.pot) || x.year - z.year || (x.pot.order ?? 0) - (z.pot.order ?? 0));

  const tiles = checks.map(r => `<button class="mtile${r.ok ? '' : r.gap > 0 ? ' spare' : ' over'}${r.ym === now ? ' now' : ''}" data-mt="${r.ym}">
      <b>${esc(monShort(r.ym))}</b><span class="num">${r.total == null ? '—' : money0(r.total)}</span>
      <small>${r.total == null ? 'set it' : r.ok ? '✓' : r.gap > 0 ? `${money0(r.gap)} spare` : `${money0(-r.gap)} over`}</small></button>`).join('');

  const chipRow = (pot, year, s) => {
    const cells = M.cellsOf(pot.id, year)[s] || {}, due = new Set(M.duesOf(pot, year).map(d => d.ym));
    return `<div class="mchips">${months.map((m, i) => {
      const c = cells[m], plan = M.cellPlan(c), shown = c?.done && c.amt != null ? c.amt : plan;
      const over = !pot.separate && shown && checks[i].over[s];
      return `<button class="mchip${c?.done ? ' done' : ''}${shown ? '' : ' none'}${over ? ' over' : ''}${m === now ? ' now' : ''}" data-cell="${pot.id}|${year}|${s}|${m}">
        <small>${esc(monShort(m))}${due.has(m) ? ' 💳' : ''}</small><b>${shown ? money0(shown) : '—'}</b></button>`;
    }).join('')}</div>`;
  };
  const potCard = ({ pot, year }) => {
    const st = M.potStats(pot, year), rows = M.slotsOf(pot).filter(s => slots.includes(s));
    const planned = r2(rows.reduce((t, s) => t + months.reduce((x, m) => { const c = (M.cellsOf(pot.id, year)[s] || {})[m]; return x + (c ? (c.done ? M.cellSaved(c) : M.cellPlan(c)) : 0); }, 0), 0));
    const target = rows.every(s => st.per[s]?.target != null) ? r2(rows.reduce((t, s) => t + st.per[s].target, 0)) : null;
    let status = '';
    if (pot.type === 'year' && target != null) {
      const all = r2(rows.reduce((t, s) => t + (st.per[s].carry || 0) + st.per[s].plan + (st.per[s].added || 0), 0)), diff = r2(target - all);
      status = Math.abs(diff) < 0.5 ? '<span class="good">✓ all planned</span>' : diff > 0 ? `<span class="warn">${money(diff)} still to plan</span>` : `<span class="bad">${money(-diff)} more than the target</span>`;
    }
    return `<section class="card flat mplan"><div class="mp-head">${jarOf(pot, year, 30)}
        <div class="grow"><button class="nmbtn" data-pot="${pot.id}" data-year="${year}">${esc(pot.name)}</button>
          <div class="meta">${pot.owner === 'j' ? ownerTag('j', 'ours') : who === 'both' ? ownerTag(pot.owner) : ''}${year !== y && pot.type === 'year' ? `<span class="tag c-lav">for ${esc(yearTag(pot, year))}</span>` : ''}${pot.separate ? '<span class="tag c-honey">kept apart</span>' : ''}
            <span>${target != null ? `${pot.type === 'goal' ? 'Goal' : 'Target'} ${money0(target)} · ` : ''}${money0(planned)} in ${y}</span> ${status} ${shortTag(pot, year)}</div></div>
        <button class="btn sm ghost" data-spreadpot="${pot.id}|${year}">Spread</button></div>
      ${rows.length > 1 ? rows.map(s => `<div class="mrowlabel">${ownerTag(s)}</div>${chipRow(pot, year, s)}`).join('') : chipRow(pot, year, rows[0])}</section>`;
  };

  const allYs = [...new Set([...M.dataYears(), M.nowYear(), M.nowYear() + 1])].sort();
  const prev = allYs.filter(v => v < y).pop(), next = allYs.find(v => v > y);
  const bad = checks.filter(r => !r.ok).length;
  const color = who === 'both' ? '' : ` style="--pc:${esc(ownerColor(who))}"`;
  view.innerHTML = `<div class="seg wide" role="group" aria-label="Whose plan">${[...bothSlots().map(s => [s, nameOf(s)]), ['both', 'Both']].map(([k, l]) => `<button data-who="${k}" aria-pressed="${k === who}">${esc(l)}</button>`).join('')}</div>
    <div class="stepper"><button class="iconbtn" data-yy="${prev ?? ''}" ${prev == null ? 'disabled' : ''} aria-label="Year before">‹</button>
      <span class="label">${y}<span class="tiny">${list.length} pot${list.length === 1 ? '' : 's'}</span></span>
      <button class="iconbtn" data-yy="${next ?? ''}" ${next == null ? 'disabled' : ''} aria-label="Year after">›</button></div>
    <section class="card ${who === 'both' ? 'c-honey' : 'pcol'}"${color}><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>${who === 'both' ? `Our months in ${y}` : `${esc(ownerPossessive(who))} months in ${y}`}</h3><span class="sub">${bad ? `${bad} to look at` : 'all add up'}</span></div>
      <p class="hint">Each month: what goes into savings${who === 'both' ? ' (both of you together)' : ''}, and whether the pots below add up to it. Tap a month to ${who === 'both' ? 'open it' : 'change its savings amount'}.</p>
      <div class="mtiles">${tiles}</div></section>
    <p class="hint">Tap any month of a pot to change it (or the rest of the year with it). Ticked months are already in.</p>
    ${list.length ? list.map(potCard).join('') : `<div class="empty">No pots in ${y} yet.</div>`}`;

  view.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.who) return ctx.go(`months-${b.dataset.who}-${y}`);
    if (b.dataset.yy) return ctx.go(`months-${who}-${b.dataset.yy}`);
    if (b.dataset.mt) { if (who === 'both') { showMonth(b.dataset.mt); return ctx.go('pots'); } return editTotal(who, b.dataset.mt, ctx); }
    if (b.dataset.pot) return ctx.go(`pot-${b.dataset.pot}@${b.dataset.year}`);
    if (b.dataset.spreadpot) { const [id, yr] = b.dataset.spreadpot.split('|'); return spreadSheet(M.getPot(id), +yr, ctx); }
    if (b.dataset.cell) {
      const m = b.dataset.cell.split('|')[3];
      return editCell(b.dataset.cell, ctx, { rest: months.filter(x => x > m), restLabel: `The rest of ${y} too` });
    }
  };
  return true;
}
