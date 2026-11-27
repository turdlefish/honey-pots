// The two of you (each person's own "profile" document), plus little per-phone preferences.

import * as store from './store.js';
import { esc } from './ui.js';

export const COLORS = ['#F290B5', '#7FB2EC', '#62C29A', '#AE96E8', '#F4A47C', '#E7B23A', '#E0607E', '#5BA8B5'];
export const JOINT_COLOR = '#F6B93B';

export function person(slot) {
  const f = store.read(store.keyFor(slot, 'profile'), {}).fields || {};
  const fallback = slot === store.me() ? 'Me' : 'Partner';
  return { slot, name: f.name?.v || fallback, color: f.color?.v || COLORS[slot === 'a' ? 0 : 1], here: !!f.name };
}
export const nameOf = slot => person(slot).name;
/** You first, then your partner. */
export const bothSlots = () => [store.me(), store.partner()];
/** a / b / j (joint) → a name. Joint things are "Shared" everywhere. */
export const ownerName = o => (o === 'j' ? 'Shared' : nameOf(o));
export const ownerColor = o => (o === 'j' ? JOINT_COLOR : person(o).color);
/** Whose: "Adri's", "Joe's", "Shared". */
export const ownerPossessive = o => (o === 'j' ? 'Shared' : `${nameOf(o)}’s`);
/** A little coloured name tag. */
export const ownerTag = (o, label = ownerName(o)) => `<span class="tag pcol" style="--pc:${esc(ownerColor(o))}">${esc(label)}</span>`;

/**
 * The same four choices on every page: All (everything), each of you, and Shared.
 * attr is the button's data attribute (e.g. "pwho" → data-pwho="a").
 */
export const WHO = ['all', 'a', 'b', 'j'];
export const whoLabel = w => (w === 'all' ? 'All' : w === 'j' ? 'Shared' : nameOf(w));
export const whoSeg = (cur, attr, label = 'Whose') => `<div class="seg wide whoseg" role="group" aria-label="${esc(label)}">${['all', ...bothSlots(), 'j']
  .map(k => `<button data-${attr}="${k}" aria-pressed="${cur === k}">${esc(whoLabel(k))}</button>`).join('')}</div>`;
/** A saved choice, or All. ("both" was the old word for All.) */
export const whoPref = key => { const w = pref(key, 'all'); return w === 'both' ? 'all' : WHO.includes(w) ? w : 'all'; };

// Per-phone choices (which tab view, week/month/year…), never synced.
export function pref(key, fallback) {
  try { const v = localStorage.getItem('pots:pref:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
export function setPref(key, value) { try { localStorage.setItem('pots:pref:' + key, JSON.stringify(value)); } catch (e) {} }
/** A per-phone set of ids (folded cards…): has / toggle. */
export const prefSet = key => new Set(pref(key, []));
export function togglePrefSet(key, id) { const s = prefSet(key); if (s.has(id)) s.delete(id); else s.add(id); setPref(key, [...s]); return s.has(id); }
