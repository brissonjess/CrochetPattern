/**
 * templates.js -- Garment shape templates and mask generators
 *
 * A "mask" is a Uint8Array the same size as the panel grid:
 *   1 = inside the garment (paintable)
 *   0 = outside the garment (blocked, shown as grey hatching)
 *
 * Mask generators are pure functions: (width, height) -> Uint8Array
 */

CrochetApp.Templates = {};

// ---- Mask generators --------------------------------------------------------

const _maskFns = {

  blank(w, h) {
    return new Uint8Array(w * h).fill(1);
  },

  'vest-front'(w, h) {
    const mask         = new Uint8Array(w * h).fill(1);
    const armholeRows  = Math.floor(h * 0.38);
    const armholeCols  = Math.floor(w * 0.20);
    const neckRows     = Math.floor(h * 0.16);
    const neckW        = Math.floor(w * 0.34);
    const neckL        = Math.floor((w - neckW) / 2);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (row < armholeRows && (col < armholeCols || col >= w - armholeCols)) mask[i] = 0;
        if (row < neckRows    &&  col >= neckL      && col < neckL + neckW)      mask[i] = 0;
      }
    }
    return mask;
  },

  'vest-back'(w, h) {
    const mask        = new Uint8Array(w * h).fill(1);
    const armholeRows = Math.floor(h * 0.38);
    const armholeCols = Math.floor(w * 0.20);
    const neckRows    = Math.floor(h * 0.05);
    const neckW       = Math.floor(w * 0.26);
    const neckL       = Math.floor((w - neckW) / 2);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (row < armholeRows && (col < armholeCols || col >= w - armholeCols)) mask[i] = 0;
        if (row < neckRows    &&  col >= neckL      && col < neckL + neckW)      mask[i] = 0;
      }
    }
    return mask;
  },

  'sweater-front'(w, h) {
    const mask     = new Uint8Array(w * h).fill(1);
    const neckRows = Math.floor(h * 0.16);
    const neckW    = Math.floor(w * 0.34);
    const neckL    = Math.floor((w - neckW) / 2);
    for (let row = 0; row < neckRows; row++)
      for (let col = neckL; col < neckL + neckW; col++)
        mask[row * w + col] = 0;
    return mask;
  },

  'sweater-back'(w, h) {
    const mask     = new Uint8Array(w * h).fill(1);
    const neckRows = Math.floor(h * 0.05);
    const neckW    = Math.floor(w * 0.26);
    const neckL    = Math.floor((w - neckW) / 2);
    for (let row = 0; row < neckRows; row++)
      for (let col = neckL; col < neckL + neckW; col++)
        mask[row * w + col] = 0;
    return mask;
  },

  sleeve(w, h) {
    // Trapezoid: narrow at top (armhole cap), wide at bottom (cuff)
    const mask      = new Uint8Array(w * h).fill(0);
    const topInset  = Math.floor(w * 0.22);
    for (let row = 0; row < h; row++) {
      const t     = row / Math.max(h - 1, 1); // 0=top, 1=bottom
      const inset = Math.round(topInset * (1 - t));
      for (let col = inset; col < w - inset; col++)
        mask[row * w + col] = 1;
    }
    return mask;
  },

  dress(w, h) {
    const mask          = new Uint8Array(w * h).fill(1);
    const bodiceRows    = Math.floor(h * 0.45);
    const shoulderInset = Math.floor(w * 0.12);
    const neckRows      = Math.floor(h * 0.12);
    const neckW         = Math.floor(w * 0.30);
    const neckL         = Math.floor((w - neckW) / 2);
    for (let row = 0; row < h; row++) {
      // Shoulder taper in bodice
      if (row < bodiceRows) {
        const t     = row / Math.max(bodiceRows - 1, 1); // 0=shoulder, 1=waist
        const inset = Math.round(shoulderInset * (1 - t));
        for (let col = 0; col < inset; col++) {
          mask[row * w + col]           = 0;
          mask[row * w + (w - 1 - col)] = 0;
        }
      }
      // Neck cutout
      if (row < neckRows)
        for (let col = neckL; col < neckL + neckW; col++)
          mask[row * w + col] = 0;
    }
    return mask;
  },

  'cardigan-front'(w, h) {
    // Half-width panel with button band — no neck cutout needed (open front)
    return new Uint8Array(w * h).fill(1);
  },

  beanie(w, h)     { return new Uint8Array(w * h).fill(1); },
  'tote-panel'(w, h) { return new Uint8Array(w * h).fill(1); },
  scarf(w, h)      { return new Uint8Array(w * h).fill(1); },
};

