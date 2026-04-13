# Crochet Tapestry Pixel Design App — Planning Document

## Overview

A local-first web application for designing crochet tapestry pixel art patterns. Runs entirely in the browser with no backend required. Projects saved to IndexedDB with JSON export/import.

---

## Target User

Crochet artists designing tapestry, graphghan, C2C, and mosaic crochet projects who need a free, offline-capable, full-featured alternative to tools like Stitch Fiddle or Crochetto.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Vanilla HTML/CSS/JS (no framework) | Zero build tooling, truly local, easy to open with `file://` |
| Rendering | HTML5 Canvas | Performance at 200x200+ grids; DOM-based grids are too slow |
| Storage | IndexedDB (via `idb` or raw API) | Persists large projects locally without a server |
| PDF Export | `jsPDF` + `html2canvas` | Client-side PDF generation |
| Image Import | Canvas `drawImage` + color quantization | Convert reference photos to palette-reduced grids |

> **Alternative:** If a lightweight framework is preferred later, consider Preact or Solid.js — both are small enough to load from a CDN without a build step.

---

## Core Features (MVP)

### 1. Grid Canvas
- Configurable grid size: 5×5 up to 300×300
- Default: 100×100
- Cell-by-cell color painting (click + drag)
- Bucket fill (flood fill)
- Eraser tool
- Zoom in / out (mouse wheel + buttons)
- Pan (middle-click drag or space + drag)
- Undo / redo (Ctrl+Z / Ctrl+Y), minimum 50 steps

### 2. Color Palette Panel
- Up to 20 named color swatches per project
- Each swatch: hex color picker + user-defined label (e.g., "Lion Brand Teal")
- Live stitch count per color (updates as you paint)
- Percentage of total stitches
- Assign a printable symbol to each color (for B&W chart printing)
- Active color indicator

### 3. Tools Toolbar
- Pencil (single cell paint)
- Fill bucket (flood fill)
- Eraser
- Color picker / eyedropper (sample color from grid)
- Rectangle select (for copy/paste/mirror operations)

### 4. Technique Modes
Select at project creation (can change later):

| Mode | Grid Cell = | Aspect Ratio | Read Direction |
|---|---|---|---|
| Tapestry SC | 1 single crochet | ~4:5 (w:h) | Row by row, alternating |
| Graphghan | 1 single crochet | ~4:5 (w:h) | Bottom to top |
| C2C | 1 block (3dc) | ~1:1 | Diagonal |
| Mosaic | 1 stitch, 2-row repeat | ~4:5 (w:h) | Row by row |

### 5. Aspect Ratio Preview
- Toggle between square cells (design view) and gauge-corrected cells (preview view)
- Enter custom gauge: stitches/inch and rows/inch from swatch
- App calculates and displays estimated finished dimensions (inches + cm)

### 6. Written Instructions
- Auto-generated row-by-row text instructions from the grid
- Format: `Row 12 (RS→): 5 MC, 3 CC1, 8 MC`
- Reading direction per row shown (→ or ←)
- Mosaic mode: shows which color is active per row pair
- Copy to clipboard button

### 7. Pattern Repeats & Symmetry
- Horizontal / vertical mirror of selection or entire canvas
- 90° rotation of selection
- Tile repeat preview (show pattern repeated N×M times)
- Copy / paste rectangular selection
- Pattern repeat boundary markers (dashed overlay lines)

### 8. Row Tracker / Reading Mode
- Separate read-only mode overlaid on the chart
- Highlighted current row (can customize highlight color)
- Click to advance to next row
- Keyboard shortcut to advance (spacebar or arrow key)
- Progress indicator: "Row 34 of 100"

### 9. Image Import
- Upload PNG/JPG/WEBP reference image
- Choose target grid size (fit to current canvas or specify)
- Choose number of colors (2–20)
- Color quantization with dithering options (none / Floyd-Steinberg)
- Map quantized colors to existing palette or create new swatches
- Preview before committing

### 10. Export
| Format | Contents |
|---|---|
| PNG | Grid chart image with row/column numbers and color legend |
| PDF | Chart image + color legend + written row instructions + gauge info + project notes |
| JSON | Full project save file (import back into app) |
| CSV | Per-row color block data (color, stitch count per block) |

---

## Secondary Features (Post-MVP)

- Yarn yardage estimator (stitches × weight factor per yarn weight category)
- Built-in yarn brand color library (Paintbox, Lion Brand, Stylecraft, Drops)
- Gradient fill tool
- Multiple layers / frames (for animation or colorway variants)
- Dark mode
- Keyboard shortcut map / help overlay
- Auto-save every 60 seconds to IndexedDB

---

## Project Data Model

```json
{
  "id": "uuid",
  "name": "My Tapestry",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "technique": "tapestry_sc | graphghan | c2c | mosaic",
  "grid": {
    "width": 100,
    "height": 100,
    "cells": "RLE or flat array of color indices"
  },
  "palette": [
    {
      "index": 0,
      "hex": "#ffffff",
      "label": "Background White",
      "symbol": "○"
    }
  ],
  "gauge": {
    "stitchesPerInch": 4,
    "rowsPerInch": 5
  },
  "notes": "Free text project notes"
}
```

