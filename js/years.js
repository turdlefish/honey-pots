// Years: look back on a year (what went in, what was used, which pots got there), and plan the next one.

import * as store from './store.js';
import * as M from './model.js';
import { jar } from './jar.js';
import { nameOf, ownerColor, ownerTag, ownerPossessive, bothSlots, person, whoSeg, whoPref, pref, setPref } from './people.js';
import { esc, money, money0, r2, toast, parseMoney, MON, monShort, openSheet, closeSheet, confirmSheet } from './ui.js';
import { defaultYear, newPot, spreadFrom, shortTag, showMonth, leftLine, moveLeftSheet } from './pots.js';

let year = null;

function potsInYear(y) {
  return M.allPots({ archived: true }).filter(p => M.yearsOfPot(p).includes(y));
}

export function renderYears(view, ctx) {
  ctx.topbar.set('Years');
  const years = M.dataYears(), now = M.nowYear();
  if (year == null) year = years.includes(now) || !years.length ? now : years[years.length - 1];
  const y = year;
  const prev = years.filter(v => v < y).pop(), next = years.find(v => v > y);
  // Whose pots (per phone): All, one of you (your own pots), or the Shared ones.
  const who = whoPref('yearsWho'), keep = p => who === 'all' || p.owner === who;
  const pots = potsInYear(y).filter(keep);

  // What went in each calendar month, per person, into the pots on show (money for next year's pots counts in the month it went in).
  const months = M.monthsOf(y), slots = who === 'a' || who === 'b' ? [who] : bothSlots();
  const perMonth = months.map(m => Object.fromEntries(slots.map(s => [s, r2(M.monthLines(s, m).filter(l => keep(l.pot)).reduce((t, l) => t + M.cellSaved(l.cell), 0) + M.depositsInMonth(s, m, who === 'all' ? null : keep))])));
  const inYear = Object.fromEntries(slots.map(s => [s, r2(perMonth.reduce((t, x) => t + x[s], 0))]));
  const max = Math.max(1, ...perMonth.map(x => slots.reduce((t, s) => t + x[s], 0)));
  const used = r2(pots.reduce((t, p) => t + M.potStats(p, y).tot.used, 0));
  const withTarget = pots.filter(p => M.potStats(p, y).tot.target);
  const reached = withTarget.filter(p => M.potStats(p, y).tot.reached).length;
  const nowYM = M.nowYM();

  const bars = `<div class="ybars">${perMonth.map((x, i) => `<div class="col${months[i] === nowYM ? ' now' : ''}" title="${MON[i]}: ${slots.map(s => `${nameOf(s)} ${money0(x[s])}`).join(', ')}">
      ${slots.map(s => `<i style="height:${(x[s] / max) * 100}%;background:${esc(ownerColor(s))}"></i>`).join('')}</div>`).join('')}</div>
    <div class="ylabels">${MON.map(m => `<span>${m[0]}</span>`).join('')}</div>
    <div class="legend">${slots.map(s => `<span><i style="background:${esc(ownerColor(s))}"></i>${esc(nameOf(s))} ${money0(inYear[s])}</span>`).join('')}</div>`;

  const groupCard = o => {
    const list = pots.filter(p => p.owner === o);
    if (!list.length) return '';
    return `<section class="card flat pcol" style="--pc:${esc(ownerColor(o))}"><div class="card-head"><h3>${esc(ownerPossessive(o))} pots</h3><span class="sub">${list.length}</span></div>
      <div class="ytable">${list.map(p => {
        const st = M.potStats(p, y), t = st.tot, lv = M.jarLevels(st);
        // ✅ the months planned reach the goal; green: the months ticked done did.
        const res = !t.target ? (t.moved > 0.5 && Math.abs(t.rest) < 0.5 ? `<span class="muted">➡️ in ${y + 1}</span>` : `<span class="muted">${money0(t.rest)} in it</span>`)
          : t.reached ? `<span class="good">${t.have > t.target + 0.5 ? money0(t.have - t.target) + ' over' : 'reached'}</span>`
            : y < now ? `<span class="warn">⚠️ short ${money0(t.left)}</span>` : `<span class="muted">${money0(t.left)} to go</span>`;
        const pct = t.target ? Math.min(100, (t.have / t.target) * 100) : 0, usedPct = t.target ? Math.min(pct, (t.used / t.target) * 100) : 0;
        return `<button class="yrow${t.reached ? ' reached' : ''}" data-pot="${p.id}">${jar({ ...lv, size: 34, emoji: p.emoji, lid: ownerColor(p.owner), reached: t.reached })}
          <div><div class="nm">${esc(p.name)}${t.planOK ? ' ✅' : ''}${p.archived ? ' <span class="tag c-peach">put away</span>' : ''}</div>
            <div class="meta num">${t.target ? `${money0(t.have)} of ${money0(t.target)}` : `${money0(t.have)} in`}${t.used ? ` · used ${money0(t.used)}` : ''}</div>
            ${t.target ? `<div class="bar"><i style="width:${pct - usedPct}%"></i><i style="width:${usedPct}%"></i></div>` : ''}</div>
          <div class="res">${res}</div></button>`;
      }).join('')}</div></section>`;
  };

  const planNext = y >= now ? (() => {
    const ny = y + 1, planned = M.yearPots(ny).length, toCopy = M.yearPots(y).filter(p => !M.potYear(p.id, ny)).length;
    return `<section class="card c-lav"><div class="card-head"><h3>Plan ${ny}</h3><span class="sub">${planned} pot${planned === 1 ? '' : 's'} so far</span></div>
      <div class="row-btns"><button class="btn" data-plan="${ny}">${toCopy ? `📋 Copy ${y}’s pots into ${ny} ›` : `${ny}’s pots ›`}</button></div></section>`;
  })() : '';

  const interest = M.interestInYear(y, who === 'all' ? null : a => a.owner === who);
  const solo = who === 'a' || who === 'b';
  const title = who === 'all' ? `${y} at a glance` : who === 'j' ? `${y}: the shared pots` : `${y}: ${esc(ownerPossessive(who))} pots`;
  view.innerHTML = `${whoSeg(who, 'ywho', 'Whose pots')}
    <div class="stepper"><button class="iconbtn" data-y="${prev ?? ''}" ${prev == null ? 'disabled' : ''} aria-label="Year before">‹</button>
      <span class="label">${y}</span>
      <button class="iconbtn" data-y="${next ?? ''}" ${next == null ? 'disabled' : ''} aria-label="Year after">›</button></div>
    <div class="cols">
      <section class="card ${solo ? 'pcol' : 'c-honey'} span hero"${solo ? ` style="--pc:${esc(ownerColor(who))}"` : ''}><span class="tape" aria-hidden="true"></span>
        <div class="card-head"><h3>${title}</h3></div>
        <div class="stats">
          <div class="stat"><div class="k">Put in</div><div class="v">${money0(slots.reduce((t, s) => t + inYear[s], 0))}</div><div class="x">${slots.length > 1 ? slots.map(s => `${esc(nameOf(s))} ${money0(inYear[s])}`).join(' · ') : who === 'all' ? '' : `into ${esc(nameOf(who))}’s own pots`}</div></div>
          <div class="stat"><div class="k">Used</div><div class="v">${money0(used)}</div></div>
          <div class="stat"><div class="k">Targets reached</div><div class="v">${reached} of ${withTarget.length}</div></div>
          ${interest ? `<div class="stat"><div class="k">Interest</div><div class="v">${money(interest)}</div></div>` : ''}
        </div>
        ${bars}
        <div class="row-btns"><button class="btn sm" data-plan="${y}">✎ Change ${y}’s pots</button></div>
        ${y < now ? leftLine(y, keep) : ''}
      </section>
      ${planNext}
      ${(who === 'all' ? [...bothSlots(), 'j'] : [who]).map(groupCard).join('')}
      ${!pots.length ? `<div class="empty span">No ${who === 'j' ? 'shared ' : solo ? `${esc(ownerPossessive(who))} ` : ''}pots with money in ${y}.</div>` : ''}
    </div>`;

  view.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.ywho) { setPref('yearsWho', b.dataset.ywho); return ctx.render(); }
    if (b.dataset.y) { year = +b.dataset.y; return ctx.render(); }
    if (b.dataset.pot) return ctx.go(`pot-${b.dataset.pot}@${y}`);
    if (b.dataset.plan) return ctx.go('plan-' + b.dataset.plan);
    if (b.dataset.moveleft) return moveLeftSheet(+b.dataset.moveleft, ctx, { keep });
  };
}

