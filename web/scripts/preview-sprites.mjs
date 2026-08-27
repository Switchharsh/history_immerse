#!/usr/bin/env node
/**
 * Renders every character sprite to a PNG contact sheet so the art can be reviewed
 * without a browser.
 *
 *   node web/scripts/preview-sprites.mjs [out.png]
 *
 * Portraits are fetched and pixelated exactly as the browser does, so what this produces
 * is what the stage shows.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { drawSprite, spriteFor, SPRITE_W, SPRITE_H } from '../src/lib/spriteKit.js';
import { quantise } from '../src/lib/pixelate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs', 'sprites.png');

// Portraits are cached on disk and fetched with a pause between requests. Wikimedia
// rate-limits a tight loop with 429s, and there is no reason to re-download a file that
// has not changed just to re-render the sheet.
const CACHE = join(ROOT, 'data', 'portrait-cache');
mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPortrait(url) {
  const key = join(CACHE, createHash('sha1').update(url).digest('hex') + '.img');
  if (existsSync(key)) return readFileSync(key);
  await sleep(400);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'parley-sprite-preview/0.1 (contact via repo)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  writeFileSync(key, buf);
  return buf;
}

const cards = readdirSync(join(ROOT, 'cards'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'cards', f), 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Same crop + quantise the browser applies. */
async function faceFor(card) {
  if (!card.portrait) return null;
  try {
    // Wikimedia rejects requests without a User-Agent with a 403. The browser always
    // sends one; a bare loadImage() from Node does not.
    const img = await loadImage(await fetchPortrait(card.portrait));
    const res = 14;
    const c = createCanvas(res, res);
    const ctx = c.getContext('2d');
    const side = Math.min(img.width, img.height) * 0.82;
    const sx = (img.width - side) / 2;
    const sy = Math.min((img.height - side) / 2, img.height * 0.06);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, res, res);
    const px = ctx.getImageData(0, 0, res, res);
    quantise(px.data);
    ctx.putImageData(px, 0, 0);
    return c;
  } catch (err) {
    console.error(`  ! ${card.id}: ${err.message}`);
    return null;
  }
}

const SCALE = 4;
const COLS = 6;
const CELL_W = SPRITE_W * SCALE + 16;
const CELL_H = SPRITE_H * SCALE + 30;
const rows = Math.ceil(cards.length / COLS);

const sheet = createCanvas(COLS * CELL_W, rows * CELL_H);
const sctx = sheet.getContext('2d');
sctx.fillStyle = '#14132a';
sctx.fillRect(0, 0, sheet.width, sheet.height);

console.error(`Rendering ${cards.length} sprites...`);

for (const [i, card] of cards.entries()) {
  const cx = (i % COLS) * CELL_W;
  const cy = Math.floor(i / COLS) * CELL_H;

  const cell = createCanvas(SPRITE_W * SCALE, SPRITE_H * SCALE);
  const ctx = cell.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawSprite(ctx, { sprite: spriteFor(card), frame: 0, speaking: false });

  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(cell, cx + 8, cy + 6);

  sctx.fillStyle = '#f2c14e';
  sctx.font = '11px sans-serif';
  sctx.textAlign = 'center';
  sctx.fillText(card.name.slice(0, 22), cx + CELL_W / 2, cy + CELL_H - 10);
  sctx.fillStyle = '#6f6aa8';
  sctx.fillText(spriteFor(card).garment, cx + CELL_W / 2, cy + CELL_H - 22);
}

writeFileSync(OUT, sheet.toBuffer('image/png'));
console.error(`Wrote ${OUT}`);