// ---- Garment catalogue ------------------------------------------------------

/**
 * Each garment entry has:
 *   id, name, desc
 *   panels: [{ name, shapeId, defaultWidth, defaultHeight }]
 */
CrochetApp.Templates.GARMENTS = [
  {
    id:   'blank',
    name: 'Blank Canvas',
    desc: 'No template — start from scratch',
    panels: [
      { name: 'Main', shapeId: 'blank', defaultWidth: 50, defaultHeight: 50 },
    ],
  },
  {
    id:   'vest',
    name: 'Vest',
    desc: 'Front and back panels with armhole shaping',
    panels: [
      { name: 'Front', shapeId: 'vest-front', defaultWidth: 60, defaultHeight: 75 },
      { name: 'Back',  shapeId: 'vest-back',  defaultWidth: 60, defaultHeight: 75 },
    ],
  },
  {
    id:   'sweater',
    name: 'Sweater',
    desc: 'Front, back, and two sleeves',
    panels: [
      { name: 'Front',    shapeId: 'sweater-front', defaultWidth: 60, defaultHeight: 75 },
      { name: 'Back',     shapeId: 'sweater-back',  defaultWidth: 60, defaultHeight: 75 },
      { name: 'Sleeve L', shapeId: 'sleeve',        defaultWidth: 38, defaultHeight: 58 },
      { name: 'Sleeve R', shapeId: 'sleeve',        defaultWidth: 38, defaultHeight: 58 },
    ],
  },
  {
    id:   'cardigan',
    name: 'Cardigan',
    desc: 'Left front, right front, back, and two sleeves',
    panels: [
      { name: 'Left Front',  shapeId: 'cardigan-front', defaultWidth: 32, defaultHeight: 75 },
      { name: 'Right Front', shapeId: 'cardigan-front', defaultWidth: 32, defaultHeight: 75 },
      { name: 'Back',        shapeId: 'sweater-back',   defaultWidth: 60, defaultHeight: 75 },
      { name: 'Sleeve L',    shapeId: 'sleeve',         defaultWidth: 38, defaultHeight: 58 },
      { name: 'Sleeve R',    shapeId: 'sleeve',         defaultWidth: 38, defaultHeight: 58 },
    ],
  },
  {
    id:   'dress',
    name: 'Dress',
    desc: 'Front and back with bodice taper and A-line skirt',
    panels: [
      { name: 'Front', shapeId: 'dress', defaultWidth: 65, defaultHeight: 120 },
      { name: 'Back',  shapeId: 'dress', defaultWidth: 65, defaultHeight: 120 },
    ],
  },
  {
    id:   'beanie',
    name: 'Beanie',
    desc: 'Single rectangle panel (seamed into a tube)',
    panels: [
      { name: 'Body', shapeId: 'beanie', defaultWidth: 60, defaultHeight: 30 },
    ],
  },
  {
    id:   'tote',
    name: 'Tote Bag',
    desc: 'Front and back panels',
    panels: [
      { name: 'Front', shapeId: 'tote-panel', defaultWidth: 50, defaultHeight: 60 },
      { name: 'Back',  shapeId: 'tote-panel', defaultWidth: 50, defaultHeight: 60 },
    ],
  },
  {
    id:   'scarf',
    name: 'Scarf',
    desc: 'Single long panel',
    panels: [
      { name: 'Main', shapeId: 'scarf', defaultWidth: 25, defaultHeight: 150 },
    ],
  },
];

// ---- Public API -------------------------------------------------------------

/**
 * Generate a mask Uint8Array for the given shape at the given grid size.
 * Falls back to a blank (all-1) mask for unknown shape IDs.
 */
CrochetApp.Templates.generateMask = function(shapeId, width, height) {
  const fn = _maskFns[shapeId] || _maskFns['blank'];
  return fn(width, height);
};

/** Return the garment definition for the given id, or null. */
CrochetApp.Templates.findGarment = function(id) {
  return CrochetApp.Templates.GARMENTS.find(g => g.id === id) || null;
};

/**
 * Build a panel-definitions array from a garment id, ready for createProject().
 * Uses each panel's defaultWidth/defaultHeight from the template.
 */
CrochetApp.Templates.buildPanels = function(garmentId) {
  const garment = CrochetApp.Templates.findGarment(garmentId);
  if (!garment) return null;
  return garment.panels.map(pd => ({
    name:    pd.name,
    shapeId: pd.shapeId,
    width:   pd.defaultWidth,
    height:  pd.defaultHeight,
    mask:    CrochetApp.Templates.generateMask(pd.shapeId, pd.defaultWidth, pd.defaultHeight),
  }));
};