// ── One year's pots: copy last year's in, change a pot's name or target, add pots or take them out ──
// Route plan-<year>[@pots]: the @pots says to go back to Pots rather than Years.
// Copying is a tick list and one button, with Undo straight after; each pot in the year is a row to tap.
/** Money planned for a pot's year in the months before it starts (saving early), for one person. */
const earlyIn = (p, y, s) => Object.entries(M.cellsOf(p.id, y)[s] || {}).filter(([m]) => m < M.ymOf(y, 1)).reduce((t, [, c]) => t + M.cellPlan(c), 0);
/** Spreads each person's target (less what's brought over and saved early) over the year's months still to come. */
const spreadTargets = (p, y, target, carry = {}) => M.slotsOf(p).forEach(s => {
  if (target?.[s] == null) return;
  M.spreadPlan(p, y, s, Math.max(0, target[s] - (carry?.[s] || 0) - earlyIn(p, y, s)), spreadFrom(y), M.ymOf(y, 12));
});
/** "target $1,200", or each person's for a shared pot. */
const targetText = (p, t) => {
  const s = M.slotsOf(p);
  if (s.every(x => t?.[x] == null)) return 'no target';
  return s.length > 1 ? `targets ${s.map(x => `${esc(nameOf(x))} ${t?.[x] != null ? money0(t[x]) : '—'}`).join(' · ')}` : `target ${money0(t[s[0]])}`;
};

