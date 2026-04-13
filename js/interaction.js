/**
 * interaction.js — Mouse event handling for the grid canvas
 *
 * Tools handled here:
 *   pencil     — click/drag paints cells
 *   eraser     — click/drag erases cells
 *   fill       — one-shot flood fill on click
 *   eyedropper — one-shot color sample on click
 *   select     — drag to define a rectangular selection
 *
 * Pan: middle-click drag OR Space + left-click drag (any tool)
 * Zoom: mouse wheel
 */

CrochetApp.Interaction = class {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {CrochetApp.Renderer} renderer
   * @param {() => object}   getProject
   * @param {() => string}   getActiveTool
   * @param {() => number}   getActiveColor
   * @param {(snapshot: Uint8Array) => void} onStrokeEnd
   * @param {(col: number, row: number) => void} [onCursorMove]
   * @param {(colorIndex: number) => void}       [onEyedropper]
   * @param {(sel: object|null) => void}         [onSelectionChange]
   */
  constructor(canvas, renderer, getProject, getActiveTool, getActiveColor,
              onStrokeEnd, onCursorMove, onEyedropper, onSelectionChange,
              getShapeEditMode) {
    this.canvas             = canvas;
    this.renderer           = renderer;
    this.getProject         = getProject;
    this.getActiveTool      = getActiveTool;
    this.getActiveColor     = getActiveColor;
    this.onStrokeEnd        = onStrokeEnd;
    this.onCursorMove       = onCursorMove       || null;
    this.onEyedropper       = onEyedropper       || null;
    this.onSelectionChange  = onSelectionChange  || null;
    this.onZoomChanged      = null; // set externally
    this.getShapeEditMode   = getShapeEditMode   || (() => false);

    // Paint stroke state
    this._isPainting     = false;
    this._strokeSnapshot = null;
    this._lastGridPos    = null;

    // Pan state
    this._isPanning   = false;
    this._isSpaceDown = false;
    this._lastPanPos  = null;

    // Select tool state
    this._isSelecting  = false;
    this._selectStart  = null; // { col, row }

    this._bindEvents();
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown',   e => this._onMouseDown(e));
    c.addEventListener('mousemove',   e => this._onMouseMove(e));
    c.addEventListener('mouseup',     e => this._onMouseUp(e));
    c.addEventListener('mouseleave',  e => this._onMouseLeave(e));
    c.addEventListener('wheel',       e => this._onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        this._isSpaceDown = true;
        if (!this._isPainting && !this._isSelecting) {
          this.canvas.style.cursor = 'grab';
        }
      }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') {
        this._isSpaceDown = false;
        if (!this._isPanning) this._resetCursor();
      }
    });
  }

  // ─── Cursor ───────────────────────────────────────────────────────────────

  _resetCursor() {
    const tool = this.getActiveTool();
    if      (tool === 'select')      this.canvas.style.cursor = 'crosshair';
    else if (tool === 'eyedropper')  this.canvas.style.cursor = 'cell';
    else if (tool === 'fill')        this.canvas.style.cursor = 'cell';
    else                             this.canvas.style.cursor = 'crosshair';
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ─── Mouse events ─────────────────────────────────────────────────────────

  _onMouseDown(e) {
    const pos  = this._canvasPos(e);

    // ── Pan (middle-click or Space + left) ────────────────────────────────
    if (e.button === 1 || (e.button === 0 && this._isSpaceDown)) {
      e.preventDefault();
      this._isPanning  = true;
      this._lastPanPos = pos;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const project = this.getProject();
    if (!project) return;

    const { col, row } = this.renderer.screenToGrid(pos.x, pos.y);
    const tool = this.getActiveTool();

    // ── Select tool ───────────────────────────────────────────────────────
    if (tool === 'select') {
      this._isSelecting = true;
      this._selectStart = { col, row };
      // Broadcast a point selection immediately
      if (this.onSelectionChange) {
        this.onSelectionChange({ startCol: col, startRow: row, endCol: col, endRow: row });
      }
      return;
    }

    // ── One-shot tools (fill, eyedropper) ─────────────────────────────────
    if (tool === 'fill') {
      if (this.getShapeEditMode()) {
        // Flood-fill the mask
        this._strokeSnapshot = project.grid.cells.slice(); // cells unchanged but keeps undo consistent
        CrochetApp.Tools.floodFillMask(project, col, row, 1);
        this.renderer.refreshMask(project);
        this.onStrokeEnd(this._strokeSnapshot);
        this._strokeSnapshot = null;
      } else {
        const { mask } = project.grid;
        if (mask && mask[row * project.grid.width + col] === 0) return; // outside garment
        this._strokeSnapshot = project.grid.cells.slice();
        CrochetApp.Tools.floodFill(project, col, row, this.getActiveColor());
        this.renderer.render();
        this.onStrokeEnd(this._strokeSnapshot);
        this._strokeSnapshot = null;
      }
      return;
    }

    if (tool === 'eyedropper') {
      const idx = CrochetApp.getCell(project, col, row);
      if (idx !== CrochetApp.EMPTY_CELL && this.onEyedropper) {
        this.onEyedropper(idx);
      }
      return;
    }

    // ── Drag-paint tools (pencil, eraser) ─────────────────────────────────
    this._strokeSnapshot = project.grid.cells.slice();
    this._isPainting     = true;
    this._lastGridPos    = null;
    this._paintAt(project, col, row);
  }

  _onMouseMove(e) {
    const pos = this._canvasPos(e);

    // ── Pan update ────────────────────────────────────────────────────────
    if (this._isPanning && this._lastPanPos) {
      this.renderer.pan(pos.x - this._lastPanPos.x, pos.y - this._lastPanPos.y);
      this._lastPanPos = pos;
      return;
    }

    const { col, row } = this.renderer.screenToGrid(pos.x, pos.y);

    // ── Cursor reporting ──────────────────────────────────────────────────
    if (this.onCursorMove) this.onCursorMove(col, row);

    // ── Selection drag update ──────────────────────────────────────────────
    if (this._isSelecting && this._selectStart) {
      if (this.onSelectionChange) {
        this.onSelectionChange({
          startCol: this._selectStart.col,
          startRow: this._selectStart.row,
          endCol:   col,
          endRow:   row,
        });
      }
      return;
    }

    // ── Paint drag ────────────────────────────────────────────────────────
    if (this._isPainting) {
      const project = this.getProject();
      if (!project) return;
      if (this._lastGridPos && col === this._lastGridPos.col && row === this._lastGridPos.row) return;
      this._paintAt(project, col, row);
    }
  }

  _onMouseUp(_e) {
    if (this._isPanning) {
      this._isPanning  = false;
      this._lastPanPos = null;
      this.canvas.style.cursor = this._isSpaceDown ? 'grab' : this._getCursorForTool();
      return;
    }

    if (this._isSelecting) {
      this._isSelecting = false;
      // Selection is already finalized via onSelectionChange during drag
      return;
    }

    if (this._isPainting) {
      this._isPainting  = false;
      this._lastGridPos = null;
      if (this._strokeSnapshot) {
        this.onStrokeEnd(this._strokeSnapshot);
        this._strokeSnapshot = null;
      }
    }
  }

  _onMouseLeave(_e) {
    if (this._isPainting) {
      this._isPainting  = false;
      this._lastGridPos = null;
      if (this._strokeSnapshot) {
        this.onStrokeEnd(this._strokeSnapshot);
        this._strokeSnapshot = null;
      }
    }
    if (this._isSelecting) {
      this._isSelecting = false;
    }
    if (this.onCursorMove) this.onCursorMove(-1, -1);
  }

  _onWheel(e) {
    e.preventDefault();
    const pos      = this._canvasPos(e);
    const factor   = e.deltaY < 0 ? 1.12 : 0.9;
    const newScale = this.renderer.zoom(factor, pos.x, pos.y);
    if (this.onZoomChanged) this.onZoomChanged(newScale);
  }

  // ─── Paint ────────────────────────────────────────────────────────────────

  _paintAt(project, col, row) {
    const { width, height, mask } = project.grid;
    if (col < 0 || col >= width || row < 0 || row >= height) return;

    const tool          = this.getActiveTool();
    const shapeEditMode = this.getShapeEditMode();

    if (shapeEditMode) {
      // In shape-edit mode pencil/eraser write to the mask, not the cells
      if (!project.grid.mask) {
        project.grid.mask = new Uint8Array(width * height).fill(1);
      }
      if (tool === 'pencil') {
        project.grid.mask[row * width + col] = 1;
      } else if (tool === 'eraser') {
        project.grid.mask[row * width + col] = 0;
      }
      this.renderer.refreshMask(project);
    } else {
      // Normal design mode — respect the mask
      if (mask && mask[row * width + col] === 0) return;
      if (tool === 'pencil') {
        CrochetApp.setCell(project, col, row, this.getActiveColor());
      } else if (tool === 'eraser') {
        CrochetApp.setCell(project, col, row, CrochetApp.EMPTY_CELL);
      }
      this.renderer.render();
    }

    this._lastGridPos = { col, row };
  }

  _getCursorForTool() {
    const tool = this.getActiveTool();
    if (tool === 'eyedropper' || tool === 'fill') return 'cell';
    if (tool === 'select')                         return 'crosshair';
    return 'crosshair';
  }
};