// The money model: pots and their years, each month's plan, money taken out,
// the budget and the owings. Everything is shared (merged field by field, see store.js).
//
// Documents (all shared):
//   pots            <potId> → { name, emoji, owner: 'a'|'b'|'j', type: 'year'|'goal',
//                               goal?: {a?, b?}, start?: {a?, b?}, note?, order?, archived? }
//   y<YYYY>         py:<pot> → { target: {a?, b?}, carry?: {a?, b?}, label? }      (a yearly pot's year)
//                   c:<pot>:<slot>:<YYYY-MM> → { plan, done?, amt? }              (money into a pot)
//                   w:<id> → { pot, ym, a?, b?, note }                             (money taken out by hand)
//     A yearly pot's money lives in its own year's doc, even when it's put in the year
//     before (saving early for next year). A goal pot's lives in the calendar year's doc.
//   totals          <slot>:<YYYY-MM> → what that person puts into savings that month
//                   (a month without its own amount keeps the last one before it)
//   budget          inc:<slot> → { amt, freq }   g:<id> → { name, emoji, order }
//                   i:<id> → { name, group, amt, freq, who: 'a'|'b'|'j', split?, acct?, note?, track?, order }
//   o<YYYY-MM>      e:<id> → { date, desc, cat, amt, by: 'j'|'a'|'b', cov, lines: [{ id, desc, amt, cov }], note, at }
//                   pd:<id>:<party> → { at, by }   (that party has paid their part back)
//     cov (who covers it): 'both' (split 50/50) | 'a' | 'b' | 'j' (joint money: nobody owes)
//                          | 'tbd' (decide later) | 'pot:<potId>' (taken out of a pot)
//   settings        cats → [{ id, name, emoji }]

import * as store from './store.js';
import { r2, thisYM } from './ui.js';

// ── Cached reads, cleared whenever anything changes ──────────────────────
const cache = new Map();
store.on(() => cache.clear());
export const vals = doc => { if (!cache.has('v:' + doc)) cache.set('v:' + doc, store.values(doc)); return cache.get('v:' + doc); };
const memo = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
export const clearCache = () => cache.clear();

// ── Months ───────────────────────────────────────────────────────────────
export const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export function addMonths(ym, n) {
  const t = +ym.slice(0, 4) * 12 + (+ym.slice(5, 7) - 1) + n;
  return ymOf(Math.floor(t / 12), (t % 12) + 1);
}
export const monthsOf = y => Array.from({ length: 12 }, (_, i) => ymOf(y, i + 1));
export const yearOfYM = ym => +ym.slice(0, 4);
export const nowYM = () => thisYM();
export const nowYear = () => new Date().getFullYear();
export const monthsBetween = (from, to) => { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; };

// ── Pots ─────────────────────────────────────────────────────────────────
export function allPots({ archived = false } = {}) {
  return memo('pots:' + archived, () => Object.entries(vals('pots')).map(([id, p]) => ({ id, ...p }))
    .filter(p => archived || !p.archived)
    .sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name))));
}
export const getPot = id => { const p = vals('pots')[id]; return p ? { id, ...p } : null; };
export function savePot(p) { const { id, ...rest } = p; store.setField('pots', id, rest); }
export const slotsOf = pot => (pot.owner === 'j' ? ['a', 'b'] : [pot.owner]);
export const isMine = (pot, slot) => pot.owner === slot || pot.owner === 'j';

const Y = y => 'y' + y;
export const dataYears = () => memo('years', () => store.docsLike('y').filter(d => /^y\d{4}$/.test(d)).map(d => +d.slice(1)).sort());
export const potYear = (potId, y) => vals(Y(y))['py:' + potId] || null;
export function setPotYear(potId, y, data) { store.setField(Y(y), 'py:' + potId, data); }

/** The years a pot has: a yearly pot's own years; a goal pot's years with money in or out. */
export function yearsOfPot(pot) {
  return memo('yop:' + pot.id, () => {
    const out = [];
    for (const y of dataYears()) {
      const v = vals(Y(y));
      if (pot.type === 'year') { if (v['py:' + pot.id]) out.push(y); continue; }
      const pre = `c:${pot.id}:`;
      if (Object.keys(v).some(k => k.startsWith(pre)) || Object.values(v).some(w => w && w.pot === pot.id)) out.push(y);
    }
    if (pot.type === 'goal') owingUsesOf(pot.id).forEach(u => { if (!out.includes(u.py)) out.push(u.py); });
    return out.sort();
  });
}

