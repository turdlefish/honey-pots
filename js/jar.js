// A little honey jar: filled to how much of the target is saved. Money that was saved
// and then spent again shows as paler honey at the top, so a used pot still shows
// how full it got.

import { esc } from './ui.js';

let n = 0;
const BODY = 'M12 23c0-3 2-5 5-5h26c3 0 5 2 5 5v33c0 7-5 12-12 12H24c-7 0-12-5-12-12z';
const TOP = 20, BOTTOM = 68;

export function jar({ full = 0, spent = 0, size = 46, emoji = '', lid = '#FFE19A', reached = false } = {}) {
  const id = 'jc' + (++n);
  full = Math.max(0, Math.min(1, full || 0));
  spent = Math.max(0, Math.min(full, spent || 0));
  const yFull = BOTTOM - (BOTTOM - TOP) * full, yGold = BOTTOM - (BOTTOM - TOP) * (full - spent);
  const wave = y => `M8 ${y} q5.5 3 11 0 t11 0 t11 0 t11 0 t11 0`;
  const h = Math.round(size), w = Math.round(size * 60 / 72);
  return `<svg class="jar${reached ? ' reached' : ''}" viewBox="0 0 60 72" width="${w}" height="${h}" aria-hidden="true">
    <defs><clipPath id="${id}"><path d="${BODY}"/></clipPath></defs>
    <path class="glass" d="${BODY}"/>
    ${full > 0 ? `<g clip-path="url(#${id})">
      ${spent > 0 ? `<path d="${wave(yFull)} V72 H8z" class="honey" opacity=".35"/>` : ''}
      <path d="${wave(yGold)} V72 H8z" class="honey"/>
      <path d="${wave(yGold)}" class="top"/>
    </g>` : ''}
    <path class="rim" d="${BODY}"/>
    <rect x="15" y="7" width="30" height="10" rx="4" class="lid" style="--lidc:${esc(lid)}"/>
    <path d="M18 28v12" class="shine"/>
    ${emoji ? `<circle cx="30" cy="47" r="10" class="lbl"/><text x="30" y="48" class="emo">${esc(emoji)}</text>` : ''}
    ${reached ? '<path d="M50 9l1.4 3.2 3.2 1.4-3.2 1.4L50 18.2l-1.4-3.2-3.2-1.4 3.2-1.4z" fill="#FFC23D"/>' : ''}
  </svg>`;
}
