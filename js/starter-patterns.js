/**
 * starter-patterns.js — Pre-built colorwork patterns for new projects
 *
 * Each pattern is a pure function (width, height) -> { cells: Uint8Array, palette }
 * that fills a grid at any resolution. Patterns tile / scale to fit any canvas size.
 *
 * Public API:
 *   CrochetApp.StarterPatterns.ALL          — array of pattern definitions
 *   CrochetApp.StarterPatterns.generate(id, width, height) -> { cells, palette } | null
 *   CrochetApp.StarterPatterns.thumbnail(id, canvas)      — draws 80×80 preview
 */

const CrochetApp = window.CrochetApp || {};
CrochetApp.StarterPatterns = {};

// ─── Palette helpers ──────────────────────────────────────────────────────────

function _pal(colors) {
  const syms = ['○','●','□','■','△','▲','◇','◆'];
  return colors.map((hex, i) => ({ hex, label: 'Color ' + String.fromCharCode(65 + i), symbol: syms[i] || '○' }));
}

// ─── Pattern generators ───────────────────────────────────────────────────────

const _generators = {};

// ── Horizontal stripes ────────────────────────────────────────────────────────
_generators['stripes-h'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#2d3a8c']);
  const cells = new Uint8Array(w * h);
  const stripeH = Math.max(2, Math.round(h / 10));
  for (let row = 0; row < h; row++) {
    const ci = Math.floor(row / stripeH) % 2;
    for (let col = 0; col < w; col++) cells[row * w + col] = ci;
  }
  return { cells, palette };
};

// ── Vertical stripes ──────────────────────────────────────────────────────────
_generators['stripes-v'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#7c3aed']);
  const cells = new Uint8Array(w * h);
  const stripeW = Math.max(2, Math.round(w / 10));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      cells[row * w + col] = Math.floor(col / stripeW) % 2;
    }
  }
  return { cells, palette };
};

// ── Checkerboard ──────────────────────────────────────────────────────────────
_generators['checkerboard'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#1a1a2e']);
  const cells = new Uint8Array(w * h);
  const sz = Math.max(2, Math.round(Math.min(w, h) / 12));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      cells[row * w + col] = (Math.floor(row / sz) + Math.floor(col / sz)) % 2;
    }
  }
  return { cells, palette };
};

// ── Diagonal stripes ──────────────────────────────────────────────────────────
_generators['diagonal'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#be185d', '#f9a8d4']);
  const cells = new Uint8Array(w * h);
  const period = Math.max(4, Math.round(Math.min(w, h) / 8));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const v = ((col + row) % period);
      cells[row * w + col] = v < Math.floor(period / 3) ? 2
                           : v < Math.floor(2 * period / 3) ? 1
                           : 0;
    }
  }
  return { cells, palette };
};

// ── Diamond / argyle ──────────────────────────────────────────────────────────
_generators['diamond'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#7c3aed', '#c4b5fd']);
  const cells = new Uint8Array(w * h);
  const rx = Math.max(4, Math.round(w / 6));
  const ry = Math.max(4, Math.round(h / 6));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const cx = ((col + rx / 2) % (rx * 2) + rx * 2) % (rx * 2) - rx;
      const cy = ((row + ry / 2) % (ry * 2) + ry * 2) % (ry * 2) - ry;
      const dist = Math.abs(cx) / rx + Math.abs(cy) / ry;
      cells[row * w + col] = dist < 0.35 ? 1 : dist < 0.65 ? 2 : 0;
    }
  }
  return { cells, palette };
};

// ── Chevron ───────────────────────────────────────────────────────────────────
_generators['chevron'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#0f766e', '#99f6e4']);
  const cells = new Uint8Array(w * h);
  const period = Math.max(4, Math.round(h / 8));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const offset = Math.abs(col - Math.floor(w / 2));
      const v = ((row + offset) % (period * 2) + period * 2) % (period * 2);
      cells[row * w + col] = v < Math.floor(period * 0.4) ? 2
                           : v < period                    ? 1
                           : v < Math.floor(period * 1.4) ? 2
                           : 0;
    }
  }
  return { cells, palette };
};