/** One pot-year's money in: { a: { 'YYYY-MM': cell }, b: {…} } */
export function cellsOf(potId, y) {
  return memo(`cells:${potId}:${y}`, () => {
    const out = { a: {}, b: {} }, pre = `c:${potId}:`;
    for (const [k, v] of Object.entries(vals(Y(y)))) {
      if (!k.startsWith(pre)) continue;
      const [, , slot, ym] = k.split(':');
      if (out[slot]) out[slot][ym] = v;
    }
    return out;
  });
}
export const cellPlan = c => (c ? r2(c.plan || 0) : 0);
export const cellSaved = c => (c && c.done ? r2(c.amt ?? c.plan ?? 0) : 0);
export const cellKey = (potId, slot, ym) => `c:${potId}:${slot}:${ym}`;
export function setCell(potId, y, slot, ym, patch) {
  const key = cellKey(potId, slot, ym), cur = vals(Y(y))[key] || {};
  const next = { ...cur, ...patch };
  if (next.amt == null || next.amt === next.plan) delete next.amt;
  if (!next.done) delete next.done;
  store.setField(Y(y), key, next.plan || next.amt ? next : null);
}
/** Several fields of one year's doc at once: { key: value }. */
export const setYearFields = (y, fields) => store.setFields(Y(y), fields);

/** Money taken out by hand, for one pot in one year's doc. */
export function manualUses(potId, y) {
  return Object.entries(vals(Y(y))).filter(([k, w]) => k.startsWith('w:') && w && w.pot === potId)
    .map(([k, w]) => ({ ...w, id: k.slice(2), py: y, kind: 'manual' }));
}
export function saveUse(y, use) { const { id, py, kind, ...rest } = use; store.setField(Y(y), 'w:' + id, rest); }
export function deleteUse(y, id) { store.setField(Y(y), 'w:' + id, null); }
export const usesOf = (potId, y) => [...manualUses(potId, y), ...owingUsesOf(potId).filter(u => u.py === y)]
  .sort((x, z) => String(z.date || z.ym).localeCompare(String(x.date || x.ym)));

/**
 * Money put in by hand, outside the monthly plan (a past deposit, a lump sum), by either of you:
 * y<YYYY> d:<id> → { pot, ym, a?, b?, note }. It counts as saved, but not in a month's savings check.
 */
export function manualDeposits(potId, y) {
  return Object.entries(vals(Y(y))).filter(([k, d]) => k.startsWith('d:') && d && d.pot === potId)
    .map(([k, d]) => ({ ...d, id: k.slice(2), py: y, kind: 'deposit' }))
    .sort((x, z) => String(z.ym).localeCompare(String(x.ym)));
}
export function saveDeposit(y, dep) { const { id, py, kind, ...rest } = dep; store.setField(Y(y), 'd:' + id, rest); }
export function deleteDeposit(y, id) { store.setField(Y(y), 'd:' + id, null); }
/** Deposits by hand for one person in one calendar month, across every pot (for the year's bars). */
export function depositsInMonth(slot, ym) {
  let t = 0;
  for (const y of dataYears()) for (const [k, d] of Object.entries(vals(Y(y)))) if (k.startsWith('d:') && d && d.ym === ym) t += +d[slot] || 0;
  return r2(t);
}

/** Saved / planned / used per person in one year's doc. saved includes money put in by hand (added). */
function flows(pot, y) {
  return memo(`flows:${pot.id}:${y}`, () => {
    const cells = cellsOf(pot.id, y), uses = usesOf(pot.id, y), deps = manualDeposits(pot.id, y), out = {};
    for (const s of slotsOf(pot)) {
      let plan = 0, saved = 0, months = 0, done = 0;
      for (const c of Object.values(cells[s] || {})) { plan += cellPlan(c); saved += cellSaved(c); if (cellPlan(c) || c.amt) { months++; if (c.done) done++; } }
      const added = r2(deps.reduce((t, d) => t + (+d[s] || 0), 0));
      out[s] = { plan: r2(plan), saved: r2(saved + added), added, used: r2(uses.reduce((t, u) => t + (u[s] || 0), 0)), months, done };
    }
    return out;
  });
}

/**
 * A pot's numbers for a year (a yearly pot's own year, or a goal pot's calendar year):
 * per person and in total. have = brought in + saved (how full it got), balance = what's
 * in it now (have − used), left = still to put in to reach the target.
 */
