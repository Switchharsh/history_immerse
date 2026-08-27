import { hash } from './pixelate.js';

/**
 * Draws a full-body character sprite on a 32x48 pixel grid.
 *
 * The head is the real Wikimedia portrait, resampled to 14x14. The body is drawn from a
 * garment silhouette chosen per figure, so Joan of Arc stands in plate, Ashoka in a robe
 * and Churchill in a three-piece suit — recognisable at a glance from the outline alone,
 * which is the whole job of a sprite.
 *
 * Everything is drawn with fillRect on integer coordinates. No curves, no anti-aliasing,
 * no sub-pixel positions — one stray 0.5 and the illusion is gone.
 */

export const SPRITE_W = 32;
// 56 rather than 48: a stovepipe hat and a bicorne both need real headroom, and
// clipping them off the top of the canvas is the difference between Lincoln and a man
// standing under a black bar.
export const SPRITE_H = 56;
const HEAD_ROOM = 8;

/** Garment silhouettes, keyed by the `sprite.garment` field on a card. */
export const GARMENTS = [
  'robe', 'toga', 'armor', 'coat', 'suit', 'uniform', 'gown', 'dhoti', 'tunic',
];

/** Fallback when a card carries no explicit sprite block (generated cards). */
export function inferSprite(card) {
  const tags = new Set(card.era_tags ?? []);
  const roles = (card.roles ?? []).join(' ').toLowerCase();
  const born = card.born ?? 0;

  let garment = 'coat';
  if (tags.has('ancient') || tags.has('roman') || tags.has('greek')) garment = 'toga';
  else if (tags.has('egyptian') || tags.has('hellenistic') || tags.has('buddhism') || tags.has('indian')) garment = 'robe';
  else if (tags.has('medieval') || tags.has('steppe') || tags.has('mongol')) garment = 'tunic';
  else if (born >= 1400 && born < 1650) garment = 'tunic';
  else if (born >= 1650 && born < 1850) garment = 'coat';
  else if (born >= 1850) garment = 'suit';
  if (/general|military|marshal|colonel|admiral|khan|emperor of the french/.test(roles)) garment = 'uniform';
  if (/queen|pharaoh/.test(roles)) garment = 'gown';

  const h = hash(card.id ?? card.name ?? 'x');
  const hues = [
    ['#5a3f6b', '#3d2a49', '#c9a227'],
    ['#2f4f6b', '#213849', '#d9b45a'],
    ['#6b3a2f', '#4a2620', '#d0a05a'],
    ['#2f5b45', '#1f3d2e', '#c8b06a'],
    ['#4a4a5e', '#32323f', '#b9a06a'],
    ['#6b2f45', '#48202f', '#d4a76a'],
  ];
  const [primary, shadow, accent] = hues[h % hues.length];
  return { garment, primary, shadow, accent };
}

export function spriteFor(card) {
  const base = inferSprite(card);
  return { ...base, ...(card.sprite ?? {}) };
}

/**
 * Render one sprite.
 *
 * @param ctx        canvas 2d context, already scaled so 1 unit = 1 sprite pixel
 * @param opts.frame  0 or 1 — the idle bob frame
 */