export function renderPlanner(view, ctx, arg) {
  const [ys, from] = String(arg).split('@'), y = +ys, py = y - 1;
  if (!y) return false;
  const back = from === 'pots' ? 'pots' : 'years';
  ctx.topbar.set(`${y}’s pots`, { back, backLabel: back === 'pots' ? 'Pots' : 'Years' });
  const inYear = M.yearPots(y), toCopy = M.yearPots(py).filter(p => !M.potYear(p.id, y));
  const start = spreadFrom(y);

  // 1. Copy last year's pots in.
  const leftAll = r2(toCopy.reduce((t, p) => t + Math.max(0, M.potStats(p, py).tot.balance), 0));
  const copyRows = toCopy.map(p => {
    const last = M.potStats(p, py);
    return `<label class="moverow"><input type="checkbox" data-pick="${p.id}" checked>
      <span class="grow"><span class="mvname"><b>${esc(p.emoji || '🍯')} ${esc(p.name)}</b>${ownerTag(p.owner)}</span>
        <span class="tiny muted">${py}: ${targetText(p, last.py?.target)}${last.tot.balance > 0.5 ? ` · ${money0(last.tot.balance)} left in it` : ''}</span></span></label>`;
  }).join('');
  const copyCard = toCopy.length ? `<section class="card c-lav span hero"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>📋 Copy ${py}’s pots into ${y}</h3><span class="sub">${toCopy.length} not in ${y} yet</span></div>
      <ol class="steps small"><li>Tick the pots to bring into ${y}. Each starts with its ${py} target.</li><li>Press <b>Copy</b> at the bottom. Undo shows straight after, in case.</li><li>Change any target below, in <b>In ${y}</b>.</li></ol>
      <div class="row-btns"><button class="linkbtn" data-all="1">Tick all</button><button class="linkbtn" data-all="0">Untick all</button></div>
      <div class="moverows">${copyRows}</div>
      <label class="toggle"><input type="checkbox" id="cp-spread" checked> Spread each target over ${esc(monShort(start))}–Dec ${y}</label>
      ${leftAll > 0.5 ? `<label class="toggle"><input type="checkbox" id="cp-carry"> Bring over what’s left in them (${money0(leftAll)} in all) as their “From ${py}” money</label>` : ''}
      <div class="row-btns end copybar"><button class="btn primary" data-copy></button></div></section>` : '';

  // 2. The pots in the year: tap one to change it.
  const inRows = inYear.map(p => {
    const st = M.potStats(p, y), t = st.tot, months = M.slotsOf(p).reduce((n, s) => n + st.per[s].months, 0);
    return `<button class="plrow" data-editpot="${p.id}">${jar({ ...M.jarLevels(st), size: 40, emoji: p.emoji, lid: ownerColor(p.owner), reached: t.reached })}
      <span class="grow"><span class="mvname"><b>${esc(p.name)}${t.planOK ? ' ✅' : ''}</b>${ownerTag(p.owner)}</span>
        <span class="tiny muted">${targetText(p, st.py?.target)} · ${months ? `${money0(t.plan)} planned` : 'no months planned yet'}${t.carry ? ` · ${money0(t.carry)} from ${py}` : ''}</span></span>
      <span class="pen" aria-hidden="true">✎</span></button>`;
  }).join('');
  const inCard = `<section class="card c-honey span${toCopy.length ? '' : ' hero'}"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>In ${y}</h3><span class="sub">${inYear.length} pot${inYear.length === 1 ? '' : 's'}</span></div>
      ${inRows ? `<div class="plrows">${inRows}</div>` : `<p class="small muted">No pots in ${y} yet.${toCopy.length ? ` Copy ${py}’s above, or add one.` : ''}</p>`}
      <div class="row-btns"><button class="btn sm" data-addpot>＋ Add a pot to ${y}</button></div></section>`;

  // 3. Each month against the savings amount (folded away until you want it).
  const checksOpen = !!pref('planChecksOpen', false);
  const sums = bothSlots().map(s => { const bad = M.yearMonthCheck(s, y).filter(r => !r.ok).length; return `${esc(nameOf(s))}: ${bad ? `${bad} to look at` : 'all add up'}`; }).join(' · ');
  const checksCard = `<section class="card flat span${checksOpen ? '' : ' folded'}"><button class="card-head foldhead" data-checks aria-expanded="${checksOpen}"><h3>Each month against the savings amount</h3>
      ${checksOpen ? '' : `<span class="sub">${sums}</span>`}<span class="iconbtn fold" aria-hidden="true">${checksOpen ? '▾' : '▸'}</span></button></section>
    ${checksOpen ? bothSlots().map(s => monthCheckCard(s, y)).join('') : ''}`;

  view.innerHTML = `<div class="cols">${copyCard}${inCard}${checksCard}</div>`;

  const label = () => {
    const n = view.querySelectorAll('[data-pick]:checked').length, b = view.querySelector('[data-copy]');
    if (!b) return;
    b.textContent = n ? `Copy ${n} pot${n === 1 ? '' : 's'} into ${y}` : `Copy into ${y}`;
    b.disabled = !n;
  };
  label();
  // What Undo puts back: each pot's year and its months in that year's doc.
  const snap = ids => {
    const v = M.vals('y' + y), out = {};
    for (const id of ids) { out['py:' + id] = v['py:' + id] ?? null; for (const k of Object.keys(v)) if (k.startsWith(`c:${id}:`)) out[k] = v[k]; }
    return out;
  };
  view.onchange = e => { if (e.target.matches('[data-pick]')) label(); };
  view.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.all) { view.querySelectorAll('[data-pick]').forEach(c => { c.checked = b.dataset.all === '1'; }); return label(); }
    if (b.dataset.month) { showMonth(b.dataset.month); return ctx.go('pots'); }
    if (b.dataset.plangrid) return ctx.go(`months-${b.dataset.plangrid}-${y}`);
    if (b.hasAttribute('data-checks')) { setPref('planChecksOpen', !checksOpen); return ctx.render(true); }
    if (b.dataset.editpot) return editYearPot(M.getPot(b.dataset.editpot), y, ctx);
    if (b.hasAttribute('data-addpot')) return addPotToYear(y, ctx);
    if (!b.hasAttribute('data-copy')) return;
    const ids = [...view.querySelectorAll('[data-pick]:checked')].map(c => c.dataset.pick);
    if (!ids.length) return toast('Tick a pot to copy');
    const spread = view.querySelector('#cp-spread')?.checked, carry = view.querySelector('#cp-carry')?.checked;
    const before = snap(ids);
    for (const id of ids) {
      const p = M.getPot(id), last = M.potStats(p, py), data = { target: { ...(last.py?.target || {}) } };
      if (carry) {
        const c = Object.fromEntries(M.slotsOf(p).map(s => [s, r2(Math.max(0, last.per[s].balance))]).filter(([, v]) => v > 0.004));
        if (Object.keys(c).length) data.carry = c;
      }
      M.setPotYear(p.id, y, data);
      if (spread) spreadTargets(p, y, data.target, data.carry);
    }
    toast(`Copied ${ids.length} pot${ids.length === 1 ? '' : 's'} into ${y}`, { label: 'Undo', run: () => {
      const now = snap(ids), f = {};
      for (const k of Object.keys(now)) f[k] = k in before ? before[k] : null;
      Object.assign(f, before);
      M.setYearFields(y, f);
      ctx.render(true);
    } });
    ctx.render(true);
  };
  return true;
}