export function potStats(pot, y) {
  return memo(`stats:${pot.id}:${y}`, () => {
    const f = flows(pot, y), py = pot.type === 'year' ? potYear(pot.id, y) : null;
    const per = {}, tot = { target: null, carry: 0, plan: 0, saved: 0, used: 0, have: 0, balance: 0, left: 0, unplanned: 0 };
    for (const s of slotsOf(pot)) {
      let target, carry = 0;
      if (pot.type === 'year') { target = py?.target?.[s] ?? null; carry = py?.carry?.[s] || 0; }
      else {
        // A goal also counts what was in it before you tracked it, and money for it in your own accounts.
        target = pot.goal?.[s] ?? null;
        carry = (pot.start?.[s] || 0) + extrasOf(pot, s);
        for (const yr of yearsOfPot(pot)) if (yr < y) { const g = flows(pot, yr)[s]; carry += g.saved - g.used; }
      }
      const x = f[s];
      const have = r2(carry + x.saved);
      const p = {
        ...x, target, carry: r2(carry), have, balance: r2(have - x.used),
        left: target != null ? r2(Math.max(0, target - have)) : 0,
        unplanned: target != null ? r2(Math.max(0, target - carry - x.plan - (x.added || 0))) : 0,
      };
      per[s] = p;
      for (const k of ['carry', 'plan', 'saved', 'used', 'have', 'balance', 'left', 'unplanned']) tot[k] = r2(tot[k] + p[k]);
    }
    // A shared pot only has a total target when you both have one (else each person's shows on its page).
    const slots = slotsOf(pot);
    if (slots.every(s => per[s].target != null)) tot.target = r2(slots.reduce((t, s) => t + per[s].target, 0));
    else { tot.left = 0; tot.unplanned = 0; tot.partTarget = slots.some(s => per[s].target != null); }
    tot.reached = tot.target != null && tot.target > 0 && tot.have >= tot.target - 0.5;
    return { per, tot, py };
  });
}
/**
 * Money for a goal that sits in one of your own accounts, outside the pot's monthly money
 * (e.g. Adri's own house savings): pot.extras = [{ id, slot, label, amt }]. It counts on top.
 */
export const extrasList = pot => (pot.extras || []).filter(x => x && +x.amt);
export const extrasOf = (pot, s) => r2(extrasList(pot).filter(x => x.slot === s).reduce((t, x) => t + (+x.amt || 0), 0));

/** 0…1 how full the jar is, and how much of that was spent again. */
export function jarLevels(st) {
  const t = st.tot;
  if (!t.target) return { full: t.have > 0 ? 0.4 : 0, spent: t.have > 0 && t.used > 0 ? Math.min(0.4, 0.4 * t.used / t.have) : 0 };
  const full = Math.min(1, Math.max(0, t.have / t.target));
  return { full, spent: t.have > 0 ? Math.min(full, full * Math.max(0, t.used) / t.have) : 0 };
}

/** For a yearly pot, the year to use for something on `date` (YYYY-MM-DD or YYYY-MM). */
export function potYearFor(pot, date) {
  const y = +String(date).slice(0, 4);
  if (pot.type !== 'year') return y;
  const ys = yearsOfPot(pot);
  if (ys.includes(y)) return y;
  const before = ys.filter(v => v < y), after = ys.filter(v => v > y);
  return before.length ? before[before.length - 1] : after.length ? after[0] : y;
}
/** How a joint pot's money splits between you: Adri's share, 0…1 (by your targets when you both have one, else half each). */
export function jointShare(pot, y) {
  const t = pot.type === 'year' ? potYear(pot.id, y)?.target : pot.goal;
  const a = +(t?.a || 0), b = +(t?.b || 0);
  return a > 0 && b > 0 ? a / (a + b) : 0.5;   // half each unless you both have a target
}

// ── Each month's money into pots ─────────────────────────────────────────
/** Everything planned for one person in one month, across pots (saving early for next year's pots too). */
export function monthLines(slot, ym) {
  return memo(`ml:${slot}:${ym}`, () => {
    const y = yearOfYM(ym), out = [], suffix = `:${slot}:${ym}`;
    for (const yr of dataYears()) {
      if (yr < y - 1 || yr > y + 3) continue;
      for (const [k, c] of Object.entries(vals(Y(yr)))) {
        if (!k.startsWith('c:') || !k.endsWith(suffix)) continue;
        const pot = getPot(k.split(':')[1]);
        if (!pot || pot.archived) continue;
        out.push({ pot, year: yr, cell: c, key: k });
      }
    }
    const rank = p => (p.separate ? 2 : p.owner === 'j' ? 1 : 0);
    return out.sort((x, z) => rank(x.pot) - rank(z.pot) || x.year - z.year || (x.pot.order ?? 0) - (z.pot.order ?? 0) || String(x.pot.name).localeCompare(String(z.pot.name)));
  });
}
export function monthTotal(slot, ym) {
  const t = vals('totals'), own = t[`${slot}:${ym}`];
  if (own != null) return { amt: own, own: true, from: ym };
  let best = null;
  for (const k of Object.keys(t)) { const [s, m] = k.split(':'); if (s === slot && m < ym && (!best || m > best)) best = m; }
  return best ? { amt: t[`${slot}:${best}`], own: false, from: best } : { amt: null, own: false, from: null };
}
/** scope 'on' = this month and the months after it; 'just' = only this month. */
export function setMonthTotal(slot, ym, amt, scope = 'on') {
  const before = monthTotal(slot, ym).amt, next = addMonths(ym, 1);
  const fields = { [`${slot}:${ym}`]: amt };
  if (scope === 'just' && !monthTotal(slot, next).own) fields[`${slot}:${next}`] = before;
  store.setFields('totals', fields);
}
/**
 * One person's month. Pots kept apart (a house deposit in its own account) don't count
 * towards the monthly savings amount: `planned` and `gap` leave them out, `apart` is theirs.
 */
