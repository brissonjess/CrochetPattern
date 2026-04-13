/**
 * palette.js — Color palette panel UI
 *
 * Renders into a container element. Callbacks fire when the user
 * selects a color, or when the palette data changes (add/edit/delete).
 */

CrochetApp.Palette = class {
  /**
   * @param {HTMLElement} containerEl
   * @param {(index: number) => void} onColorSelect  — user clicked a swatch
   * @param {() => void}              onPaletteChanged — palette data mutated
   */
  constructor(containerEl, onColorSelect, onPaletteChanged) {
    this.el                  = containerEl;
    this.onColorSelect       = onColorSelect;
    this.onPaletteChanged    = onPaletteChanged;
    this.onVisibilityChange  = null; // set by app.js after construction
    this.project             = null;
    this.activeIndex         = 0;
    this.hiddenIndices       = new Set();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  setProject(project) {
    this.project       = project;
    this.activePanel   = project ? CrochetApp.getActivePanel(project) : null;
    this.activeIndex   = 0;
    this.hiddenIndices = new Set();
    this.render();
  }

  /** Call whenever the active panel changes so counts stay per-panel. */
  setActivePanel(panel) {
    this.activePanel = panel;
    this.updateCounts();
  }

  setActiveIndex(i) {
    this.activeIndex = i;
    this._highlightActive();
  }

  /** Refresh only the stitch-count numbers without a full re-render. */
  updateCounts() {
    if (!this.project) return;
    const src    = this.activePanel || this.project;
    const counts = CrochetApp.countColors(src, this.project.palette.length);
    const total  = CrochetApp.totalPainted(src);

    this.el.querySelectorAll('.swatch-count').forEach(el => {
      const i     = parseInt(el.dataset.index);
      const count = counts[i] || 0;
      const pct   = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
      el.textContent = `${count.toLocaleString()} (${pct}%)`;
    });

    const totalEl = this.el.querySelector('.total-count');
    if (totalEl) totalEl.textContent = `Total stitches: ${total.toLocaleString()}`;
  }

  // ─── Rendering ───────────────────────────────────────────────────────────

  render() {
    if (!this.project) return;
    const { palette } = this.project;
    const src    = this.activePanel || this.project;
    const counts = CrochetApp.countColors(src, palette.length);
    const total  = CrochetApp.totalPainted(src);

    this.el.innerHTML = `
      <div class="palette-header">
        <span class="palette-title">Colors</span>
        <button class="btn-icon" id="btn-add-color" title="Add color">+</button>
      </div>
      <div class="swatches-list" id="swatches-list">
        ${palette.map((color, i) => this._swatchHTML(color, i, counts[i] || 0, total)).join('')}
      </div>
      <div class="total-count">Total stitches: ${total.toLocaleString()}</div>
    `;

    this._bindEvents();
    this._highlightActive();
  }

  _swatchHTML(color, i, count, total) {
    const pct       = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    const canDelete = this.project.palette.length > 1;
    const hidden    = this.hiddenIndices.has(i);

    // SVG eye-open path (Material Design)
    const eyeOpen = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5
               c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5
               -2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
    </svg>`;

    // SVG eye-closed (slash) path (Material Design)
    const eyeClosed = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92
               c1.51-1.26 2.7-2.89 3.43-4.75C21.27 7.61 17 4.5 12 4.5c-1.4 0-2.74.25-3.98.7
               l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46
               C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84
               l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55
               c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55
               c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z
               m4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
    </svg>`;

    return `
      <div class="swatch-row${hidden ? ' color-hidden' : ''}" data-index="${i}">
        <div class="swatch-color" style="background:${color.hex}" data-index="${i}"></div>
        <div class="swatch-info">
          <span class="swatch-label">${this._esc(color.label)}</span>
          <span class="swatch-count" data-index="${i}">${count.toLocaleString()} (${pct}%)</span>
        </div>
        <button class="swatch-visibility${hidden ? ' is-hidden' : ''}"
                data-index="${i}"
                title="${hidden ? 'Show color' : 'Hide color'}"
        >${hidden ? eyeClosed : eyeOpen}</button>
        <button class="swatch-edit"   data-index="${i}" title="Edit color">✎</button>
        ${canDelete
          ? `<button class="swatch-delete" data-index="${i}" title="Delete color">×</button>`
          : ''}
      </div>
    `;
  }

  _bindEvents() {
    // Add color
    this.el.querySelector('#btn-add-color')
      .addEventListener('click', () => this._addColor());

    // Swatch rows — select active color
    this.el.querySelectorAll('.swatch-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.swatch-edit, .swatch-delete')) return;
        const i = parseInt(row.dataset.index);
        this.activeIndex = i;
        this._highlightActive();
        this.onColorSelect(i);
      });
    });

    // Edit buttons
    this.el.querySelectorAll('.swatch-edit').forEach(btn => {
      btn.addEventListener('click', () => this._openEditModal(parseInt(btn.dataset.index)));
    });

    // Visibility toggle buttons
    this.el.querySelectorAll('.swatch-visibility').forEach(btn => {
      btn.addEventListener('click', () => this._toggleVisibility(parseInt(btn.dataset.index)));
    });

    // Delete buttons
    this.el.querySelectorAll('.swatch-delete').forEach(btn => {
      btn.addEventListener('click', () => this._deleteColor(parseInt(btn.dataset.index)));
    });
  }

  _highlightActive() {
    this.el.querySelectorAll('.swatch-row').forEach(row => {
      row.classList.toggle('active', parseInt(row.dataset.index) === this.activeIndex);
    });
  }

  // ─── Color operations ────────────────────────────────────────────────────

  _addColor() {
    const { palette } = this.project;
    if (palette.length >= 20) {
      alert('Maximum 20 colors per project.');
      return;
    }
    const sym = CrochetApp.DEFAULT_SYMBOLS[palette.length] || '?';
    palette.push({ hex: '#888888', label: `Color ${this._nextLabel()}`, symbol: sym });
    this.activeIndex = palette.length - 1;
    this.render();
    this.onPaletteChanged();
    this._openEditModal(this.activeIndex);
  }

  _nextLabel() {
    // Use A, B, C … Z, AA, AB …
    const n = this.project.palette.length;
    if (n < 26) return String.fromCharCode(65 + n);
    return String.fromCharCode(65 + Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26));
  }

  _openEditModal(index) {
    const color  = this.project.palette[index];
    const modal  = document.getElementById('modal-color-edit');
    const hexIn  = document.getElementById('color-edit-hex');
    const lblIn  = document.getElementById('color-edit-label');
    const symIn  = document.getElementById('color-edit-symbol');
    const preview = document.getElementById('color-edit-preview');

    hexIn.value  = color.hex;
    lblIn.value  = color.label;
    symIn.value  = color.symbol;
    preview.style.background = color.hex;

    // Live preview as user picks a color
    hexIn.oninput = () => { preview.style.background = hexIn.value; };

    modal.dataset.editIndex = index;
    modal.classList.remove('hidden');
    lblIn.focus();
    lblIn.select();
  }

  _toggleVisibility(index) {
    if (this.hiddenIndices.has(index)) {
      this.hiddenIndices.delete(index);
    } else {
      this.hiddenIndices.add(index);
    }
    if (this.onVisibilityChange) this.onVisibilityChange(this.hiddenIndices);
    this.render(); // refresh eye icon + row dimming
  }

  _deleteColor(index) {
    const { palette } = this.project;
    const src   = this.activePanel || this.project;
    const count = CrochetApp.countColors(src, palette.length)[index] || 0;

    if (count > 0) {
      if (!confirm(
        `"${palette[index].label}" is used in ${count.toLocaleString()} cells.\n` +
        `Deleting it will erase those cells. Continue?`
      )) return;
    }

    // Always re-index cells: erase any that used this color, and shift all
    // higher indices down by 1 so they still point to the correct palette entry.
    const { cells } = (this.activePanel || this.project.panels[0]).grid;
    for (let i = 0; i < cells.length; i++) {
      if      (cells[i] === index)                                    cells[i] = CrochetApp.EMPTY_CELL;
      else if (cells[i] > index && cells[i] !== CrochetApp.EMPTY_CELL) cells[i]--;
    }

    palette.splice(index, 1);
    if (this.activeIndex >= palette.length) this.activeIndex = palette.length - 1;

    // Remap hidden indices now that palette has shifted
    const newHidden = new Set();
    for (const h of this.hiddenIndices) {
      if (h === index) continue;         // deleted color — drop it
      else if (h > index) newHidden.add(h - 1); // shifted down
      else newHidden.add(h);             // below deleted — unchanged
    }
    this.hiddenIndices = newHidden;
    if (this.onVisibilityChange) this.onVisibilityChange(this.hiddenIndices);

    this.render();
    this.onColorSelect(this.activeIndex);
    this.onPaletteChanged();
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  _esc(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};