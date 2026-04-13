/**
 * app.js — Main application controller
 *
 * Owns:
 *   - Screen navigation (project list ↔ editor)
 *   - Current project state + dirty flag
 *   - Undo / redo stacks
 *   - All top-level event bindings (toolbar, modals, keyboard shortcuts)
 */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────

  let currentProject  = null;
  let currentPanel    = null;  // always === getActivePanel(currentProject)
  let activeTool      = 'pencil';
  let activeColor     = 0;
  let undoStack       = []; // snapshots for currentPanel
  let redoStack       = [];
  let _panelStacks    = {}; // { [panelId]: { undo, redo } } saved on panel switch
  let isDirty         = false;

  // Selection & clipboard
  let activeSelection = null; // { startCol, startRow, endCol, endRow } | null
  let clipboard       = null; // { width, height, cells: Uint8Array } | null
  let lastCursorPos   = { col: 0, row: 0 };

  // Phase 3 state
  let aspectRatioOn   = false;
  let readingModeOn   = false;
  let readingRow      = 0;    // display row number (1 = bottom of piece)

  // Garment / panel state
  let shapeEditMode   = false;
  let _selectedGarmentId   = 'blank'; // tracks picker selection in new-project modal
  let _selectedAddPanelShapeId = 'blank'; // tracks shape picker in add-panel modal

  // Module instances (created once, reused across projects)
  let renderer    = null;
  let interaction = null;
  let paletteUI   = null;

  const MAX_UNDO = 50;

  // ── Boot ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    _initDarkMode();
    _startAutoSave();
    _bindProjectListEvents();
    _bindEditorEvents();
    _bindModalEvents();
    _bindImportEvents();
    _bindPanelModalEvents();
    _bindKeyboardShortcuts();
    await _initFolderState();
    await showProjectList();
  }

  // ── Folder setup ─────────────────────────────────────────────────────────

  /**
   * Called once at startup. Checks permission state and shows the appropriate
   * banner (setup / reconnect / nothing) without triggering any browser prompt.
   */
  async function _initFolderState() {
    const state = await CrochetApp.Storage.getPermissionState();
    _updateFolderBanner(state);
    _updateFolderNameDisplay();
  }

  function _updateFolderBanner(state) {
    const banner    = document.getElementById('folder-banner');
    const setupDiv  = document.getElementById('folder-banner-setup');
    const reconnDiv = document.getElementById('folder-banner-reconnect');

    if (state === 'granted') {
      banner.classList.add('hidden');
    } else if (state === 'prompt') {
      // Has a handle but needs a user gesture to re-grant permission this session
      banner.classList.remove('hidden');
      setupDiv.classList.add('hidden');
      reconnDiv.classList.remove('hidden');
    } else {
      // 'none' — first time or handle lost
      banner.classList.remove('hidden');
      setupDiv.classList.remove('hidden');
      reconnDiv.classList.add('hidden');
    }
  }

  async function _updateFolderNameDisplay() {
    const name = await CrochetApp.Storage.getFolderName();
    const el   = document.getElementById('folder-name-display');
    el.textContent = name ?? 'No folder';
    el.title       = name ? ('Projects folder: ' + name) : 'No projects folder configured';
  }

  async function _doSetupFolder() {
    try {
      await CrochetApp.Storage.setupFolder();
      await _updateFolderNameDisplay();
      _updateFolderBanner('granted');
      // Re-render the project list now that we have access
      await renderProjectList();
    } catch (e) {
      if (e.name !== 'AbortError') {
        alert('Could not set up projects folder: ' + e.message);
      }
    }
  }

  async function _doReconnectFolder() {
    const granted = await CrochetApp.Storage.requestAccess();
    if (granted) {
      _updateFolderBanner('granted');
      await renderProjectList();
    } else {
      alert('Permission was not granted. Your projects folder could not be accessed.');
    }
  }

  // ── Screen navigation ────────────────────────────────────────────────────

  async function showProjectList() {
    document.getElementById('screen-projects').classList.remove('hidden');
    document.getElementById('screen-editor').classList.add('hidden');
    await renderProjectList();
  }

  function showEditor() {
    document.getElementById('screen-projects').classList.add('hidden');
    document.getElementById('screen-editor').classList.remove('hidden');
  }

  // ── Project list ─────────────────────────────────────────────────────────

  async function renderProjectList() {
    const list      = document.getElementById('project-list');
    const empty     = document.getElementById('empty-state');
    const projects  = await CrochetApp.Storage.listProjects();

    list.innerHTML = '';

    if (projects.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    empty.classList.add('hidden');

    projects.forEach(p => {
      const card = document.createElement('div');
      card.className = 'project-card';
      card.innerHTML = `
        <div class="project-card-badge">${_techniqueLabel(p.technique)}</div>
        <div class="project-card-name">${_esc(p.name)}</div>
        <div class="project-card-meta">
          ${p.panelCount > 1
            ? `${p.panelCount} panels &nbsp;·&nbsp; ${p.gridWidth} × ${p.gridHeight} (first panel)`
            : `${p.gridWidth} × ${p.gridHeight} stitches`}<br>
          Last edited: ${_formatDate(p.updatedAt)}
        </div>
        <div class="project-card-actions">
          <button class="btn-card-delete" data-id="${p.id}">Delete</button>
        </div>
      `;

      // Open on card click (but not on delete button)
      card.addEventListener('click', e => {
        if (e.target.closest('.btn-card-delete')) return;
        openProject(p.id);
      });

      card.querySelector('.btn-card-delete').addEventListener('click', async e => {
        e.stopPropagation();
        if (confirm(`Delete "${p.name}"? This cannot be undone.`)) {
          await CrochetApp.Storage.deleteProject(p.id);
          await renderProjectList();
        }
      });

      list.appendChild(card);
    });
  }

  async function openProject(id) {
    const project = await CrochetApp.Storage.loadProject(id);
    if (!project) { alert('Project not found.'); return; }
    loadProject(project);
  }

  // ── Editor setup ─────────────────────────────────────────────────────────

  function loadProject(project) {
    currentProject  = project;
    _panelStacks    = {};
    undoStack       = [];
    redoStack       = [];
    isDirty         = false;
    activeColor     = 0;
    activeSelection = null;
    clipboard       = null;

    // Reset shape-edit mode
    if (shapeEditMode) _exitShapeEditMode();

    // Reset Phase 3 state
    if (readingModeOn) exitReadingMode();
    if (aspectRatioOn) {
      aspectRatioOn = false;
      document.getElementById('btn-aspect-ratio')?.classList.remove('active');
    }

    _initEditorModules();

    // Activate first/stored panel
    currentPanel = CrochetApp.getActivePanel(project);
    renderer.setPanel(currentPanel, project.palette);
    renderer.setHiddenColors(new Set());
    paletteUI.setProject(project);

    _renderPanelTabs();
    _updateStatusBar();
    _updateTitle();
    _updateUndoRedoButtons();
    _updateSelectionActions();

    showEditor();
  }

  function _initEditorModules() {
    // Create modules once; they persist across project loads
    if (!renderer) {
      const canvas = document.getElementById('grid-canvas');

      renderer = new CrochetApp.Renderer(canvas);

      interaction = new CrochetApp.Interaction(
        canvas,
        renderer,
        () => currentPanel,          // pass active panel (has .grid like a project)
        () => activeTool,
        () => activeColor,
        (snapshot)  => _onStrokeEnd(snapshot),
        (col, row)  => _onCursorMove(col, row),
        (colorIdx)  => _onEyedropper(colorIdx),
        (sel)       => _onSelectionChange(sel),
        () => shapeEditMode
      );
      interaction.onZoomChanged = () => _updateStatusBar();

      paletteUI = new CrochetApp.Palette(
        document.getElementById('palette-panel'),
        (i) => { activeColor = i; },
        ()  => { _markDirty(); renderer.render(); }
      );
      paletteUI.onVisibilityChange = (hiddenSet) => renderer.setHiddenColors(hiddenSet);
    }
  }

  // ── Undo / redo ──────────────────────────────────────────────────────────

  function _onStrokeEnd(snapshot) {
    // snapshot is a Uint8Array (cells only) from interaction.js — wrap for consistency
    undoStack.push(snapshot);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
    paletteUI.updateCounts();
    _markDirty();
    _updateUndoRedoButtons();
  }

  function undo() {
    if (!currentProject || undoStack.length === 0) return;
    const snapshot = undoStack.pop();
    // Push current state to redo (always full snapshot for symmetry)
    redoStack.push({
      cells:   currentPanel.grid.cells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   currentPanel.grid.width,
      height:  currentPanel.grid.height,
    });
    _restoreSnapshot(snapshot);
  }

  function redo() {
    if (!currentProject || redoStack.length === 0) return;
    const snapshot = redoStack.pop();
    undoStack.push({
      cells:   currentPanel.grid.cells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   currentPanel.grid.width,
      height:  currentPanel.grid.height,
    });
    _restoreSnapshot(snapshot);
  }

  function _restoreSnapshot(snapshot) {
    // Snapshot can be a plain Uint8Array (panel cells only) or a full { cells, palette, width, height }
    if (snapshot instanceof Uint8Array) {
      currentPanel.grid.cells = snapshot;
    } else {
      currentPanel.grid.cells  = snapshot.cells;
      currentPanel.grid.width  = snapshot.width;
      currentPanel.grid.height = snapshot.height;
      currentProject.palette   = snapshot.palette;
      paletteUI.setProject(currentProject);
      renderer.setPanel(currentPanel, currentProject.palette);
    }
    renderer.render();
    paletteUI.updateCounts();
    _markDirty();
    _updateUndoRedoButtons();
  }

  function _updateUndoRedoButtons() {
    document.getElementById('btn-undo').disabled = undoStack.length === 0;
    document.getElementById('btn-redo').disabled = redoStack.length === 0;
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  async function saveProject() {
    if (!currentProject) return;
    try {
      currentProject.updatedAt = new Date().toISOString();
      await CrochetApp.Storage.saveProject(currentProject);
      isDirty = false;
      const btn = document.getElementById('btn-save');
      btn.textContent = 'Saved \u2713';
      setTimeout(() => { btn.textContent = 'Save'; }, 1800);
    } catch (e) {
      alert('Could not save: ' + e.message + '\n\nMake sure a projects folder is set up from the Projects screen.');
    }
  }

  function _markDirty() {
    isDirty = true;
  }

  // ── Status bar ───────────────────────────────────────────────────────────

  function _updateStatusBar() {
    if (!currentProject || !currentPanel) return;
    const { width, height } = currentPanel.grid;
    document.getElementById('status-grid-size').textContent =
      `${width} × ${height}`;
    document.getElementById('status-zoom').textContent =
      `Zoom: ${Math.round(renderer?.scale ?? 10)}px`;
    document.getElementById('status-technique').textContent =
      _techniqueLabel(currentProject.technique);
  }

  function _onCursorMove(col, row) {
    const el = document.getElementById('status-cursor');
    if (!currentPanel || col < 0 || col >= currentPanel.grid.width ||
        row < 0 || row >= currentPanel.grid.height) {
      el.textContent = '—';
    } else {
      lastCursorPos  = { col, row };
      el.textContent = `Col ${col + 1}, Row ${row + 1}`;
    }
  }

  // ── Eyedropper ────────────────────────────────────────────────────────────

  function _onEyedropper(colorIdx) {
    activeColor = colorIdx;
    paletteUI.setActiveIndex(colorIdx);
    // Switch back to pencil after sampling
    setTool('pencil');
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function _onSelectionChange(sel) {
    // Clamp selection to grid bounds
    if (!currentProject || !sel) {
      activeSelection = null;
    } else {
      const { width, height } = currentPanel.grid;
      activeSelection = {
        startCol: Math.max(0, Math.min(width  - 1, sel.startCol)),
        startRow: Math.max(0, Math.min(height - 1, sel.startRow)),
        endCol:   Math.max(0, Math.min(width  - 1, sel.endCol)),
        endRow:   Math.max(0, Math.min(height - 1, sel.endRow)),
      };
    }
    renderer.setSelection(activeSelection);
    _updateSelectionActions();
  }

  function _clearSelection() {
    activeSelection = null;
    renderer.setSelection(null);
    _updateSelectionActions();
  }

  /** Enable/disable selection-dependent buttons. */
  function _updateSelectionActions() {
    const hasSel  = activeSelection !== null;
    const hasClip = clipboard !== null;
    const btnCopy  = document.getElementById('btn-copy');
    const btnPaste = document.getElementById('btn-paste');
    const btnCrop  = document.getElementById('btn-crop');
    if (btnCopy)  btnCopy.disabled  = !hasSel;
    if (btnPaste) btnPaste.disabled = !hasClip;
    if (btnCrop)  btnCrop.disabled  = !hasSel;
  }

  // ── Copy / paste / delete selection ──────────────────────────────────────

  function copySelection() {
    if (!currentProject || !activeSelection) return;
    clipboard = CrochetApp.Tools.copySelection(currentProject, activeSelection);
    _updateSelectionActions();
    _flashStatus('Copied!');
  }

  function pasteClipboard() {
    if (!currentProject || !clipboard) return;
    const snapshot = currentPanel.grid.cells.slice();
    CrochetApp.Tools.pasteClipboard(currentPanel, clipboard, lastCursorPos.col, lastCursorPos.row);
    _onStrokeEnd(snapshot);
    renderer.render();
    paletteUI.updateCounts();
  }

  function deleteSelection() {
    if (!currentProject || !activeSelection) return;
    const snapshot = currentPanel.grid.cells.slice();
    CrochetApp.Tools.clearSelection(currentPanel, activeSelection);
    _onStrokeEnd(snapshot);
    renderer.render();
    paletteUI.updateCounts();
  }

  function cropSelection() {
    if (!currentProject || !activeSelection) return;

    const result = CrochetApp.Tools.cropToSelection(currentPanel, activeSelection);

    undoStack.push({
      cells:   currentPanel.grid.cells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   currentPanel.grid.width,
      height:  currentPanel.grid.height,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];

    currentPanel.grid.cells  = result.cells;
    currentPanel.grid.width  = result.width;
    currentPanel.grid.height = result.height;

    activeSelection = null;
    renderer.setPanel(currentPanel, currentProject.palette); // re-centres view
    renderer.setSelection(null);
    paletteUI.updateCounts();
    _markDirty();
    _updateUndoRedoButtons();
    _updateSelectionActions();
    _updateStatusBar();
  }

  function _updateTitle() {
    const el = document.getElementById('project-name-display');
    el.textContent = currentProject?.name ?? '';
  }

  // ── Aspect ratio preview ─────────────────────────────────────────────────

  function toggleAspectRatio() {
    if (!currentProject) return;
    aspectRatioOn = !aspectRatioOn;
    const ratio = CrochetApp.Instructions.cellAspectRatio(currentProject.gauge);
    renderer.setAspectRatio(ratio);
    renderer.setAspectRatioMode(aspectRatioOn);
    document.getElementById('btn-aspect-ratio')
      .classList.toggle('active', aspectRatioOn);
    _updateStatusBar();
  }

  // ── Reading mode ─────────────────────────────────────────────────────────

  function enterReadingMode() {
    if (!currentProject || readingModeOn) return;
    readingModeOn = true;
    readingRow    = 1; // display row 1 = bottom of piece
    _applyReadingRow();
    document.getElementById('reading-mode-bar').classList.remove('hidden');
    document.getElementById('btn-reading-mode').classList.add('active');
  }

  function exitReadingMode() {
    readingModeOn = false;
    renderer.setReadingMode(false);
    document.getElementById('reading-mode-bar').classList.add('hidden');
    document.getElementById('btn-reading-mode').classList.remove('active');
  }

  function _applyReadingRow() {
    if (!currentProject) return;
    const { height } = currentPanel.grid;
    readingRow = Math.max(1, Math.min(height, readingRow));
    // Convert display row (1 = bottom) to grid row (0-indexed from top)
    const gridRow = height - readingRow;
    renderer.setReadingMode(true, gridRow);
    document.getElementById('rm-status').textContent =
      `Row ${readingRow} of ${height}`;
  }

  function readingModeNext() {
    if (!currentProject) return;
    readingRow = Math.min(currentPanel.grid.height, readingRow + 1);
    _applyReadingRow();
  }

  function readingModePrev() {
    readingRow = Math.max(1, readingRow - 1);
    _applyReadingRow();
  }

  // ── Pattern modal ─────────────────────────────────────────────────────────

  function openPatternModal() {
    if (!currentProject) return;
    _refreshPatternModal();
    document.getElementById('modal-pattern').classList.remove('hidden');
  }

  function _refreshPatternModal() {
    // Always open on the Instructions tab
    document.querySelectorAll('.pattern-tab[data-ptab]').forEach(b => b.classList.remove('active'));
    document.querySelector('.pattern-tab[data-ptab="instructions"]')?.classList.add('active');
    document.getElementById('ptab-instructions')?.classList.remove('hidden');
    document.getElementById('ptab-shaping')?.classList.add('hidden');

    const project = currentProject;
    const gauge   = project.gauge || { stitchesPerInch: 4, rowsPerInch: 5 };

    // Populate gauge inputs from project
    document.getElementById('gauge-stitches').value = gauge.stitchesPerInch;
    document.getElementById('gauge-rows').value      = gauge.rowsPerInch;

    _updateDimensions();
    _updateColorSummary();
    _updateInstructionsList();
  }

  function _updateDimensions() {
    const gauge = {
      stitchesPerInch: parseFloat(document.getElementById('gauge-stitches').value) || 4,
      rowsPerInch:     parseFloat(document.getElementById('gauge-rows').value)     || 5,
    };
    const dims = CrochetApp.Instructions.calcDimensions(currentPanel.grid, gauge);
    document.getElementById('dim-width').textContent  = `${dims.widthIn}"  (${dims.widthCm} cm)`;
    document.getElementById('dim-height').textContent = `${dims.heightIn}"  (${dims.heightCm} cm)`;
  }

  function _updateColorSummary() {
    const { palette } = currentProject;
    const counts = CrochetApp.countColors(currentPanel, palette.length);
    const total  = CrochetApp.totalPainted(currentPanel);
    const el = document.getElementById('color-summary');
    el.innerHTML = palette.map((c, i) => {
      const count = counts[i] || 0;
      const pct   = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
      return `
        <div class="color-summary-row">
          <div class="color-summary-swatch" style="background:${c.hex}"></div>
          <span class="color-summary-label" title="${_esc(c.label)}">${_esc(c.label)}</span>
          <span class="color-summary-count">${count.toLocaleString()} (${pct}%)</span>
        </div>`;
    }).join('');
  }

  function _updateInstructionsList() {
    // Instructions expects an object with .grid and .technique
    const panelAsProject = { grid: currentPanel.grid, technique: currentProject.technique };
    const rows  = CrochetApp.Instructions.generateAll(panelAsProject);
    const total = CrochetApp.totalPainted(currentPanel);

    document.getElementById('instructions-meta').textContent =
      `${rows.length} rows · ${currentPanel.grid.width} stitches wide · ${total.toLocaleString()} total stitches`;

    const listEl = document.getElementById('instructions-list');
    listEl.innerHTML = rows.map(r => {
      const text = CrochetApp.Instructions.formatRow(r, currentProject.palette);
      return `<div class="instr-row">${_esc(text)}</div>`;
    }).join('');
  }

  function _saveGaugeFromModal() {
    if (!currentProject) return;
    const st = parseFloat(document.getElementById('gauge-stitches').value);
    const rw = parseFloat(document.getElementById('gauge-rows').value);
    if (st > 0 && rw > 0) {
      currentProject.gauge.stitchesPerInch = st;
      currentProject.gauge.rowsPerInch     = rw;
      _markDirty();
      // Update aspect ratio if mode is on
      if (aspectRatioOn) {
        renderer.setAspectRatio(CrochetApp.Instructions.cellAspectRatio(currentProject.gauge));
        renderer.render();
      }
    }
  }

  // ── Mirror / flip ─────────────────────────────────────────────────────────

  function flipHorizontal() {
    if (!currentProject) return;
    const snapshot = currentPanel.grid.cells.slice();
    CrochetApp.Tools.mirrorHorizontal(currentPanel);
    _onStrokeEnd(snapshot);
    renderer.render();
    paletteUI.updateCounts();
  }

  function flipVertical() {
    if (!currentProject) return;
    const snapshot = currentPanel.grid.cells.slice();
    CrochetApp.Tools.mirrorVertical(currentPanel);
    _onStrokeEnd(snapshot);
    renderer.render();
    paletteUI.updateCounts();
  }

  // ── Tool selection ────────────────────────────────────────────────────────

  function setTool(tool) {
    activeTool = tool;
    // Clear selection when switching away from the select tool
    if (tool !== 'select') _clearSelection();
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  // ── Event bindings ───────────────────────────────────────────────────────

  function _bindProjectListEvents() {
    document.getElementById('btn-new-project')
      .addEventListener('click', () => _openNewProjectModal());

    document.getElementById('btn-dark-mode-projects')
      .addEventListener('click', toggleDarkMode);

    document.getElementById('btn-setup-folder')
      .addEventListener('click', _doSetupFolder);

    document.getElementById('btn-reconnect-folder')
      .addEventListener('click', _doReconnectFolder);

    document.getElementById('btn-change-folder')
      .addEventListener('click', _doSetupFolder);
  }

  function _bindEditorEvents() {
    // Back button — confirm unsaved changes
    document.getElementById('btn-back').addEventListener('click', async () => {
      if (isDirty && !confirm('You have unsaved changes. Leave without saving?')) return;
      await showProjectList();
    });

    // Save
    document.getElementById('btn-save').addEventListener('click', saveProject);

    // Undo / redo buttons
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);

    // Tool buttons
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });

    // Phase 3 — header buttons
    document.getElementById('btn-aspect-ratio').addEventListener('click', toggleAspectRatio);
    document.getElementById('btn-reading-mode').addEventListener('click', enterReadingMode);
    document.getElementById('btn-pattern').addEventListener('click', openPatternModal);

    // Phase 5 — header buttons
    document.getElementById('btn-dark-mode-editor').addEventListener('click', toggleDarkMode);
    document.getElementById('btn-shortcuts').addEventListener('click', openShortcutsModal);
    document.getElementById('btn-repeat-preview').addEventListener('click', openRepeatPreview);
    document.getElementById('btn-swatch-calc').addEventListener('click', openSwatchCalc);

    // Reading mode controls
    document.getElementById('btn-rm-next').addEventListener('click', readingModeNext);
    document.getElementById('btn-rm-prev').addEventListener('click', readingModePrev);
    document.getElementById('btn-rm-exit').addEventListener('click', exitReadingMode);

    // Flip buttons
    document.getElementById('btn-flip-h').addEventListener('click', flipHorizontal);
    document.getElementById('btn-flip-v').addEventListener('click', flipVertical);

    // Crop button
    document.getElementById('btn-crop').addEventListener('click', cropSelection);

    // Zoom buttons
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      if (renderer) { renderer.zoom(1.25, renderer.canvas.width / 2, renderer.canvas.height / 2); _updateStatusBar(); }
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      if (renderer) { renderer.zoom(0.8, renderer.canvas.width / 2, renderer.canvas.height / 2); _updateStatusBar(); }
    });
    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      if (renderer) { renderer.centerView(); renderer.render(); _updateStatusBar(); }
    });

    // Export dropdown toggle
    const exportBtn  = document.getElementById('btn-export');
    const exportMenu = document.getElementById('export-menu');
    exportBtn.addEventListener('click', e => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => exportMenu.classList.add('hidden'));

    exportMenu.querySelectorAll('button[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        exportMenu.classList.add('hidden');
        if (!currentProject) return;
        if (btn.dataset.export === 'png')  CrochetApp.Export.toPNG(currentProject, currentPanel);
        if (btn.dataset.export === 'pdf')  CrochetApp.Export.toPDF(currentProject, currentPanel);
        if (btn.dataset.export === 'json') CrochetApp.Export.toJSON(currentProject);
        if (btn.dataset.export === 'csv')  CrochetApp.Export.toCSV(currentProject, currentPanel);
      });
    });

    // Shape-edit, layout-view, and expand canvas
    document.getElementById('btn-shape-edit')?.addEventListener('click', toggleShapeEditMode);
    document.getElementById('btn-layout-view')?.addEventListener('click', openLayoutView);
    document.getElementById('btn-expand-canvas')?.addEventListener('click', _openExpandModal);

    // Rename project by clicking the title
    document.getElementById('project-name-display').addEventListener('click', () => {
      if (!currentProject) return;
      const modal = document.getElementById('modal-rename-project');
      const input = document.getElementById('rename-project-input');
      input.value = currentProject.name;
      modal.classList.remove('hidden');
      input.focus();
      input.select();
    });
  }

  function _bindModalEvents() {
    // ── Pattern modal ──────────────────────────────────────────────────────
    document.getElementById('btn-close-pattern').addEventListener('click', () => {
      document.getElementById('modal-pattern').classList.add('hidden');
    });

    document.getElementById('modal-pattern').addEventListener('click', e => {
      if (e.target === e.currentTarget)
        document.getElementById('modal-pattern').classList.add('hidden');
    });

    // Pattern modal tab switching
    document.querySelectorAll('.pattern-tab[data-ptab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pattern-tab[data-ptab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ptab;
        document.getElementById('ptab-instructions').classList.toggle('hidden', tab !== 'instructions');
        document.getElementById('ptab-shaping').classList.toggle('hidden', tab !== 'shaping');
        if (tab === 'shaping') _renderShapingTab();
      });
    });

    document.getElementById('shaping-changes-only')?.addEventListener('change', _renderShapingTab);

    // ── Expand canvas modal ────────────────────────────────────────────────
    let _expandSelectedSide = 'top';
    document.querySelectorAll('#expand-side-picker .esp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#expand-side-picker .esp-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _expandSelectedSide = btn.dataset.side;
        const label = document.getElementById('expand-count-label');
        if (label) label.textContent = (_expandSelectedSide === 'left' || _expandSelectedSide === 'right')
          ? 'Columns to add' : 'Rows to add';
      });
    });
    // Select top by default on open
    document.querySelector('#expand-side-picker .esp-btn-top')?.classList.add('selected');

    document.getElementById('btn-cancel-expand')?.addEventListener('click', () => {
      document.getElementById('modal-expand').classList.add('hidden');
    });
    document.getElementById('modal-expand')?.addEventListener('click', e => {
      if (e.target === e.currentTarget) document.getElementById('modal-expand').classList.add('hidden');
    });
    document.getElementById('btn-confirm-expand')?.addEventListener('click', () => {
      const count = parseInt(document.getElementById('expand-count').value) || 0;
      if (count < 1) { alert('Enter at least 1.'); return; }
      _expandCanvas(_expandSelectedSide, count);
      document.getElementById('modal-expand').classList.add('hidden');
    });

    document.getElementById('btn-pattern-print').addEventListener('click', () => {
      if (currentProject) CrochetApp.Export.toPDF(currentProject, currentPanel);
    });

    document.getElementById('btn-pattern-copy').addEventListener('click', () => {
      if (!currentProject) return;
      const lines = CrochetApp.Instructions.formatAll(currentProject);
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        const btn = document.getElementById('btn-pattern-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy All'; }, 1800);
      });
    });

    // Gauge inputs — recalculate dimensions and save on change
    ['gauge-stitches', 'gauge-rows'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        _updateDimensions();
        _saveGaugeFromModal();
      });
    });

    // ── Swatch calculator modal ────────────────────────────────────────────
    document.getElementById('btn-close-swatch').addEventListener('click', () => {
      document.getElementById('modal-swatch').classList.add('hidden');
    });

    document.getElementById('modal-swatch').addEventListener('click', e => {
      if (e.target === e.currentTarget)
        document.getElementById('modal-swatch').classList.add('hidden');
    });

    // Recalculate live on any input change
    ['swatch-w', 'swatch-h', 'swatch-stitches', 'swatch-rows', 'swatch-units'].forEach(id => {
      document.getElementById(id).addEventListener('input', _calcSwatch);
    });

    // Lock aspect ratio: target-w and target-h get special handlers
    document.getElementById('swatch-target-w').addEventListener('input', () => {
      _swatchLockScale('w');
      _calcSwatch();
    });
    document.getElementById('swatch-target-h').addEventListener('input', () => {
      _swatchLockScale('h');
      _calcSwatch();
    });

    document.getElementById('swatch-lock-ratio').addEventListener('change', () => {
      // Capture the current ratio whenever the lock is toggled on
      _swatchCaptureRatio();
    });

    document.getElementById('btn-swatch-apply-gauge').addEventListener('click', _swatchApplyGauge);
    document.getElementById('btn-swatch-apply-resize').addEventListener('click', _swatchApplyResize);
    document.getElementById('btn-swatch-apply-both').addEventListener('click', () => {
      _swatchApplyGauge();
      _swatchApplyResize();
    });

    // ── Keyboard shortcuts modal ───────────────────────────────────────────
    document.getElementById('btn-close-shortcuts').addEventListener('click', () => {
      document.getElementById('modal-shortcuts').classList.add('hidden');
    });

    document.getElementById('modal-shortcuts').addEventListener('click', e => {
      if (e.target === e.currentTarget)
        document.getElementById('modal-shortcuts').classList.add('hidden');
    });

    // ── Pattern repeat preview modal ───────────────────────────────────────
    document.getElementById('btn-close-repeat').addEventListener('click', () => {
      document.getElementById('modal-repeat').classList.add('hidden');
    });

    document.getElementById('modal-repeat').addEventListener('click', e => {
      if (e.target === e.currentTarget)
        document.getElementById('modal-repeat').classList.add('hidden');
    });

    let _repeatDebounce = null;
    ['repeat-x', 'repeat-y'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        clearTimeout(_repeatDebounce);
        _repeatDebounce = setTimeout(_renderRepeatPreview, 150);
      });
    });

    // ── New Project modal ──────────────────────────────────────────────────
    document.getElementById('btn-cancel-new-project')
      .addEventListener('click', _closeNewProjectModal);

    document.getElementById('btn-create-project')
      .addEventListener('click', _createProject);

    document.getElementById('modal-new-project')
      .addEventListener('click', e => {
        if (e.target === e.currentTarget) _closeNewProjectModal();
      });

    // Enter key to submit new project form
    ['new-project-name', 'new-project-width', 'new-project-height'].forEach(id => {
      document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') _createProject();
      });
    });

    // Unit selector events
    document.getElementById('new-project-unit')
      ?.addEventListener('change', _onNewProjectUnitChange);
    ['new-project-width', 'new-project-height', 'np-gauge-st', 'np-gauge-rows'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', _updateNewProjectStitchPreview);
    });

    // ── Color edit modal ───────────────────────────────────────────────────
    document.getElementById('btn-cancel-color').addEventListener('click', () => {
      document.getElementById('modal-color-edit').classList.add('hidden');
    });

    document.getElementById('btn-save-color').addEventListener('click', _saveColorEdit);

    document.getElementById('modal-color-edit')
      .addEventListener('click', e => {
        if (e.target === e.currentTarget)
          document.getElementById('modal-color-edit').classList.add('hidden');
      });

    document.getElementById('color-edit-label')
      .addEventListener('keydown', e => { if (e.key === 'Enter') _saveColorEdit(); });

    // ── Rename project modal ───────────────────────────────────────────────
    document.getElementById('btn-cancel-rename').addEventListener('click', () => {
      document.getElementById('modal-rename-project').classList.add('hidden');
    });

    document.getElementById('btn-confirm-rename').addEventListener('click', _renameProject);

    document.getElementById('rename-project-input')
      .addEventListener('keydown', e => { if (e.key === 'Enter') _renameProject(); });

    document.getElementById('modal-rename-project')
      .addEventListener('click', e => {
        if (e.target === e.currentTarget)
          document.getElementById('modal-rename-project').classList.add('hidden');
      });
  }

  // ── Panel tab bar ─────────────────────────────────────────────────────────

  function _renderPanelTabs() {
    const container = document.getElementById('panel-tabs');
    if (!container || !currentProject) return;

    const panels = currentProject.panels;
    container.innerHTML = '';

    panels.forEach(panel => {
      const tab = document.createElement('button');
      tab.className = 'panel-tab' + (panel.id === currentProject.activePanelId ? ' active' : '');
      tab.dataset.panelId = panel.id;
      tab.textContent = panel.name;
      tab.addEventListener('click', () => _setActivePanel(panel.id));

      if (panels.length > 1) {
        const del = document.createElement('span');
        del.className = 'panel-tab-close';
        del.textContent = 'x';
        del.title = 'Delete panel';
        del.addEventListener('click', e => { e.stopPropagation(); _deletePanel(panel.id); });
        tab.appendChild(del);
      }

      container.appendChild(tab);
    });

    // Add panel button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-panel';
    addBtn.textContent = '+';
    addBtn.title = 'Add panel';
    addBtn.addEventListener('click', _openAddPanelModal);
    container.appendChild(addBtn);
  }

  function _setActivePanel(panelId) {
    if (!currentProject) return;
    const panel = currentProject.panels.find(p => p.id === panelId);
    if (!panel) return;

    // Save current panel's undo/redo stacks
    _panelStacks[currentProject.activePanelId] = { undo: undoStack.slice(), redo: redoStack.slice() };

    // Switch
    currentProject.activePanelId = panelId;
    currentPanel = panel;
    undoStack = (_panelStacks[panelId] || {}).undo || [];
    redoStack = (_panelStacks[panelId] || {}).redo || [];

    // Exit shape-edit mode on panel switch
    if (shapeEditMode) _exitShapeEditMode();

    renderer.setPanel(currentPanel, currentProject.palette);
    paletteUI.setActivePanel(currentPanel);
    _renderPanelTabs();
    _updateStatusBar();
    _updateUndoRedoButtons();
    _clearSelection();
  }

  function _deletePanel(panelId) {
    if (!currentProject || currentProject.panels.length <= 1) {
      alert('A project must have at least one panel.');
      return;
    }
    const panel = currentProject.panels.find(p => p.id === panelId);
    if (!panel) return;
    if (!confirm('Delete panel "' + panel.name + '"? This cannot be undone.')) return;

    const idx = currentProject.panels.findIndex(p => p.id === panelId);
    currentProject.panels.splice(idx, 1);
    delete _panelStacks[panelId];

    // If we deleted the active panel, switch to nearest neighbour
    if (currentProject.activePanelId === panelId) {
      const next = currentProject.panels[Math.min(idx, currentProject.panels.length - 1)];
      currentProject.activePanelId = next.id;
      currentPanel = next;
      undoStack = [];
      redoStack = [];
      renderer.setPanel(currentPanel, currentProject.palette);
      paletteUI.setActivePanel(currentPanel);
    }

    _renderPanelTabs();
    _markDirty();
  }

  // ── Shape-edit mode ───────────────────────────────────────────────────────

  function toggleShapeEditMode() {
    if (shapeEditMode) _exitShapeEditMode();
    else               _enterShapeEditMode();
  }

  function _enterShapeEditMode() {
    shapeEditMode = true;
    renderer.shapeEditMode = true;
    renderer.render();
    document.getElementById('btn-shape-edit')?.classList.add('active');
    const badge = document.getElementById('shape-edit-badge');
    if (badge) badge.classList.remove('hidden');
  }

  function _exitShapeEditMode() {
    shapeEditMode = false;
    renderer.shapeEditMode = false;
    renderer.render();
    document.getElementById('btn-shape-edit')?.classList.remove('active');
    const badge = document.getElementById('shape-edit-badge');
    if (badge) badge.classList.add('hidden');
  }

  // ── Layout view ───────────────────────────────────────────────────────────

  function openLayoutView() {
    if (!currentProject) return;
    const modal = document.getElementById('modal-layout');
    if (!modal) return;
    const container = modal.querySelector('.layout-panels');
    if (!container) return;
    container.innerHTML = '';

    currentProject.panels.forEach(panel => {
      const block = document.createElement('div');
      block.className = 'layout-panel-block' + (panel.id === currentProject.activePanelId ? ' active' : '');

      const label = document.createElement('div');
      label.className = 'layout-panel-label';
      label.textContent = panel.name + ' (' + panel.grid.width + 'x' + panel.grid.height + ')';

      const cvs = document.createElement('canvas');
      cvs.className = 'layout-panel-canvas';
      cvs.width  = 120;
      cvs.height = 120;
      _drawPanelThumbnail(cvs, panel);

      cvs.addEventListener('click', () => {
        modal.classList.add('hidden');
        _setActivePanel(panel.id);
      });

      block.appendChild(label);
      block.appendChild(cvs);
      container.appendChild(block);
    });

    modal.classList.remove('hidden');
  }

  function _drawPanelThumbnail(canvas, panel) {
    const ctx  = canvas.getContext('2d');
    const { width, height, cells, mask } = panel.grid;
    const cw   = canvas.width  / width;
    const ch   = canvas.height / height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx   = row * width + col;
        const ci    = cells[idx];
        const inMask = !mask || mask[idx] === 1;
        if (!inMask) {
          ctx.fillStyle = '#aaa';
        } else if (ci !== CrochetApp.EMPTY_CELL && currentProject.palette[ci]) {
          ctx.fillStyle = currentProject.palette[ci].hex;
        } else {
          ctx.fillStyle = '#fff';
        }
        ctx.fillRect(col * cw, row * ch, cw, ch);
      }
    }
  }

  // ── Add Panel modal ───────────────────────────────────────────────────────

  function _openAddPanelModal() {
    const modal = document.getElementById('modal-add-panel');
    if (!modal) return;
    _selectedAddPanelShapeId = 'blank';
    const container = modal.querySelector('#add-panel-shape-picker');
    if (container) {
      _renderShapePicker(container, id => { _selectedAddPanelShapeId = id; }, 'blank');
    }
    document.getElementById('add-panel-name').value = 'Panel ' + (currentProject.panels.length + 1);

    // Pre-fill size from current panel
    if (currentPanel) {
      document.getElementById('add-panel-width').value  = currentPanel.grid.width;
      document.getElementById('add-panel-height').value = currentPanel.grid.height;
    }

    // Reset copy checkbox
    const copyChk  = document.getElementById('add-panel-copy-canvas');
    const copyNote = document.getElementById('add-panel-copy-note');
    if (copyChk) copyChk.checked = false;
    if (copyNote) copyNote.classList.add('hidden');
    _updateAddPanelCopyState();

    modal.classList.remove('hidden');
  }

  function _updateAddPanelCopyState() {
    const checked   = document.getElementById('add-panel-copy-canvas')?.checked ?? false;
    const copyNote  = document.getElementById('add-panel-copy-note');
    const wInput    = document.getElementById('add-panel-width');
    const hInput    = document.getElementById('add-panel-height');
    const shapePicker = document.getElementById('add-panel-shape-picker');

    if (copyNote)    copyNote.classList.toggle('hidden', !checked);
    if (wInput)      wInput.disabled = checked;
    if (hInput)      hInput.disabled = checked;
    // When copying, shape picker is irrelevant — dim it
    if (shapePicker) shapePicker.style.opacity = checked ? '0.4' : '1';
    if (shapePicker) shapePicker.style.pointerEvents = checked ? 'none' : '';

    if (checked && currentPanel) {
      if (wInput) wInput.value = currentPanel.grid.width;
      if (hInput) hInput.value = currentPanel.grid.height;
    }
  }

  function _confirmAddPanel() {
    const modal      = document.getElementById('modal-add-panel');
    const name       = document.getElementById('add-panel-name').value.trim() || ('Panel ' + (currentProject.panels.length + 1));
    const copyCanvas = document.getElementById('add-panel-copy-canvas')?.checked ?? false;
    const shapeId    = _selectedAddPanelShapeId || 'blank';

    let width, height, mask, cells;

    if (copyCanvas && currentPanel) {
      // Use the current panel's exact dimensions and copy its cells + mask
      width  = currentPanel.grid.width;
      height = currentPanel.grid.height;
      cells  = currentPanel.grid.cells.slice();
      mask   = currentPanel.grid.mask ? currentPanel.grid.mask.slice() : null;
    } else {
      width  = parseInt(document.getElementById('add-panel-width').value)  || 40;
      height = parseInt(document.getElementById('add-panel-height').value) || 50;
      if (shapeId !== 'blank') {
        mask = CrochetApp.Templates.generateMask(shapeId, width, height);
      }
    }

    const panel = CrochetApp._createPanel({ name, shapeId: copyCanvas ? (currentPanel?.shapeId || 'blank') : shapeId, width, height, mask });

    // Overwrite the freshly-created blank cells with the copied ones
    if (copyCanvas && cells) {
      panel.grid.cells = cells;
    }

    currentProject.panels.push(panel);
    if (modal) modal.classList.add('hidden');

    _setActivePanel(panel.id);
    _markDirty();
  }

  function _bindPanelModalEvents() {
    // Add panel modal
    const addModal = document.getElementById('modal-add-panel');
    if (addModal) {
      const confirm = document.getElementById('btn-confirm-add-panel');
      if (confirm) confirm.addEventListener('click', _confirmAddPanel);

      const cancel = document.getElementById('btn-cancel-add-panel');
      if (cancel) cancel.addEventListener('click', () => addModal.classList.add('hidden'));

      addModal.addEventListener('click', e => {
        if (e.target === e.currentTarget) addModal.classList.add('hidden');
      });

      document.getElementById('add-panel-copy-canvas')
        ?.addEventListener('change', _updateAddPanelCopyState);
    }

    // Layout view modal close
    const layoutModal = document.getElementById('modal-layout');
    if (layoutModal) {
      const closeBtn = document.getElementById('btn-close-layout');
      if (closeBtn) closeBtn.addEventListener('click', () => layoutModal.classList.add('hidden'));
      layoutModal.addEventListener('click', e => {
        if (e.target === e.currentTarget) layoutModal.classList.add('hidden');
      });
    }
  }

  // ── Garment / shape picker helpers ────────────────────────────────────────

  function _renderShapePicker(container, onSelect, initial) {
    initial = initial || 'blank';
    container.innerHTML = '';
    const shapes = [
      { id: 'blank',           label: 'Blank' },
      { id: 'vest-front',      label: 'Vest Front' },
      { id: 'vest-back',       label: 'Vest Back' },
      { id: 'sweater-front',   label: 'Sweater Front' },
      { id: 'sweater-back',    label: 'Sweater Back' },
      { id: 'sleeve',          label: 'Sleeve' },
      { id: 'dress',           label: 'Dress' },
      { id: 'cardigan-front',  label: 'Cardigan Front' },
      { id: 'beanie',          label: 'Beanie' },
      { id: 'tote-panel',      label: 'Tote Bag' },
      { id: 'scarf',           label: 'Scarf' },
    ];
    shapes.forEach(shape => {
      const card = document.createElement('div');
      card.className = 'garment-card' + (shape.id === initial ? ' selected' : '');
      card.dataset.id = shape.id;
      card.textContent = shape.label;
      card.addEventListener('click', () => {
        container.querySelectorAll('.garment-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        onSelect(shape.id);
      });
      container.appendChild(card);
    });
  }

  function _renderGarmentPicker() {
    const container = document.getElementById('garment-picker');
    if (!container) return;
    const garments = CrochetApp.Templates ? CrochetApp.Templates.GARMENTS : [];
    container.innerHTML = '';
    garments.forEach(g => {
      const card = document.createElement('div');
      card.className = 'garment-card' + (g.id === _selectedGarmentId ? ' selected' : '');
      card.dataset.id = g.id;
      card.textContent = g.label;
      card.addEventListener('click', () => {
        container.querySelectorAll('.garment-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _selectedGarmentId = g.id;
        // Toggle blank-size-fields visibility
        const sizeFields = document.getElementById('blank-size-fields');
        if (sizeFields) {
          sizeFields.classList.toggle('hidden', g.id !== 'blank');
        }
        // Show panel preview
        const preview = document.getElementById('garment-panel-preview');
        if (preview) {
          if (g.id !== 'blank' && g.panels) {
            const names = g.panels.map(p => p.name).join(', ');
            preview.textContent = 'Panels: ' + names;
            preview.classList.remove('hidden');
          } else {
            preview.textContent = '';
            preview.classList.add('hidden');
          }
        }
      });
      container.appendChild(card);
    });
  }

  // ── Dark mode ────────────────────────────────────────────────────────────

  function _initDarkMode() {
    if (localStorage.getItem('darkMode') === '1') {
      document.body.classList.add('dark');
      _updateDarkToggleIcons();
    }
  }

  function toggleDarkMode() {
    document.body.classList.toggle('dark');
    localStorage.setItem('darkMode', document.body.classList.contains('dark') ? '1' : '0');
    _updateDarkToggleIcons();
  }

  function _updateDarkToggleIcons() {
    const isDark = document.body.classList.contains('dark');
    document.querySelectorAll('.btn-dark-toggle').forEach(btn => {
      btn.textContent = isDark ? '☀' : '☾';
      btn.title       = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  // ── Auto-save ─────────────────────────────────────────────────────────────

  function _startAutoSave() {
    setInterval(async () => {
      if (!isDirty || !currentProject) return;
      await saveProject();
      _showAutoSaveToast();
    }, 60_000);
  }

  function _showAutoSaveToast() {
    let toast = document.getElementById('autosave-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id        = 'autosave-toast';
      toast.className = 'autosave-toast';
      toast.textContent = '✓ Auto-saved';
      document.body.appendChild(toast);
    }
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ── Keyboard shortcut overlay ─────────────────────────────────────────────

  function openShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.remove('hidden');
  }

  // ── Pattern repeat preview ────────────────────────────────────────────────

  function openRepeatPreview() {
    if (!currentProject) return;
    document.getElementById('modal-repeat').classList.remove('hidden');
    _renderRepeatPreview();
  }

  function _renderRepeatPreview() {
    if (!currentProject) return;
    const repeatX = Math.max(1, Math.min(10, parseInt(document.getElementById('repeat-x').value) || 3));
    const repeatY = Math.max(1, Math.min(10, parseInt(document.getElementById('repeat-y').value) || 3));
    const { width, height, cells } = currentPanel.grid;
    const palette = currentProject.palette;

    const wrap    = document.querySelector('.repeat-canvas-wrap');
    const canvas  = document.getElementById('repeat-canvas');
    const maxW    = (wrap.clientWidth  || 760) - 24;
    const maxH    = (wrap.clientHeight || 400) - 24;
    const cellSize = Math.max(2, Math.min(
      Math.floor(maxW / (width  * repeatX)),
      Math.floor(maxH / (height * repeatY)),
      16
    ));

    const totalW = width  * repeatX * cellSize;
    const totalH = height * repeatY * cellSize;
    canvas.width  = totalW;
    canvas.height = totalH;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, totalW, totalH);

    for (let ry = 0; ry < repeatY; ry++) {
      for (let rx = 0; rx < repeatX; rx++) {
        for (let row = 0; row < height; row++) {
          for (let col = 0; col < width; col++) {
            const idx = cells[row * width + col];
            if (idx === CrochetApp.EMPTY_CELL) continue;
            ctx.fillStyle = palette[idx]?.hex ?? '#fff';
            ctx.fillRect(
              (rx * width  + col) * cellSize,
              (ry * height + row) * cellSize,
              cellSize, cellSize
            );
          }
        }
      }
    }

    // Repeat boundary lines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 1;
    for (let rx = 1; rx < repeatX; rx++) {
      const x = rx * width * cellSize + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, totalH); ctx.stroke();
    }
    for (let ry = 1; ry < repeatY; ry++) {
      const y = ry * height * cellSize + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(totalW, y); ctx.stroke();
    }

    // Grid lines within each cell when large enough
    if (cellSize >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth   = 0.5;
      ctx.beginPath();
      for (let col = 0; col <= width * repeatX; col++) {
        const x = col * cellSize + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, totalH);
      }
      for (let row = 0; row <= height * repeatY; row++) {
        const y = row * cellSize + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(totalW, y);
      }
      ctx.stroke();
    }
  }

  // ── Swatch Calculator ────────────────────────────────────────────────────

  function openSwatchCalc() {
    // Pre-populate target size from current project, if open
    if (currentProject) {
      const gauge = currentProject.gauge;
      // Back-calculate a reasonable swatch from the project's saved gauge
      // Only do this if the modal hasn't been touched yet (inputs at defaults)
      const stW = parseFloat(document.getElementById('swatch-w').value)       || 4;
      const stSt = parseInt(document.getElementById('swatch-stitches').value) || 16;
      if (stW === 4 && stSt === 16) {
        // First open: seed inputs from project gauge so the user sees sane defaults
        const spi = gauge.stitchesPerInch || 4;
        const rpi = gauge.rowsPerInch     || 5;
        document.getElementById('swatch-stitches').value = Math.round(spi * 4);
        document.getElementById('swatch-rows').value     = Math.round(rpi * 4);
      }
      document.getElementById('swatch-target-w').value = 12;
      document.getElementById('swatch-target-h').value = 14;
    }
    _calcSwatch();
    _swatchCaptureRatio(); // initialize lock ratio from current values
    document.getElementById('modal-swatch').classList.remove('hidden');
  }

  /**
   * Reads all swatch inputs, computes gauge + grid dimensions, and updates
   * the display. Called on every input event inside the modal.
   */
  function _calcSwatch() {
    const units   = document.getElementById('swatch-units').value; // 'in' | 'cm'
    const cmPerIn = 2.54;

    // Raw swatch measurements
    const swatchW  = parseFloat(document.getElementById('swatch-w').value)    || 0;
    const swatchH  = parseFloat(document.getElementById('swatch-h').value)    || 0;
    const stitches = parseInt(document.getElementById('swatch-stitches').value) || 0;
    const rows     = parseInt(document.getElementById('swatch-rows').value)     || 0;

    // Convert to inches for internal calculations
    const wIn = units === 'cm' ? swatchW / cmPerIn : swatchW;
    const hIn = units === 'cm' ? swatchH / cmPerIn : swatchH;

    // Update all unit labels
    document.querySelectorAll('[data-unit-label]').forEach(el => {
      el.textContent = units === 'cm' ? 'cm' : 'in';
    });

    const gaugeBox = document.getElementById('swatch-gauge-box');

    // Validate
    if (wIn <= 0 || hIn <= 0 || stitches <= 0 || rows <= 0) {
      gaugeBox.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Enter swatch dimensions and stitch counts above.</span>';
      document.getElementById('swatch-out-cols').textContent = '—';
      document.getElementById('swatch-out-rows').textContent = '—';
      document.getElementById('swatch-note').textContent = '';
      return;
    }

    const spi = stitches / wIn;  // stitches per inch
    const rpi = rows     / hIn;  // rows per inch
    const ratio = rpi / spi;     // cell aspect ratio (>1 means cells taller than wide)

    // Display gauge
    const fmtN = n => Number.isFinite(n) ? n.toFixed(2) : '—';
    gaugeBox.innerHTML = `
      <div class="swatch-gauge-stat">
        <span class="swatch-gauge-num">${fmtN(spi)}</span>
        <span class="swatch-gauge-desc">stitches / inch</span>
      </div>
      <div class="swatch-gauge-sep"></div>
      <div class="swatch-gauge-stat">
        <span class="swatch-gauge-num">${fmtN(rpi)}</span>
        <span class="swatch-gauge-desc">rows / inch</span>
      </div>
      <div class="swatch-gauge-sep"></div>
      <div class="swatch-gauge-stat">
        <span class="swatch-gauge-num">${fmtN(ratio)}</span>
        <span class="swatch-gauge-desc">stitch aspect<br>(rows ÷ sts / in)</span>
      </div>`;

    // Step 2 — target finished size
    const targetW = parseFloat(document.getElementById('swatch-target-w').value) || 0;
    const targetH = parseFloat(document.getElementById('swatch-target-h').value) || 0;
    const tWin    = units === 'cm' ? targetW / cmPerIn : targetW;
    const tHin    = units === 'cm' ? targetH / cmPerIn : targetH;

    const outCols = tWin > 0 ? Math.round(tWin * spi) : 0;
    const outRows = tHin > 0 ? Math.round(tHin * rpi) : 0;

    document.getElementById('swatch-out-cols').textContent = outCols > 0 ? outCols : '—';
    document.getElementById('swatch-out-rows').textContent = outRows > 0 ? outRows : '—';

    // Warn if dimensions are out of range
    const noteEl = document.getElementById('swatch-note');
    const maxDim = 300;
    if (outCols > maxDim || outRows > maxDim) {
      noteEl.className = 'swatch-note warn';
      noteEl.textContent = `Grid maximum is ${maxDim} × ${maxDim}. Reduce your finished size or adjust the swatch.`;
    } else if (outCols > 0 && outRows > 0) {
      noteEl.className = 'swatch-note';
      noteEl.textContent = `Grid will be ${outCols} × ${outRows} stitches. Stitch aspect ratio ${fmtN(ratio)} (1.00 = perfect square).`;
    } else {
      noteEl.className = 'swatch-note';
      noteEl.textContent = '';
    }

    // Cache calculated gauge on the modal element for use by apply buttons
    const modal = document.getElementById('modal-swatch');
    modal._gaugeResult  = { stitchesPerInch: spi, rowsPerInch: rpi };
    modal._gridResult   = { width: outCols, height: outRows };
  }

  function _swatchApplyGauge() {
    if (!currentProject) return;
    const modal = document.getElementById('modal-swatch');
    const g = modal._gaugeResult;
    if (!g || !g.stitchesPerInch) return;

    currentProject.gauge.stitchesPerInch = parseFloat(g.stitchesPerInch.toFixed(4));
    currentProject.gauge.rowsPerInch     = parseFloat(g.rowsPerInch.toFixed(4));
    _markDirty();

    // Update aspect ratio preview if it's on
    if (aspectRatioOn) {
      renderer.setAspectRatio(CrochetApp.Instructions.cellAspectRatio(currentProject.gauge));
      renderer.render();
    }
    _flashStatus('Gauge applied!');
  }

  function _swatchApplyResize() {
    if (!currentProject) return;
    const modal  = document.getElementById('modal-swatch');
    const dims   = modal._gridResult;
    if (!dims || dims.width <= 0 || dims.height <= 0) {
      alert('Please complete Step 2 with a valid finished size before resizing.');
      return;
    }
    const maxDim = 300;
    if (dims.width > maxDim || dims.height > maxDim) {
      alert(`Grid dimensions ${dims.width} × ${dims.height} exceed the ${maxDim} × ${maxDim} maximum. Reduce your finished size.`);
      return;
    }
    if (!confirm(`Resize panel "${currentPanel.name}" from ${currentPanel.grid.width} × ${currentPanel.grid.height} to ${dims.width} × ${dims.height}? The design will be scaled to fit.`)) return;

    _resizeGrid(dims.width, dims.height);
    _flashStatus(`Resized to ${dims.width} × ${dims.height}`);
  }

  /**
   * Resize the current project grid, scaling the existing design to fill the
   * new dimensions using nearest-neighbor sampling so no work is lost.
   */
  function _resizeGrid(newW, newH) {
    const { width: oldW, height: oldH, cells: oldCells } = currentPanel.grid;

    undoStack.push({
      cells:   oldCells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   oldW,
      height:  oldH,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];

    // Nearest-neighbor scale: design stretches to fill the new dimensions
    const newCells = new Uint8Array(newW * newH);
    for (let row = 0; row < newH; row++) {
      const srcRow = Math.floor(row * oldH / newH);
      for (let col = 0; col < newW; col++) {
        newCells[row * newW + col] = oldCells[Math.floor(col * oldW / newW) + srcRow * oldW];
      }
    }

    // Also scale the mask proportionally if one exists
    if (currentPanel.grid.mask) {
      const oldMask = currentPanel.grid.mask;
      const newMask = new Uint8Array(newW * newH).fill(1);
      for (let row = 0; row < newH; row++) {
        const srcRow = Math.floor(row * oldH / newH);
        for (let col = 0; col < newW; col++) {
          newMask[row * newW + col] = oldMask[Math.floor(col * oldW / newW) + srcRow * oldW];
        }
      }
      currentPanel.grid.mask = newMask;
    }

    currentPanel.grid.width  = newW;
    currentPanel.grid.height = newH;
    currentPanel.grid.cells  = newCells;

    renderer.setPanel(currentPanel, currentProject.palette);
    paletteUI.updateCounts();
    _markDirty();
    _updateUndoRedoButtons();
    _updateStatusBar();
  }

  function _openExpandModal() {
    if (!currentProject) return;
    document.querySelectorAll('#expand-side-picker .esp-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector('#expand-side-picker .esp-btn-top')?.classList.add('selected');
    const label = document.getElementById('expand-count-label');
    if (label) label.textContent = 'Rows to add';
    document.getElementById('expand-count').value = 5;
    document.getElementById('modal-expand').classList.remove('hidden');
  }

  function _expandCanvas(side, count) {
    if (!currentPanel || count < 1) return;
    const { width: oldW, height: oldH, cells: oldCells, mask: oldMask } = currentPanel.grid;
    let newW = oldW, newH = oldH, offsetCol = 0, offsetRow = 0;
    if (side === 'top')    { newH += count; offsetRow = count; }
    if (side === 'bottom') { newH += count; }
    if (side === 'left')   { newW += count; offsetCol = count; }
    if (side === 'right')  { newW += count; }

    undoStack.push({
      cells:   oldCells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   oldW,
      height:  oldH,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];

    const newCells = new Uint8Array(newW * newH).fill(CrochetApp.EMPTY_CELL);
    for (let r = 0; r < oldH; r++) {
      for (let c = 0; c < oldW; c++) {
        newCells[(r + offsetRow) * newW + (c + offsetCol)] = oldCells[r * oldW + c];
      }
    }

    let newMask = null;
    if (oldMask) {
      newMask = new Uint8Array(newW * newH).fill(0);
      for (let r = 0; r < oldH; r++) {
        for (let c = 0; c < oldW; c++) {
          newMask[(r + offsetRow) * newW + (c + offsetCol)] = oldMask[r * oldW + c];
        }
      }
    }

    currentPanel.grid.width  = newW;
    currentPanel.grid.height = newH;
    currentPanel.grid.cells  = newCells;
    if (newMask !== null) currentPanel.grid.mask = newMask;

    renderer.setPanel(currentPanel, currentProject.palette);
    paletteUI.updateCounts();
    _markDirty();
    _updateUndoRedoButtons();
    _updateStatusBar();
    const unit = (side === 'left' || side === 'right') ? 'columns' : 'rows';
    _flashStatus(`Expanded ${side}: +${count} ${unit}`);
  }

  // ── Swatch aspect-ratio lock ──────────────────────────────────────────────

  let _swatchAspectRatio = 1;
  let _swatchLocking     = false;

  function _swatchCaptureRatio() {
    const w = parseFloat(document.getElementById('swatch-target-w').value) || 0;
    const h = parseFloat(document.getElementById('swatch-target-h').value) || 0;
    if (w > 0 && h > 0) _swatchAspectRatio = h / w;
  }

  function _swatchLockScale(changed) {
    if (!document.getElementById('swatch-lock-ratio')?.checked) return;
    if (_swatchLocking) return;
    _swatchLocking = true;
    if (changed === 'w') {
      const w = parseFloat(document.getElementById('swatch-target-w').value) || 0;
      if (w > 0) document.getElementById('swatch-target-h').value = (w * _swatchAspectRatio).toFixed(1);
    } else {
      const h = parseFloat(document.getElementById('swatch-target-h').value) || 0;
      if (h > 0) document.getElementById('swatch-target-w').value = (h / _swatchAspectRatio).toFixed(1);
    }
    _swatchLocking = false;
  }

  // ── Shaping analysis ──────────────────────────────────────────────────────

  function _analyzeShaping(panel) {
    const { width, height, cells, mask } = panel.grid;
    const rows = [];
    for (let gridRow = height - 1; gridRow >= 0; gridRow--) {
      const displayRow = height - gridRow;
      let leftEdge = -1, rightEdge = -1, count = 0;
      for (let col = 0; col < width; col++) {
        const idx    = gridRow * width + col;
        const active = mask
          ? mask[idx] === 1
          : cells[idx] !== CrochetApp.EMPTY_CELL;
        if (active) {
          if (leftEdge === -1) leftEdge = col;
          rightEdge = col;
          count++;
        }
      }
      rows.push({ displayRow, gridRow, leftEdge, rightEdge, count });
    }
    return rows.map((curr, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      if (!prev || curr.count === 0) {
        return { ...curr, change: 0, leftChange: 0, rightChange: 0, action: '' };
      }
      const leftChange  = (prev.leftEdge  !== -1 && curr.leftEdge  !== -1) ? prev.leftEdge  - curr.leftEdge  : 0;
      const rightChange = (curr.rightEdge !== -1 && prev.rightEdge !== -1) ? curr.rightEdge - prev.rightEdge : 0;
      const change      = curr.count - prev.count;
      let action = '';
      if (change > 0) {
        if (leftChange > 0 && rightChange > 0)
          action = `inc ${change} (${leftChange} left, ${rightChange} right)`;
        else if (leftChange > 0) action = `inc ${change} at left`;
        else if (rightChange > 0) action = `inc ${change} at right`;
        else action = `inc ${change}`;
      } else if (change < 0) {
        const dec = -change;
        if (leftChange < 0 && rightChange < 0)
          action = `dec ${dec} (${-leftChange} left, ${-rightChange} right)`;
        else if (leftChange < 0) action = `dec ${dec} at left`;
        else if (rightChange < 0) action = `dec ${dec} at right`;
        else action = `dec ${dec}`;
      }
      return { ...curr, change, leftChange, rightChange, action };
    });
  }

  function _renderShapingTab() {
    if (!currentPanel) return;
    const changesOnly = document.getElementById('shaping-changes-only')?.checked ?? true;
    const rows        = _analyzeShaping(currentPanel);
    const tbody       = document.getElementById('shaping-tbody');
    const meta        = document.getElementById('shaping-meta');
    if (!tbody) return;
    const shapingRows = rows.filter(r => r.action !== '');
    meta.textContent  = `${rows.length} rows total · ${shapingRows.length} rows require shaping`;
    const display = changesOnly ? shapingRows : rows;
    if (display.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No shaping required.</td></tr>';
      return;
    }
    tbody.innerHTML = display.map(r => {
      const changeStr = r.change === 0 ? '' : (r.change > 0 ? '+' + r.change : String(r.change));
      const cls = r.change > 0 ? 'shaping-inc' : r.change < 0 ? 'shaping-dec' : '';
      return `<tr class="${cls}">
        <td>Row ${r.displayRow}</td>
        <td>${r.count > 0 ? r.count : '—'}</td>
        <td>${changeStr}</td>
        <td>${r.action || 'no change'}</td>
      </tr>`;
    }).join('');
  }

  // ── Image import ─────────────────────────────────────────────────────────

  // State local to the import modal
  const _importState = {
    img:         null,   // loaded HTMLImageElement
    naturalW:    0,
    naturalH:    0,
    lastResult:  null,   // { palette, cells } from most recent process() call
    debounceId:  null,
  };

  function _bindImportEvents() {
    document.getElementById('btn-import-image')
      .addEventListener('click', _openImportModal);

    document.getElementById('btn-close-import')
      .addEventListener('click', _closeImportModal);

    document.getElementById('modal-import')
      .addEventListener('click', e => { if (e.target === e.currentTarget) _closeImportModal(); });

    // File input
    document.getElementById('import-file-input')
      .addEventListener('change', e => {
        if (e.target.files[0]) _loadImportFile(e.target.files[0]);
      });

    // Drag & drop on the drop zone
    const dz = document.getElementById('import-dropzone');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) _loadImportFile(file);
    });

    // Controls — live preview with debounce
    ['import-width', 'import-height', 'import-dither'].forEach(id => {
      document.getElementById(id).addEventListener('input', _schedulePreviewUpdate);
    });

    document.getElementById('import-colors-range').addEventListener('input', e => {
      document.getElementById('import-colors-val').textContent = e.target.value;
      _schedulePreviewUpdate();
    });

    // Lock aspect ratio: when width changes, update height and vice versa
    document.getElementById('import-width').addEventListener('input', () => {
      if (!document.getElementById('import-lock-ratio').checked) return;
      const w = parseInt(document.getElementById('import-width').value) || 1;
      const ratio = _importState.naturalH / _importState.naturalW;
      document.getElementById('import-height').value = Math.max(5, Math.round(w * ratio));
    });
    document.getElementById('import-height').addEventListener('input', () => {
      if (!document.getElementById('import-lock-ratio').checked) return;
      const h = parseInt(document.getElementById('import-height').value) || 1;
      const ratio = _importState.naturalW / _importState.naturalH;
      document.getElementById('import-width').value = Math.max(5, Math.round(h * ratio));
    });

    // Fit-to-canvas toggle
    document.getElementById('import-fit-canvas').addEventListener('change', e => {
      _applyFitCanvasToggle(e.target.checked);
      if (_importState.img) _schedulePreviewUpdate();
    });

    // Reset → go back to drop zone
    document.getElementById('btn-import-reset').addEventListener('click', () => {
      _importState.img = null;
      document.getElementById('import-dropzone').classList.remove('hidden');
      document.getElementById('import-editor').classList.add('hidden');
      document.getElementById('import-file-input').value = '';
    });

    // Apply to grid
    document.getElementById('btn-import-apply').addEventListener('click', _applyImportToGrid);
  }

  function _openImportModal() {
    if (!currentProject) return;
    const { width, height } = currentPanel.grid;

    // Update the "Fit to canvas" label with live project dimensions
    document.getElementById('import-fit-dims').textContent = `${width} × ${height}`;

    // Pre-fill dimension inputs from the project
    document.getElementById('import-width').value  = width;
    document.getElementById('import-height').value = height;

    // Apply locked state based on current toggle value
    _applyFitCanvasToggle(document.getElementById('import-fit-canvas').checked);

    // Reset to drop zone view
    _importState.img = null;
    document.getElementById('import-dropzone').classList.remove('hidden');
    document.getElementById('import-editor').classList.add('hidden');
    document.getElementById('import-file-input').value = '';
    document.getElementById('modal-import').classList.remove('hidden');
  }

  /**
   * Lock or unlock the dimension inputs based on the "Fit to canvas" toggle.
   * When locked: inputs are pinned to the current project grid size.
   * When unlocked: inputs are free and auto-ratio applies on image load.
   */
  function _applyFitCanvasToggle(locked) {
    const row = document.querySelector('.import-controls-row');
    row.classList.toggle('is-locked', locked);

    if (locked && currentPanel) {
      document.getElementById('import-width').value  = currentPanel.grid.width;
      document.getElementById('import-height').value = currentPanel.grid.height;
    }
  }

  function _closeImportModal() {
    document.getElementById('modal-import').classList.add('hidden');
  }

  async function _loadImportFile(file) {
    try {
      const img = await CrochetApp.ImageImport.loadFile(file);
      _importState.img      = img;
      _importState.naturalW = img.naturalWidth;
      _importState.naturalH = img.naturalHeight;

      // When "Fit to canvas" is ON, keep the locked project dimensions as-is.
      // Otherwise auto-size the grid to the image's natural aspect ratio.
      const fitLocked = document.getElementById('import-fit-canvas').checked;
      if (!fitLocked) {
        const maxDim = 300;
        let gridW = Math.max(5, Math.min(maxDim,
          parseInt(document.getElementById('import-width').value) || 50));
        let gridH = Math.max(5, Math.round(gridW * img.naturalHeight / img.naturalWidth));

        if (gridH > maxDim) {
          gridH = maxDim;
          gridW = Math.max(5, Math.round(gridH * img.naturalWidth / img.naturalHeight));
        }

        document.getElementById('import-width').value  = gridW;
        document.getElementById('import-height').value = gridH;
        document.getElementById('import-lock-ratio').checked = true;
      }

      // Show original preview
      const origCanvas = document.getElementById('import-canvas-original');
      origCanvas.width  = img.naturalWidth;
      origCanvas.height = img.naturalHeight;
      origCanvas.getContext('2d').drawImage(img, 0, 0);

      // Switch to editor view
      document.getElementById('import-dropzone').classList.add('hidden');
      document.getElementById('import-editor').classList.remove('hidden');

      // Wait one frame so the browser has laid out the original canvas before
      // we measure it and size the preview canvas to match.
      requestAnimationFrame(_runPreviewUpdate);
    } catch (err) {
      alert('Could not load image: ' + err.message);
    }
  }

  function _schedulePreviewUpdate() {
    clearTimeout(_importState.debounceId);
    _importState.debounceId = setTimeout(_runPreviewUpdate, 180);
  }

  function _runPreviewUpdate() {
    const img = _importState.img;
    if (!img) return;

    const w         = Math.max(5, Math.min(300, parseInt(document.getElementById('import-width').value)  || 50));
    const h         = Math.max(5, Math.min(300, parseInt(document.getElementById('import-height').value) || 50));
    const numColors = parseInt(document.getElementById('import-colors-range').value) || 8;
    const dithering = document.getElementById('import-dither').value === 'floyd';

    const result = CrochetApp.ImageImport.process(img, { width: w, height: h, numColors, dithering });
    _importState.lastResult = result;

    // Render preview canvas
    const previewCanvas = document.getElementById('import-canvas-preview');
    CrochetApp.ImageImport.renderPreview(previewCanvas, result.palette, result.cells, w, h);

    document.getElementById('import-preview-dims').textContent = `(${w} × ${h})`;

    // Size the preview canvas to match the original canvas's rendered CSS dimensions
    // so both panels appear the same size regardless of grid resolution.
    const origCanvas = document.getElementById('import-canvas-original');
    const rect = origCanvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      previewCanvas.style.width  = rect.width  + 'px';
      previewCanvas.style.height = rect.height + 'px';
    }
  }

  function _applyImportToGrid() {
    if (!currentProject || !_importState.lastResult) return;

    const { palette, cells } = _importState.lastResult;
    const w = parseInt(document.getElementById('import-width').value)  || currentPanel.grid.width;
    const h = parseInt(document.getElementById('import-height').value) || currentPanel.grid.height;

    undoStack.push({
      cells:   currentPanel.grid.cells.slice(),
      palette: JSON.parse(JSON.stringify(currentProject.palette)),
      width:   currentPanel.grid.width,
      height:  currentPanel.grid.height,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];

    currentPanel.grid.width  = w;
    currentPanel.grid.height = h;
    currentPanel.grid.cells  = cells.slice();
    currentProject.palette   = palette;

    paletteUI.setProject(currentProject);
    renderer.setPanel(currentPanel, currentProject.palette);
    _markDirty();
    _updateUndoRedoButtons();
    _closeImportModal();
  }

  function _bindKeyboardShortcuts() {
    window.addEventListener('keydown', e => {
      // Skip if focus is in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Undo / redo
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); return; }

      // Save
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveProject(); return; }

      // Copy / paste (only in editor)
      if (e.ctrlKey && e.key === 'c') { e.preventDefault(); copySelection(); return; }
      if (e.ctrlKey && e.key === 'v') { e.preventDefault(); pasteClipboard(); return; }

      // Tool shortcuts
      if (!e.ctrlKey && !e.altKey) {
        if (e.key === 'p' || e.key === 'P') setTool('pencil');
        if (e.key === 'e' || e.key === 'E') setTool('eraser');
        if (e.key === 'b' || e.key === 'B') setTool('fill');
        if (e.key === 'i' || e.key === 'I') setTool('eyedropper');
        if (e.key === 's' || e.key === 'S') setTool('select');
        if (e.key === 'h' || e.key === 'H') flipHorizontal();
        if (e.key === 'v' || e.key === 'V') flipVertical();

        // Delete / backspace clears selected cells
        if ((e.key === 'Delete' || e.key === 'Backspace') && activeSelection) {
          e.preventDefault();
          deleteSelection();
        }

        // Reading mode navigation
        if (readingModeOn) {
          if (e.key === 'ArrowUp')   { e.preventDefault(); readingModePrev(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); readingModeNext(); }
        }

        // Zoom
        if (e.key === '+' || e.key === '=') {
          if (renderer) { renderer.zoom(1.25, renderer.canvas.width / 2, renderer.canvas.height / 2); _updateStatusBar(); }
        }
        if (e.key === '-') {
          if (renderer) { renderer.zoom(0.8, renderer.canvas.width / 2, renderer.canvas.height / 2); _updateStatusBar(); }
        }
        if (e.key === '0') {
          if (renderer) { renderer.centerView(); renderer.render(); _updateStatusBar(); }
        }

        // Escape — close modal, exit reading mode, or clear selection
        if (e.key === 'Escape') {
          const openModal = document.querySelector('.modal-overlay:not(.hidden)');
          if (openModal)        openModal.classList.add('hidden');
          else if (readingModeOn) exitReadingMode();
          else                  _clearSelection();
        }
      }
    });

    // Warn on close if there are unsaved changes
    window.addEventListener('beforeunload', e => {
      if (isDirty) e.preventDefault();
    });
  }

  // ── Modal actions ────────────────────────────────────────────────────────

  function _openNewProjectModal() {
    _selectedGarmentId = 'blank';
    _renderGarmentPicker();
    const sizeFields = document.getElementById('blank-size-fields');
    if (sizeFields) sizeFields.classList.remove('hidden');
    const preview = document.getElementById('garment-panel-preview');
    if (preview) preview.textContent = '';
    // Reset unit selector
    const unitSel = document.getElementById('new-project-unit');
    if (unitSel) { unitSel.value = 'stitches'; _onNewProjectUnitChange(); }
    document.getElementById('modal-new-project').classList.remove('hidden');
    document.getElementById('new-project-name').focus();
    document.getElementById('new-project-name').select();
  }

  function _onNewProjectUnitChange() {
    const unit      = document.getElementById('new-project-unit')?.value || 'stitches';
    const gaugeRow  = document.getElementById('size-gauge-row');
    const wLabel    = document.getElementById('np-width-label');
    const hLabel    = document.getElementById('np-height-label');
    const wInput    = document.getElementById('new-project-width');
    const hInput    = document.getElementById('new-project-height');
    const preview   = document.getElementById('np-stitch-preview');

    if (unit === 'stitches') {
      gaugeRow?.classList.add('hidden');
      preview?.classList.add('hidden');
      if (wLabel) wLabel.textContent = 'Width (stitches)';
      if (hLabel) hLabel.textContent = 'Height (rows)';
      wInput.min = 5; wInput.max = 300; wInput.step = 1;
      hInput.min = 5; hInput.max = 300; hInput.step = 1;
    } else {
      gaugeRow?.classList.remove('hidden');
      preview?.classList.remove('hidden');
      const sym = unit === 'inches' ? '"' : ' cm';
      if (wLabel) wLabel.textContent = `Width (${unit === 'inches' ? 'inches' : 'cm'})`;
      if (hLabel) hLabel.textContent = `Height (${unit === 'inches' ? 'inches' : 'cm'})`;
      wInput.min = 0.5; wInput.max = 999; wInput.step = 0.5;
      hInput.min = 0.5; hInput.max = 999; hInput.step = 0.5;
      // Set sensible defaults for inches/cm
      if (wInput.value === '50') wInput.value = unit === 'inches' ? '12' : '30';
      if (hInput.value === '50') hInput.value = unit === 'inches' ? '15' : '38';
    }
    _updateNewProjectStitchPreview();
  }

  function _updateNewProjectStitchPreview() {
    const preview = document.getElementById('np-stitch-preview');
    if (!preview) return;
    const unit = document.getElementById('new-project-unit')?.value || 'stitches';
    if (unit === 'stitches') { preview.classList.add('hidden'); return; }

    const w  = parseFloat(document.getElementById('new-project-width').value)  || 0;
    const h  = parseFloat(document.getElementById('new-project-height').value) || 0;
    const st = parseFloat(document.getElementById('np-gauge-st').value)   || 4;
    const rw = parseFloat(document.getElementById('np-gauge-rows').value) || 5;
    const factor = unit === 'inches' ? 1 : 0.3937; // cm to inches
    const stitches = Math.round(w * factor * st);
    const rows     = Math.round(h * factor * rw);
    preview.textContent = `= ${stitches} stitches wide × ${rows} rows tall`;
    preview.classList.remove('hidden');
  }

  function _resolveNewProjectSize() {
    const unit = document.getElementById('new-project-unit')?.value || 'stitches';
    const w  = parseFloat(document.getElementById('new-project-width').value)  || 0;
    const h  = parseFloat(document.getElementById('new-project-height').value) || 0;
    if (unit === 'stitches') return { width: Math.round(w), height: Math.round(h) };
    const st = parseFloat(document.getElementById('np-gauge-st').value)   || 4;
    const rw = parseFloat(document.getElementById('np-gauge-rows').value) || 5;
    const factor = unit === 'inches' ? 1 : 0.3937;
    return {
      width:  Math.max(5, Math.min(300, Math.round(w * factor * st))),
      height: Math.max(5, Math.min(300, Math.round(h * factor * rw))),
    };
  }

  function _closeNewProjectModal() {
    document.getElementById('modal-new-project').classList.add('hidden');
  }

  async function _createProject() {
    const name      = document.getElementById('new-project-name').value.trim();
    const technique = document.getElementById('new-project-technique').value;
    const garmentId = _selectedGarmentId || 'blank';

    if (!name) { alert('Please enter a project name.'); return; }

    let project;
    if (garmentId !== 'blank' && CrochetApp.Templates) {
      // Build multi-panel garment project using template
      const panelDefs = CrochetApp.Templates.buildPanels(garmentId);
      project = CrochetApp.createProject({ name, technique, garmentId, panelDefs });
    } else {
      const { width, height } = _resolveNewProjectSize();
      if (width  < 5 || width  > 300) { alert('Width resolves to ' + width + ' stitches — must be between 5 and 300.'); return; }
      if (height < 5 || height > 300) { alert('Height resolves to ' + height + ' rows — must be between 5 and 300.'); return; }
      project = CrochetApp.createProject({ name, width, height, technique, garmentId: 'blank' });
    }

    await CrochetApp.Storage.saveProject(project);
    _closeNewProjectModal();
    loadProject(project);
  }

  function _saveColorEdit() {
    const modal = document.getElementById('modal-color-edit');
    const index = parseInt(modal.dataset.editIndex);
    const hex   = document.getElementById('color-edit-hex').value;
    const label = document.getElementById('color-edit-label').value.trim() || `Color ${index + 1}`;
    const sym   = document.getElementById('color-edit-symbol').value.trim().charAt(0) || '○';

    currentProject.palette[index] = { hex, label, symbol: sym };
    modal.classList.add('hidden');

    paletteUI.render();
    renderer.render();
    _markDirty();
  }

  function _renameProject() {
    const input = document.getElementById('rename-project-input');
    const name  = input.value.trim();
    if (!name) return;

    currentProject.name = name;
    document.getElementById('modal-rename-project').classList.add('hidden');
    _updateTitle();
    _markDirty();
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  function _flashStatus(msg) {
    const el = document.getElementById('status-cursor');
    const prev = el.textContent;
    el.textContent = msg;
    setTimeout(() => { el.textContent = prev; }, 1500);
  }

  function _techniqueLabel(technique) {
    return CrochetApp.TECHNIQUES[technique]?.label ?? technique;
  }

  function _formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();