export function monthSummary(slot, ym) {
  const lines = monthLines(slot, ym), total = monthTotal(slot, ym);
  const sum = (list, f) => r2(list.reduce((t, l) => t + f(l.cell), 0));
  const inSavings = lines.filter(l => !l.pot.separate), apartLines = lines.filter(l => l.pot.separate);
  const planned = sum(inSavings, cellPlan), apart = sum(apartLines, cellPlan);
  const done = sum(lines, cellSaved);
  const left = lines.filter(l => !l.cell.done && cellPlan(l.cell) > 0).length;
  return { lines, inSavings, apartLines, total, planned, apart, done, left, gap: total.amt == null ? null : r2(total.amt - planned) };
}

/**
 * Everything ever put into a pot by each of you (starting amounts included), what was used,
 * and what's planned but not in yet: { per: { a: { put, used, planned } }, tot }.
 */
export function lifetime(pot) {
  return memo('life:' + pot.id, () => {
    const per = {}, tot = { put: 0, used: 0, planned: 0 };
    for (const s of slotsOf(pot)) {
      let put = pot.type === 'goal' ? +(pot.start?.[s] || 0) : 0, used = 0, planned = 0;
      for (const y of yearsOfPot(pot)) {
        const f = flows(pot, y)[s];
        put += f.saved; used += f.used;
        for (const c of Object.values(cellsOf(pot.id, y)[s] || {})) if (!c.done) planned += cellPlan(c);
      }
      per[s] = { put: r2(put), used: r2(used), planned: r2(Math.max(0, planned)), extra: pot.type === 'goal' ? extrasOf(pot, s) : 0 };
      for (const k of ['put', 'used', 'planned', 'extra']) tot[k] = r2((tot[k] || 0) + per[s][k]);
    }
    return { per, tot };
  });
}

/** The yearly pots that are part of a year (not put away). */
export const yearPots = y => allPots().filter(p => p.type === 'year' && potYear(p.id, y));
/** Takes a pot out of a year: only when nothing has gone in, so no history is lost. */
export function removeFromYear(pot, y) {
  const fields = { ['py:' + pot.id]: null }, cells = cellsOf(pot.id, y);
  for (const s of ['a', 'b']) for (const [m, c] of Object.entries(cells[s] || {})) { if (c.done) return false; fields[cellKey(pot.id, s, m)] = null; }
  if (manualUses(pot.id, y).length || owingUsesOf(pot.id).some(u => u.py === y)) return false;
  setYearFields(y, fields);
  return true;
}

/**
 * Spread `amount` over the months from…to for one person: whole dollars each month
 * (cents only if the amount has them), with the odd dollars in the last months.
 * keepDone: months already marked done stay as they are, and their money counts.
 */
export function spreadPlan(pot, y, slot, amount, from, to, { keepDone = true } = {}) {
  const cells = cellsOf(pot.id, y)[slot] || {};
  let months = monthsBetween(from, to), have = 0;
  if (keepDone) { months = months.filter(m => { if (cells[m]?.done) { have += cellSaved(cells[m]); return false; } return true; }); }
  const rest = Math.max(0, r2(amount - have));
  const fields = {};
  if (!months.length) return 0;
  const whole = Math.abs(rest - Math.round(rest)) < 0.005;
  const unit = whole ? 1 : 0.01, units = Math.round(rest / unit);
  const each = Math.floor(units / months.length), extra = units - each * months.length;
  months.forEach((m, i) => {
    const plan = r2((each + (i >= months.length - extra ? 1 : 0)) * unit);
    const cur = cells[m] || {};
    fields[cellKey(pot.id, slot, m)] = plan ? { ...cur, plan } : (cur.done ? { ...cur, plan: 0 } : null);
  });
  setYearFields(y, fields);
  return months.length;
}

