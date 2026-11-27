// Owings: each month's purchases from the joint account (or one of your cards), who covers
// each part (half each, one of you, the joint budget, or a savings pot), and who's paid back.

import * as store from './store.js';
import * as M from './model.js';
import { nameOf, ownerColor, ownerTag, bothSlots, pref, setPref } from './people.js';
import { esc, money, r2, uid, toast, openSheet, closeSheet, confirmSheet, parseMoney, isoDay, ymLabel, monthName, weekday } from './ui.js';

let oMonth = null;

export const jointName = () => M.vals('settings').jointName || 'Joint account';
const party = p => (p === 'j' ? jointName() : nameOf(p));

function covLabel(cov) {
  if (!cov || cov === 'both') return 'Half each';
  if (cov === 'a' || cov === 'b') return `${nameOf(cov)}’s`;
  if (cov === 'j') return 'Joint money';
  if (cov === 'tbd') return 'Decide later';
  const pot = M.getPot(cov.slice(4));
  return pot ? `${pot.emoji || '🍯'} ${pot.name}` : 'A pot';
}
function covClass(cov) {
  if (cov === 'a' || cov === 'b') return 'pcol';
  if (cov === 'tbd') return 'c-lav';
  if (cov === 'j') return 'c-mint';
  if (cov && cov.startsWith('pot:')) return 'c-honey';
  return 'plain';
}
const covStyle = cov => (cov === 'a' || cov === 'b' ? ` style="--pc:${esc(ownerColor(cov))}"` : '');

