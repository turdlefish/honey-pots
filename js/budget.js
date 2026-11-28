// Budget: what comes in, every bill and subscription in groups (Subscriptions → Netflix, Disney+…),
// whose it is or how you split it, and what's left once bills and savings are out.

import * as store from './store.js';
import * as M from './model.js';
import { nameOf, ownerColor, ownerTag, bothSlots, pref, setPref, person, whoSeg as whoSwitch, whoPref } from './people.js';
import { esc, money, money0, r2, uid, toast, openSheet, closeSheet, confirmSheet, parseMoney } from './ui.js';
import { xbudget, renderPie, editXBudget } from './xbudget.js';

const PERIODS = [['w', 'Week'], ['f', 'Fortnight'], ['m', 'Month'], ['y', 'Year']];
const GROUP_EMOJI = ['📺', '🏠', '⚡', '🛒', '📱', '🩺', '🚗', '🐾', '💞', '📈', '🏦', '🎓', '🎵', '🧾', '✨', '🍜'];
const inPeriod = (yearly, per) => M.fromYear(yearly, per);

// Who the page is about (per phone): everyone, one of you (your own bills plus your share of the
// shared ones), or just the shared ones.
export function renderBudget(view, ctx) {
  ctx.topbar.set('Budget');
  // The basic budget (the two of you), or the pie chart budget (each of you, shared costs, doughnuts): a switch at the top.
  // '' = basic, 'pie' = pie (before 1.5 a phone kept one pie budget's id here).
  const book = pref('budgetBook', ''), pie = book === 'pie' || !!xbudget(book);
  const bookSeg = `<div class="toprow"><div class="seg bookseg" role="group" aria-label="Which budget"><button data-book="" aria-pressed="${!pie}">🧾 Basic budget</button><button data-book="pie" aria-pressed="${pie}">🍩 Pie chart budget</button></div></div>`;
  if (pie) {
    if (book !== 'pie') { const old = xbudget(book); setPref('budgetBook', 'pie'); if (old && old.owner !== 'j' && pref('pieWho', null) == null) setPref('pieWho', old.owner); }
    return renderPie(view, ctx, bookSeg);
  }
  const per = pref('budgetPer', 'm'), perWord = M.FREQ_LABEL[per];
  const who = whoPref('budgetWho');
  const groups = M.budgetGroups(), all = M.budgetItems(), tot = M.budgetTotals();
  // Paid from / paid to filters (per phone): an account's name, '_none' for not set, '' for any.
  const fromPref = pref('budgetFrom', ''), toPref = pref('budgetTo', '');
  const fromList = [...new Set(all.map(i => i.acct).filter(Boolean))].sort(), toList = [...new Set(all.map(i => i.to).filter(Boolean))].sort();
  const matchFrom = i => !fromPref || (fromPref === '_none' ? !i.acct : i.acct === fromPref);
  const matchTo = i => !toPref || (toPref === '_none' ? !i.to : i.to === toPref);
  const items = (who === 'all' ? all : who === 'j' ? all.filter(i => i.who === 'j') : all.filter(i => i.who === who || i.who === 'j'))
    .filter(i => matchFrom(i) && matchTo(i));
  const known = new Set(groups.map(g => g.id));
  const loose = items.filter(i => !known.has(i.group));
  // What an item costs the person on show (their share), or all of it.
  const costOf = i => (who === 'a' || who === 'b' ? M.itemShares(i)[who] : M.perYear(i.amt, i.freq));
  // A person's bills by the account they're paid from: [[account or '', yearly share]], named accounts first.
  const byAcct = s => {
    const m = new Map();
    for (const i of all) { const v = M.itemShares(i)[s]; if (v) m.set(i.acct || '', (m.get(i.acct || '') || 0) + v); }
    return [...m.entries()].sort((x, z) => (x[0] ? 0 : 1) - (z[0] ? 0 : 1) || z[1] - x[1]);
  };

  // Where each person's pay goes: bills by the account they come out of, savings, pots kept apart, and what's left.
  const psum = (s, big = false) => {
    // Whole dollars that add up down the column: All bills is its lines added up, Left over is what's left of them.
    const t = tot[s], p = person(s), accts = byAcct(s), R = y => Math.round(inPeriod(y, per));
    const v = n => money(n, { cents: false }), split = accts.length > 1 || (accts.length === 1 && accts[0][0]);
    const parts = accts.map(([a, y]) => [a, R(y)]);
    const bills = split ? parts.reduce((x, [, n]) => x + n, 0) : R(t.bills), save = R(t.savings), apart = t.apart ? R(t.apart) : 0;
    const income = t.income == null ? null : R(t.income), left = income == null ? null : income - bills - save - apart;
    // By account, then all of them together.
    const billRows = split
      ? parts.map(([a, n]) => `<div class="r acct"><span>${a ? `Bills from ${esc(a)}` : 'Bills, no account set'}</span><b>−${v(n)}</b></div>`).join('')
        + `<div class="r subtot"><span>All bills</span><b>−${v(bills)}</b></div>`
      : `<div class="r"><span>Bills &amp; spending</span><b>−${v(bills)}</b></div>`;
    return `<div class="psum pcol${big ? ' big' : ''}" style="--pc:${esc(p.color)}"><div class="nm">${esc(p.name)}</div>
      <div class="r"><span>Coming in</span><b>${income == null ? `<button class="linkbtn" data-income="${s}">set pay ›</button>` : `<button class="linkbtn" style="color:inherit;padding:0" data-income="${s}">${v(income)} ✎</button>`}</b></div>
      ${billRows}
      <div class="r"><span>Savings</span><b>−${v(save)}</b></div>
      ${t.apart ? `<div class="r"><span>${esc(t.apartNames.join(', ') || 'Kept apart')}</span><b>−${v(apart)}</b></div>` : ''}
      <div class="r left"><span>Left over</span><b class="${left != null && left < 0 ? 'bad' : ''}">${left == null ? '—' : v(left)}</b></div></div>`;
  };
  // With a filter on: what the bills it shows add up to, and each person's share.
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(label)}</option>`;
  // The Paid from / Paid to filters stay folded away behind one button until you want them (or one is on).
  const canFilter = fromList.length || toList.length || fromPref || toPref;
  const filtersOpen = !!(fromPref || toPref || pref('budgetFiltersOpen', false));
  const filters = canFilter && filtersOpen ? `<div class="filters">
      <label class="field"><span>Paid from</span><select class="inp" data-ffrom>${opt('', 'Any account', fromPref)}${fromList.map(a => opt(a, a, fromPref)).join('')}${opt('_none', 'Not set', fromPref)}</select></label>
      <label class="field"><span>Paid to</span><select class="inp" data-fto>${opt('', 'Anywhere', toPref)}${toList.map(a => opt(a, a, toPref)).join('')}${opt('_none', 'Not set', toPref)}</select></label></div>` : '';
  const fsum = fromPref || toPref ? (() => {
    const yt = items.reduce((t, i) => t + M.perYear(i.amt, i.freq), 0), part = s => items.reduce((t, i) => t + M.itemShares(i)[s], 0);
    const label = [fromPref ? `from ${fromPref === '_none' ? 'no account' : fromPref}` : '', toPref ? `to ${toPref === '_none' ? 'nowhere set' : toPref}` : ''].filter(Boolean).join(' ');
    return `<div class="sumline short">Paid ${esc(label)}: ${money(inPeriod(yt, per))} a ${esc(perWord)} · ${bothSlots().map(s => `${esc(nameOf(s))} ${money(inPeriod(part(s), per))}`).join(' · ')}
      <button class="linkbtn" data-clearf>Clear</button></div>`;
  })() : '';
  const sharedSum = () => {
    const sh = all.filter(i => i.who === 'j'), whole = sh.reduce((t, i) => t + M.perYear(i.amt, i.freq), 0);
    const part = s => sh.reduce((t, i) => t + M.itemShares(i)[s], 0);
    return `<div class="psum c-honey big"><div class="nm">Shared bills</div>
      <div class="r"><span>Altogether</span><b>${money(inPeriod(whole, per), { cents: false })}</b></div>
      ${bothSlots().map(s => `<div class="r"><span>${esc(nameOf(s))} pays</span><b>${money(inPeriod(part(s), per), { cents: false })}</b></div>`).join('')}
      <div class="r left"><span>${sh.length} shared bill${sh.length === 1 ? '' : 's'}</span><b></b></div></div>`;
  };

  const groupCard = g => {
    const list = items.filter(i => i.group === g.id);
    if (!list.length && (who !== 'all' || fromPref || toPref)) return '';
    const yearTotal = list.reduce((t, i) => t + costOf(i), 0);
    return `<section class="card flat"><div class="card-head"><h3>${esc(g.emoji || '🧾')} ${esc(g.name)}</h3>
        <span class="small num" style="font-weight:800">${money(inPeriod(yearTotal, per))}<span class="muted">/${esc(perWord)}</span></span>
        ${g.id !== '_other' ? `<button class="iconbtn" data-group="${g.id}" aria-label="Edit group">✎</button>` : ''}</div>
      ${list.length ? `<div class="bitems">${list.map(i => itemRow(i, per, who)).join('')}</div>` : '<p class="small muted">Nothing in this group yet.</p>'}
      <button class="addline" data-additem="${g.id}">＋ Add to ${esc(g.name)}</button></section>`;
  };

  const whoSeg = whoSwitch(who, 'who', 'Whose budget');
  const head = who === 'all' ? `<div class="sumgrid">${bothSlots().map(s => psum(s)).join('')}</div>`
    : who === 'j' ? sharedSum() : psum(who, true);

  view.innerHTML = `${bookSeg}${whoSeg}
    <div class="toprow"><div class="seg" role="group" aria-label="Show amounts per">${PERIODS.map(([k, l]) => `<button data-per="${k}" aria-pressed="${per === k}">${l}</button>`).join('')}</div>
      ${canFilter && !(fromPref || toPref) ? `<button class="btn sm ghost" data-filters aria-expanded="${filtersOpen}" aria-label="Filter by account">🔎<span class="lbl-sm"> ${filtersOpen ? 'Hide filters' : 'Filter'}</span></button>` : ''}</div>
    ${filters}${fsum}
    <div class="cols">
      <section class="card ${who === 'a' || who === 'b' ? 'pcol' : 'c-honey'} span hero"${who === 'a' || who === 'b' ? ` style="--pc:${esc(person(who).color)}"` : ''}><span class="tape" aria-hidden="true"></span>
        <div class="card-head"><h3>${who === 'a' || who === 'b' ? `${esc(nameOf(who))}’s ${esc(perWord)}` : who === 'j' ? `Shared, each ${esc(perWord)}` : `Each ${esc(perWord)}`}</h3></div>
        ${head}
      </section>
      ${groups.map(groupCard).join('')}
      ${loose.length ? groupCard({ id: '_other', name: 'Other', emoji: '🧾' }) : ''}
      ${!items.length ? `<div class="empty span">${all.length ? 'Nothing here yet.' : 'No bills yet. Start a group (like <b>Subscriptions</b>) with <b>＋ New group</b>.'}</div>` : ''}
      <button class="addline span" data-newgroup>＋ New group</button>
    </div>`;

  view.onchange = e => {
    if (e.target.matches('[data-ffrom]')) { setPref('budgetFrom', e.target.value); ctx.render(true); }
    if (e.target.matches('[data-fto]')) { setPref('budgetTo', e.target.value); ctx.render(true); }
  };
  view.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.book != null) { setPref('budgetBook', b.dataset.book); return ctx.render(); }
    if (b.hasAttribute('data-newbook')) return editXBudget(null, ctx);
    if (b.hasAttribute('data-clearf')) { setPref('budgetFrom', ''); setPref('budgetTo', ''); setPref('budgetFiltersOpen', false); return ctx.render(true); }
    if (b.hasAttribute('data-filters')) { setPref('budgetFiltersOpen', !filtersOpen); return ctx.render(true); }
    if (b.dataset.who) { setPref('budgetWho', b.dataset.who); return ctx.render(); }
    if (b.dataset.per) { setPref('budgetPer', b.dataset.per); return ctx.render(true); }
    if (b.dataset.income) return editIncome(b.dataset.income, ctx);
    if (b.dataset.item) return editItem(all.find(i => i.id === b.dataset.item), null, ctx);
    if (b.dataset.additem) return editItem(null, b.dataset.additem === '_other' ? '' : b.dataset.additem, ctx, who === 'all' ? 'j' : who);
    if (b.dataset.group) return editGroup(groups.find(g => g.id === b.dataset.group), ctx);
    if (b.hasAttribute('data-newgroup')) return editGroup(null, ctx);
  };
}

function itemRow(i, per, who = 'all') {
  const y = M.perYear(i.amt, i.freq), sh = M.itemShares(i);
  const even = i.split == null || Math.abs(i.split - 0.5) <= 0.004;
  const mine = (who === 'a' || who === 'b') && i.who === 'j';
  const meta = [
    i.who === 'j' ? ownerTag('j', even ? 'half each' : 'shared') : who === 'all' ? ownerTag(i.who) : '',
    i.freq !== per ? `<span>${money(i.amt)} a ${esc(M.FREQ_LABEL[i.freq])}</span>` : '',
  ].filter(Boolean).join('');
  const amount = mine ? M.fromYear(sh[who], per) : M.fromYear(y, per);
  const under = mine ? `<small>${even ? 'half' : 'share'} of ${money(M.fromYear(y, per))}</small>`
    : i.who === 'j' ? `<small>${bothSlots().map(s => `${esc(nameOf(s))} ${money(M.fromYear(sh[s], per))}`).join(' · ')}</small>` : '';
  return `<button class="bitem" data-item="${i.id}"><div class="grow"><div class="nm">${esc(i.name)}</div><div class="meta">${meta}</div>${i.note ? `<div class="tiny muted">${esc(i.note)}</div>` : ''}</div>
    <div class="amt">${money(amount)}${under}</div></button>`;
}

function editIncome(slot, ctx) {
  const cur = M.income(slot) || { amt: null, freq: 'm' };
  const el = openSheet(`<h3>${esc(nameOf(slot))}’s pay</h3><p class="muted small">After tax: what lands in the bank.</p>
    <div class="fields2"><label class="field"><span>Amount</span><input class="inp money" id="in-amt" inputmode="decimal" value="${cur.amt != null ? esc(String(cur.amt)) : ''}" placeholder="$0"></label>
    <label class="field"><span>Every</span><select class="inp" id="in-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="row-btns end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = e => {
    if (e.target.closest('[data-close]')) closeSheet();
    if (!e.target.closest('[data-save]')) return;
    const amt = parseMoney(el.querySelector('#in-amt').value);
    store.setField('budget', 'inc:' + slot, amt == null ? null : { amt, freq: el.querySelector('#in-freq').value });
    closeSheet(); ctx.render(true);
  };
}