// ── Budget ───────────────────────────────────────────────────────────────
export const FREQ = { w: 52, f: 26, m: 12, q: 4, y: 1 };
export const FREQ_LABEL = { w: 'week', f: 'fortnight', m: 'month', q: 'quarter', y: 'year' };
export const FREQ_SHORT = { w: '/wk', f: '/fn', m: '/mo', q: '/qtr', y: '/yr' };
export const perYear = (amt, freq) => r2((+amt || 0) * (FREQ[freq] || 12));
export const fromYear = (yearly, period) => yearly / (FREQ[period] || 12);
export const income = slot => vals('budget')['inc:' + slot] || null;
export function budgetGroups() {
  return memo('bgroups', () => Object.entries(vals('budget')).filter(([k]) => k.startsWith('g:')).map(([k, g]) => ({ id: k.slice(2), ...g }))
    .sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name))));
}
export function budgetItems() {
  return memo('bitems', () => Object.entries(vals('budget')).filter(([k]) => k.startsWith('i:')).map(([k, i]) => ({ id: k.slice(2), ...i }))
    .sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name))));
}
/** A budget item's cost to each of you, per year. */
export function itemShares(i) {
  const y = perYear(i.amt, i.freq);
  if (i.who === 'a') return { a: y, b: 0 };
  if (i.who === 'b') return { a: 0, b: y };
  const s = i.split ?? 0.5;
  return { a: r2(y * s), b: r2(y * (1 - s)) };
}
export function budgetTotals() {
  const out = {};
  for (const s of ['a', 'b']) {
    const inc = income(s);
    const bills = budgetItems().reduce((t, i) => t + itemShares(i)[s], 0);
    const save = (monthTotal(s, nowYM()).amt || 0) * 12;
    // Pots kept apart (a house deposit) come out of your pay too, on top of the savings amount.
    const sum = monthSummary(s, nowYM()), apart = sum.apart * 12;
    const apartNames = [...new Set(sum.apartLines.map(l => l.pot.name))];
    const incY = inc ? perYear(inc.amt, inc.freq) : null;
    out[s] = { income: incY, bills: r2(bills), savings: r2(save), apart: r2(apart), apartNames, left: incY == null ? null : r2(incY - bills - save - apart) };
  }
  return out;
}

// ── Categories (for owings) ──────────────────────────────────────────────
export const DEFAULT_CATS = [
  ['groceries', 'Groceries', '🛒'], ['food', 'Food', '🍜'], ['health', 'Health', '💊'], ['household', 'Household', '🏠'],
  ['tickets', 'Tickets', '🎟️'], ['laundry', 'Laundry', '🧺'], ['petrol', 'Petrol', '⛽'], ['tolls', 'Tolls', '🛣️'],
  ['house-hunting', 'House hunting', '🔑'], ['amazon', 'Amazon', '📦'], ['bunnings', 'Bunnings', '🔨'], ['misc', 'Misc', '✨'],
  ['review', 'Review together', '🤔'],
].map(([id, name, emoji]) => ({ id, name, emoji }));
export const cats = () => vals('settings').cats || DEFAULT_CATS;
export const catOf = id => cats().find(c => c.id === id) || (id ? { id, name: id, emoji: '•' } : { id: '', name: 'No category', emoji: '•' });
export const setCats = list => store.setField('settings', 'cats', list);

// ── Owings ───────────────────────────────────────────────────────────────
const O = ym => 'o' + ym;
export const owingMonths = () => memo('omonths', () => store.docsLike('o').filter(d => /^o\d{4}-\d{2}$/.test(d)).map(d => d.slice(1)).sort());
export function entries(ym) {
  return memo('ent:' + ym, () => Object.entries(vals(O(ym))).filter(([k]) => k.startsWith('e:')).map(([k, e]) => ({ id: k.slice(2), ...e }))
    .sort((x, y) => String(y.date).localeCompare(String(x.date)) || (y.at || 0) - (x.at || 0)));
}
export function saveEntry(e, oldYM) {
  const { id, ...rest } = e, ym = String(e.date).slice(0, 7);
  if (oldYM && oldYM !== ym) {
    // Moving to another month: its paid marks move with it.
    const old = vals(O(oldYM)), moved = {}, gone = { ['e:' + id]: null };
    for (const k of Object.keys(old)) if (k.startsWith(`pd:${id}:`)) { moved[k] = old[k]; gone[k] = null; }
    store.setFields(O(ym), { ['e:' + id]: rest, ...moved });
    store.setFields(O(oldYM), gone);
  } else store.setField(O(ym), 'e:' + id, rest);
}
export function deleteEntry(e) {
  const ym = String(e.date).slice(0, 7), v = vals(O(ym)), gone = { ['e:' + e.id]: null };
  for (const k of Object.keys(v)) if (k.startsWith(`pd:${e.id}:`)) gone[k] = null;
  store.setFields(O(ym), gone);
}
export const paidMark = (ym, id, party) => vals(O(ym))[`pd:${id}:${party}`] || null;
export const setPaid = (ym, id, party, on) => store.setField(O(ym), `pd:${id}:${party}`, on ? { at: Date.now(), by: store.me() } : null);
export const setPaidMany = (ym, marks) => store.setFields(O(ym), Object.fromEntries(marks.map(([id, party, on]) => [`pd:${id}:${party}`, on ? { at: Date.now(), by: store.me() } : null])));