// ── Fair isle border ──────────────────────────────────────────────────────────
_generators['fair-isle'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#1e3a5f', '#c8a951']);
  const cells = new Uint8Array(w * h).fill(0);
  // X motif tiled on a band of rows
  const bandH  = Math.max(5, Math.round(h * 0.18));
  const startY = Math.round(h * 0.20);
  const startY2 = Math.round(h * 0.62);
  const tile   = Math.max(6, Math.round(w / 8));

  function drawBand(sy) {
    for (let row = sy; row < Math.min(sy + bandH, h); row++) {
      const yr = row - sy;
      for (let col = 0; col < w; col++) {
        const xr = col % tile;
        const mid = Math.floor(tile / 2);
        // Background band
        cells[row * w + col] = 1;
        // Gold X motif
        if (xr === Math.floor(yr * mid / (bandH - 1)) ||
            xr === tile - 1 - Math.floor(yr * mid / (bandH - 1)) ||
            xr === mid) {
          cells[row * w + col] = 2;
        }
      }
    }
    // Accent stripe above and below band
    if (sy > 0) {
      for (let col = 0; col < w; col++) cells[(sy - 1) * w + col] = 2;
    }
    if (sy + bandH < h) {
      for (let col = 0; col < w; col++) cells[(sy + bandH) * w + col] = 2;
    }
  }

  drawBand(startY);
  drawBand(startY2);
  return { cells, palette };
};

// ── Nordic snowflake (beanie / hat) ───────────────────────────────────────────
_generators['nordic'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#c0392b']);
  const cells = new Uint8Array(w * h).fill(0);
  // Tile size (snowflake repeat)
  const tile = Math.max(8, Math.round(w / 6));
  const tileH = Math.max(8, Math.round(tile * 1.2));

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const xr = col % tile;
      const yr = row % tileH;
      const mx = Math.floor(tile / 2);
      const my = Math.floor(tileH / 2);
      const dx = xr - mx;
      const dy = yr - my;
      // Snowflake: cross + diagonals + dot
      const isCross = (dx === 0 || dy === 0) && Math.abs(dx) <= 3 && Math.abs(dy) <= 3;
      const isDiag  = Math.abs(dx) === Math.abs(dy) && Math.abs(dx) <= 2;
      const isDot   = (Math.abs(dx) === 1 && dy === 0) || (Math.abs(dy) === 1 && dx === 0);
      cells[row * w + col] = (isCross || isDiag || isDot) ? 1 : 0;
    }
  }
  // Bottom ribbing band (alternating columns)
  const ribStart = Math.round(h * 0.8);
  for (let row = ribStart; row < h; row++) {
    for (let col = 0; col < w; col++) {
      cells[row * w + col] = col % 2;
    }
  }
  return { cells, palette };
};

// ── Mosaic / stepped ──────────────────────────────────────────────────────────
_generators['mosaic'] = function(w, h) {
  const palette = _pal(['#FFFFFF', '#92400e', '#fbbf24']);
  const cells = new Uint8Array(w * h);
  const sz = Math.max(3, Math.round(Math.min(w, h) / 14));
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const gx = Math.floor(col / sz);
      const gy = Math.floor(row / sz);
      const v = (gx + gy) % 4;
      cells[row * w + col] = v === 0 ? 0 : v === 2 ? 2 : 1;
    }
  }
  return { cells, palette };
};

// ── Color blocks ──────────────────────────────────────────────────────────────
_generators['colorblock'] = function(w, h) {
  const palette = _pal(['#f0f0f0', '#e63946', '#457b9d', '#1d3557']);
  const cells = new Uint8Array(w * h);
  const qh = Math.floor(h / 4);
  for (let row = 0; row < h; row++) {
    const ci = Math.min(3, Math.floor(row / qh));
    for (let col = 0; col < w; col++) cells[row * w + col] = ci;
  }
  return { cells, palette };
};

