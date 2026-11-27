// First run: join with the space code you use in Human Being (the usual way), or start a new space.

import * as store from './store.js';
import { canSync, CONFIG } from './config.js';
import { COLORS } from './people.js';
import { jar } from './jar.js';
import { esc, toast, copyText } from './ui.js';

export function runOnboarding(done) {
  const el = document.getElementById('ob');
  el.hidden = false;
  let peek = null, code = '', slot = null;
  const art = `<div class="hero">${jar({ full: .62, size: 92, emoji: '💛', lid: '#F7A9C4' })}${jar({ full: .35, size: 74, emoji: '🏡', lid: '#9CC6F2' })}</div>`;

  const screens = {
    welcome: () => `<div class="card c-honey"><span class="tape" aria-hidden="true"></span>${art}
      <span class="eyebrow">Honey Pots</span>
      <h1>Our savings pots, budget and owings</h1>
      <p class="muted">You both see the same pots, bills and owings. Use the space code from Human Being so you’re paired the same way.</p>
      ${canSync() ? `<form id="ob-join"><input class="inp" id="ob-code" placeholder="Space code, e.g. sunny-otter-misty-fern-482913" autocomplete="off" autocapitalize="none"><button class="btn primary">Find</button></form>
      <p class="err" id="ob-err" hidden></p>
      <button class="btn ghost" data-ob="new">Start a new space instead</button>`
      : `<p class="note-box small">Honey Pots isn’t connected to the database yet, so for now it keeps everything on this device. To try the two-phone version, open it with <b>?mock</b> on the test server.</p>
      <button class="btn primary" data-ob="new">Try it on this device</button>`}</div>`,
    who: () => {
      const opt = s => {
        const p = peek[s] || peek.other[s];
        if (!p) return `<button class="btn ghost block" data-ob-slot="${s}" data-new="1">I’m new here (person ${s.toUpperCase()})</button>`;
        return `<button class="btn block" data-ob-slot="${s}" ${peek[s] ? 'data-existing="1"' : ''}>I’m ${esc(p.name)}</button>`;
      };
      return `<div class="card c-honey"><h1>Who are you?</h1><p class="muted">Space <b>${esc(code)}</b></p>${opt('a')}${opt('b')}<p class="err" id="ob-err" hidden></p><button class="btn ghost" data-ob="welcome">Back</button></div>`;
    },
    name: () => `<div class="card c-honey"><h1>What should we call you?</h1>
      <form id="ob-name"><input class="inp" id="ob-nick" placeholder="Your name" autocomplete="given-name"><button class="btn primary">Continue</button></form>
      <button class="btn ghost" data-ob="welcome">Back</button></div>`,
    created: () => `<div class="card c-honey"><h1>Your space is ready</h1>
      <p class="muted">${canSync() ? 'Send this code to your partner. They enter it on the first screen.' : 'This is your space’s code.'}</p>
      <div class="code">${esc(store.getSession().space)}</div>
      <div class="row-btns">${canSync() ? '<button class="btn ghost" data-ob="copy">Copy code</button>' : ''}<button class="btn primary" data-ob="enter">Start</button></div></div>`,
  };
  const show = name => { el.innerHTML = screens[name](); const f = el.querySelector('input'); if (f && matchMedia('(pointer: fine)').matches) f.focus(); };
  const err = text => { const e = el.querySelector('#ob-err'); if (e) { e.hidden = false; e.textContent = text; } };
  const finish = () => { el.hidden = true; el.innerHTML = ''; done(); };
  const writeProfile = (name, color) => { store.setFields('profile', { name, color }); store.flush(); };

  el.addEventListener('click', async e => {
    const go = e.target.closest('[data-ob]')?.dataset.ob;
    if (go === 'new') { slot = 'a'; code = ''; return show('name'); }
    if (go === 'copy') { toast((await copyText(store.getSession().space)) ? 'Code copied' : 'Select the code to copy it'); return; }
    if (go === 'enter') return finish();
    if (go) return show(go);

    const b = e.target.closest('[data-ob-slot]');
    if (!b) return;
    slot = b.dataset.obSlot;
    if (b.dataset.new) return show('name');
    store.setSession({ space: code, slot, joined: Date.now() });
    if (b.dataset.existing) {
      // Signing in again on another phone: everything comes down first.
      b.disabled = true;
      if (await store.pull({ full: true })) return finish();
      store.signOut();
      b.disabled = false;
      return err('Couldn’t download your pots. Check your connection and try again.');
    }
    // Paired in another app: the same name and colour here.
    const p = peek.other[slot];
    writeProfile(p.name, p.color || COLORS[slot === 'a' ? 0 : 1]);
    await store.pull({ full: true });
    toast(`Welcome, ${p.name}`);
    finish();
  });

  el.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'ob-join') {
      code = store.normalizeCode(el.querySelector('#ob-code').value);
      if (!code) return;
      const btn = e.target.querySelector('button');
      btn.disabled = true; btn.textContent = 'Looking…';
      try {
        peek = await store.peekSpace(code);
        if (!peek.a && !peek.b && !peek.other.a && !peek.other.b) err('We couldn’t find a space with that code. Check the spelling?');
        else return show('who');
      } catch (ex) { err('Couldn’t reach the server. Check your connection and try again.'); }
      btn.disabled = false; btn.textContent = 'Find';
    }
    if (e.target.id === 'ob-name') {
      const name = el.querySelector('#ob-nick').value.trim();
      if (!name) return;
      if (!code) {
        store.setSession({ space: store.makeSpaceCode(), slot: 'a', joined: Date.now() });
        writeProfile(name, COLORS[0]);
        return show('created');
      }
      store.setSession({ space: code, slot, joined: Date.now() });
      writeProfile(name, COLORS[slot === 'a' ? 0 : 1]);
      await store.pull({ full: true });
      finish();
    }
  });

  show('welcome');
}
