// Offline-first document store with partner sync (adapted from Property Inspect).
//
// Rows:  pots:<space>:p:<slot>:<doc>
// <slot> is "a" or "b", the same as in Human Being. Each person only writes
// their own rows, so you can never overwrite each other.
//
// Everything is shared: you both work on the same pots, budget and owings. So
// documents are made of *fields*, each stamped with when it was set and by
// whom, and the app shows the two of you merged field by field (the newest
// value wins). See merged() below. A field set to null is a deleted one.
//
// Documents live in localStorage as { t: editedAt, d: data } and are pushed
// to the table. Downloads stay small: one quick query for rows changed since
// the last look ("[]" when nothing has), then only those documents, and never
// your own edits back again.

import { CONFIG, apiBase, canSync } from './config.js';

const NS = 'pots';
const PEEK_NS = ['tend', 'prop'];   // Human Being and Property Inspect: their profiles are read, for pairing
const SESSION_KEY = 'pots:session';
const DIRTY_KEY = 'pots:dirty';
const SEEN_KEY = 'pots:seen';
const CURSOR_KEY = 'pots:cursor';
const DOC_PREFIX = 'pots:doc:';
const DOC = fk => DOC_PREFIX + fk;

function lsGet(k) {
  try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; }
}
function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
}
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
function lsHas(k) { try { return localStorage.getItem(k) != null; } catch (e) { return false; } }

let session = lsGet(SESSION_KEY);
let dirty = new Set(lsGet(DIRTY_KEY) || []);
let seen = lsGet(SEEN_KEY) || {};
let cursor = lsGet(CURSOR_KEY) || {};
const listeners = new Set();
const statusListeners = new Set();
let status = { state: canSync() ? 'idle' : 'local', at: 0, pending: dirty.size };
let flushTimer = null, pollTimer = null, flushing = null, pulling = null;
let lastFull = 0, lastPull = 0;

const stats = { requests: 0, down: 0, up: 0, docsDown: 0, lastCheck: null };
export const getStats = () => ({ ...stats });

// ── Session ───────────────────────────────────────────────────────────────
export const getSession = () => session;
export function setSession(s) { session = s; lsSet(SESSION_KEY, s); }

export function signOut() {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(DOC_PREFIX) || [DIRTY_KEY, SEEN_KEY, CURSOR_KEY, SESSION_KEY].includes(k))) drop.push(k);
    }
    drop.forEach(lsDel);
  } catch (e) {}
  session = null; dirty = new Set(); seen = {}; cursor = {};
  stopSync();
}

export const me = () => session.slot;
export const partner = () => (session.slot === 'a' ? 'b' : 'a');
export const keyFor = (slot, doc) => `p:${slot}:${doc}`;
const full = (k, space = session.space) => `${NS}:${space}:${k}`;
const parts = fk => { const p = fk.split(':'); return { slot: p[3], doc: p.slice(4).join(':') }; };

// ── Reading & writing whole documents ─────────────────────────────────────
export function read(k, fallback) {
  const e = lsGet(DOC(full(k)));
  return e ? e.d : fallback;
}
export const readMine = (doc, fb) => read(keyFor(me(), doc), fb);

export function write(k, data) {
  const fk = full(k);
  if (!lsSet(DOC(fk), { t: Date.now(), d: data })) throw new Error('This phone is out of room to save.');
  dirty.add(fk);
  lsSet(DIRTY_KEY, [...dirty]);
  emit(parts(fk).doc, 'local');
  scheduleFlush();
}
export const writeMine = (doc, data) => write(keyFor(me(), doc), data);

// ── Fields: the shared, merged layer ──────────────────────────────────────
// A field document is { fields: { key: { v, t, by } } }.