/** One pot in a year: its name (every year), its target(s), or take it out of the year if nothing's gone in. */
function editYearPot(p, y, ctx) {
  const slots = M.slotsOf(p), cur = M.potYear(p.id, y) || {}, t = M.potStats(p, y).tot, canRemove = !t.saved && !t.used;
  const el = openSheet(`<h3>${esc(p.emoji || '🍯')} ${esc(p.name)} in ${y}</h3>
    <label class="field"><span>Name (the same in every year)</span><input class="inp" id="yp-name" value="${esc(p.name)}" autocomplete="off"></label>
    <div class="${slots.length > 1 ? 'fields2' : ''}">${slots.map(s => `<label class="field"><span>${slots.length > 1 ? `${esc(nameOf(s))}’s target` : 'Target'}</span><input class="inp money" data-t="${s}" inputmode="decimal" placeholder="$0" value="${cur.target?.[s] != null ? esc(String(cur.target[s])) : ''}"></label>`).join('')}</div>
    <label class="toggle"><input type="checkbox" id="yp-spread" checked> When the target changes, spread it over ${esc(monShort(spreadFrom(y)))}–Dec ${y} (months already ticked done stay)</label>
    <div class="row-btns end">${canRemove ? `<button class="btn danger sm" data-remove>Take out of ${y}</button><span class="grow"></span>` : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-remove]')) {
      closeSheet();
      if (!(await confirmSheet({ title: `Take ${p.name} out of ${y}?`, text: `Nothing has gone into it in ${y}, so only its plan goes. The pot stays in its other years.`, yes: 'Take it out' }))) return;
      if (!M.removeFromYear(p, y)) toast('It has money in it now, so it stays');
      return ctx.render(true);
    }
    if (!e.target.closest('[data-save]')) return;
    const name = el.querySelector('#yp-name').value.trim();
    if (name && name !== p.name) M.savePot({ ...p, name });
    const target = {};
    el.querySelectorAll('[data-t]').forEach(i => { const v = parseMoney(i.value); if (v != null) target[i.dataset.t] = v; });
    if (!slots.every(s => (cur.target?.[s] ?? null) === (target[s] ?? null))) {
      M.setPotYear(p.id, y, { ...cur, target });
      if (el.querySelector('#yp-spread').checked) spreadTargets(p, y, target, cur.carry);
    }
    closeSheet(); toast('Saved'); ctx.render(true);
  };
}

/** Adds a pot to a year: one from another year, or a brand-new one. */
function addPotToYear(y, ctx) {
  const others = M.allPots().filter(p => p.type === 'year' && !M.potYear(p.id, y));
  const el = openSheet(`<h3>Add a pot to ${y}</h3>
    ${others.length ? `<p class="muted small">One you’ve had before:</p>${others.map(p => `<button class="opt" data-pick="${p.id}">${esc(p.emoji || '🍯')} ${esc(p.name)}<span class="grow"></span>
      <span class="tag plain">${esc(M.yearsOfPot(p).slice(-1)[0] || '')}</span>${ownerTag(p.owner)}</button>`).join('')}` : ''}
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-new>＋ A brand-new pot</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-new]')) { closeSheet(); return newPot(ctx, { year: y, then: () => ctx.render() }); }
    const pk = e.target.closest('[data-pick]');
    if (!pk) return;
    const p = M.getPot(pk.dataset.pick), slots = M.slotsOf(p), last = M.potStats(p, M.yearsOfPot(p).slice(-1)[0] || y);
    el.innerHTML = `<h3>${esc(p.emoji || '🍯')} ${esc(p.name)} in ${y}</h3>
      <div class="${slots.length > 1 ? 'fields2' : ''}">${slots.map(s => `<label class="field"><span>${slots.length > 1 ? esc(nameOf(s)) : 'Target'}</span><input class="inp money" data-t="${s}" inputmode="decimal" placeholder="$0" value="${last.per[s]?.target != null ? esc(String(last.per[s].target)) : ''}"></label>`).join('')}</div>
      <label class="toggle"><input type="checkbox" id="ap-spread" checked> Spread it over the months, ${esc(monShort(spreadFrom(y)))} to Dec ${y}</label>
      <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-add>Add to ${y}</button></div>`;
    el.onclick = ev => {
      if (ev.target.closest('[data-close]')) return closeSheet();
      if (!ev.target.closest('[data-add]')) return;
      const target = {};
      el.querySelectorAll('[data-t]').forEach(i => { const v = parseMoney(i.value); if (v != null) target[i.dataset.t] = v; });
      M.setPotYear(p.id, y, { target });
      if (el.querySelector('#ap-spread').checked) slots.forEach(s => { if (target[s]) M.spreadPlan(p, y, s, target[s], spreadFrom(y), M.ymOf(y, 12)); });
      closeSheet(); toast(`${p.name} is in ${y}`); ctx.render(true);
    };
  };
}