export function drawSprite(ctx, { sprite, frame = 0, speaking = false }) {
  const { garment, primary, shadow, accent } = sprite;
  const bob = frame === 1 ? 1 : 0;

  // Everything below is authored against the original 48-tall layout; the translate
  // gives headwear its room without renumbering every coordinate.
  ctx.save();
  ctx.translate(0, HEAD_ROOM);

  const px = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y + bob), Math.round(w), Math.round(h));
  };

  const DARK = '#0b0a14';
  const SKIN = sprite.skin ?? '#c98f68';

  // ---- shadow on the ground (does not bob — it is on the floor) ----
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(8, 46, 16, 2);

  // ---- head ----------------------------------------------------------------
  // Drawn, not photographic. A 14px crop of an oil painting is indistinguishable from
  // noise — and the games this is modelled on use drawn sprites, so hair, beard and
  // headwear are what make a figure recognisable at this size.
  drawHead(px, ctx, 9, 3, sprite, bob);

  // ---- neck ----------------------------------------------------------------
  px(14, 17, 4, 2, SKIN);

  // ---- body ----------------------------------------------------------------
  const shoulderY = 19;

  switch (garment) {
    case 'robe':
    case 'toga': {
      // Wide trapezoid to the floor; no legs visible.
      for (let i = 0; i < 27; i++) {
        const w = 10 + Math.floor(i * 0.52);
        px(16 - w / 2, shoulderY + i, w, 1, i % 5 === 4 ? shadow : primary);
      }
      px(10, shoulderY + 2, 12, 2, accent); // sash across the chest
      px(15, shoulderY + 4, 2, 22, shadow); // centre fold
      break;
    }
    case 'gown': {
      for (let i = 0; i < 27; i++) {
        const w = 9 + Math.floor(i * 0.72);
        px(16 - w / 2, shoulderY + i, w, 1, i % 6 === 5 ? shadow : primary);
      }
      px(11, shoulderY, 10, 3, accent); // collar / ruff
      px(13, shoulderY + 8, 6, 12, accent); // stomacher panel
      break;
    }
    case 'dhoti': {
      px(12, shoulderY, 8, 9, SKIN); // bare chest
      px(9, shoulderY - 1, 5, 16, '#e8e4d8'); // shawl over one shoulder
      for (let i = 0; i < 18; i++) px(11, shoulderY + 9 + i, 10, 1, i % 4 === 3 ? '#cfcabb' : '#e8e4d8');
      break;
    }
    case 'armor': {
      px(11, shoulderY, 10, 12, '#9aa3b0');
      px(11, shoulderY, 10, 2, '#c3cad4'); // lit top edge
      px(8, shoulderY, 4, 5, '#8a94a3'); // pauldrons
      px(20, shoulderY, 4, 5, '#8a94a3');
      px(13, shoulderY + 4, 6, 6, accent); // tabard
      px(11, shoulderY + 12, 10, 3, '#7a8494'); // fauld
      px(12, shoulderY + 15, 3, 11, '#8a94a3'); // legs
      px(17, shoulderY + 15, 3, 11, '#8a94a3');
      px(11, 44, 5, 2, DARK);
      px(16, 44, 5, 2, DARK);
      break;
    }
    case 'uniform': {
      px(11, shoulderY, 10, 14, primary);
      px(11, shoulderY, 10, 1, '#ffffff22');
      px(8, shoulderY, 3, 3, accent); // shoulder boards
      px(21, shoulderY, 3, 3, accent);
      px(15, shoulderY + 1, 2, 12, shadow); // button placket
      px(11, shoulderY + 9, 10, 2, DARK); // belt
      px(12, shoulderY + 3, 3, 4, accent); // medals
      px(12, shoulderY + 14, 3, 12, shadow);
      px(17, shoulderY + 14, 3, 12, shadow);
      px(11, 44, 5, 2, DARK);
      px(16, 44, 5, 2, DARK);
      break;
    }
    case 'tunic': {
      px(11, shoulderY, 10, 13, primary);
      px(10, shoulderY + 1, 2, 9, shadow); // sleeves
      px(20, shoulderY + 1, 2, 9, shadow);
      px(11, shoulderY + 8, 10, 2, accent); // belt
      px(12, shoulderY + 13, 3, 13, shadow);
      px(17, shoulderY + 13, 3, 13, shadow);
      px(11, 44, 5, 2, DARK);
      px(16, 44, 5, 2, DARK);
      break;
    }
    case 'coat': {
      px(11, shoulderY, 10, 10, primary);
      px(13, shoulderY, 6, 7, '#e8e4d8'); // shirt front
      px(15, shoulderY, 2, 5, accent); // cravat
      for (let i = 0; i < 8; i++) px(10 - Math.floor(i / 4), shoulderY + 10 + i, 12 + Math.floor(i / 2), 1, i % 4 === 3 ? shadow : primary);
      px(12, shoulderY + 18, 3, 8, shadow);
      px(17, shoulderY + 18, 3, 8, shadow);
      px(11, 44, 5, 2, DARK);
      px(16, 44, 5, 2, DARK);
      break;
    }
    case 'suit':
    default: {
      px(11, shoulderY, 10, 13, primary);
      px(14, shoulderY, 4, 8, '#e8e4d8'); // shirt
      px(15, shoulderY + 1, 2, 6, accent); // tie
      px(10, shoulderY + 1, 2, 10, shadow); // sleeves
      px(20, shoulderY + 1, 2, 10, shadow);
      px(12, shoulderY + 13, 3, 13, shadow);
      px(17, shoulderY + 13, 3, 13, shadow);
      px(11, 44, 5, 2, DARK);
      px(16, 44, 5, 2, DARK);
      break;
    }
  }

  // ---- speaking marker -----------------------------------------------------
  if (speaking) {
    px(14, -8, 4, 2, '#f2c14e');
    px(15, -6, 2, 2, '#f2c14e');
  }

  ctx.restore();
}