/** Set one field in my copy of a document. value null = deleted. */
export function setField(doc, key, value) {
  return setFields(doc, { [key]: value });
}
/** Set several fields at once (one write). */
export function setFields(doc, values) {
  const mine = readMine(doc, { fields: {} });
  mine.fields = mine.fields || {};
  const t = Date.now();
  for (const [k, v] of Object.entries(values)) mine.fields[k] = { v: v === undefined ? null : v, t, by: me() };
  writeMine(doc, mine);
}
/** Both people's copies merged: { key: record }, the newest record per key. */
export function merged(doc) {
  const out = {};
  for (const slot of ['a', 'b']) {
    const f = (read(keyFor(slot, doc), null) || {}).fields || {};
    for (const [k, rec] of Object.entries(f)) if (!out[k] || rec.t > out[k].t) out[k] = rec;
  }
  return out;
}
/** Just the values of merged(doc), without deleted ones. */
export function values(doc) {
  const m = merged(doc), out = {};
  for (const [k, rec] of Object.entries(m)) if (rec.v != null) out[k] = rec.v;
  return out;
}

/** The documents of one person on this phone: [{ doc, bytes, t }]. */
export function listDocs(slot) {
  const prefix = DOC(full(keyFor(slot, '')));
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const raw = localStorage.getItem(k) || '';
      let t = 0;
      try { t = JSON.parse(raw).t || 0; } catch (e) {}
      out.push({ doc: k.slice(prefix.length), bytes: raw.length, t });
    }
  } catch (e) {}
  return out.sort((x, y) => x.doc.localeCompare(y.doc));
}
/** Every document name either of you has that starts with `prefix`. */
export function docsLike(prefix) {
  const names = new Set();
  for (const slot of ['a', 'b']) listDocs(slot).forEach(d => { if (d.doc.startsWith(prefix)) names.add(d.doc); });
  return [...names].sort();
}

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(doc, source) {
  listeners.forEach(fn => { try { fn(doc, source); } catch (e) { console.error(e); } });
}
export function onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); }
export const getStatus = () => status;
function setStatus(state) {
  status = { state, at: Date.now(), pending: dirty.size };
  statusListeners.forEach(fn => fn(status));
}

// ── Network ───────────────────────────────────────────────────────────────
// The database only shows (and takes) a space's rows when the request names
// that space in its x-space header, so nobody can look through other couples'.
function headers(extra = {}, space = session && session.space) {
  return { apikey: CONFIG.supabaseKey, Authorization: 'Bearer ' + CONFIG.supabaseKey, ...(space ? { 'x-space': space } : {}), ...extra };
}
// space: another space than yours (only when joining one).
async function api(query, { space, ...opts } = {}) {
  if (!canSync()) throw new Error('not-live');
  stats.requests++;
  if (opts.body) stats.up += opts.body.length;
  const r = await fetch(apiBase() + '/rest/v1/' + CONFIG.table + query, { ...opts, headers: headers(opts.headers, space) });
  const text = await r.text().catch(() => '');
  stats.down += text.length;
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + text);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}
const inList = fks => 'in.(' + fks.map(k => '"' + k + '"').join(',') + ')';
const quote = v => '"' + v + '"';

async function fetchDocs(fks, space) {
  const out = [];
  for (let i = 0; i < fks.length; i += 40) {
    const rows = await api('?select=key,value,updated_at&key=' + encodeURIComponent(inList(fks.slice(i, i + 40))), { space }) || [];
    for (const row of rows) {
      let v = row.value;
      if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = null; } }
      out.push({ key: row.key, updated_at: row.updated_at, entry: v });
    }
  }
  return out;
}

function fetchStamps(all) {
  const space = session.space;
  if (all) return api('?select=key,updated_at&key=' + encodeURIComponent(`like.${NS}:${space}:*`));
  const like = s => `key.like.${quote(`${NS}:${space}:p:${s}:*`)}`;
  const part = s => (cursor[s] ? `and(${like(s)},updated_at.gt.${quote(cursor[s])})` : like(s));
  return api('?select=key,updated_at&or=' + encodeURIComponent(`(${part('a')},${part('b')},${part('m')})`));
}
const later = (x, y) => !y || Date.parse(x) > Date.parse(y);

