import { useEffect, useRef, useState } from 'react';
import { loadFaceSprite } from '../lib/pixelate.js';
import { drawSprite, spriteFor, SPRITE_W, SPRITE_H } from '../lib/spriteKit.js';

/**
 * A standing character sprite: real portrait head, drawn body, two-frame idle bob.
 *
 * The bob runs on an interval rather than CSS so the whole sprite redraws in step —
 * a CSS transform on the canvas would slide the ground shadow up with the character.
 */
export default function CharacterSprite({ card, scale = 4, speaking = false, dim = false }) {
  const canvasRef = useRef(null);
  const [face, setFace] = useState(null);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!card?.portrait) {
      setFace(null);
      return;
    }
    loadFaceSprite(card.portrait, 14)
      .then((c) => !cancelled && setFace(c))
      .catch(() => !cancelled && setFace(null));
    return () => {
      cancelled = true;
    };
  }, [card?.portrait]);

  // Speaking characters breathe faster — the only motion cue that reads at this size.
  useEffect(() => {
    const period = speaking ? 380 : 900;
    const t = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), period);
    return () => clearInterval(t);
  }, [speaking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !card) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SPRITE_W * scale * dpr;
    canvas.height = SPRITE_H * scale * dpr;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);

    drawSprite(ctx, { sprite: spriteFor(card), face, frame, speaking });
  }, [card, face, frame, scale, speaking]);

  if (!card) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-label={card.name}
      title={card.name}
      className={dim ? 'opacity-45 saturate-50' : ''}
      style={{
        width: SPRITE_W * scale,
        height: SPRITE_H * scale,
        imageRendering: 'pixelated',
        display: 'block',
      }}
    />
  );
}