> **Cell storage:** For large grids, store cells as a flat `Uint8Array` (one byte per cell = color palette index 0–255). Serialize to Base64 for JSON export. For very sparse grids, RLE encoding reduces file size significantly.

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  [App Name]   [New] [Open] [Save] [Export ▾]        │  ← Top bar
├──────┬──────────────────────────────────┬────────────┤
│      │                                  │            │
│ Tool │         Canvas (zoomable)        │  Palette   │
│ bar  │                                  │  Panel     │
│      │                                  │            │
│  P   │                                  │  [+ Color] │
│  F   │                                  │  ■ Color 1 │
│  E   │                                  │  ■ Color 2 │
│  S   │                                  │  ...       │
│  I   │                                  │            │
│      │                                  │  Counts:   │
│      │                                  │  C1: 450   │
│      │                                  │  C2: 230   │
├──────┴──────────────────────────────────┴────────────┤
│  Grid: 100×100  |  Zoom: 100%  |  Technique: SC      │  ← Status bar
└─────────────────────────────────────────────────────┘
```

---

## File Structure

```
CrochetTapestryApp/
├── index.html
├── style.css
├── app.js                  # Entry point, app init
├── canvas/
│   ├── renderer.js         # Canvas draw logic
│   ├── interaction.js      # Mouse/touch event handlers
│   └── tools.js            # Pencil, fill, eraser, picker logic
├── palette/
│   └── palette.js          # Color swatch management
├── project/
│   ├── model.js            # Project data structure, grid storage
│   ├── storage.js          # IndexedDB read/write
│   └── export.js           # PNG, PDF, JSON, CSV export
├── instructions/
│   └── generator.js        # Written row instruction generator
├── image-import/
│   └── quantizer.js        # Image upload + color quantization
└── lib/
    ├── jspdf.umd.min.js    # PDF generation (CDN or local copy)
    └── idb.js              # IndexedDB wrapper (optional)
```

---

## Build Phases

### Phase 1 — Core Canvas Editor
- [ ] Project: create/name, set grid size and technique
- [ ] Canvas renderer with zoom and pan
- [ ] Pencil tool (click + drag to paint)
- [ ] Color palette panel (add/edit/delete swatches)
- [ ] Undo/redo (50 steps)
- [ ] Save/load from IndexedDB
- [ ] PNG export

### Phase 2 — Tools and Productivity ✓
- [x] Bucket fill (flood fill)
- [x] Eraser
- [x] Eyedropper / color picker (auto-returns to pencil after sampling)
- [x] Rectangle select + copy/paste (Ctrl+C / Ctrl+V at cursor position)
- [x] Delete selected cells (Delete / Backspace key)
- [x] Horizontal/vertical mirror (H / V keys, toolbar buttons)
- [x] Live stitch count per color

### Phase 3 — Pattern Output ✓
- [x] Written row instruction generator (row-by-row with direction arrows, colour runs)
- [x] Aspect ratio preview mode with gauge calculator (toggle button, persisted per project)
- [x] Row tracker / reading mode (dimmed overlay, ↑/↓ arrow keys, Escape to exit)
- [x] PDF export via print window (chart image + dimensions + legend + written instructions)
- [x] Finished size calculator (inches + cm from gauge)

### Phase 4 — Image Import ✓
- [x] Upload image via file picker or drag & drop
- [x] Resize to target grid dimensions (browser bilinear interpolation)
- [x] Color quantization via Median Cut (2–20 colors, adjustable with live slider)
- [x] Dithering option — Floyd-Steinberg error diffusion
- [x] Side-by-side original vs. pixelated preview before committing
- [x] Lock aspect ratio toggle when resizing
- [x] Apply to grid (replaces cells + palette, fully undoable)

### Phase 5 — Polish ✓
- [x] Pattern repeat preview
- [x] CSV export
- [x] Keyboard shortcut overlay
- [x] Auto-save
- [x] Dark mode

---

## Key Design Decisions

1. **No build step.** Open `index.html` directly in a browser. No Node.js, no npm, no bundler.
2. **Canvas over DOM.** A 200×200 grid is 40,000 cells — rendering each as a `<div>` or `<rect>` would destroy performance. A single `<canvas>` element redrawn on each change is the right approach.
3. **IndexedDB for storage.** `localStorage` is limited to ~5MB and synchronous. IndexedDB supports large binary data (Uint8Array grid) and is async.
4. **Palette index cells.** Store cells as color indices (0–255), not hex strings. This keeps the grid data small and makes color replacement trivial (change palette entry → entire grid updates instantly).
5. **Offline-first.** No network requests at runtime. CDN libraries (jsPDF) should be downloaded and stored locally in `/lib/`.

---

## Decisions

| Question | Decision |
|---|---|
| Multiple projects | Yes — project manager screen to create, open, rename, and delete saved projects. Each stored separately in IndexedDB. |
| Touch/stylus input | Mouse + keyboard only for now. Touch support deferred to a later iteration. |
| Mosaic chart row grouping | **Deferred** — needs a visual mockup before deciding. Will revisit when Phase 3 (pattern output) begins. |
| Default palette for new projects | Start with two swatches: white (`#FFFFFF`, label "Color A") and black (`#000000`, label "Color B"). |
| Yardage estimation | User selects a broad yarn weight category (Lace / Fingering / Sport / DK / Worsted / Bulky / Super Bulky) and enters the yards per skein and grams per skein from their yarn label. App derives yards/gram and estimates total yardage needed per color. |
