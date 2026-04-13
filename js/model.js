/**
 * model.js -- Project data structure and grid operations
 *
 * Schema (v2 -- multi-panel):
 *   project.panels[]         array of panel objects (replaces project.grid)
 *   project.activePanelId    id of the panel currently being edited
 *   panel.grid.mask          Uint8Array | null  (1=inside garment, 0=outside)
 *
 * Backwards compat: old projects that have project.grid are migrated to a
 * single-panel structure by deserializeProject().
 */

const CrochetApp = window.CrochetApp || {};

CrochetApp.EMPTY_CELL = 255;

CrochetApp.TECHNIQUES = {
  tapestry_sc: { label: 'Tapestry SC',  aspectW: 4, aspectH: 5 },
  graphghan:   { label: 'Graphghan',    aspectW: 4, aspectH: 5 },
  c2c:         { label: 'C2C',          aspectW: 1, aspectH: 1 },
  mosaic:      { label: 'Mosaic',       aspectW: 4, aspectH: 5 },
};

CrochetApp.DEFAULT_SYMBOLS = ['○','●','□','■','△','▲','◇','◆','★','☆',
                               '✕','✚','⬡','⬢','♥','♦','♣','♠','✿','❋'];

// ---- Panel helpers ----------------------------------------------------------

/** Create a single panel object from a definition. */
CrochetApp._createPanel = function({ name, shapeId, width, height, mask }) {
  const w = width  || 50;
  const h = height || 50;
  return {
    id:      crypto.randomUUID(),
    name:    name    || 'Panel',
    shapeId: shapeId || 'blank',
    grid: {
      width:  w,
      height: h,
      cells:  new Uint8Array(w * h).fill(CrochetApp.EMPTY_CELL),
      mask:   mask instanceof Uint8Array ? mask : null,
    },
  };
};

/** Return the active panel, falling back to the first panel. */
CrochetApp.getActivePanel = function(project) {
  return project.panels.find(p => p.id === project.activePanelId)
      || project.panels[0];
};

// ---- Project creation -------------------------------------------------------

/**
 * Create a new project.
 *
 * @param opts.name       {string}
 * @param opts.technique  {string}
 * @param opts.panelDefs  {Array}  — panel definitions from CrochetApp.Templates.buildPanels()
 *                                    Each: { name, shapeId, width, height, mask }
 *                                    If omitted a single blank 50x50 panel is created.
 * @param opts.garmentId  {string} — stored for reference, default 'blank'
 * @param opts.width      {number} — legacy: used when panelDefs is omitted
 * @param opts.height     {number} — legacy
 */
CrochetApp.createProject = function({ name, technique, panelDefs, garmentId, width, height }) {
  const panels = (panelDefs && panelDefs.length)
    ? panelDefs.map(pd => CrochetApp._createPanel(pd))
    : [CrochetApp._createPanel({ name: 'Main', shapeId: 'blank', width: width || 50, height: height || 50 })];

  const firstId = panels[0].id;

  return {
    id:            crypto.randomUUID(),
    name:          name      || 'Untitled',
    technique:     technique || 'tapestry_sc',
    garmentId:     garmentId || 'blank',
    palette: [
      { hex: '#FFFFFF', label: 'Color A', symbol: CrochetApp.DEFAULT_SYMBOLS[0] },
      { hex: '#000000', label: 'Color B', symbol: CrochetApp.DEFAULT_SYMBOLS[1] },
    ],
    gauge:         { stitchesPerInch: 4, rowsPerInch: 5 },
    panels,
    activePanelId: firstId,
    notes:         '',
    createdAt:     new Date().toISOString(),
    updatedAt:     new Date().toISOString(),
  };
};

// ---- Grid cell accessors ----------------------------------------------------
// These accept either a project or a panel (anything with .grid).

/** Read a cell value; returns EMPTY_CELL if out of bounds. */
CrochetApp.getCell = function(gridOwner, col, row) {
  const { width, height, cells } = gridOwner.grid;
  if (col < 0 || col >= width || row < 0 || row >= height) return CrochetApp.EMPTY_CELL;
  return cells[row * width + col];
};

/** Write a cell value. No-op if out of bounds. */
CrochetApp.setCell = function(gridOwner, col, row, colorIndex) {
  const { width, height, cells } = gridOwner.grid;
  if (col < 0 || col >= width || row < 0 || row >= height) return;
  cells[row * width + col] = colorIndex;
};

// ---- Color statistics -------------------------------------------------------

/**
 * Count cells per palette index.
 * @param gridOwner  anything with .grid.cells
 * @param paletteLength  number of palette slots
 * @returns number[]
 */
CrochetApp.countColors = function(gridOwner, paletteLength) {
  const len    = paletteLength || 255;
  const counts = new Array(len).fill(0);
  const cells  = gridOwner.grid.cells;
  for (let i = 0; i < cells.length; i++) {
    const idx = cells[i];
    if (idx !== CrochetApp.EMPTY_CELL && idx < len) counts[idx]++;
  }
  return counts;
};

/** Count total painted (non-empty) cells in one panel or project.grid. */
CrochetApp.totalPainted = function(gridOwner) {
  let n = 0;
  const cells = gridOwner.grid.cells;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== CrochetApp.EMPTY_CELL) n++;
  }
  return n;
};

// ---- Serialization ----------------------------------------------------------

CrochetApp.serializeProject = function(project) {
  return {
    ...project,
    panels: project.panels.map(panel => ({
      ...panel,
      grid: {
        ...panel.grid,
        cells: Array.from(panel.grid.cells),
        mask:  panel.grid.mask ? Array.from(panel.grid.mask) : null,
      },
    })),
  };
};

CrochetApp.deserializeProject = function(raw) {
  // ---- Migrate v1 projects (project.grid) to v2 (project.panels) ----------
  if (raw.grid && !raw.panels) {
    const panelId = (raw.id || 'p') + '-panel';
    raw = {
      ...raw,
      garmentId:     'blank',
      panels: [{
        id:      panelId,
        name:    'Main',
        shapeId: 'blank',
        grid:    raw.grid,   // deserialized below
      }],
      activePanelId: panelId,
    };
    delete raw.grid;
  }

  return {
    ...raw,
    panels: raw.panels.map(panel => ({
      ...panel,
      grid: {
        ...panel.grid,
        cells: new Uint8Array(panel.grid.cells),
        mask:  panel.grid.mask ? new Uint8Array(panel.grid.mask) : null,
      },
    })),
  };
};

window.CrochetApp = CrochetApp;
