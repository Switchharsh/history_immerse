import { useEffect, useRef } from 'react';
import { hash } from '../lib/pixelate.js';

/**
 * The room the party is standing in, drawn as a pixel scene.
 *
 * Zelda-style interiors: a back wall with something on it, a floor line the sprites stand
 * on, and a couple of props for depth. Everything is fillRect on a 128x72 grid scaled up,
 * so it stays crisp at any window size and costs nothing to render.
 */

const W = 128;
const H = 72;

const PALETTES = {
  war_room:  { wall: '#3a3550', wallLo: '#2b2740', floor: '#4a3f33', floorLo: '#382f26', trim: '#6d4f18', glow: '#f2c14e' },
  palace:    { wall: '#4a3a5e', wallLo: '#372a47', floor: '#6b5a3a', floorLo: '#4f422a', trim: '#c9a227', glow: '#f2c14e' },
  stone:     { wall: '#33313f', wallLo: '#24222e', floor: '#3d3a45', floorLo: '#2c2a33', trim: '#5a5668', glow: '#8a94a3' },
  void_room: { wall: '#1e1b33', wallLo: '#161328', floor: '#2a2545', floorLo: '#1e1a33', trim: '#4a3f6b', glow: '#9b7ede' },
  mars:      { wall: '#4a2620', wallLo: '#331a16', floor: '#6b3a2f', floorLo: '#4d2921', trim: '#8a4a3a', glow: '#e6935a' },
  workshop:  { wall: '#3f3a2f', wallLo: '#2e2a22', floor: '#5b4a33', floorLo: '#423626', trim: '#8a6a2f', glow: '#f2c14e' },
  throne:    { wall: '#42283a', wallLo: '#301d2a', floor: '#5b3a45', floorLo: '#422a33', trim: '#c9a227', glow: '#f2c14e' },
};

/** Which room a scenario happens in. Explicit on the card where it matters. */
function pickScene(scenario) {
  if (scenario.backdrop && PALETTES[scenario.backdrop]) return scenario.backdrop;
  const text = `${scenario.id} ${scenario.setting ?? ''}`.toLowerCase();
  if (/mars|planet|habitat|viewport/.test(text)) return 'mars';
  if (/cell|stone|prison|trial|condemned/.test(text)) return 'stone';
  if (/palace|throne|chamber|queen|pharaoh/.test(text)) return 'throne';
  if (/workshop|bench|device|laborator/.test(text)) return 'workshop';
  if (/outside of time|no date|bare room|windows/.test(text)) return 'void_room';
  if (/embassy|conference|map|tent|war/.test(text)) return 'war_room';
  return 'palace';
}

export default function Backdrop({ scenario, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !scenario) return;

    const scene = pickScene(scenario);
    const p = PALETTES[scene];
    const seed = hash(scenario.id ?? 'x');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const px = (x, y, w, h, c) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };

    const HORIZON = 44;

    // ---- wall, with a 2px dither band so the gradient reads as era-appropriate ----
    px(0, 0, W, HORIZON, p.wall);
    for (let y = 0; y < HORIZON; y += 2) {
      if ((y / 2) % 3 === 0) px(0, y, W, 1, p.wallLo);
    }

    // ---- floor, receding in bands ----
    px(0, HORIZON, W, H - HORIZON, p.floor);
    for (let y = HORIZON; y < H; y += 3) {
      px(0, y, W, 1, p.floorLo);
    }
    px(0, HORIZON, W, 1, p.trim); // the line the sprites stand on

    // ---- scene furniture ----
    if (scene === 'mars') {
      // Starfield above a low horizon, and a small distant sun.
      for (let i = 0; i < 40; i++) {
        const x = (hash(`${seed}s${i}`) % W);
        const y = (hash(`${seed}y${i}`) % (HORIZON - 8));
        px(x, y, 1, 1, i % 5 === 0 ? '#ffffff' : '#ffffff88');
      }
      px(96, 10, 6, 6, '#e6935a');
      px(97, 9, 4, 8, '#e6935a');
      // Rock silhouettes on the horizon.
      for (let i = 0; i < 5; i++) {
        const x = 8 + i * 26 + (hash(`${seed}r${i}`) % 8);
        const w = 10 + (hash(`${seed}w${i}`) % 8);
        px(x, HORIZON - 5, w, 5, p.wallLo);
      }
    } else if (scene === 'stone') {
      // Block masonry and a barred window.
      for (let y = 0; y < HORIZON; y += 6) {
        const off = (y / 6) % 2 === 0 ? 0 : 8;
        for (let x = -8; x < W; x += 16) px(x + off, y, 15, 5, p.wallLo);
      }
      px(52, 6, 24, 18, '#0b0a14');
      px(54, 8, 20, 14, '#2b3550');
      for (let x = 57; x < 74; x += 5) px(x, 8, 2, 14, '#0b0a14');
    } else if (scene === 'throne') {
      // Hanging banners and a seat of state.
      px(20, 0, 12, 30, p.trim);
      px(96, 0, 12, 30, p.trim);
      px(22, 26, 8, 6, p.glow);
      px(98, 26, 8, 6, p.glow);
      px(56, 20, 16, 24, p.wallLo);
      px(58, 22, 12, 10, p.trim);
    } else if (scene === 'workshop') {
      // A shelf of implements and a hanging lamp.
      px(12, 14, 44, 2, p.trim);
      for (let i = 0; i < 6; i++) px(15 + i * 7, 8, 4, 6, i % 2 ? p.glow : p.wallLo);
      px(88, 0, 2, 12, p.trim);
      px(84, 12, 10, 6, p.glow);
    } else if (scene === 'void_room') {
      // Nothing on the walls. That is the point of the room.
      px(0, HORIZON - 1, W, 1, p.trim);
      for (let i = 0; i < 16; i++) {
        const x = hash(`${seed}v${i}`) % W;
        const y = hash(`${seed}u${i}`) % HORIZON;
        px(x, y, 1, 1, '#ffffff18');
      }
    } else {
      // war_room / palace: tall windows and a long table edge.
      for (let i = 0; i < 3; i++) {
        const x = 14 + i * 40;
        px(x, 6, 18, 26, '#0b0a14');
        px(x + 2, 8, 14, 22, i === 1 ? p.glow : p.wallLo);
        px(x + 8, 8, 2, 22, '#0b0a14');
      }
      px(0, HORIZON + 12, W, 4, p.floorLo);
    }

    // ---- vignette, dithered rather than blurred ----
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        const d = Math.max(Math.abs(x - W / 2) / (W / 2), Math.abs(y - H / 2) / (H / 2));
        if (d > 0.78 && (x + y) % 2 === 0) px(x, y, 1, 1, 'rgba(11,10,20,0.35)');
      }
    }
  }, [scenario]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={className}
      style={{
        width: '100%',
        height: '100%',
        imageRendering: 'pixelated',
        display: 'block',
        position: 'absolute',
        inset: 0,
      }}
    />
  );
}
