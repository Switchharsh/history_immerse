import { useEffect, useRef, useState } from 'react';

/**
 * Turns a real Wikimedia Commons photograph into a sprite.
 *
 * `image-rendering: pixelated` alone does nothing to a 600px JPEG — the browser still has
 * every pixel and draws them all. To actually pixelate, the image has to be *resampled
 * down* to sprite resolution and then blown back up. We do that in a canvas: draw at
 * ~44px, quantise the colour, then scale up with smoothing off.
 *
 * The quantisation step matters as much as the downsample. Photographs carry hundreds of
 * near-identical browns; flattening them to a coarse ramp is what makes the result read
 * as pixel art rather than as a small blurry photo.
 */

/** Snap each channel to `steps` levels, and lift saturation so the palette reads. */
function quantise(data, steps = 6) {
  const q = 255 / (steps - 1);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];

    // Mild saturation boost — archival photographs are muddy and go grey when quantised.
    const grey = (r + g + b) / 3;
    r = grey + (r - grey) * 1.45;
    g = grey + (g - grey) * 1.45;
    b = grey + (b - grey) * 1.45;

    data[i] = Math.min(255, Math.max(0, Math.round(r / q) * q));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(g / q) * q));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(b / q) * q));
  }
}

const SIZES = {
  xs: { box: 40, res: 24 },
  sm: { box: 56, res: 28 },
  md: { box: 88, res: 40 },
  lg: { box: 128, res: 48 },
  xl: { box: 168, res: 56 },
};

export default function PixelPortrait({
  src,
  name,
  size = 'md',
  active = false,
  dim = false,
  className = '',
}) {
  const canvasRef = useRef(null);
  const [state, setState] = useState('loading'); // loading | ready | failed
  const { box, res } = SIZES[size] ?? SIZES.md;

  useEffect(() => {
    if (!src) {
      setState('failed');
      return;
    }
    let cancelled = false;
    setState('loading');

    const img = new Image();
    // Commons serves permissive CORS headers, which we need to read pixels back out.
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        // Step 1 — resample down to sprite resolution, cropping to a square from the top
        // (portraits put the face near the top; a centre crop decapitates half of them).
        const small = document.createElement('canvas');
        small.width = res;
        small.height = res;
        const sctx = small.getContext('2d', { willReadFrequently: true });

        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = Math.min((img.height - side) / 2, img.height * 0.08);
        sctx.drawImage(img, sx, sy, side, side, 0, 0, res, res);

        // Step 2 — flatten the colour.
        const pixels = sctx.getImageData(0, 0, res, res);
        quantise(pixels.data);
        sctx.putImageData(pixels, 0, 0);

        // Step 3 — blow it back up with smoothing off, so each source pixel is a block.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = box * dpr;
        canvas.height = box * dpr;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(small, 0, 0, res, res, 0, 0, canvas.width, canvas.height);

        setState('ready');
      } catch {
        // A tainted canvas (CORS refused by a mirror) throws on getImageData.
        setState('failed');
      }
    };

    img.onerror = () => !cancelled && setState('failed');
    img.src = src;

    return () => {
      cancelled = true;
    };
  }, [src, box, res]);

  const initials = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

  return (
    <div
      className={`relative shrink-0 bg-slate ${active ? 'frame-active' : 'frame-sm'} ${
        dim ? 'opacity-40 saturate-50' : ''
      } ${className}`}
      style={{ width: box, height: box }}
      title={name}
    >
      {state === 'ready' ? (
        <canvas ref={canvasRef} style={{ width: box, height: box, display: 'block' }} />
      ) : (
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      )}

      {state !== 'ready' ? (
        <span
          className="absolute inset-0 flex items-center justify-center font-pixel text-gold-deep"
          style={{ fontSize: Math.max(8, box / 5) }}
        >
          {state === 'loading' ? '…' : initials}
        </span>
      ) : null}
    </div>
  );
}