export function pull({ full: all = false } = {}) {
  if (pulling) return all ? pulling.then(() => pull({ full: true })) : pulling;
  pulling = doPull(all || Date.now() - lastFull > CONFIG.fullCheckMs).finally(() => { pulling = null; });
  return pulling;
}

async function doPull(all) {
  if (!session) return false;
  if (!canSync()) { setStatus('local'); return false; }
  if (navigator.onLine === false) { setStatus('offline'); return false; }
  lastPull = Date.now();
  try {
    const stamps = await fetchStamps(all);
    const next = { ...cursor };
    const want = [];
    for (const s of stamps || []) {
      const { slot } = parts(s.key);
      if (slot !== 'a' && slot !== 'b' && slot !== 'm') continue;   // m: the maker's feedback marks
      if (later(s.updated_at, next[slot])) next[slot] = s.updated_at;
      if (seen[s.key] !== s.updated_at || !lsHas(DOC(s.key))) want.push(s.key);
    }
    if (want.length) {
      const rows = await fetchDocs(want);
      stats.docsDown += rows.length;
      const changed = [];
      for (const row of rows) {
        seen[row.key] = row.updated_at;
        const e = row.entry;
        if (!e || typeof e.t !== 'number' || dirty.has(row.key)) continue;
        const local = lsGet(DOC(row.key));
        if (!local || e.t > local.t) {
          lsSet(DOC(row.key), e);
          changed.push(parts(row.key).doc);
        }
      }
      lsSet(SEEN_KEY, seen);
      changed.forEach(d => emit(d, 'remote'));
    }
    cursor = next;
    lsSet(CURSOR_KEY, cursor);
    if (all) lastFull = Date.now();
    stats.lastCheck = { at: Date.now(), full: all, rows: (stamps || []).length, docs: want.length };
    if (!dirty.size) setStatus('synced');
    return true;
  } catch (e) {
    console.warn('Honey Pots: pull failed', e);
    setStatus(navigator.onLine === false ? 'offline' : 'error');
    return false;
  }
}

function scheduleFlush(ms = 700) {
  clearTimeout(flushTimer);
  if (!canSync()) { setStatus('local'); return; }
  flushTimer = setTimeout(() => flush(), ms);
  setStatus('saving');
}

export async function flush({ keepalive = false } = {}) {
  if (!session || !dirty.size || !canSync()) return true;
  if (flushing) return flushing;
  if (navigator.onLine === false) { setStatus('offline'); return false; }
  const batch = [...dirty].map(fk => ({ fk, entry: lsGet(DOC(fk)) })).filter(x => x.entry);
  const now = new Date().toISOString();
  flushing = (async () => {
    try {
      // Big documents (a year of pots) go a few at a time, so no single request is huge.
      const stamped = new Map();
      for (let i = 0; i < batch.length; i += 8) {
        const part = batch.slice(i, i + 8);
        const rows = await api('?select=key,updated_at', {
          method: 'POST',
          keepalive: keepalive && part.length < 3,
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify(part.map(x => ({ key: x.fk, value: JSON.stringify(x.entry), updated_at: now }))),
        });
        (Array.isArray(rows) ? rows : []).forEach(r => stamped.set(r.key, r.updated_at));
      }
      for (const x of batch) {
        seen[x.fk] = stamped.get(x.fk) || now;
        const cur = lsGet(DOC(x.fk));
        if (cur && cur.t === x.entry.t) dirty.delete(x.fk);
      }
      lsSet(SEEN_KEY, seen);
      lsSet(DIRTY_KEY, [...dirty]);
      if (dirty.size) scheduleFlush(300); else setStatus('synced');
      return true;
    } catch (e) {
      console.warn('Honey Pots: push failed', e);
      setStatus(navigator.onLine === false ? 'offline' : 'error');
      return false;
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function startSync() {
  stopSync();
  if (!canSync()) { setStatus('local'); return Promise.resolve(false); }
  const first = pull({ full: true });
  first.then(() => flush());
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') { flush(); pull(); }
  }, CONFIG.pollMs);
  return first;
}
export function stopSync() { clearInterval(pollTimer); pollTimer = null; }
export const syncNow = () => flush().then(() => pull({ full: true }));

/**
 * Moves this phone to a new space code, keeping everything it has: each
 * document, and any edits still waiting to be sent, only change their name.
 * Then syncs again with the new code.
 */
export function rekeySpace(to) {
  const from = session.space;
  if (!to || to === from) return Promise.resolve(true);
  stopSync();
  const swap = fk => { const m = /^([a-z]+):([^:]+):(.*)$/.exec(fk); return m && m[2] === from ? `${m[1]}:${to}:${m[3]}` : null; };
  const keys = [];
  try { for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i)); } catch (e) {}
  for (const k of keys) {
    if (!k || !k.startsWith(DOC_PREFIX)) continue;
    const nk = swap(k.slice(DOC_PREFIX.length));
    if (!nk) continue;
    const e = lsGet(k), cur = lsGet(DOC(nk));
    if (!e || (cur && (cur.t || 0) >= (e.t || 0)) || lsSet(DOC(nk), e)) lsDel(k);
  }
  dirty = new Set([...dirty].map(fk => swap(fk) || fk));
  seen = {};
  lsSet(DIRTY_KEY, [...dirty]);
  lsSet(SEEN_KEY, seen);
  cursor = {};
  lastFull = 0;
  lsSet(CURSOR_KEY, cursor);
  setSession({ ...session, space: to });
  return startSync();
}