// ── Gradient fade (top to bottom) ─────────────────────────────────────────────
_generators['gradient'] = function(w, h) {
  const palette = _pal(['#fef9c3', '#fde047', '#f97316', '#7c3aed']);
  const cells = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const ci = Math.min(3, Math.floor(row / h * 4));
    for (let col = 0; col < w; col++) cells[row * w + col] = ci;
  }
  return { cells, palette };
};

// ─── Pattern catalogue ────────────────────────────────────────────────────────

CrochetApp.StarterPatterns.ALL = [
  {
    id:    'none',
    name:  'Blank',
    desc:  'Start with an empty canvas',
    tags:  ['all'],
  },
  {
    id:    'stripes-h',
    name:  'Horizontal Stripes',
    desc:  'Classic two-colour horizontal bands',
    tags:  ['all'],
  },
  {
    id:    'stripes-v',
    name:  'Vertical Stripes',
    desc:  'Two-colour vertical columns',
    tags:  ['all'],
  },
  {
    id:    'checkerboard',
    name:  'Checkerboard',
    desc:  'Two-colour checkerboard blocks',
    tags:  ['all'],
  },
  {
    id:    'diagonal',
    name:  'Diagonal Stripes',
    desc:  'Three-colour diagonal bands',
    tags:  ['all'],
  },
  {
    id:    'chevron',
    name:  'Chevron',
    desc:  'Three-colour chevron / zigzag',
    tags:  ['all'],
  },
  {
    id:    'diamond',
    name:  'Diamond / Argyle',
    desc:  'Tiled diamond motifs',
    tags:  ['all'],
  },
  {
    id:    'fair-isle',
    name:  'Fair Isle Border',
    desc:  'Two decorative bands with an X motif',
    tags:  ['vest', 'sweater', 'cardigan', 'dress'],
  },
  {
    id:    'nordic',
    name:  'Nordic Snowflake',
    desc:  'Tiled snowflake repeat with a ribbing band',
    tags:  ['beanie', 'vest', 'sweater'],
  },
  {
    id:    'mosaic',
    name:  'Mosaic Steps',
    desc:  'Three-colour stepped tile pattern',
    tags:  ['all'],
  },
  {
    id:    'colorblock',
    name:  'Color Blocks',
    desc:  'Bold horizontal colour sections',
    tags:  ['all'],
  },
  {
    id:    'gradient',
    name:  'Gradient Fade',
    desc:  'Four-colour gradient from top to bottom',
    tags:  ['all'],
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate cells + palette for a pattern at the given size.
 * Returns null for id === 'none' or unknown ids.
 */
CrochetApp.StarterPatterns.generate = function(id, width, height) {
  const fn = _generators[id];
  if (!fn) return null;
  return fn(width, height);
};

/**
 * Draw a small preview of the pattern onto the given canvas element.
 */
CrochetApp.StarterPatterns.thumbnail = function(id, canvas, width, height) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (id === 'none') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
    ctx.fillStyle = '#bbb';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Blank', canvas.width / 2, canvas.height / 2);
    return;
  }
  const fn = _generators[id];
  if (!fn) return;
  // Render at a low resolution for the thumbnail
  const tw = width  || 30;
  const th = height || 30;
  const result = fn(tw, th);
  const cw = canvas.width  / tw;
  const ch = canvas.height / th;
  for (let row = 0; row < th; row++) {
    for (let col = 0; col < tw; col++) {
      const ci = result.cells[row * tw + col];
      ctx.fillStyle = result.palette[ci]?.hex ?? '#fff';
      ctx.fillRect(col * cw, row * ch, cw, ch);
    }
  }
};

window.CrochetApp = CrochetApp;
