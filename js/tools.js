/**
 * tools.js — Grid operation algorithms
 * Pure functions; no DOM access.
 */

CrochetApp.Tools = {};

// ─── Flood Fill ───────────────────────────────────────────────────────────────

/**
 * 4-connected flood fill (iterative DFS).
 * Replaces all cells connected to (startCol, startRow) that share
 * the same color with newColorIndex.
 */
CrochetApp.Tools.floodFill = function(project, startCol, startRow, newColorIndex) {
  const { width, height, cells } = project.grid;
  const startIdx    = startRow * width + startCol;
  const targetColor = cells[startIdx];

  if (targetColor === newColorIndex) return; // nothing to do

  const visited = new Uint8Array(width * height);
  const stack   = [startIdx];
  visited[startIdx] = 1;

  while (stack.length > 0) {
    const idx = stack.pop();
    cells[idx] = newColorIndex;

    const col = idx % width;
    const row = (idx - col) / width;

    // Right
    if (col < width - 1) {
      const n = idx + 1;
      if (!visited[n] && cells[n] === targetColor) { visited[n] = 1; stack.push(n); }
    }
    // Left
    if (col > 0) {
      const n = idx - 1;
      if (!visited[n] && cells[n] === targetColor) { visited[n] = 1; stack.push(n); }
    }
    // Down
    if (row < height - 1) {
      const n = idx + width;
      if (!visited[n] && cells[n] === targetColor) { visited[n] = 1; stack.push(n); }
    }
    // Up
    if (row > 0) {
      const n = idx - width;
      if (!visited[n] && cells[n] === targetColor) { visited[n] = 1; stack.push(n); }
    }
  }
};

// ─── Mask flood fill ──────────────────────────────────────────────────────────

/**
 * Flood-fill the mask layer starting at (startCol, startRow), setting all
 * connected cells that share the same current mask value to newValue (0 or 1).
 */
CrochetApp.Tools.floodFillMask = function(panel, startCol, startRow, newValue) {
  const { width, height } = panel.grid;
  if (!panel.grid.mask) panel.grid.mask = new Uint8Array(width * height).fill(1);
  const mask     = panel.grid.mask;
  const startIdx = startRow * width + startCol;
  const target   = mask[startIdx];
  if (target === newValue) return;

  const visited = new Uint8Array(width * height);
  const stack   = [startIdx];
  visited[startIdx] = 1;

  while (stack.length) {
    const idx = stack.pop();
    mask[idx]  = newValue;
    const col  = idx % width;
    const row  = (idx - col) / width;
    if (col < width  - 1) { const n = idx + 1;     if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); } }
    if (col > 0)           { const n = idx - 1;     if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); } }
    if (row < height - 1)  { const n = idx + width; if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); } }
    if (row > 0)           { const n = idx - width; if (!visited[n] && mask[n] === target) { visited[n] = 1; stack.push(n); } }
  }
};

// ─── Mirror / Flip ────────────────────────────────────────────────────────────

/** Flip the entire grid horizontally (each row reversed left-to-right). */
CrochetApp.Tools.mirrorHorizontal = function(project) {
  const { width, height, cells } = project.grid;
  for (let row = 0; row < height; row++) {
    const base = row * width;
    let l = 0, r = width - 1;
    while (l < r) {
      const tmp            = cells[base + l];
      cells[base + l]      = cells[base + r];
      cells[base + r]      = tmp;
      l++; r--;
    }
  }
};

/** Flip the entire grid vertically (row order reversed top-to-bottom). */
CrochetApp.Tools.mirrorVertical = function(project) {
  const { width, height, cells } = project.grid;
  for (let row = 0; row < Math.floor(height / 2); row++) {
    const mirrorRow = height - 1 - row;
    for (let col = 0; col < width; col++) {
      const a = row       * width + col;
      const b = mirrorRow * width + col;
      const tmp  = cells[a];
      cells[a]   = cells[b];
      cells[b]   = tmp;
    }
  }
};

// ─── Selection helpers ────────────────────────────────────────────────────────

/**
 * Normalize a selection so startCol/startRow are always ≤ endCol/endRow.
 * @param {{ startCol, startRow, endCol, endRow }} sel
 * @returns {{ c1, r1, c2, r2, width, height }}
 */
CrochetApp.Tools.normalizeSelection = function(sel) {
  const c1 = Math.min(sel.startCol, sel.endCol);
  const c2 = Math.max(sel.startCol, sel.endCol);
  const r1 = Math.min(sel.startRow, sel.endRow);
  const r2 = Math.max(sel.startRow, sel.endRow);
  return { c1, r1, c2, r2, width: c2 - c1 + 1, height: r2 - r1 + 1 };
};

/**
 * Copy the selected region into a clipboard object.
 * @returns {{ width, height, cells: Uint8Array }}
 */
CrochetApp.Tools.copySelection = function(project, sel) {
  const { c1, r1, width: w, height: h } = CrochetApp.Tools.normalizeSelection(sel);
  const { width, cells } = project.grid;
  const copied = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      copied[row * w + col] = cells[(r1 + row) * width + (c1 + col)];
    }
  }
  return { width: w, height: h, cells: copied };
};

/**
 * Erase (set to EMPTY_CELL) all cells within the selection.
 */
CrochetApp.Tools.clearSelection = function(project, sel) {
  const { c1, r1, c2, r2 } = CrochetApp.Tools.normalizeSelection(sel);
  const { width } = project.grid;
  for (let row = r1; row <= r2; row++) {
    for (let col = c1; col <= c2; col++) {
      project.grid.cells[row * width + col] = CrochetApp.EMPTY_CELL;
    }
  }
};

/**
 * Crop the grid to the selected region.
 * Returns { cells: Uint8Array, width, height } — caller applies to project.
 */
CrochetApp.Tools.cropToSelection = function(project, sel) {
  const { c1, r1, width: newW, height: newH } = CrochetApp.Tools.normalizeSelection(sel);
  const { width: oldW, cells: oldCells } = project.grid;
  const newCells = new Uint8Array(newW * newH);
  for (let row = 0; row < newH; row++) {
    for (let col = 0; col < newW; col++) {
      newCells[row * newW + col] = oldCells[(r1 + row) * oldW + (c1 + col)];
    }
  }
  return { cells: newCells, width: newW, height: newH };
};

/**
 * Paste clipboard contents with its top-left corner at (destCol, destRow).
 * Empty clipboard cells (EMPTY_CELL) are skipped (transparent paste).
 */
CrochetApp.Tools.pasteClipboard = function(project, clipboard, destCol, destRow) {
  const { width, height } = project.grid;
  for (let row = 0; row < clipboard.height; row++) {
    for (let col = 0; col < clipboard.width; col++) {
      const c   = destCol + col;
      const r   = destRow + row;
      if (c < 0 || c >= width || r < 0 || r >= height) continue;
      const val = clipboard.cells[row * clipboard.width + col];
      if (val !== CrochetApp.EMPTY_CELL) {
        CrochetApp.setCell(project, c, r, val);
      }
    }
  }
};