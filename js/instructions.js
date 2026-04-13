/**
 * instructions.js — Written row instruction generator
 *
 * Reads the grid from bottom to top (row 1 = bottom of finished piece)
 * and produces human-readable row-by-row instructions.
 *
 * Reading direction by technique:
 *   tapestry_sc / graphghan / mosaic : alternating → ← per row (flat work)
 *   c2c                              : row-by-row left to right (simplified)
 *
 * EMPTY_CELL runs are labelled "[no stitch]" and included so the
 * count still totals the full row width.
 */

CrochetApp.Instructions = {};

// ─── Core generator ──────────────────────────────────────────────────────────

/**
 * Generate structured row data for the whole project.
 * Returns an array ordered from display Row 1 (bottom) → last row (top).
 *
 * Each element: { gridRow, displayRowNum, isRTL, runs[] }
 * Each run:     { colorIdx, count }
 */
CrochetApp.Instructions.generateAll = function(project) {
  const { width, height, cells } = project.grid;
  const technique = project.technique;
  const result    = [];

  // Iterate from bottom grid row to top
  for (let gridRow = height - 1; gridRow >= 0; gridRow--) {
    const displayRowNum = height - gridRow; // 1 = bottom row of finished piece

    // Reading direction: alternates for flat tapestry work
    // Row 1 always reads left→right; even rows read right←left
    let isRTL = false;
    if (technique !== 'c2c') {
      isRTL = displayRowNum % 2 === 0;
    }

    // Extract raw cell indices for this row
    const rowCells = [];
    for (let col = 0; col < width; col++) {
      rowCells.push(cells[gridRow * width + col]);
    }
    if (isRTL) rowCells.reverse();

    // Compress into color runs
    const runs = [];
    if (rowCells.length > 0) {
      let curIdx = rowCells[0];
      let count  = 1;
      for (let i = 1; i < rowCells.length; i++) {
        if (rowCells[i] === curIdx) {
          count++;
        } else {
          runs.push({ colorIdx: curIdx, count });
          curIdx = rowCells[i];
          count  = 1;
        }
      }
      runs.push({ colorIdx: curIdx, count });
    }

    result.push({ gridRow, displayRowNum, isRTL, runs });
  }

  return result;
};

/**
 * Format a single row's data as a human-readable string.
 * e.g. "Row 3 (→): 5 Color A, 11 Color B, 5 Color A"
 */
CrochetApp.Instructions.formatRow = function(rowData, palette) {
  const dir   = rowData.isRTL ? '←' : '→';
  const parts = rowData.runs.map(run => {
    if (run.colorIdx === CrochetApp.EMPTY_CELL) return `${run.count} [no stitch]`;
    const label = palette[run.colorIdx]?.label ?? `Color ${run.colorIdx + 1}`;
    return `${run.count} ${label}`;
  });
  return `Row ${rowData.displayRowNum} (${dir}): ${parts.join(', ')}`;
};

/** Format all rows and return as an array of strings. */
CrochetApp.Instructions.formatAll = function(project) {
  const rows = CrochetApp.Instructions.generateAll(project);
  return rows.map(r => CrochetApp.Instructions.formatRow(r, project.palette));
};

// ─── Color-change summary ─────────────────────────────────────────────────────

/**
 * Count how many color-changes occur in each row.
 * Returns an array of { displayRowNum, changes } sorted by displayRowNum.
 */
CrochetApp.Instructions.colorChangesPerRow = function(project) {
  const rows = CrochetApp.Instructions.generateAll(project);
  return rows.map(rowData => ({
    displayRowNum: rowData.displayRowNum,
    changes: Math.max(0, rowData.runs.length - 1),
  }));
};

// ─── Finished dimensions calculator ──────────────────────────────────────────

/**
 * Compute finished fabric dimensions in inches and cm from gauge.
 * @param {{ width, height }} grid
 * @param {{ stitchesPerInch, rowsPerInch }} gauge
 * @returns {{ widthIn, heightIn, widthCm, heightCm }}
 */
CrochetApp.Instructions.calcDimensions = function(grid, gauge) {
  const widthIn  = grid.width  / gauge.stitchesPerInch;
  const heightIn = grid.height / gauge.rowsPerInch;
  return {
    widthIn:  parseFloat(widthIn.toFixed(2)),
    heightIn: parseFloat(heightIn.toFixed(2)),
    widthCm:  parseFloat((widthIn  * 2.54).toFixed(1)),
    heightCm: parseFloat((heightIn * 2.54).toFixed(1)),
  };
};

// ─── Aspect ratio scale factor ────────────────────────────────────────────────

/**
 * Returns the Y-to-X scale ratio for correct-proportion cell rendering.
 * Normal square cells → ratio = 1.0
 * Typical SC gauge (4st/in, 5rows/in) → ratio = 4/5 = 0.8 (cells shorter than wide)
 */
CrochetApp.Instructions.cellAspectRatio = function(gauge) {
  if (!gauge || gauge.stitchesPerInch <= 0 || gauge.rowsPerInch <= 0) return 1;
  return gauge.stitchesPerInch / gauge.rowsPerInch;
};