export function renderOwings(view, ctx, arg) {
  if (arg && /^\d{4}-\d{2}$/.test(arg)) oMonth = arg;
  if (!oMonth) oMonth = M.nowYM();
  ctx.topbar.set('Owings');
  const show = pref('owingsShow', 'all');
  const list = M.entries(oMonth), owes = M.monthOwes(oMonth), allow = M.allowances(oMonth);
  const total = r2(list.reduce((t, e) => t + (+e.amt || 0), 0));
  const filtered = list.filter(e => {
    if (show === 'all') return true;
    const sp = M.splitEntry(e);
    if (show === 'tbd') return sp.resp.tbd > 0;
    return sp.owes.some(o => !M.paidMark(oMonth, e.id, o.from));
  });

  const oweLines = owes.pairs.map(pr => {
    const done = pr.amt < 0.005;
    return `<div class="oweline ${pr.from === 'j' ? 'c-mint' : 'pcol'}${done ? ' settled' : ''}"${pr.from !== 'j' ? ` style="--pc:${esc(ownerColor(pr.from))}"` : ''}>
      <div><div class="who">${esc(party(pr.from))} → ${esc(party(pr.to))}</div>
        <div class="sub">${done ? `All paid back · ${money(pr.paid)}` : `${pr.open.length} purchase${pr.open.length === 1 ? '' : 's'}${pr.fromPots ? ` · ${money(pr.fromPots)} of it from pots` : ''}${pr.paid ? ` · ${money(pr.paid)} paid already` : ''}`}</div></div>
      <div class="amt">${done ? '✓' : money(pr.amt, { cents: true })}</div>
      ${done ? '' : `<button class="btn sm" data-payall="${pr.from}>${pr.to}">✓ Paid</button>`}</div>`;
  }).join('');
  const allowHtml = allow.map(a => {
    const pct = a.monthly ? Math.min(100, Math.round(a.spent / a.monthly * 100)) : 0;
    return `<div class="allow ${a.left < 0 ? 'c-peach' : 'c-honey'}"><div class="top"><span class="grow">${esc(a.cat.emoji)} ${esc(a.item.name)}</span>
      <span class="num">${money(a.spent)} of ${money(a.monthly)}</span><span class="${a.left < 0 ? 'bad' : 'good'}">${a.left < 0 ? `${money(-a.left)} over` : `${money(a.left)} left`}</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');

  view.innerHTML = `<div class="stepper"><button class="iconbtn" data-m="-1" aria-label="Month before">‹</button>
      <button class="label" data-m="0">${esc(ymLabel(oMonth))}<span class="tiny">${list.length} purchase${list.length === 1 ? '' : 's'} · ${money(total)}</span></button>
      <button class="iconbtn" data-m="1" aria-label="Month after">›</button></div>
    <div class="cols">
      <div class="stack">
      <section class="card c-honey"><span class="tape" aria-hidden="true"></span>
        <div class="card-head"><h3>To pay back · ${esc(monthName(oMonth))}</h3></div>
        ${oweLines ? `<div class="owe">${oweLines}</div>` : '<p class="small muted">Nothing to pay back this month.</p>'}
        ${owes.tbd.length ? `<button class="sumline short" data-show="tbd" style="border:0;text-align:left">🤔 ${owes.tbd.length} still to decide: who covers ${owes.tbd.length === 1 ? 'it' : 'them'}? ›</button>` : ''}
        ${allowHtml ? `<hr class="divider"><div class="eyebrow">Spending budgets</div>${allowHtml}` : ''}
      </section>
      </div>
      <section class="card"><div class="toprow"><div class="seg" role="group" aria-label="Show">
          ${[['all', 'All'], ['open', 'Not paid back'], ['tbd', 'To decide']].map(([k, l]) => `<button data-show="${k}" aria-pressed="${show === k}">${l}</button>`).join('')}</div></div>
        ${filtered.length ? `<div>${filtered.map(entryRow).join('')}</div>` : `<p class="empty small">${list.length ? 'Nothing here.' : `No purchases in ${esc(monthName(oMonth))} yet.`}</p>`}
      </section>
    </div>
    <button class="fab" data-add>＋ Add a purchase</button>`;

  view.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.m) { oMonth = b.dataset.m === '0' ? M.nowYM() : M.addMonths(oMonth, +b.dataset.m); return ctx.render(); }
    if (b.dataset.show) { setPref('owingsShow', b.dataset.show); return ctx.render(true); }
    if (b.dataset.paid) {
      const [id, p] = b.dataset.paid.split('|');
      M.setPaid(oMonth, id, p, !M.paidMark(oMonth, id, p));
      return ctx.render(true);
    }
    if (b.dataset.payall) {
      const [from, to] = b.dataset.payall.split('>'), pr = owes.pairs.find(x => x.from === from && x.to === to);
      if (!pr) return;
      M.setPaidMany(oMonth, pr.open.map(id => [id, from, true]));
      const ym = oMonth;
      toast(`${party(from)}: ${money(pr.amt, { cents: true })} marked paid`, { label: 'Undo', run: () => { M.setPaidMany(ym, pr.open.map(id => [id, from, false])); ctx.render(true); } });
      return ctx.render(true);
    }
    if (b.dataset.entry) return editEntry(list.find(x => x.id === b.dataset.entry), ctx);
    if (b.hasAttribute('data-add')) return editEntry(null, ctx);
  };
}

function entryRow(e) {
  const sp = M.splitEntry(e), cat = M.catOf(e.cat);
  const many = sp.lines.length > 1;
  const chips = sp.lines.map(l => `<span class="tag ${covClass(l.cov)}"${covStyle(l.cov)}>${l.desc && !l.rest ? esc(l.desc) + ' · ' : l.rest && many ? 'Rest · ' : ''}${esc(covLabel(l.cov))}${many || (l.cov && l.cov !== 'both' && l.cov !== 'j' && l.cov !== 'tbd') ? ' ' + money(l.amt) : ''}</span>`).join('');
  const paids = sp.owes.map(o => {
    const paid = !!M.paidMark(oMonth, e.id, o.from);
    return `<button class="paidbtn" data-paid="${e.id}|${o.from}" aria-pressed="${paid}"><span class="dot">✓</span>${esc(party(o.from))} ${paid ? 'paid' : `owes ${money(o.amt, { cents: true })}`}</button>`;
  }).join('');
  const d = String(e.date || '');
  return `<div class="erow">
    <div class="day">${esc(d.slice(8, 10).replace(/^0/, '') || '?')}<small>${d.length >= 10 ? esc(weekday(d)) : ''}</small></div>
    <div class="grow"><button class="ebtn" data-entry="${e.id}">
      <div class="toprow" style="flex-wrap:nowrap;align-items:flex-start"><div class="what">${esc(e.desc || 'Purchase')}</div><div class="amt">${money(e.amt, { cents: true })}</div></div>
      ${e.cat || (e.by && e.by !== 'j') ? `<div class="tiny muted" style="font-weight:700">${e.cat ? `${esc(cat.emoji)} ${esc(cat.name)}` : ''}${e.by && e.by !== 'j' ? `${e.cat ? ' · ' : ''}paid with ${esc(nameOf(e.by))}’s card` : ''}</div>` : ''}
      <div class="splits">${chips}${sp.over ? `<span class="tag c-peach">items add up to ${money(sp.over)} more</span>` : ''}</div>
      ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</button>
      ${paids ? `<div class="splits">${paids}</div>` : ''}</div></div>`;
}

// ── Adding or changing a purchase ────────────────────────────────────────
function covSelect(id, value, { rest = false } = {}) {
  const pots = M.allPots(), groups = [['j', 'Our pots'], ...bothSlots().map(s => [s, `${nameOf(s)}’s pots`])];
  const opt = (v, l) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`;
  return `<select class="inp" id="${id}" data-cov>
    <optgroup label="People">${opt('both', 'Half each')}${bothSlots().map(s => opt(s, `${nameOf(s)}’s`)).join('')}${opt('j', 'Joint money · nobody owes')}${opt('tbd', 'Decide later')}</optgroup>
    ${groups.map(([o, l]) => { const ps = pots.filter(p => p.owner === o); return ps.length ? `<optgroup label="${esc(l)}">${ps.map(p => opt('pot:' + p.id, `${p.emoji || '🍯'} ${p.name}`)).join('')}</optgroup>` : ''; }).join('')}
  </select>`;
}

function editEntry(e, ctx) {
  const isNew = !e;
  const cur = e ? JSON.parse(JSON.stringify(e)) : { id: uid(), date: oMonth === M.nowYM() ? isoDay() : oMonth + '-01', desc: '', amt: null, cat: '', by: 'j', cov: 'both', lines: [], at: Date.now() };
  const oldYM = e ? String(e.date).slice(0, 7) : null;
  let covTouched = !isNew;
  const el = openSheet(`<div class="sheet-top"><h3>${isNew ? 'A purchase' : 'Purchase'}</h3></div>
    <label class="field"><span>What was it</span><input class="inp" id="en-desc" value="${esc(cur.desc)}" placeholder="e.g. Bunnings, Linkt, dinner" autocomplete="off"></label>
    <div class="fields2"><label class="field"><span>Amount</span><input class="inp money" id="en-amt" inputmode="decimal" placeholder="$0.00" value="${cur.amt != null ? esc(String(cur.amt)) : ''}"></label>
      <label class="field"><span>Day</span><input class="inp" type="date" id="en-date" value="${esc(cur.date)}"></label></div>
    <div class="field"><span>Kind</span><div class="chips" id="en-cat">${M.cats().map(c => `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${c.id === cur.cat}">${esc(c.emoji)} ${esc(c.name)}</button>`).join('')}</div></div>
    <div class="field"><span>Paid with</span><div class="seg wide" id="en-by">${[['j', jointName()], ...bothSlots().map(s => [s, `${nameOf(s)}’s card`])].map(([k, l]) => `<button type="button" data-by="${k}" aria-pressed="${k === (cur.by || 'j')}">${esc(l)}</button>`).join('')}</div></div>
    <div class="field" id="en-items"></div>
    <div class="field"><span id="en-covlabel">Who covers it</span><div id="en-covbox"></div><span class="hint" id="en-covhint"></span></div>
    <label class="field"><span>Note (optional)</span><input class="inp" id="en-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <p class="err" id="en-err" hidden></p>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>${isNew ? 'Add' : 'Save'}</button></div>`);

  const $ = s => el.querySelector(s);
  const readLines = () => [...el.querySelectorAll('.lineed')].map(row => ({
    id: row.dataset.line, desc: row.querySelector('[data-ldesc]').value.trim(), amt: parseMoney(row.querySelector('[data-lamt]').value) || 0, cov: row.querySelector('[data-cov]').value,
  }));
  const gather = () => ({
    ...cur, desc: $('#en-desc').value.trim(), amt: parseMoney($('#en-amt').value), date: $('#en-date').value || cur.date,
    cat: el.querySelector('#en-cat [aria-pressed="true"]')?.dataset.cat || '', by: el.querySelector('#en-by [aria-pressed="true"]')?.dataset.by || 'j',
    cov: $('#en-cov') ? $('#en-cov').value : cur.cov, lines: readLines(), note: $('#en-note').value.trim() || undefined,
  });
  function drawItems() {
    $('#en-items').innerHTML = cur.lines.length
      ? `<span>Items</span><div class="lines">${cur.lines.map((l, i) => `<div class="lineed" data-line="${esc(l.id)}">
          <input class="inp" data-ldesc value="${esc(l.desc)}" placeholder="e.g. Plants" autocomplete="off">
          <input class="inp money" data-lamt inputmode="decimal" value="${l.amt ? esc(String(l.amt)) : ''}" placeholder="$0">
          <button type="button" class="x" data-ldel="${i}" aria-label="Remove item">✕</button>
          ${covSelect('lc-' + i, l.cov || 'both')}</div>`).join('')}
          <button type="button" class="addline" data-ladd>＋ Another item</button></div>`
      : `<button type="button" class="addline" data-ladd>＋ Split it into items (e.g. plants for one of you, hooks for both)</button>`;
    $('#en-covlabel').textContent = cur.lines.length ? 'Who covers the rest' : 'Who covers it';
    $('#en-covbox').innerHTML = covSelect('en-cov', cur.cov || 'both');
    hint();
  }
  function hint() {
    const g = gather(), sp = M.splitEntry({ ...g, amt: g.amt || 0 });
    const restLine = sp.lines.find(l => l.rest);
    const bits = [];
    if (g.lines.length) bits.push(restLine ? `The rest is ${money(restLine.amt, { cents: true })}.` : sp.over ? `<span class="bad">The items add up to ${money(sp.over, { cents: true })} more than the amount.</span>` : 'The items cover all of it.');
    sp.potUse.forEach(u => bits.push(`${esc(u.pot.emoji || '🍯')} ${esc(u.pot.name)} (${u.py}) pays ${money(u.amt, { cents: true })}${u.pot.owner === 'j' ? `: ${esc(nameOf('a'))} ${money(u.a, { cents: true })} · ${esc(nameOf('b'))} ${money(u.b, { cents: true })} from your savings` : ''}.`));
    if (g.amt) bits.push(sp.owes.length ? sp.owes.map(o => `${esc(party(o.from))} pays back ${money(o.amt, { cents: true })}`).join(' · ') + ` to ${esc(party(g.by || 'j'))}.` : 'Nobody owes anything for it.');
    $('#en-covhint').innerHTML = bits.join(' ');
  }
  drawItems();

  el.addEventListener('input', hint);
  el.addEventListener('change', e => {
    if (e.target.id === 'en-cov' || e.target.matches('[data-cov]')) covTouched = true;
    hint();
  });
  el.onclick = async ev => {
    const c = ev.target.closest('[data-cat]');
    if (c) {
      el.querySelectorAll('#en-cat [data-cat]').forEach(x => x.setAttribute('aria-pressed', String(x === c && x.getAttribute('aria-pressed') !== 'true')));
      // A spending budget you share (e.g. groceries) is the joint money's to cover.
      const tracked = M.budgetItems().find(i => i.track === c.dataset.cat);
      if (tracked && !covTouched && $('#en-cov')) { $('#en-cov').value = tracked.who === 'j' ? 'j' : tracked.who; }
      return hint();
    }
    const by = ev.target.closest('[data-by]');
    if (by) { el.querySelectorAll('#en-by [data-by]').forEach(x => x.setAttribute('aria-pressed', String(x === by))); return hint(); }
    if (ev.target.closest('[data-ladd]')) {
      const g = gather(); cur.lines = g.lines; cur.cov = g.cov;
      cur.lines.push({ id: uid(), desc: '', amt: 0, cov: cur.lines.length ? 'both' : store.me() });
      drawItems();
      const rows = el.querySelectorAll('[data-ldesc]'); rows[rows.length - 1]?.focus();
      return;
    }
    const ld = ev.target.closest('[data-ldel]');
    if (ld) { const g = gather(); cur.lines = g.lines.filter((_, i) => i !== +ld.dataset.ldel); cur.cov = g.cov; return drawItems(); }
    if (ev.target.closest('[data-close]')) return closeSheet();
    if (ev.target.closest('[data-del]')) {
      closeSheet();
      if (await confirmSheet({ title: 'Delete this purchase?', text: esc(e.desc || ''), yes: 'Delete', danger: true })) {
        M.deleteEntry(e);
        toast('Deleted', { label: 'Undo', run: () => { M.saveEntry(e); ctx.render(true); } });
        ctx.render(true);
      }
      return;
    }
    if (ev.target.closest('[data-save]')) {
      const g = gather();
      const err = t => { const x = $('#en-err'); x.hidden = false; x.textContent = t; };
      if (!g.desc && !g.amt) return err('What was it, and how much?');
      if (g.amt == null || g.amt <= 0) return err('How much was it?');
      g.lines = g.lines.filter(l => l.amt || l.desc).map(l => ({ ...l, amt: r2(l.amt) }));
      if (!g.lines.length) delete g.lines;
      M.saveEntry(g, oldYM);
      closeSheet();
      const ym = String(g.date).slice(0, 7);
      if (ym !== oMonth) { oMonth = ym; toast(`Saved in ${ymLabel(ym)}`); }
      ctx.render(true);
    }
  };
}