function editItem(item, groupId, ctx, whoNew = 'j') {
  const isNew = !item;
  const cur = item ? { ...item } : { id: uid(), name: '', amt: null, freq: 'm', who: whoNew, group: groupId || '', order: Date.now() / 1e13 };
  // Your accounts (Pots → Accounts) first, so a bill's "Paid from" matches the account's name, then names used before.
  const accounts = [...new Set([...M.accounts().map(a => a.name), ...[...new Set(M.budgetItems().flatMap(i => [i.acct, i.to]).filter(Boolean))].sort()])];
  const custom = cur.who === 'j' && cur.split != null && Math.abs(cur.split - 0.5) > 0.004;
  const shareA = cur.amt ? r2(cur.amt * (cur.split ?? 0.5)) : '';
  const el = openSheet(`<h3>${isNew ? 'A new bill or cost' : esc(cur.name)}</h3>
    <label class="field"><span>Name</span><input class="inp" id="bi-name" value="${esc(cur.name)}" placeholder="e.g. Netflix, Internet, Rent" autocomplete="off"></label>
    <div class="fields2"><label class="field"><span>Amount</span><input class="inp money" id="bi-amt" inputmode="decimal" value="${cur.amt != null ? esc(String(cur.amt)) : ''}" placeholder="$0.00"></label>
      <label class="field"><span>Every</span><select class="inp" id="bi-freq">${Object.entries(M.FREQ_LABEL).map(([k, l]) => `<option value="${k}" ${k === cur.freq ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="field"><span>Whose</span><div class="seg wide" id="bi-who">${[...bothSlots(), 'j'].map(o => `<button type="button" data-who="${o}" aria-pressed="${o === cur.who}">${o === 'j' ? 'Shared' : esc(nameOf(o))}</button>`).join('')}</div></div>
    <div class="field" id="bi-splitbox" ${cur.who === 'j' ? '' : 'hidden'}><span>Split</span>
      <div class="seg wide" id="bi-split"><button type="button" data-split="half" aria-pressed="${!custom}">Half each</button><button type="button" data-split="custom" aria-pressed="${custom}">Not evenly</button></div>
      <div class="fields2" id="bi-custom" ${custom ? '' : 'hidden'}><label class="field"><span>${esc(nameOf('a'))} pays</span><input class="inp money" id="bi-a" inputmode="decimal" value="${esc(String(shareA))}"></label>
        <label class="field"><span>${esc(nameOf('b'))} pays</span><input class="inp money" id="bi-b" inputmode="decimal" value="${cur.amt ? esc(String(r2(cur.amt - shareA))) : ''}"></label></div></div>
    <label class="field"><span>Group</span><select class="inp" id="bi-group"><option value="">Other</option>${M.budgetGroups().map(g => `<option value="${g.id}" ${g.id === cur.group ? 'selected' : ''}>${esc(g.emoji || '')} ${esc(g.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Paid from (optional)</span><input class="inp" id="bi-acct" list="bi-accts" value="${esc(cur.acct || '')}" placeholder="e.g. 2Up, CommBank" autocomplete="off"><datalist id="bi-accts">${accounts.map(a => `<option value="${esc(a)}">`).join('')}</datalist></label>
    <label class="field"><span>Paid to (optional)</span><input class="inp" id="bi-to" list="bi-accts" value="${esc(cur.to || '')}" placeholder="e.g. CommBank, or who it goes to" autocomplete="off"><span class="hint">For money that moves between accounts (2Up → CommBank), or who gets paid.</span></label>
    <label class="field"><span>Keep track of the spending in Owings</span><select class="inp" id="bi-track"><option value="">No, it’s a set bill</option>${M.cats().map(c => `<option value="${esc(c.id)}" ${c.id === cur.track ? 'selected' : ''}>Yes: purchases tagged ${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select>
      <span class="hint">For a spending budget like groceries: Owings shows how much of it is left each month.</span></label>
    <label class="field"><span>Note (optional)</span><input class="inp" id="bi-note" value="${esc(cur.note || '')}" autocomplete="off"></label>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  const $ = s => el.querySelector(s);
  el.onclick = async e => {
    const w = e.target.closest('[data-who]');
    if (w) { el.querySelectorAll('#bi-who [data-who]').forEach(x => x.setAttribute('aria-pressed', String(x === w))); $('#bi-splitbox').hidden = w.dataset.who !== 'j'; return; }
    const sp = e.target.closest('[data-split]');
    if (sp) {
      el.querySelectorAll('#bi-split [data-split]').forEach(x => x.setAttribute('aria-pressed', String(x === sp)));
      $('#bi-custom').hidden = sp.dataset.split !== 'custom';
      if (sp.dataset.split === 'custom' && !$('#bi-a').value) { const v = parseMoney($('#bi-amt').value) || 0; $('#bi-a').value = r2(v / 2) || ''; $('#bi-b').value = r2(v - r2(v / 2)) || ''; }
      return;
    }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      if (await confirmSheet({ title: `Delete ${cur.name}?`, yes: 'Delete', danger: true })) {
        store.setField('budget', 'i:' + cur.id, null);
        toast('Deleted', { label: 'Undo', run: () => { const { id, ...rest } = item; store.setField('budget', 'i:' + id, rest); ctx.render(true); } });
        ctx.render(true);
      }
      return;
    }
    if (!e.target.closest('[data-save]')) return;
    const who = el.querySelector('#bi-who [aria-pressed="true"]').dataset.who;
    const out = {
      name: $('#bi-name').value.trim() || 'Untitled', amt: parseMoney($('#bi-amt').value) || 0, freq: $('#bi-freq').value, who,
      group: $('#bi-group').value, acct: $('#bi-acct').value.trim() || undefined, to: $('#bi-to').value.trim() || undefined, track: $('#bi-track').value || undefined,
      note: $('#bi-note').value.trim() || undefined, order: cur.order ?? Date.now() / 1e13,
    };
    if (who === 'j' && el.querySelector('#bi-split [aria-pressed="true"]').dataset.split === 'custom') {
      const a = parseMoney($('#bi-a').value) || 0, b = parseMoney($('#bi-b').value) || 0;
      if (a + b > 0) { out.split = r2(a / (a + b) * 10000) / 10000; if (!out.amt) out.amt = r2(a + b); }
    }
    store.setField('budget', 'i:' + cur.id, out);
    closeSheet(); ctx.render(true);
  };
  // Typing the amount keeps a custom split's two halves adding up.
  $('#bi-amt').addEventListener('input', () => {
    if ($('#bi-custom').hidden) return;
    const v = parseMoney($('#bi-amt').value) || 0, a = parseMoney($('#bi-a').value) || 0, b = parseMoney($('#bi-b').value) || 0;
    const s = a + b > 0 ? a / (a + b) : 0.5;
    $('#bi-a').value = r2(v * s) || ''; $('#bi-b').value = r2(v - r2(v * s)) || '';
  });
}

function editGroup(g, ctx) {
  const isNew = !g, cur = g ? { ...g } : { id: uid(), name: '', emoji: '📺', order: Date.now() / 1e13 };
  const el = openSheet(`<h3>${isNew ? 'A new group' : 'Edit group'}</h3>
    <label class="field"><span>Name</span><input class="inp" id="bg-name" value="${esc(cur.name)}" placeholder="e.g. Subscriptions, Utilities" autocomplete="off"></label>
    <div class="field"><span>Little picture</span><div class="chips" id="bg-emo">${GROUP_EMOJI.map(x => `<button type="button" class="chip" data-emo="${x}" aria-pressed="${x === cur.emoji}">${x}</button>`).join('')}</div></div>
    <div class="row-btns end">${isNew ? '' : '<button class="btn danger sm" data-del>Delete group</button><span class="grow"></span>'}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  el.onclick = async e => {
    const em = e.target.closest('[data-emo]');
    if (em) { el.querySelectorAll('#bg-emo [data-emo]').forEach(x => x.setAttribute('aria-pressed', String(x === em))); return; }
    if (e.target.closest('[data-close]')) return closeSheet();
    if (e.target.closest('[data-del]')) {
      closeSheet();
      const n = M.budgetItems().filter(i => i.group === cur.id).length;
      if (await confirmSheet({ title: `Delete ${cur.name}?`, text: n ? `Its ${n} item${n === 1 ? '' : 's'} move to Other.` : '', yes: 'Delete', danger: true })) {
        const f = { ['g:' + cur.id]: null };
        M.budgetItems().filter(i => i.group === cur.id).forEach(({ id, ...i }) => { f['i:' + id] = { ...i, group: '' }; });
        store.setFields('budget', f);
        ctx.render(true);
      }
      return;
    }
    if (!e.target.closest('[data-save]')) return;
    const { id, ...rest } = cur;
    store.setField('budget', 'g:' + id, { ...rest, name: el.querySelector('#bg-name').value.trim() || 'Group', emoji: el.querySelector('#bg-emo [aria-pressed="true"]')?.dataset.emo || cur.emoji });
    closeSheet(); ctx.render(true);
  };
}
