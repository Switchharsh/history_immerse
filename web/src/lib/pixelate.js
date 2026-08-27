/**
 * Resample a photograph down to sprite resolution and flatten its palette.
 *
 * `image-rendering: pixelated` on a 600px JPEG does nothing — the browser still has every
 * pixel and draws them all. Real pixelation means resampling *down* and scaling back up
 * with smoothing off. The colour quantisation matters as much as the downsample:
 * photographs carry hundreds of near-identical browns, and flattening them to a coarse
 * ramp is what makes the result read as pixel art rather than a small blurry photo.
 */

/** Snap each channel to `steps` levels, with a saturation lift so the palette reads. */
export function quantise(data, steps = 5, saturation = 1.5) {
  const q = 255 / (steps - 1);
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    const grey = (r + g + b) / 3;
    r = grey + (r - grey) * saturation;
    g = grey + (g - grey) * saturation;
    b = grey + (b - grey) * saturation;
    data[i] = Math.min(255, Math.max(0, Math.round(r / q) * q));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(g / q) * q));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(b / q) * q));
  }
}

const cache = new Map(); // src|res -> Promise<HTMLCanvasElement>

/**
 * Load an image and return a small canvas holding its pixelated face crop.
 * Cached, because the same portrait is drawn in the party bar, the stage and the log.
 */
export function loadFaceSprite(src, res = 16) {
  if (!src) return Promise.reject(new Error('no src'));
  const key = `${src}|${res}`;
  if (cache.has(key)) return cache.get(key);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = res;
        c.height = res;
        const ctx = c.getContext('2d', { willReadFrequently: true });

        // Crop square, biased high — portraits put the face near the top and a centre
        // crop decapitates half of them.
        const side = Math.min(img.width, img.height) * 0.82;
        const sx = (img.width - side) / 2;
        const sy = Math.min((img.height - side) / 2, img.height * 0.06);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, res, res);

        const px = ctx.getImageData(0, 0, res, res);
        quantise(px.data);
        ctx.putImageData(px, 0, 0);
        resolve(c);
      } catch (err) {
        reject(err); // tainted canvas — a mirror refused CORS
      }
    };
    img.onerror = () => reject(new Error('image failed'));
    img.src = src;
  });

  cache.set(key, promise);
  return promise;
}

/** Deterministic hash so a given character always gets the same generated colours. */
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