/** Who covers each part of a purchase, and so who owes whom. */
export function splitEntry(e) {
  const lines = (e.lines || []).filter(l => +l.amt);
  const linesSum = r2(lines.reduce((t, l) => t + (+l.amt || 0), 0));
  const rest = r2((+e.amt || 0) - linesSum);
  const all = lines.map(l => ({ ...l, amt: r2(+l.amt) }));
  if (rest > 0.004 || !all.length) all.push({ id: 'rest', desc: lines.length ? 'The rest' : '', amt: Math.max(0, rest), cov: e.cov || 'both', rest: true });
  const resp = { a: 0, b: 0, j: 0, tbd: 0 }, pots = { a: 0, b: 0, j: 0 }, potUse = [];
  for (const l of all) {
    const c = l.cov || 'both';
    l.potId = null;
    if (c === 'a' || c === 'b' || c === 'j' || c === 'tbd') resp[c] += l.amt;
    else if (c.startsWith('pot:')) {
      const pot = getPot(c.slice(4));
      if (!pot) { resp.tbd += l.amt; continue; }
      l.potId = pot.id;
      const py = potYearFor(pot, e.date || nowYM());
      const use = { pot, py, amt: l.amt, a: 0, b: 0, line: l };
      if (pot.owner === 'j') { const s = jointShare(pot, py); use.a = r2(l.amt * s); use.b = r2(l.amt - use.a); }
      else use[pot.owner] = l.amt;
      resp.a += use.a; resp.b += use.b; pots.a += use.a; pots.b += use.b;
      potUse.push(use);
    } else { const a = r2(l.amt * (l.share ?? 0.5)); resp.a += a; resp.b += l.amt - a; }
  }
  for (const k in resp) resp[k] = r2(resp[k]);
  const payer = e.by || 'j', owes = [];
  for (const p of ['a', 'b', 'j']) if (p !== payer && resp[p] > 0.004) owes.push({ from: p, to: payer, amt: resp[p], fromPots: r2(pots[p] || 0) });
  return { lines: all, resp, potUse, owes, over: linesSum > (+e.amt || 0) + 0.004 ? r2(linesSum - e.amt) : 0 };
}

/** Every pot's money used through owings: Map potId → [{ id, ym, date, py, a, b, desc }]. */
function owingUseMap() {
  return memo('owuse', () => {
    const map = new Map();
    for (const ym of owingMonths()) for (const e of entries(ym)) {
      for (const u of splitEntry(e).potUse) {
        if (!map.has(u.pot.id)) map.set(u.pot.id, []);
        map.get(u.pot.id).push({ id: e.id, ym, date: e.date, py: u.py, a: u.a, b: u.b, note: (u.line.desc && !u.line.rest ? u.line.desc + ' · ' : '') + (e.desc || ''), kind: 'owing' });
      }
    }
    return map;
  });
}
export const owingUsesOf = potId => owingUseMap().get(potId) || [];

/** What's still to be paid back in a month: { 'a>j': { amt, fromPots, ids:[…] }, … } plus decide-later count. */
export function monthOwes(ym) {
  return memo('mowes:' + ym, () => {
    const out = {}, tbd = [];
    for (const e of entries(ym)) {
      const sp = splitEntry(e);
      if (sp.resp.tbd > 0) tbd.push(e);
      for (const o of sp.owes) {
        const k = `${o.from}>${o.to}`, paid = !!paidMark(ym, e.id, o.from);
        out[k] = out[k] || { from: o.from, to: o.to, amt: 0, paid: 0, fromPots: 0, open: [], all: [] };
        out[k].all.push(e.id);
        if (paid) out[k].paid = r2(out[k].paid + o.amt);
        else { out[k].amt = r2(out[k].amt + o.amt); out[k].fromPots = r2(out[k].fromPots + o.fromPots); out[k].open.push(e.id); }
      }
    }
    return { pairs: Object.values(out), tbd };
  });
}

/** Budget items tracked in owings (e.g. groceries): this month's allowance and spend. */
export function allowances(ym) {
  return budgetItems().filter(i => i.track).map(i => {
    const spent = r2(entries(ym).filter(e => e.cat === i.track).reduce((t, e) => t + (+e.amt || 0), 0));
    const monthly = r2(perYear(i.amt, i.freq) / 12);
    return { item: i, cat: catOf(i.track), monthly, spent, left: r2(monthly - spent) };
  });
}

