/**
 * renderer.js — Canvas drawing engine
 *
 * Coordinate systems:
 *   Grid coords  — integer (col, row) indexing into project.grid.cells
 *   Screen coords — pixel (x, y) on the <canvas> element
 *
 * Transform:
 *   Normal mode:       screenX = col * scale  + offsetX
 *                      screenY = row * scale  + offsetY
 *   Aspect ratio mode: screenX = col * scaleX + offsetX   (scaleX = scale)
 *                      screenY = row * scaleY + offsetY   (scaleY = scale * cellAspectRatio)
 */

CrochetApp.Renderer = class {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.project = null;

    // View state
    this.scale   = 10;   // base pixels per cell (X axis)
    this.offsetX = 0;
    this.offsetY = 0;

    this.MIN_SCALE = 2;
    this.MAX_SCALE = 48;

    // Aspect ratio preview
    this.aspectRatioMode = false; // when true, cells render non-square
    this._cellAspect     = 1;     // scaleY / scaleX ratio (updated by setAspectRatio)

    // Hidden colors (visibility toggle)
    this._hiddenColors = new Set();

    // Shape-edit mode: mask is rendered prominently; cells are dimmed
    this.shapeEditMode = false;

    // Reading mode
    this.readingMode    = false;
    this.readingGridRow = 0;       // which grid row (0-indexed) is highlighted

    // Overlays
    this.selection = null;         // { startCol, startRow, endCol, endRow } | null

    // Keep canvas sized to its container
    this._ro = new ResizeObserver(() => this._onResize());
    this._ro.observe(canvas.parentElement);
    this._onResize();
  }

  // ─── Derived scale ────────────────────────────────────────────────────────

  get scaleX() { return this.scale; }
  get scaleY() {
    return this.aspectRatioMode ? this.scale * this._cellAspect : this.scale;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  destroy() { this._ro.disconnect(); }

  // ─── View helpers ────────────────────────────────────────────────────────

  _onResize() {
    const p = this.canvas.parentElement;
    this.canvas.width  = p.clientWidth;
    this.canvas.height = p.clientHeight;
    this.render();
  }

  /** Re-center the grid in the canvas viewport at a comfortable zoom level. */
  centerView() {
    if (!this.project) return;
    const { width, height } = this.project.grid;
    const aspect = this.aspectRatioMode ? this._cellAspect : 1;

    const fitScaleX = Math.floor((this.canvas.width  * 0.85) / width);
    const fitScaleY = Math.floor((this.canvas.height * 0.85) / (height * aspect));
    const fitScale  = Math.min(fitScaleX, fitScaleY, this.MAX_SCALE);

    this.scale   = Math.max(this.MIN_SCALE, fitScale);
    this.offsetX = (this.canvas.width  - width  * this.scaleX) / 2;
    this.offsetY = (this.canvas.height - height * this.scaleY) / 2;
  }

  /** Zoom by a multiplicative factor, keeping pivot (px, py) stationary. */
  zoom(factor, pivotX, pivotY) {
    const newScale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, this.scale * factor));
    if (newScale === this.scale) return newScale;
    // Maintain pivot relative to both axes
    this.offsetX = pivotX - (pivotX - this.offsetX) * (newScale / this.scale);
    this.offsetY = pivotY - (pivotY - this.offsetY) * (newScale * (this.aspectRatioMode ? this._cellAspect : 1)) /
                                                       (this.scale * (this.aspectRatioMode ? this._cellAspect : 1));
    this.scale   = newScale;
    this.render();
    return newScale;
  }

  /** Shift the viewport by (dx, dy) pixels. */
  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    this.render();
  }

  // ─── Aspect ratio mode ────────────────────────────────────────────────────

  /** @param {number} ratio  scaleY/scaleX — e.g. 0.8 for 4st/5rows gauge */
  setAspectRatio(ratio) {
    this._cellAspect = Math.max(0.1, ratio);
  }

  setAspectRatioMode(enabled) {
    this.aspectRatioMode = enabled;
    this.centerView();
    this.render();
  }

  // ─── Reading mode ─────────────────────────────────────────────────────────

  setReadingMode(enabled, gridRow) {
    this.readingMode    = enabled;
    this.readingGridRow = gridRow ?? 0;
    this.render();
  }

  setReadingRow(gridRow) {
    this.readingGridRow = gridRow;
    this.render();
  }

  // ─── Coordinate conversion ───────────────────────────────────────────────

  screenToGrid(sx, sy) {
    return {
      col: Math.floor((sx - this.offsetX) / this.scaleX),
      row: Math.floor((sy - this.offsetY) / this.scaleY),
    };
  }

  gridToScreen(col, row) {
    return {
      x: col * this.scaleX + this.offsetX,
      y: row * this.scaleY + this.offsetY,
    };
  }

  // ─── Project ─────────────────────────────────────────────────────────────

  setProject(project) {
    this.project   = project;
    this.selection = null;
    this.centerView();
    this.render();
  }

  /**
   * Switch to a new panel.  Creates an internal compat shim so all existing
   * render code (which reads this.project.grid / this.project.palette) works
   * unchanged.
   * @param {object} panel    — panel object with .grid { width, height, cells, mask }
   * @param {Array}  palette  — project palette array
   */
  setPanel(panel, palette) {
    this.project   = { grid: panel.grid, palette };
    this._mask     = panel.grid.mask || null;
    this.selection = null;
    this.centerView();
    this.render();
  }

  /** Call after a mask change without needing to re-center. */
  refreshMask(panel) {
    this._mask = panel.grid.mask || null;
    this.render();
  }

  /** Replace the set of palette indices to hide; re-renders immediately. */
  setHiddenColors(set) {
    this._hiddenColors = set instanceof Set ? set : new Set();
    this.render();
  }

  setSelection(sel) {
    this.selection = sel;
    this.render();
  }

  // ─── Main render ─────────────────────────────────────────────────────────

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.project) return;

    const { width, height, cells } = this.project.grid;
    const palette  = this.project.palette;
    const { scaleX, scaleY, offsetX, offsetY } = this;

    // Visible cell range (culling)
    const colStart = Math.max(0, Math.floor(-offsetX / scaleX));
    const rowStart = Math.max(0, Math.floor(-offsetY / scaleY));
    const colEnd   = Math.min(width,  Math.ceil((canvas.width  - offsetX) / scaleX));
    const rowEnd   = Math.min(height, Math.ceil((canvas.height - offsetY) / scaleY));

    // ── Background ──────────────────────────────────────────────────────
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(
      Math.round(colStart * scaleX + offsetX),
      Math.round(rowStart * scaleY + offsetY),
      Math.ceil((colEnd - colStart) * scaleX),
      Math.ceil((rowEnd - rowStart) * scaleY)
    );

    // ── Cells ────────────────────────────────────────────────────────────
    for (let row = rowStart; row < rowEnd; row++) {
      for (let col = colStart; col < colEnd; col++) {
        const idx = cells[row * width + col];
        if (idx === CrochetApp.EMPTY_CELL || this._hiddenColors.has(idx)) continue;
        ctx.fillStyle = palette[idx]?.hex ?? '#ffffff';
        ctx.fillRect(
          Math.round(col * scaleX + offsetX),
          Math.round(row * scaleY + offsetY),
          Math.ceil(scaleX),
          Math.ceil(scaleY)
        );
      }
    }

    // ── Mask overlay (cells outside the garment shape) ───────────────────
    if (this._mask) {
      const mask = this._mask;
      // In shape-edit mode cells are dimmed so the mask is the focus;
      // in design mode the outside area is just a subtle grey block.
      if (this.shapeEditMode) {
        // Dim the whole canvas first, then punch out the inside area
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'destination-out';
        for (let row = rowStart; row < rowEnd; row++) {
          for (let col = colStart; col < colEnd; col++) {
            if (mask[row * width + col] === 1) {
              ctx.fillRect(
                Math.round(col * scaleX + offsetX),
                Math.round(row * scaleY + offsetY),
                Math.ceil(scaleX), Math.ceil(scaleY)
              );
            }
          }
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = 'rgba(90,90,90,0.48)';
        for (let row = rowStart; row < rowEnd; row++) {
          for (let col = colStart; col < colEnd; col++) {
            if (mask[row * width + col] === 0) {
              ctx.fillRect(
                Math.round(col * scaleX + offsetX),
                Math.round(row * scaleY + offsetY),
                Math.ceil(scaleX), Math.ceil(scaleY)
              );
            }
          }
        }
        ctx.restore();
      }
    }

    // ── Reading mode highlight ────────────────────────────────────────────
    if (this.readingMode) {
      const ry = Math.round(this.readingGridRow * scaleY + offsetY);
      const rh = Math.ceil(scaleY);

      // Dim everything outside the current row
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      // Above the row
      if (ry > 0) ctx.fillRect(0, 0, canvas.width, ry);
      // Below the row
      const rowBottom = ry + rh;
      if (rowBottom < canvas.height) {
        ctx.fillRect(0, rowBottom, canvas.width, canvas.height - rowBottom);
      }

      // Bright border around current row
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth   = 2;
      ctx.setLineDash([]);
      const rx = Math.round(offsetX);
      ctx.strokeRect(rx + 1, ry + 1, width * scaleX - 2, rh - 2);
      ctx.restore();
    }

    // ── Grid lines ────────────────────────────────────────────────────────
    if (scaleX >= 5) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      for (let col = colStart; col <= colEnd; col++) {
        const x = Math.round(col * scaleX + offsetX) + 0.5;
        ctx.moveTo(x, Math.round(rowStart * scaleY + offsetY));
        ctx.lineTo(x, Math.round(rowEnd   * scaleY + offsetY));
      }
      for (let row = rowStart; row <= rowEnd; row++) {
        const y = Math.round(row * scaleY + offsetY) + 0.5;
        ctx.moveTo(Math.round(colStart * scaleX + offsetX), y);
        ctx.lineTo(Math.round(colEnd   * scaleX + offsetX), y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Outer border ──────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#555';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(
      Math.round(offsetX) + 0.75,
      Math.round(offsetY) + 0.75,
      width  * scaleX - 1.5,
      height * scaleY - 1.5
    );
    ctx.restore();

    // ── Row / column number labels ────────────────────────────────────────
    if (scaleX >= 10) {
      ctx.save();
      ctx.fillStyle = 'rgba(80,80,80,0.7)';
      ctx.font      = `${Math.min(scaleX * 0.55, 11)}px monospace`;
      const interval = scaleX >= 18 ? 5 : 10;

      ctx.textAlign = 'center';
      for (let col = interval - 1; col < colEnd; col += interval) {
        if (col < colStart) continue;
        const x = Math.round(col * scaleX + offsetX) + scaleX / 2;
        const y = Math.round(offsetY) - 3;
        if (y > 2) ctx.fillText(col + 1, x, y);
      }

      ctx.textAlign = 'right';
      for (let row = interval - 1; row < rowEnd; row += interval) {
        if (row < rowStart) continue;
        const x = Math.round(offsetX) - 3;
        const y = Math.round(row * scaleY + offsetY) + scaleY / 2 + 3;
        if (x > 2) ctx.fillText(row + 1, x, y);
      }
      ctx.restore();
    }

    // ── Selection overlay ─────────────────────────────────────────────────
    if (this.selection) {
      const { c1, r1, c2, r2 } = CrochetApp.Tools.normalizeSelection(this.selection);
      const sx = Math.round(c1 * scaleX + offsetX);
      const sy = Math.round(r1 * scaleY + offsetY);
      const sw = (c2 - c1 + 1) * scaleX;
      const sh = (r2 - r1 + 1) * scaleY;

      ctx.save();
      ctx.fillStyle = 'rgba(100, 160, 255, 0.18)';
      ctx.fillRect(sx, sy, sw, sh);

      ctx.strokeStyle = 'rgba(50, 120, 255, 0.9)';
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(50, 120, 255, 0.9)';
      const hs = 4;
      for (const [hx, hy] of [[sx,sy],[sx+sw,sy],[sx,sy+sh],[sx+sw,sy+sh]]) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
      ctx.restore();
    }
  }
};
