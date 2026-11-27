// Years: look back on a year (what went in, what was used, which pots got there), and plan the next one.

import * as store from './store.js';
import * as M from './model.js';
import { jar } from './jar.js';
import { nameOf, ownerColor, ownerTag, ownerPossessive, bothSlots, person, whoSeg, whoPref, setPref } from './people.js';
import { esc, money, money0, r2, toast, parseMoney, MON, monShort, openSheet, closeSheet, confirmSheet } from './ui.js';
import { defaultYear, newPot, spreadFrom, shortTag, showMonth } from './pots.js';

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
        const res = !t.target ? `<span class="muted">${money0(t.balance)} in it</span>`
          : t.reached ? `<span class="good">✅ ${t.have > t.target + 0.5 ? money0(t.have - t.target) + ' over' : 'reached'}</span>`
            : y < now ? `<span class="warn">${money0(t.left)} short</span>` : `<span class="muted">${money0(t.left)} to go</span>`;
        const pct = t.target ? Math.min(100, (t.have / t.target) * 100) : 0, usedPct = t.target ? Math.min(pct, (t.used / t.target) * 100) : 0;
        return `<button class="yrow${t.reached ? ' reached' : ''}" data-pot="${p.id}">${jar({ ...lv, size: 34, emoji: p.emoji, lid: ownerColor(p.owner), reached: t.reached })}
          <div><div class="nm">${esc(p.name)}${t.reached ? ' ✅' : ''}${p.archived ? ' <span class="tag c-peach">put away</span>' : ''}</div>
            <div class="meta">${t.target ? `${p.type === 'goal' ? 'Goal' : 'Target'} ${money0(t.target)} · ` : ''}${t.carry ? `${money0(t.carry)} from before · ` : ''}saved ${money0(t.saved)} · used ${money0(t.used)}</div>
            ${t.target ? `<div class="bar"><i style="width:${pct - usedPct}%"></i><i style="width:${usedPct}%"></i></div>` : ''}</div>
          <div class="res">${res}</div></button>`;
      }).join('')}</div></section>`;
  };

  const planNext = y >= now ? (() => {
    const ny = y + 1, planned = M.allPots().filter(p => p.type === 'year' && M.potYear(p.id, ny)).length;
    const yearly = M.allPots().filter(p => p.type === 'year' && (M.potYear(p.id, y) || M.potYear(p.id, ny))).length;
    return `<section class="card c-lav"><span class="tape" aria-hidden="true"></span><div class="card-head"><h3>Plan ${ny}</h3><span class="sub">${planned} of ${yearly} pots</span></div>
      <p class="small">Look over how ${y} went, then copy the pots into ${ny}: each starts with its ${y} target, and you can change names and amounts or add new pots.</p>
      <div class="row-btns"><button class="btn" data-plan="${ny}">Plan ${ny} ›</button></div></section>`;
  })() : '';

  const interest = M.interestInYear(y, who === 'all' ? null : a => a.owner === who);
  const solo = who === 'a' || who === 'b';
  const title = who === 'all' ? `${y} at a glance` : who === 'j' ? `${y}: the shared pots` : `${y}: ${esc(ownerPossessive(who))} pots`;
  view.innerHTML = `${whoSeg(who, 'ywho', 'Whose pots')}
    <div class="stepper"><button class="iconbtn" data-y="${prev ?? ''}" ${prev == null ? 'disabled' : ''} aria-label="Year before">‹</button>
      <span class="label">${y}<span class="tiny">${y === now ? 'this year' : y < now ? 'looking back' : 'coming up'}</span></span>
      <button class="iconbtn" data-y="${next ?? ''}" ${next == null ? 'disabled' : ''} aria-label="Year after">›</button></div>
    <div class="cols">
      <section class="card ${solo ? 'pcol' : 'c-honey'} span"${solo ? ` style="--pc:${esc(ownerColor(who))}"` : ''}><span class="tape" aria-hidden="true"></span>
        <div class="card-head"><h3>${title}</h3></div>
        <div class="stats">
          <div class="stat"><div class="k">Put in</div><div class="v">${money0(slots.reduce((t, s) => t + inYear[s], 0))}</div><div class="x">${slots.length > 1 ? slots.map(s => `${esc(nameOf(s))} ${money0(inYear[s])}`).join(' · ') : who === 'all' ? '' : `into ${esc(nameOf(who))}’s own pots`}</div></div>
          <div class="stat"><div class="k">Used</div><div class="v">${money0(used)}</div><div class="x">taken out of pots</div></div>
          <div class="stat"><div class="k">Targets reached</div><div class="v">${reached} of ${withTarget.length}</div><div class="x">${y < now ? 'by the end of the year' : 'so far'}</div></div>
          ${interest ? `<div class="stat"><div class="k">Interest</div><div class="v">${money(interest)}</div><div class="x">from ${who === 'all' ? 'your' : who === 'j' ? 'the shared' : `${esc(nameOf(who))}’s`} savers</div></div>` : ''}
        </div>
        ${bars}
        <div class="row-btns"><button class="btn sm" data-plan="${y}">✎ Change ${y}’s pots</button></div>
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
  };
}

