/**
 * image-import.js — Image-to-grid conversion pipeline
 *
 * Pipeline:
 *   1. loadFile(file)               → HTMLImageElement
 *   2. resizeToGrid(img, w, h)      → ImageData  (grid-resolution pixels)
 *   3. medianCut(imageData, n)      → palette[]  ({ r, g, b })
 *   4a. mapToPalette(imageData, pal)           → Uint8Array  (no dithering)
 *   4b. ditherFloydSteinberg(imageData, pal)   → Uint8Array  (with dithering)
 *   5. renderPreview(canvas, pal, cells, w, h) → void  (draw result to canvas)
 */

CrochetApp.ImageImport = {};

// ─── Step 1 — Load file ───────────────────────────────────────────────────────

/** Load a File/Blob into an HTMLImageElement. Returns a Promise<HTMLImageElement>. */
CrochetApp.ImageImport.loadFile = function(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not load image.')); };
    img.src = url;
  });
};

// ─── Step 2 — Resize ─────────────────────────────────────────────────────────

/**
 * Draw the image scaled to (targetW × targetH) and return the ImageData.
 * Uses browser bilinear/bicubic interpolation automatically.
 */
CrochetApp.ImageImport.resizeToGrid = function(img, targetW, targetH) {
  const canvas  = document.createElement('canvas');
  canvas.width  = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return ctx.getImageData(0, 0, targetW, targetH);
};

// ─── Step 3 — Median cut quantization ────────────────────────────────────────

/**
 * Reduce the image to numColors representative colours using the Median Cut algorithm.
 * @param {ImageData} imageData
 * @param {number}    numColors  2–20
 * @returns {{ r, g, b }[]}
 */
CrochetApp.ImageImport.medianCut = function(imageData, numColors) {
  const { data, width, height } = imageData;
  const total = width * height;

  // Extract {r, g, b} pixels
  const pixels = new Array(total);
  for (let i = 0; i < total; i++) {
    pixels[i] = { r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2] };
  }

  let buckets = [pixels];

  while (buckets.length < numColors) {
    // Find the bucket with the widest color range
    let splitIdx  = 0;
    let maxRange  = -1;
    let splitAxis = 'r';

    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length === 0) continue;

      let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
      for (const p of b) {
        if (p.r < minR) minR = p.r; if (p.r > maxR) maxR = p.r;
        if (p.g < minG) minG = p.g; if (p.g > maxG) maxG = p.g;
        if (p.b < minB) minB = p.b; if (p.b > maxB) maxB = p.b;
      }
      const rR = maxR - minR, gR = maxG - minG, bR = maxB - minB;
      const range = Math.max(rR, gR, bR);

      if (range > maxRange) {
        maxRange  = range;
        splitIdx  = i;
        splitAxis = rR >= gR && rR >= bR ? 'r' : gR >= bR ? 'g' : 'b';
      }
    }

    // Sort bucket along the widest axis and split at median
    const bucket = buckets[splitIdx];
    const ax     = splitAxis;
    bucket.sort((a, b) => a[ax] - b[ax]);
    const mid = Math.ceil(bucket.length / 2);

    buckets.splice(splitIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
    buckets = buckets.filter(b => b.length > 0);

    if (buckets.length >= numColors) break;
  }

  // Representative colour = arithmetic mean of each bucket
  return buckets.slice(0, numColors).map(bucket => {
    const n = bucket.length;
    return {
      r: Math.round(bucket.reduce((s, p) => s + p.r, 0) / n),
      g: Math.round(bucket.reduce((s, p) => s + p.g, 0) / n),
      b: Math.round(bucket.reduce((s, p) => s + p.b, 0) / n),
    };
  });
};

// ─── Shared: nearest-colour lookup ───────────────────────────────────────────

function _nearestIdx(r, g, b, palette) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i].r, dg = g - palette[i].g, db = b - palette[i].b;
    const d  = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ─── Step 4a — Direct mapping (no dithering) ─────────────────────────────────