document.addEventListener('visibilitychange', () => {
  if (!session) return;
  if (document.visibilityState === 'visible') { flush(); if (Date.now() - lastPull > 15000) pull(); }
  else flush({ keepalive: true });
});
window.addEventListener('online', () => { if (session) { flush(); pull(); } });
window.addEventListener('offline', () => setStatus('offline'));

// ── Spaces ────────────────────────────────────────────────────────────────
export const normalizeCode = s => String(s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

const ADJ = ['sunny', 'cozy', 'fuzzy', 'sweet', 'misty', 'dreamy', 'peachy', 'minty', 'sleepy', 'bubbly',
  'snug', 'honey', 'velvet', 'starry', 'dewy', 'rosy', 'lucky', 'gentle', 'merry', 'breezy', 'cloudy',
  'golden', 'lilac', 'silky', 'twinkly', 'jolly', 'mellow', 'plushy', 'sparkly', 'tender'];
const NOUN = ['otter', 'bunny', 'panda', 'koala', 'fawn', 'duckling', 'kitten', 'puffin', 'hedgehog', 'lamb',
  'robin', 'seal', 'cub', 'sparrow', 'bee', 'fox', 'mochi', 'dumpling', 'teacup', 'petal', 'clover',
  'cloud', 'acorn', 'pebble', 'muffin', 'peach', 'plum', 'tulip', 'fern', 'moon'];
/** A new space code (the same long kind as the other apps make): two pairs of words and six digits. */
export function makeSpaceCode() {
  const r = new Uint32Array(5);
  crypto.getRandomValues(r);
  return `${ADJ[r[0] % 30]}-${NOUN[r[1] % 30]}-${ADJ[r[2] % 30]}-${NOUN[r[3] % 30]}-${100000 + (r[4] % 900000)}`;
}

// Who's already in a space? { a?, b? } from Honey Pots, other: { a?, b? } from Human Being / Property Inspect.
export async function peekSpace(code) {
  const fks = ['a', 'b'].flatMap(s => [`${NS}:${code}:p:${s}:profile`, ...PEEK_NS.map(ns => `${ns}:${code}:p:${s}:profile`)]);
  const rows = await fetchDocs(fks, code);
  const out = { other: {} };
  const plain = d => (d && d.fields ? Object.fromEntries(Object.entries(d.fields).map(([k, x]) => [k, x.v])) : d);
  rows.forEach(r => {
    const [ns, , , slot] = r.key.split(':');
    const d = plain(r.entry && r.entry.d);
    if (!d || !d.name) return;
    if (ns === NS) out[slot] = d;
    else if (!out.other[slot]) out.other[slot] = d;
  });
  return out;
}