// ── One year's pots: rename them, change amounts, add pots, copy last year's ──
// Route plan-<year>[@pots]: the @pots says to go back to Pots rather than Years.
export function renderPlanner(view, ctx, arg) {
  const [ys, from] = String(arg).split('@'), y = +ys, py = y - 1;
  if (!y) return false;
  const back = from === 'pots' ? 'pots' : 'years';
  ctx.topbar.set(`${y}’s pots`, { back, backLabel: back === 'pots' ? 'Pots' : 'Years' });
  const inYear = M.yearPots(y), toCopy = M.yearPots(py).filter(p => !M.potYear(p.id, y));
  const start = spreadFrom(y);

  const inputs = (p, vals) => M.slotsOf(p).map(s => `<label class="small tin">${M.slotsOf(p).length > 1 ? `<span>${esc(nameOf(s))}</span>` : '<span>Target</span>'}
      <input class="inp money" data-t="${s}" inputmode="decimal" placeholder="$0" value="${vals?.[s] != null ? esc(String(vals[s])) : ''}"></label>`).join('');
  const early = (p, s) => Object.entries(M.cellsOf(p.id, y)[s] || {}).filter(([m]) => m < M.ymOf(y, 1)).reduce((t, [, c]) => t + M.cellPlan(c), 0);

  const inRows = inYear.map(p => {
    const st = M.potStats(p, y), t = st.tot, slots = M.slotsOf(p);
    const months = slots.reduce((n, s) => n + st.per[s].months, 0);
    const canRemove = !t.saved && !t.used;
    return `<div class="plannerrow" data-in="${p.id}">${jar({ ...M.jarLevels(st), size: 34, emoji: p.emoji, lid: ownerColor(p.owner) })}
      <div><div class="namerow"><input class="inp nameinp" data-name value="${esc(p.name)}" aria-label="Name">${ownerTag(p.owner)}</div>
        <div class="tiny muted" style="font-weight:700">${months ? `${money0(t.plan)} planned over ${months} month${months === 1 ? '' : 's'}` : 'no months planned yet'}${t.saved ? ` · ${money0(t.saved)} in so far` : ''}${t.carry ? ` · ${money0(t.carry)} brought over` : ''} ${shortTag(p, y)}</div></div>
      <div class="ins">${inputs(p, st.py?.target)}
        ${canRemove ? `<button class="linkbtn" data-remove="${p.id}">✕ Take out of ${y}</button>` : ''}</div></div>`;
  }).join('');
  const copyRows = toCopy.map(p => {
    const last = M.potStats(p, py), slots = M.slotsOf(p);
    return `<div class="plannerrow" data-copy="${p.id}">${jar({ ...M.jarLevels(last), size: 34, emoji: p.emoji, lid: ownerColor(p.owner) })}
      <div><div class="namerow"><b>${esc(p.name)}</b>${ownerTag(p.owner)}</div>
        <div class="tiny muted" style="font-weight:700">${py}: ${last.tot.target ? `target ${money0(last.tot.target)} · ` : ''}saved ${money0(last.tot.saved)} · used ${money0(last.tot.used)} · ${money0(last.tot.balance)} left in it</div></div>
      <div class="ins"><label class="toggle"><input type="checkbox" data-pick checked> Copy</label>${inputs(p, Object.fromEntries(slots.map(s => [s, last.per[s].target])))}
        ${last.tot.balance > 0.5 ? `<label class="toggle"><input type="checkbox" data-carry> Bring over ${money0(last.tot.balance)}</label>` : ''}</div></div>`;
  }).join('');

  view.innerHTML = `<div class="cols">
    <section class="card c-honey span"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>In ${y}</h3><span class="sub">${inYear.length} pot${inYear.length === 1 ? '' : 's'}</span></div>
      ${inRows ? `<div>${inRows}</div><p class="hint">Change a name or a target here. A new name shows in every year.</p>` : `<p class="small muted">No pots in ${y} yet.${toCopy.length ? ` Copy ${py}’s below, or add one.` : ''}</p>`}
      <div class="row-btns"><button class="btn sm" data-addpot>＋ Add a pot to ${y}</button></div>
    </section>
    ${toCopy.length ? `<section class="card c-lav span"><span class="tape" aria-hidden="true"></span>
      <div class="card-head"><h3>Copy from ${py}</h3><span class="sub">${toCopy.length} not in ${y} yet</span></div>
      <p class="small">Each starts with its ${py} target; change any you like. <b>Bring over</b> moves what’s left in the pot into ${y}; otherwise it stays in ${py}’s pot.</p>
      <div class="row-btns"><button class="linkbtn" data-all="1">Tick all</button><button class="linkbtn" data-all="0">Untick all</button></div>
      <div>${copyRows}</div></section>` : ''}
    <section class="card flat span">
      <label class="toggle"><input type="checkbox" id="yp-spread" checked> Spread new and changed targets over the months, ${esc(monShort(start))} to Dec ${y} (months already ticked done stay as they are)</label>
      <div class="row-btns end"><button class="btn ghost" data-go="${back}">Cancel</button><button class="btn primary" data-saveyear>Save ${y}’s pots</button></div>
    </section>
    ${bothSlots().map(s => monthCheckCard(s, y)).join('')}</div>`;

  const spreadOne = (p, target, carry = {}) => M.slotsOf(p).forEach(s => {
    if (target[s] == null) return;
    M.spreadPlan(p, y, s, Math.max(0, target[s] - (carry[s] || 0) - early(p, s)), start, M.ymOf(y, 12));
  });
  const readT = row => { const t = {}; row.querySelectorAll('[data-t]').forEach(i => { const v = parseMoney(i.value); if (v != null) t[i.dataset.t] = v; }); return t; };

  view.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.all) { view.querySelectorAll('[data-pick]').forEach(c => { c.checked = b.dataset.all === '1'; }); return; }
    if (b.dataset.month) { showMonth(b.dataset.month); return ctx.go('pots'); }
    if (b.dataset.plangrid) return ctx.go(`months-${b.dataset.plangrid}-${y}`);
    if (b.dataset.remove) {
      const p = M.getPot(b.dataset.remove);
      if (!(await confirmSheet({ title: `Take ${p.name} out of ${y}?`, text: `Nothing has gone into it in ${y}, so only its plan goes. The pot stays in its other years.`, yes: 'Take it out' }))) return;
      if (!M.removeFromYear(p, y)) toast('It has money in it now, so it stays');
      return ctx.render(true);
    }
    if (b.hasAttribute('data-addpot')) return addPotToYear(y, ctx);
    if (!b.hasAttribute('data-saveyear')) return;
    const spread = view.querySelector('#yp-spread').checked;
    let renamed = 0, changed = 0, copied = 0;
    view.querySelectorAll('[data-in]').forEach(row => {
      const p = M.getPot(row.dataset.in), name = row.querySelector('[data-name]').value.trim();
      if (name && name !== p.name) { M.savePot({ ...p, name }); renamed++; }
      const cur = M.potYear(p.id, y) || {}, target = readT(row);
      const same = M.slotsOf(p).every(s => (cur.target?.[s] ?? null) === (target[s] ?? null));
      if (same) return;
      M.setPotYear(p.id, y, { ...cur, target });
      if (spread) spreadOne(p, target, cur.carry);
      changed++;
    });
    view.querySelectorAll('[data-copy]').forEach(row => {
      if (!row.querySelector('[data-pick]').checked) return;
      const p = M.getPot(row.dataset.copy), last = M.potStats(p, py), target = readT(row), data = { target };
      if (row.querySelector('[data-carry]')?.checked) data.carry = Object.fromEntries(M.slotsOf(p).map(s => [s, Math.max(0, last.per[s].balance)]));
      M.setPotYear(p.id, y, data);
      if (spread) spreadOne(p, target, data.carry);
      copied++;
    });
    const bits = [copied && `${copied} copied`, changed && `${changed} changed`, renamed && `${renamed} renamed`].filter(Boolean);
    toast(bits.length ? `${y}: ${bits.join(', ')}` : 'Nothing to change');
    ctx.render();
  };
  return true;
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
    <p class="hint">Each month’s pot amounts should add up to what goes into savings that month. Tap a month to fix it, or <button class="linkbtn" style="padding:0" data-plangrid="${s}">📅 plan every pot by month</button>.</p>
    <div class="mcheck"><div class="mrow h"><span>Month</span><span>Savings</span><span>In pots</span><span></span></div>
      ${rows.map(r => `<button class="mrow${r.ok ? '' : ' off'}" data-month="${r.ym}"><span><b>${esc(monShort(r.ym))}</b></span>
        <span class="num">${r.total == null ? '—' : money(r.total)}</span>
        <span class="num">${money(r.planned)}${r.apart ? `<small class="muted"> +${money(r.apart)} apart</small>` : ''}</span><span>${status(r)}</span></button>`).join('')}</div></section>`;
}
