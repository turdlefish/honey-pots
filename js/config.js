// Where Honey Pots keeps its shared data.
//
// Same Supabase project and key/value table as Human Being, Human Doing and
// Property Inspect. Every Honey Pots row is namespaced "pots:<space code>:…",
// so the apps never collide, and you join with the same space code.

const isLocalHost = ['localhost', '[::1]'].includes(location.hostname) || /^127\./.test(location.hostname);

// `?mock` (local dev only) points sync at dev-server.js's fake table instead
// of the real database; `?mock=0` switches back.
try {
  const q = new URLSearchParams(location.search);
  if (q.get('mock') === '0') localStorage.removeItem('pots:mock');
  else if (q.has('mock')) localStorage.setItem('pots:mock', '1');
} catch (e) { /* storage blocked: stay on the real database */ }

let mockFlag = false;
try { mockFlag = localStorage.getItem('pots:mock') === '1'; } catch (e) {}

export const APP = 'Honey Pots';
// This app's version (shown on Us; the Android app's versionName will match it).
export const VERSION = '1.7';
// The website (GitHub Pages): the same space as the Android app, synced both ways.
export const WEBSITE = 'https://turdlefish.github.io/honey-pots/';

export const CONFIG = {
  supabaseUrl: 'https://njywijcqspkwebfqesjx.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qeXdpamNxc3Brd2ViZnFlc2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTAwODcsImV4cCI6MjA4OTgyNjA4N30.2dAP4tXOr1ukQy8Q3_GkMjKhOfnwSCMnTjp9ofd79ls',
  table: 'tb_store',
  mock: isLocalHost && mockFlag,
  // The real database keeps a couple's rows private with its space lock, which
  // covers "pots:" rows since 2026-11-27 (Timeblock_app/supabase-space-lock.sql).
  // false = never send anything there (everything stays on the device, or ?mock).
  live: true,
  isLocalHost,
  pollMs: 30000,             // check for your partner's changes while the app is on screen
  fullCheckMs: 10 * 60000,   // every row's stamp, in case a wrong clock hid a change
};

export const apiBase = () => (CONFIG.mock ? location.origin : CONFIG.supabaseUrl);
export const canSync = () => CONFIG.mock || CONFIG.live;
