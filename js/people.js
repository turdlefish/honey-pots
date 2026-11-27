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
/** a / b / j (joint) → a name. */
export const ownerName = o => (o === 'j' ? 'Ours' : nameOf(o));
export const ownerColor = o => (o === 'j' ? JOINT_COLOR : person(o).color);
/** Whose: "Adri's", "Joe's", "Our". */
export const ownerPossessive = o => (o === 'j' ? 'Our' : `${nameOf(o)}’s`);
/** A little coloured name tag. */
export const ownerTag = (o, label = ownerName(o)) => `<span class="tag pcol" style="--pc:${esc(ownerColor(o))}">${esc(label)}</span>`;

// Per-phone choices (which tab view, week/month/year…), never synced.
export function pref(key, fallback) {
  try { const v = localStorage.getItem('pots:pref:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
export function setPref(key, value) { try { localStorage.setItem('pots:pref:' + key, JSON.stringify(value)); } catch (e) {} }