// ── Savings accounts ─────────────────────────────────────────────────────
// accounts doc: a:<id> → { name, owner: 'a'|'b'|'j', pots: [potId], note?, order }
//               m:<id>:<YYYY-MM> → { interest?, balance? }   (interest that month; what the bank said)
// A pot lives in one account at most.
export function accounts() {
  return memo('accts', () => Object.entries(vals('accounts')).filter(([k]) => k.startsWith('a:')).map(([k, a]) => ({ id: k.slice(2), pots: [], ...a }))
    .sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || String(x.name).localeCompare(String(y.name))));
}
export const accountOfPot = potId => accounts().find(a => a.pots.includes(potId)) || null;
export function saveAccount(acc) {
  const { id, ...rest } = acc, fields = { ['a:' + id]: rest };
  // Pots ticked here leave any other account they were in.
  for (const o of accounts()) {
    if (o.id === id) continue;
    const keep = o.pots.filter(p => !rest.pots.includes(p));
    if (keep.length !== o.pots.length) { const { id: oid, ...orest } = o; fields['a:' + oid] = { ...orest, pots: keep }; }
  }
  store.setFields('accounts', fields);
}
export function deleteAccount(id) {
  const fields = { ['a:' + id]: null };
  for (const k of Object.keys(vals('accounts'))) if (k.startsWith(`m:${id}:`)) fields[k] = null;
  store.setFields('accounts', fields);
}
export const accountMonth = (id, ym) => vals('accounts')[`m:${id}:${ym}`] || {};
export function setAccountMonth(id, ym, patch) {
  const next = { ...accountMonth(id, ym), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  store.setField('accounts', `m:${id}:${ym}`, Object.keys(next).length ? next : null);
}
/** What a pot holds now: a goal, everything put in less what was used; a yearly pot, this year's balance. */
export function potNow(pot) {
  if (pot.type === 'goal') { const l = lifetime(pot).tot; return r2(l.put - l.used); }
  return potStats(pot, nowYear()).tot.balance;
}
/** An account's pots, its interest (that month, that year, ever) and how that compares with the bank. */
export function accountStats(acc, ym) {
  const pots = acc.pots.map(getPot).filter(p => p && !p.archived);
  const perPot = pots.map(p => ({ pot: p, now: potNow(p) }));
  const inPots = r2(perPot.reduce((t, x) => t + x.now, 0));
  const months = Object.entries(vals('accounts')).filter(([k]) => k.startsWith(`m:${acc.id}:`)).map(([k, v]) => ({ ym: k.split(':')[2], ...v }));
  const interest = { month: 0, year: 0, all: 0 };
  let bank = null;
  for (const m of months) {
    const i = +m.interest || 0;
    if (m.ym <= ym) interest.all += i;
    if (m.ym === ym) interest.month += i;
    if (m.ym.slice(0, 4) === ym.slice(0, 4) && m.ym <= ym) interest.year += i;
    if (m.balance != null && m.ym <= ym && (!bank || m.ym > bank.ym)) bank = { ym: m.ym, amt: +m.balance };
  }
  for (const k in interest) interest[k] = r2(interest[k]);
  const total = r2(inPots + interest.all);
  return { pots, perPot, inPots, interest, total, bank, diff: bank ? r2(bank.amt - total) : null, months };
}
/** Interest from every account in a year. */
export const interestInYear = y => r2(Object.entries(vals('accounts')).filter(([k]) => k.startsWith('m:') && k.split(':')[2].startsWith(y + '-')).reduce((t, [, v]) => t + (+v.interest || 0), 0));

// ── When a pot's money is needed (save it by a date) ─────────────────────
// A yearly pot's dates are that year's: py.due = [{ id, ym, amt, note? }] (car insurance, $2,600 by March).
// A goal's are on the goal itself: pot.due = [...] (the deposit, $60,000 by December 2027).
// The check adds up the money in (or planned) up to and including that month, against
// everything due by then. Money put in by hand counts too.
export const duesOf = (pot, y) => [...((pot.type === 'year' ? potYear(pot.id, y)?.due : pot.due) || [])].sort((a, b) => a.ym.localeCompare(b.ym));
export function setDues(pot, y, due) {
  if (pot.type === 'year') setPotYear(pot.id, y, { ...(potYear(pot.id, y) || { target: {} }), due: due.length ? due : undefined });
  else savePot({ ...pot, due: due.length ? due : undefined });
}
/** Each person's share of something due on a shared pot (by your targets, else half each). */
const shareOf = (pot, y, s) => (pot.owner !== 'j' ? 1 : s === 'a' ? jointShare(pot, y) : 1 - jointShare(pot, y));
/** Every month's money for one person in a pot: a yearly pot's own year, or all of a goal's years: { ym: cell }. */
function cellsAll(pot, y, s) {
  if (pot.type === 'year') return cellsOf(pot.id, y)[s] || {};
  const out = {};
  for (const yr of yearsOfPot(pot)) Object.assign(out, cellsOf(pot.id, yr)[s] || {});
  return out;
}
const depositsAll = (pot, y) => (pot.type === 'year' ? manualDeposits(pot.id, y) : yearsOfPot(pot).flatMap(yr => manualDeposits(pot.id, yr)));
/** What was there before the months: a yearly pot's brought-over money; a goal's starting money and own-account money. */
const startOf = (pot, y, s) => (pot.type === 'year' ? potYear(pot.id, y)?.carry?.[s] || 0 : (pot.start?.[s] || 0) + extrasOf(pot, s));
/** Money in (or planned) by the end of a month. */
export function moneyBy(pot, y, s, ym) {
  let t = startOf(pot, y, s);
  for (const [m, c] of Object.entries(cellsAll(pot, y, s))) if (m <= ym) t += c.done ? cellSaved(c) : cellPlan(c);
  for (const d of depositsAll(pot, y)) if (d.ym <= ym) t += +d[s] || 0;
  return r2(t);
}
/** [{ due, cum, need: {a,b}, have: {a,b}, short: {a,b}, shortTot, ok }] for each date, in order. */
export function dueCheck(pot, y) {
  return memo(`due:${pot.id}:${y}`, () => {
    let cum = 0;
    return duesOf(pot, y).map(d => {
      cum = r2(cum + (+d.amt || 0));
      const need = {}, have = {}, short = {};
      let shortTot = 0;
      for (const s of slotsOf(pot)) {
        need[s] = r2(cum * shareOf(pot, y, s));
        have[s] = moneyBy(pot, y, s, d.ym);
        short[s] = r2(Math.max(0, need[s] - have[s]));
        shortTot += short[s];
      }
      return { due: d, cum, need, have, short, shortTot: r2(shortTot), ok: shortTot < 0.5 };
    });
  });
}
/** The first date a pot won't have enough by, or null. */
export const firstShort = (pot, y) => dueCheck(pot, y).find(c => !c.ok) || null;

/**
 * Re-plans the months still to come so each date has enough. A yearly pot then spreads the
 * rest of its target after the last date; a goal leaves the months after it as they are.
 * Months already ticked done stay as they are. Returns the dates it couldn't make.
 */
export function replanForDues(pot, y) {
  const dues = duesOf(pot, y), from = nowYM(), failed = [];
  if (!dues.length) return failed;
  const last = pot.type === 'year' ? ymOf(y, 12) : dues[dues.length - 1].ym;
  const st = pot.type === 'year' ? potStats(pot, y) : null, byDoc = {};
  const docOf = m => (pot.type === 'year' ? y : yearOfYM(m));
  for (const s of slotsOf(pot)) {
    const cells = cellsAll(pot, y, s), share = shareOf(pot, y, s), deps = depositsAll(pot, y);
    // Money that's settled: what was there before, months ticked done, months gone by, and money put in by hand.
    const fixedBy = ym => startOf(pot, y, s)
      + Object.entries(cells).filter(([m, c]) => m <= ym && (c.done || m < from)).reduce((t, [, c]) => t + (c.done ? cellSaved(c) : cellPlan(c)), 0)
      + deps.filter(d => d.ym <= ym).reduce((t, d) => t + (+d[s] || 0), 0);
    const open = monthsBetween(from, last).filter(m => !cells[m]?.done);
    const plan = {};
    let planned = 0, cum = 0, prev = null;
    const spread = (months, amt) => {
      const whole = Math.abs(amt - Math.round(amt)) < 0.005, unit = whole ? 1 : 0.01, units = Math.round(amt / unit);
      const each = Math.floor(units / months.length), extra = units - each * months.length;
      months.forEach((m, i) => { plan[m] = r2((each + (i >= months.length - extra ? 1 : 0)) * unit); });
    };
    for (const d of dues) {
      cum += (+d.amt || 0) * share;
      const seg = open.filter(m => (prev == null || m > prev) && m <= d.ym);
      const need = Math.max(0, r2(cum - fixedBy(d.ym) - planned));
      if (seg.length) { spread(seg, need); planned += need; } else if (need > 0.5 && !failed.includes(d)) failed.push(d);
      prev = d.ym;
    }
    if (pot.type === 'year') {
      const target = st.per[s].target ?? r2(cum);
      const after = open.filter(m => prev == null || m > prev);
      const rest = Math.max(0, r2(target - fixedBy(last) - planned));
      if (after.length) spread(after, rest);
    }
    for (const m of open) {
      const cur = cells[m] || {}, doc = docOf(m);
      (byDoc[doc] = byDoc[doc] || {})[cellKey(pot.id, s, m)] = plan[m] ? { ...cur, plan: plan[m] } : (cur.done ? cur : null);
    }
  }
  Object.entries(byDoc).forEach(([doc, fields]) => setYearFields(+doc, fields));
  return failed;
}

// ── Does each month add up? ──────────────────────────────────────────────
/** One person's twelve months of a year: savings amount, money in pots (kept-apart pots aside), and the gap. */
export const yearMonthCheck = (slot, y) => monthsOf(y).map(ym => {
  const s = monthSummary(slot, ym);
  return { ym, total: s.total.amt, planned: s.planned, apart: s.apart, gap: s.gap, ok: s.gap == null || Math.abs(s.gap) < 0.5 };
});
