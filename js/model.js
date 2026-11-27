// The money model: pots and their years, each month's plan, money taken out,
// the budget and the owings. Everything is shared (merged field by field, see store.js).
//
// Documents (all shared):
//   pots            <potId> → { name, emoji, owner: 'a'|'b'|'j', type: 'year'|'goal',
//                               goal?: {a?, b?}, start?: {a?, b?}, note?, order?, archived? }
//   y<YYYY>         py:<pot> → { target: {a?, b?}, carry?: {a?, b?}, label?, due? }  (a yearly pot's year)
//                   c:<pot>:<slot>:<YYYY-MM> → { plan, done?, amt?, at? }         (money into a pot; at = when it was ticked done)
//                   w:<id> → { pot, ym, date?, a?, b?, note, at? }                (money taken out by hand)
//                   d:<id> → { pot, ym, date?, a?, b?, note, at?, from? }         (money put in by hand; from 'acct' =
//                                                                                   moved in from its own account, see accounts)
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
  // When a month is ticked done (so a savings account knows whether that money came after its balance).
  if (next.done && !cur.done) next.at = Date.now();
  if (!next.done) { delete next.done; delete next.at; }
  store.setField(Y(y), key, next.plan || next.amt ? next : null);
}
/** A cell ticked done now (for ticking many at once). */
export const doneNow = c => ({ ...c, done: true, ...(c.done ? {} : { at: Date.now() }) });
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
/** Deposits by hand for one person in one calendar month, across every pot or the pots `keep` says (for the year's bars). */
export function depositsInMonth(slot, ym, keep = null) {
  let t = 0;
  for (const y of dataYears()) for (const [k, d] of Object.entries(vals(Y(y)))) {
    if (!k.startsWith('d:') || !d || d.ym !== ym) continue;
    if (keep) { const p = getPot(d.pot); if (!p || !keep(p)) continue; }
    t += +d[slot] || 0;
  }
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
 *   planned = where the plan gets it to: what's in, plus every month planned but not ticked yet
 *             (a goal: in the years after this one too); short = how far that is from the target
 *   planOK  = the months planned reach the target (a ✅ by the pot's name)
 *   reached = the months ticked done (and money put in by hand) reach it (the pot goes green)
 *   moved   = a yearly pot: what the next year brought over from this one (its carry); rest = balance − moved
 */
export function potStats(pot, y) {
  return memo(`stats:${pot.id}:${y}`, () => {
    const f = flows(pot, y), py = pot.type === 'year' ? potYear(pot.id, y) : null;
    const next = pot.type === 'year' ? potYear(pot.id, y + 1) : null;
    const KEYS = ['carry', 'plan', 'saved', 'used', 'have', 'balance', 'left', 'unplanned', 'planned', 'short', 'moved', 'rest'];
    const per = {}, tot = Object.fromEntries(KEYS.map(k => [k, 0]));
    tot.target = null;
    const toCome = (yr, s) => Object.values(cellsOf(pot.id, yr)[s] || {}).reduce((x, c) => x + (c.done ? 0 : cellPlan(c)), 0);
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
      const have = r2(carry + x.saved), balance = r2(have - x.used);
      let planned = have + toCome(y, s);
      if (pot.type === 'goal') for (const yr of yearsOfPot(pot)) if (yr > y) planned += toCome(yr, s) + flows(pot, yr)[s].saved;
      planned = r2(planned);
      const moved = r2(+next?.carry?.[s] || 0);
      const p = {
        ...x, target, carry: r2(carry), have, balance,
        left: target != null ? r2(Math.max(0, target - have)) : 0,
        unplanned: target != null ? r2(Math.max(0, target - carry - x.plan - (x.added || 0))) : 0,
        planned, short: target != null ? r2(Math.max(0, target - planned)) : 0,
        planOK: target != null && target > 0 && planned >= target - 0.5,
        // This person's part is in: the months ticked done (and money put in by hand) reach their target.
        reached: target != null && target > 0 && have >= target - 0.5,
        moved, rest: r2(balance - moved),
      };
      per[s] = p;
      for (const k of KEYS) tot[k] = r2(tot[k] + p[k]);
    }
    // A shared pot only has a total target when you both have one (else each person's shows on its page).
    const slots = slotsOf(pot);
    if (slots.every(s => per[s].target != null)) tot.target = r2(slots.reduce((t, s) => t + per[s].target, 0));
    else { tot.left = 0; tot.unplanned = 0; tot.short = 0; tot.partTarget = slots.some(s => per[s].target != null); }
    tot.reached = tot.target != null && tot.target > 0 && tot.have >= tot.target - 0.5;
    tot.planOK = tot.target != null && tot.target > 0 && tot.planned >= tot.target - 0.5;
    return { per, tot, py };
  });
}
/**
 * A pot's goal for some of you (slots): ✅ planOK when the months planned get there, reached (green)
 * when the months ticked done do, and how far the plan is from it (short) or past it (over).
 * { target, have, left, planned, short, over, planOK, reached, each: { a: reached? }, plan: { a: planOK? } }
 * — target null when not all of them have one.
 */
export function goalCheck(pot, y, slots = slotsOf(pot)) {
  const st = potStats(pot, y), rows = slots.filter(s => st.per[s]);
  const each = Object.fromEntries(rows.map(s => [s, st.per[s].reached])), plan = Object.fromEntries(rows.map(s => [s, st.per[s].planOK]));
  const sum = k => r2(rows.reduce((t, s) => t + st.per[s][k], 0));
  if (!rows.length || !rows.every(s => st.per[s].target != null)) return { target: null, have: sum('have'), reached: false, planOK: false, each, plan };
  const target = sum('target'), have = sum('have'), planned = sum('planned');
  return {
    target, have, left: r2(Math.max(0, target - have)), each, plan, planned,
    short: r2(Math.max(0, target - planned)), over: r2(Math.max(0, planned - target)),
    planOK: target > 0 && planned >= target - 0.5, reached: target > 0 && have >= target - 0.5,
  };
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

/**
 * What's left in a year's pots that hasn't gone on to the next year: [{ pot, amt: {a?, b?}, tot, inNext }].
 * amt is each person's money still to move (below 0: the next year brought over more than is left now).
 * Moving it makes it the next year's "From <y>" money (its carry); the year keeps its history.
 */
export function leftovers(y) {
  return memo('left:' + y, () => yearPots(y).map(pot => {
    const st = potStats(pot, y), slots = slotsOf(pot);
    const amt = Object.fromEntries(slots.map(s => [s, r2(Math.max(0, st.per[s].balance) - st.per[s].moved)]));
    return { pot, amt, tot: r2(slots.reduce((t, s) => t + amt[s], 0)), inNext: !!potYear(pot.id, y + 1) };
  }).filter(x => Object.values(x.amt).some(v => Math.abs(v) > 0.5)));
}
/**
 * Moves what's left in these pots in year y into y + 1 (a pot not in y + 1 yet joins it, without a
 * target). Returns what each pot's y + 1 was before, for Undo.
 */
export function moveLeftovers(y, potIds) {
  const fields = {}, before = {};
  for (const id of potIds) {
    const pot = getPot(id);
    if (!pot || pot.type !== 'year' || !potYear(id, y)) continue;
    const st = potStats(pot, y), cur = potYear(id, y + 1);
    const carry = { ...(cur?.carry || {}) };
    for (const s of slotsOf(pot)) { const v = r2(Math.max(0, st.per[s].balance)); if (v > 0) carry[s] = v; else delete carry[s]; }
    before['py:' + id] = cur;
    fields['py:' + id] = { ...(cur || { target: {} }), carry: Object.keys(carry).length ? carry : undefined };
  }
  if (Object.keys(fields).length) setYearFields(y + 1, fields);
  return before;
}
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
        map.get(u.pot.id).push({ id: e.id, ym, date: e.date, at: e.at, py: u.py, a: u.a, b: u.b, note: (u.line.desc && !u.line.rest ? u.line.desc + ' · ' : '') + (e.desc || ''), kind: 'owing' });
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

// ── Accounts (savers and spending accounts) ──────────────────────────────
// The pots are the plan; an account is the real money in the bank. Its amount starts from what
// was in it on a date (a balance you put in), and money in and out after that changes it.
// accounts doc: a:<id> → { name, kind: 'save'|'spend', owner: 'a'|'b'|'j', pots: [potId], note?, order }
//               m:<id>:<YYYY-MM> → { interest?, balance? }   (interest that month; balance: a bank balance from before 1.3)
//               x:<id> → { acct, date, ym, amt, dir: 'in'|'out'|'bal', note?, at }
//                 'bal' = what was in it on that date (the newest is where its amount starts);
//                 'in' / 'out' = money in or out that isn't in one of its pots.
// A pot lives in one account at most.
export const ACCOUNT_KINDS = [
  ['jspend', 'spend', 'j', 'Joint spending', 'like 2Up', '💳'],
  ['pspend', 'spend', 'me', 'Personal spending', '', '👛'],
  ['psave', 'save', 'me', 'Personal saver', '', '🐷'],
  ['jsave', 'save', 'j', 'Joint saver', 'like 2Up Savers', '🍯'],
].map(([id, kind, owner, label, eg, emoji]) => ({ id, kind, owner, label, eg, emoji }));
export const kindOf = acc => (acc.kind === 'spend' ? 'spend' : 'save');
export const kindInfo = acc => ACCOUNT_KINDS.find(k => k.kind === kindOf(acc) && (k.owner === 'j') === (acc.owner === 'j'));
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
  for (const [k, v] of Object.entries(vals('accounts'))) if (k.startsWith(`m:${id}:`) || (k.startsWith('x:') && v && v.acct === id)) fields[k] = null;
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
/**
 * An account: what's actually in it now, its pots (what the plan says is set aside in it), and
 * its interest in the month on show and that year so far.
 *   now   = the newest balance + everything in and out since (null until a balance is put in)
 *   since = { in, out, ticked, interest } after that balance (out is negative)
 *   free  = now − what its pots hold: money that isn't in a pot (or, below 0, the pots say more than is there)
 */
export function accountStats(acc, ym) {
  return memo(`acst:${acc.id}:${ym}`, () => {
    const pots = acc.pots.map(getPot).filter(p => p && !p.archived);
    const perPot = pots.map(p => ({ pot: p, now: potNow(p) }));
    const inPots = r2(perPot.reduce((t, x) => t + x.now, 0));
    const interest = { month: 0, year: 0 };
    for (const [k, v] of Object.entries(vals('accounts'))) {
      if (!k.startsWith(`m:${acc.id}:`)) continue;
      const m = k.split(':')[2], i = +v.interest || 0;
      if (m === ym) interest.month += i;
      if (m.slice(0, 4) === ym.slice(0, 4) && m <= ym) interest.year += i;
    }
    interest.month = r2(interest.month); interest.year = r2(interest.year);
    const start = accountStart(acc), moves = accountMoves(acc, start);
    const sum = what => r2(moves.filter(x => x.what === what).reduce((t, x) => t + x.amt, 0));
    const since = { in: sum('in'), out: sum('out'), ticked: sum('tick'), interest: sum('interest') };
    const now = start ? r2(start.amt + since.in + since.out + since.ticked + since.interest) : null;
    return { pots, perPot, inPots, interest, start, since, now, free: now == null ? null : r2(now - inPots) };
  });
}
const lastDay = ym => `${ym}-${String(new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate()).padStart(2, '0')}`;
/** Where an account's amount starts: the newest balance put in (else, from before 1.3, the newest bank balance of a month, at its end). */
export function accountStart(acc) {
  const bal = accountEntries(acc.id).find(x => x.dir === 'bal');
  if (bal) return { amt: +bal.amt || 0, date: bal.date, ym: bal.ym || String(bal.date).slice(0, 7), at: bal.at || 0, entry: bal };
  let best = null;
  for (const [k, v] of Object.entries(vals('accounts'))) {
    if (!k.startsWith(`m:${acc.id}:`) || v?.balance == null) continue;
    const m = k.split(':')[2];
    if (!best || m > best.ym) best = { ym: m, amt: +v.balance };
  }
  // Everything in that month counts as already in that balance.
  return best ? { amt: best.amt, date: lastDay(best.ym), ym: best.ym, at: Infinity, old: true } : null;
}
/**
 * Money in and out of an account after its balance: its own entries, money put into or taken out
 * of its pots (by hand, or through Owings), its pots' months ticked done, and interest.
 * Something on the balance's own day counts when it was put in after the balance was.
 */
function accountMoves(acc, start) {
  if (!start) return [];
  const sYM = start.ym, out = [];
  const after = (date, ym, at) => (date ? date > start.date || (date === start.date && (at || 0) > start.at) : (ym || '') > sYM);
  const both = r => r2((+r.a || 0) + (+r.b || 0));
  for (const x of accountEntries(acc.id)) if (x.dir !== 'bal' && after(x.date, x.ym, x.at)) out.push({ what: x.dir === 'out' ? 'out' : 'in', amt: (x.dir === 'out' ? -1 : 1) * (+x.amt || 0) });
  for (const p of acc.pots.map(getPot).filter(Boolean)) {
    for (const y of yearsOfPot(p)) {
      // Money moved into a pot from this account (from: 'acct') was already in it.
      for (const d of manualDeposits(p.id, y)) if (d.from !== 'acct' && after(d.date, d.ym, d.at)) out.push({ what: 'in', amt: both(d) });
      for (const u of manualUses(p.id, y)) if (after(u.date, u.ym, u.at)) out.push({ what: 'out', amt: -both(u) });
      const cells = cellsOf(p.id, y);
      for (const s of ['a', 'b']) for (const [m, c] of Object.entries(cells[s] || {})) {
        if (c.done && (m > sYM || (m === sYM && (c.at || 0) > start.at))) out.push({ what: 'tick', amt: cellSaved(c) });
      }
    }
    for (const u of owingUsesOf(p.id)) if (after(u.date, u.ym, u.at)) out.push({ what: 'out', amt: -both(u) });
  }
  for (const [k, rec] of Object.entries(memo('accrecs', () => store.merged('accounts')))) {
    if (!k.startsWith(`m:${acc.id}:`) || !rec.v || !+rec.v.interest) continue;
    const m = k.split(':')[2];
    if (m > sYM || (m === sYM && (rec.t || 0) > start.at)) out.push({ what: 'interest', amt: +rec.v.interest });
  }
  return out;
}
const byNewest = (p, q) => String(q.date || q.ym).localeCompare(String(p.date || p.ym)) || (q.at || 0) - (p.at || 0);
/**
 * An account's own entries: balances ('bal'), and money in or out that isn't in one of its pots
 * (a past deposit, a withdrawal): accounts doc x:<id> → { acct, date, ym, amt, dir, note?, at }.
 */
export function accountEntries(acctId) {
  return Object.entries(vals('accounts')).filter(([k, x]) => k.startsWith('x:') && x && x.acct === acctId)
    .map(([k, x]) => ({ ...x, id: k.slice(2), kind: 'account' })).sort(byNewest);
}
export function saveAccountEntry(x) { const { id, kind, ...rest } = x; store.setField('accounts', 'x:' + id, rest); }
export function deleteAccountEntry(id) { store.setField('accounts', 'x:' + id, null); }
/** Everything put in, taken out or checked by hand for an account: its own entries and its pots' (newest first). */
export function accountHistory(acc) {
  const pots = acc.pots.map(getPot).filter(Boolean), out = accountEntries(acc.id).map(x => ({ ...x, potName: null }));
  for (const p of pots) for (const y of yearsOfPot(p)) {
    manualDeposits(p.id, y).forEach(d => out.push({ ...d, dir: 'in', amt: r2((+d.a || 0) + (+d.b || 0)), potId: p.id, potName: p.name }));
    manualUses(p.id, y).forEach(u => out.push({ ...u, dir: 'out', amt: r2((+u.a || 0) + (+u.b || 0)), potId: p.id, potName: p.name }));
  }
  return out.sort(byNewest);
}
/** Bills in Budget paid from (or into) an account, matched by its name: the items and what they come to a year. */
export function accountBills(acc) {
  const n = String(acc.name || '').trim().toLowerCase(), same = s => String(s || '').trim().toLowerCase() === n;
  const from = budgetItems().filter(i => same(i.acct)), to = budgetItems().filter(i => same(i.to));
  const yearly = list => r2(list.reduce((t, i) => t + perYear(i.amt, i.freq), 0));
  return { from, to, fromYear: yearly(from), toYear: yearly(to) };
}

/** Interest from every account (or the accounts `keep` says) in a year. */
export const interestInYear = (y, keep = null) => r2(Object.entries(vals('accounts')).filter(([k]) => {
  if (!k.startsWith('m:') || !k.split(':')[2].startsWith(y + '-')) return false;
  if (!keep) return true;
  const a = accounts().find(x => x.id === k.split(':')[1]);
  return !!a && keep(a);
}).reduce((t, [, v]) => t + (+v.interest || 0), 0));

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