/** One person's twelve months: what goes into savings, what the pots add up to, and what's left or over. */
function monthCheckCard(s, y) {
  const rows = M.yearMonthCheck(s, y), bad = rows.filter(r => !r.ok).length;
  const status = r => {
    if (r.total == null) return '<span class="faint">no amount set</span>';
    if (r.ok) return '<span class="good">✓</span>';
    return r.gap > 0 ? `<span class="warn">${money(r.gap)} spare</span>` : `<span class="bad">${money(-r.gap)} over</span>`;
  };
  return `<section class="card flat pcol" style="--pc:${esc(ownerColor(s))}"><div class="card-head"><h3>${esc(ownerPossessive(s))} months in ${y}</h3>
      <span class="sub">${bad ? `${bad} to look at` : 'all add up'}</span></div>
    <div class="mcheck"><div class="mrow h"><span>Month</span><span>Savings</span><span>In pots</span><span></span></div>
      ${rows.map(r => `<button class="mrow${r.ok ? '' : ' off'}" data-month="${r.ym}"><span><b>${esc(monShort(r.ym))}</b></span>
        <span class="num">${r.total == null ? '—' : money(r.total)}</span>
        <span class="num">${money(r.planned)}${r.apart ? `<small class="muted"> +${money(r.apart)} apart</small>` : ''}</span><span>${status(r)}</span></button>`).join('')}</div></section>`;
}