/**
 * The head: 14x14, drawn from features rather than photographed.
 *
 * Recognition at this size comes almost entirely from silhouette — Lincoln's stovepipe,
 * Napoleon's bicorne, Joan's helm, Socrates' beard. Colour barely registers; outline does.
 */
function drawHead(px, ctx, hx, hy, sprite, bob) {
  const DARK = '#0b0a14';
  const skin = sprite.skin ?? '#c98f68';
  const hairColor = sprite.hairColor ?? '#3a2a1a';
  const hair = sprite.hair ?? 'short';
  const beard = sprite.beard ?? 'none';
  const headwear = sprite.headwear ?? 'none';
  const accent = sprite.accent ?? '#c9a227';

  // Shade one side of the face so it is not a flat slab.
  const shade = shadeOf(skin);

  // ---- face ----
  px(hx + 1, hy + 2, 12, 12, skin);
  px(hx + 10, hy + 2, 3, 12, shade);   // cheek in shadow
  px(hx, hy + 6, 1, 3, skin);          // ears
  px(hx + 13, hy + 6, 1, 3, shade);

  // ---- eyes ----
  px(hx + 3, hy + 7, 2, 2, DARK);
  px(hx + 8, hy + 7, 2, 2, DARK);
  if (sprite.glasses) {
    px(hx + 2, hy + 6, 4, 4, '#d8d4c8');
    px(hx + 3, hy + 7, 2, 2, DARK);
    px(hx + 7, hy + 6, 4, 4, '#d8d4c8');
    px(hx + 8, hy + 7, 2, 2, DARK);
    px(hx + 6, hy + 7, 1, 1, '#d8d4c8'); // bridge
  }
  px(hx + 5, hy + 10, 3, 1, shade);     // mouth

  // ---- hair ----
  switch (hair) {
    case 'bald':
      break;
    case 'receding':
      px(hx + 1, hy + 1, 3, 2, hairColor);
      px(hx + 10, hy + 1, 3, 2, hairColor);
      px(hx + 1, hy + 3, 1, 4, hairColor);
      px(hx + 12, hy + 3, 1, 4, hairColor);
      break;
    case 'long':
      px(hx + 1, hy, 12, 4, hairColor);
      px(hx, hy + 3, 2, 10, hairColor);
      px(hx + 12, hy + 3, 2, 10, hairColor);
      break;
    case 'bob':
      px(hx + 1, hy, 12, 4, hairColor);
      px(hx, hy + 3, 2, 7, hairColor);
      px(hx + 12, hy + 3, 2, 7, hairColor);
      break;
    case 'tied':
      px(hx + 1, hy, 12, 3, hairColor);
      px(hx, hy + 2, 1, 5, hairColor);
      px(hx + 13, hy + 2, 1, 5, hairColor);
      px(hx + 5, hy - 2, 4, 4, hairColor); // topknot, joined to the scalp
      break;
    case 'curly':
      px(hx + 1, hy, 12, 4, hairColor);
      px(hx, hy + 1, 1, 5, hairColor);
      px(hx + 13, hy + 1, 1, 5, hairColor);
      px(hx + 2, hy - 1, 3, 2, hairColor);
      px(hx + 8, hy - 1, 3, 2, hairColor);
      break;
    case 'short':
    default:
      px(hx + 1, hy, 12, 4, hairColor);
      px(hx, hy + 2, 1, 4, hairColor);
      px(hx + 13, hy + 2, 1, 4, hairColor);
      break;
  }

  // Outline first: the beard and headwear are drawn over it on purpose, so they break
  // the head's square silhouette. A beard contained inside the outline barely reads at
  // 14 pixels; one that changes the outline reads instantly.
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 1;
  ctx.strokeRect(hx + 0.5, hy + 1.5 + bob, 13, 13);

  // ---- beard ----
  switch (beard) {
    case 'full':
      px(hx, hy + 9, 14, 6, hairColor);
      px(hx + 3, hy + 9, 8, 2, skin);        // upper lip clear
      px(hx + 2, hy + 15, 10, 2, hairColor); // hangs past the jaw
      px(hx + 4, hy + 17, 6, 1, hairColor);
      break;
    case 'chinstrap':
      px(hx + 1, hy + 10, 12, 4, hairColor);
      px(hx + 3, hy + 10, 8, 2, skin);
      break;
    case 'goatee':
      px(hx + 5, hy + 11, 4, 5, hairColor);  // past the chin
      px(hx + 3, hy + 9, 8, 1, hairColor);
      break;
    case 'moustache':
      px(hx + 4, hy + 9, 6, 2, hairColor);
      break;
    default:
      break;
  }

  // ---- headwear (drawn last: it sits over everything) ----
  switch (headwear) {
    case 'crown':
      px(hx, hy - 2, 14, 3, accent);
      px(hx + 1, hy - 4, 2, 2, accent);
      px(hx + 6, hy - 5, 2, 3, accent);
      px(hx + 11, hy - 4, 2, 2, accent);
      break;
    case 'circlet':
      px(hx, hy - 1, 14, 2, accent);
      px(hx + 6, hy - 3, 2, 2, accent);
      break;
    case 'laurel':
      px(hx, hy, 5, 2, '#5fc98a');
      px(hx + 9, hy, 5, 2, '#5fc98a');
      px(hx + 1, hy - 2, 2, 2, '#4aa870');
      px(hx + 11, hy - 2, 2, 2, '#4aa870');
      px(hx + 5, hy - 1, 4, 1, '#4aa870');  // band across the brow
      break;
    case 'helm':
      px(hx - 1, hy - 2, 16, 6, '#9aa3b0');
      px(hx - 1, hy - 2, 16, 2, '#c3cad4');
      px(hx + 6, hy + 3, 2, 6, '#8a94a3'); // nasal bar
      px(hx - 1, hy + 3, 2, 5, '#8a94a3'); // cheek guards
      px(hx + 13, hy + 3, 2, 5, '#8a94a3');
      break;
    case 'tophat':
      px(hx - 2, hy - 2, 18, 2, DARK);     // brim
      px(hx + 1, hy - 11, 12, 9, '#1a1a24'); // crown
      px(hx + 1, hy - 4, 12, 2, '#33333f');  // band
      break;
    case 'bicorne':
      px(hx - 3, hy - 1, 20, 4, '#1c2740'); // sits on the scalp, wings out either side
      px(hx - 1, hy - 3, 16, 3, '#1c2740');
      px(hx + 5, hy - 5, 4, 3, '#1c2740');
      px(hx + 12, hy - 2, 3, 3, accent);    // cockade
      break;
    case 'cap':
      px(hx, hy - 2, 14, 4, sprite.primary ?? '#4a4a5e');
      px(hx - 1, hy + 1, 16, 2, DARK);     // peak
      break;
    case 'hood':
      px(hx - 1, hy - 3, 16, 6, sprite.primary ?? '#5b4a2f');
      px(hx - 1, hy + 2, 2, 9, sprite.primary ?? '#5b4a2f');
      px(hx + 13, hy + 2, 2, 9, sprite.primary ?? '#5b4a2f');
      break;
    case 'veil':
      px(hx - 1, hy - 2, 16, 4, '#e8e4d8');
      px(hx - 1, hy + 1, 2, 11, '#e8e4d8');
      px(hx + 13, hy + 1, 2, 11, '#e8e4d8');
      break;
    case 'nemes': // Egyptian royal headcloth
      px(hx - 1, hy - 2, 16, 4, accent);
      px(hx - 2, hy + 1, 3, 10, '#2f4f6b');
      px(hx + 13, hy + 1, 3, 10, '#2f4f6b');
      px(hx + 6, hy - 4, 2, 3, accent);
      break;
    default:
      break;
  }

}

/** A darker version of a hex colour, for the shaded side of the face. */
function shadeOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((n >> 16) & 255) - 34);
  const g = Math.max(0, ((n >> 8) & 255) - 30);
  const b = Math.max(0, (n & 255) - 26);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