/**
 * Map each pixel to the nearest palette entry. Returns a Uint8Array of indices.
 */
CrochetApp.ImageImport.mapToPalette = function(imageData, palette) {
  const { data, width, height } = imageData;
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    indices[i] = _nearestIdx(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], palette);
  }
  return indices;
};

// ─── Step 4b — Floyd-Steinberg dithering ─────────────────────────────────────

/**
 * Map pixels to palette using Floyd-Steinberg error diffusion.
 * Produces smoother colour gradients at the cost of some "noise."
 * Returns a Uint8Array of palette indices.
 */
CrochetApp.ImageImport.ditherFloydSteinberg = function(imageData, palette) {
  const { data, width, height } = imageData;

  // Mutable float buffer (R, G, B per pixel)
  const buf = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    buf[i * 3]     = data[i * 4];
    buf[i * 3 + 1] = data[i * 4 + 1];
    buf[i * 3 + 2] = data[i * 4 + 2];
  }

  const indices = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i  = row * width + col;
      const r  = Math.max(0, Math.min(255, buf[i * 3]));
      const g  = Math.max(0, Math.min(255, buf[i * 3 + 1]));
      const b  = Math.max(0, Math.min(255, buf[i * 3 + 2]));
      const idx = _nearestIdx(r, g, b, palette);
      indices[i] = idx;

      const er = r - palette[idx].r;
      const eg = g - palette[idx].g;
      const eb = b - palette[idx].b;

      // Distribute quantisation error to 4 neighbours (Floyd-Steinberg weights)
      const neighbours = [
        { c: col + 1, r: row,     w: 7 / 16 },
        { c: col - 1, r: row + 1, w: 3 / 16 },
        { c: col,     r: row + 1, w: 5 / 16 },
        { c: col + 1, r: row + 1, w: 1 / 16 },
      ];
      for (const n of neighbours) {
        if (n.c >= 0 && n.c < width && n.r >= 0 && n.r < height) {
          const ni = n.r * width + n.c;
          buf[ni * 3]     += er * n.w;
          buf[ni * 3 + 1] += eg * n.w;
          buf[ni * 3 + 2] += eb * n.w;
        }
      }
    }
  }

  return indices;
};

// ─── Step 5 — Render preview ──────────────────────────────────────────────────

/**
 * Draw the quantised result onto a canvas element for preview.
 * The canvas is sized to (width × height) grid cells; CSS scales it up.
 */
CrochetApp.ImageImport.renderPreview = function(canvas, palette, cells, width, height) {
  canvas.width  = width;
  canvas.height = height;
  const ctx     = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);

  for (let i = 0; i < width * height; i++) {
    const hex = palette[cells[i]]?.hex ?? '#ffffff';
    imgData.data[i * 4]     = parseInt(hex.slice(1, 3), 16);
    imgData.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    imgData.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
};

// ─── Full pipeline ────────────────────────────────────────────────────────────

/**
 * Run the complete import pipeline.
 * @param {HTMLImageElement} img
 * @param {{ width, height, numColors, dithering: boolean }} settings
 * @returns {{ palette: {hex,label,symbol}[], cells: Uint8Array }}
 */
CrochetApp.ImageImport.process = function(img, settings) {
  const { width, height, numColors, dithering } = settings;

  const imageData = CrochetApp.ImageImport.resizeToGrid(img, width, height);
  const rawPal    = CrochetApp.ImageImport.medianCut(imageData, numColors);

  const cells = dithering
    ? CrochetApp.ImageImport.ditherFloydSteinberg(imageData, rawPal)
    : CrochetApp.ImageImport.mapToPalette(imageData, rawPal);

  // Convert raw {r,g,b} palette → project palette format
  const palette = rawPal.map((c, i) => ({
    hex:    '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join(''),
    label:  `Color ${String.fromCharCode(65 + i)}`,
    symbol: CrochetApp.DEFAULT_SYMBOLS[i] ?? '?',
  }));

  return { palette, cells };
};
