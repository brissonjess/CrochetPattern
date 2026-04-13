/**
 * export.js — PNG chart export, JSON, CSV, and PDF (print) export
 *
 * All public functions accept a v2 project (project.panels[]).
 * An optional second argument `panel` selects which panel to render;
 * when omitted the active panel is used automatically.
 */

CrochetApp.Export = {};

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Return the panel to export. Prefers the explicitly passed panel, then the
 * project's active panel, then the first panel.
 */
function _resolvePanel(project, panel) {
  if (panel && panel.grid) return panel;
  return CrochetApp.getActivePanel(project);
}

// ─── PNG Export ───────────────────────────────────────────────────────────────

CrochetApp.Export.toPNG = function(project, panel) {
  const p                     = _resolvePanel(project, panel);
  const { width, height, cells } = p.grid;
  const { palette }              = project;

  const CELL       = 12;
  const NUM_W      = 32;
  const NUM_H      = 24;
  const NUM_INTV   = 5;
  const LEG_PAD    = 10;
  const LEG_ROW_H  = 22;
  const LEG_COLS   = 4;
  const hasMask    = !!(p.grid.mask);
  const legItems   = palette.length + (hasMask ? 1 : 0);
  const legendRows = Math.ceil(legItems / LEG_COLS);
  const LEG_H      = legendRows * LEG_ROW_H + LEG_PAD * 2 + 14;

  const totalW = NUM_W + width  * CELL + 1;
  const totalH = NUM_H + height * CELL + 1 + LEG_H;

  const canvas = document.createElement('canvas');
  canvas.width  = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, totalW, totalH);

  // ── Cells ──────────────────────────────────────────────────────────────
  const mask = p.grid.mask || null;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i   = row * width + col;
      const idx = cells[i];
      const outside = mask && mask[i] === 0;
      if (outside) {
        ctx.fillStyle = '#c8c8c8';
      } else {
        ctx.fillStyle = idx === CrochetApp.EMPTY_CELL ? '#ffffff' : (palette[idx]?.hex ?? '#ffffff');
      }
      ctx.fillRect(NUM_W + col * CELL, NUM_H + row * CELL, CELL, CELL);
    }
  }

  // ── Grid lines ─────────────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth   = 0.5;
  ctx.beginPath();
  for (let col = 0; col <= width; col++) {
    const x = NUM_W + col * CELL + 0.5;
    ctx.moveTo(x, NUM_H); ctx.lineTo(x, NUM_H + height * CELL);
  }
  for (let row = 0; row <= height; row++) {
    const y = NUM_H + row * CELL + 0.5;
    ctx.moveTo(NUM_W, y); ctx.lineTo(NUM_W + width * CELL, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.strokeRect(NUM_W + 0.5, NUM_H + 0.5, width * CELL, height * CELL);

  // ── Column numbers ─────────────────────────────────────────────────────
  ctx.fillStyle = '#555'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
  for (let col = NUM_INTV - 1; col < width; col += NUM_INTV) {
    ctx.fillText(col + 1, NUM_W + col * CELL + CELL / 2, NUM_H - 6);
  }
  ctx.fillText(1, NUM_W + CELL / 2, NUM_H - 6);

  // ── Row numbers ────────────────────────────────────────────────────────
  ctx.textAlign = 'right';
  for (let row = NUM_INTV - 1; row < height; row += NUM_INTV) {
    ctx.fillText(row + 1, NUM_W - 3, NUM_H + row * CELL + CELL / 2 + 3);
  }
  ctx.fillText(1, NUM_W - 3, NUM_H + CELL / 2 + 3);

  // ── Color legend ───────────────────────────────────────────────────────
  const legY = NUM_H + height * CELL + LEG_PAD + 4;
  ctx.fillStyle = '#333'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('Color Legend:', NUM_W, legY + 10);
  const colW   = Math.floor((totalW - NUM_W) / LEG_COLS);
  const legAll = [...palette.map((c, i) => ({ hex: c.hex, symbol: c.symbol, label: c.label }))];
  if (hasMask) legAll.push({ hex: '#c8c8c8', symbol: '', label: 'Outside garment shape' });

  legAll.forEach((entry, i) => {
    const lCol = i % LEG_COLS;
    const lRow = Math.floor(i / LEG_COLS);
    const x = NUM_W + lCol * colW;
    const y = legY + 16 + lRow * LEG_ROW_H;
    ctx.fillStyle = entry.hex;
    ctx.fillRect(x, y, 11, 11);
    ctx.strokeStyle = '#555'; ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 0.5, y + 0.5, 11, 11);
    ctx.fillStyle = '#333'; ctx.font = '9px sans-serif';
    ctx.fillText(entry.symbol ? `${entry.symbol}  ${entry.label}` : entry.label, x + 15, y + 9);
  });

  const filename = `${_safeName(project.name)}_${_safeName(p.name)}_chart.png`;
  _download(canvas.toDataURL('image/png'), filename);
};

// ─── JSON Export ──────────────────────────────────────────────────────────────

CrochetApp.Export.toJSON = function(project) {
  const data = CrochetApp.serializeProject(project);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  _download(url, `${_safeName(project.name)}.json`);
  URL.revokeObjectURL(url);
};

// ─── JSON Import ─────────────────────────────────────────────────────────────

CrochetApp.Export.importFromJSON = function(onImport, onError) {
  const input    = document.createElement('input');
  input.type     = 'file';
  input.accept   = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw     = JSON.parse(e.target.result);
        const project = CrochetApp.deserializeProject(raw);
        project.id        = crypto.randomUUID();
        project.name      = `${project.name} (imported)`;
        project.updatedAt = new Date().toISOString();
        onImport(project);
      } catch (err) {
        onError(`Could not read project file: ${err.message}`);
      }
    };
    reader.onerror = () => onError('Failed to read file.');
    reader.readAsText(file);
  });
  input.click();
};

// ─── CSV Export ───────────────────────────────────────────────────────────────

CrochetApp.Export.toCSV = function(project, panel) {
  const p = _resolvePanel(project, panel);
  // Instructions.generateAll expects { grid, technique }
  const proxy = { grid: p.grid, technique: project.technique };
  const rows  = CrochetApp.Instructions.generateAll(proxy);
  const lines = [
    ['Row', 'Direction', 'Instructions'].join(','),
    ...rows.map(r => {
      const dir   = r.isRTL ? '<-' : '->';
      const instr = r.runs.map(run => {
        const label = run.colorIdx === CrochetApp.EMPTY_CELL
          ? '[no stitch]'
          : (project.palette[run.colorIdx]?.label ?? `Color ${run.colorIdx + 1}`);
        return `${run.count} ${label}`;
      }).join(', ');
      return [r.displayRowNum, dir, `"${instr}"`].join(',');
    }),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  _download(url, `${_safeName(project.name)}_${_safeName(p.name)}_instructions.csv`);
  URL.revokeObjectURL(url);
};

// ─── PDF (Print) Export ───────────────────────────────────────────────────────

CrochetApp.Export.toPDF = function(project, panel) {
  const p = _resolvePanel(project, panel);
  const { palette, name, technique } = project;
  const gauge = project.gauge || { stitchesPerInch: 4, rowsPerInch: 5 };

  const chartDataURL = _buildChartDataURL(project, p);

  // Instructions proxy: generateAll / calcDimensions need { grid, technique }
  const proxy    = { grid: p.grid, technique };
  const allRows  = CrochetApp.Instructions.generateAll(proxy);
  const instrLines = allRows.map(r => CrochetApp.Instructions.formatRow(r, palette));
  const dims     = CrochetApp.Instructions.calcDimensions(p.grid, gauge);

  const counts = CrochetApp.countColors(p, palette.length);
  const total  = CrochetApp.totalPainted(p);
  const techLabel = CrochetApp.TECHNIQUES[technique]?.label ?? technique;

  const hasPDFMask = !!(p.grid.mask);
  const legendHTML = [
    ...palette.map((c, i) => {
      const count = counts[i] || 0;
      const pct   = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
      return `
        <tr>
          <td><span class="swatch" style="background:${c.hex}"></span></td>
          <td class="sym">${_escHtml(c.symbol)}</td>
          <td>${_escHtml(c.label)}</td>
          <td class="num">${count.toLocaleString()}</td>
          <td class="num">${pct}%</td>
        </tr>`;
    }),
    hasPDFMask ? `
        <tr>
          <td><span class="swatch" style="background:#c8c8c8"></span></td>
          <td class="sym"></td>
          <td><em>Outside garment shape</em></td>
          <td class="num">—</td>
          <td class="num">—</td>
        </tr>` : '',
  ].join('');

  const instrHTML = instrLines.map((line, i) => {
    return `<div class="row-instr${i % 2 === 1 ? ' alt' : ''}">${_escHtml(line)}</div>`;
  }).join('');

  const panelLabel = project.panels.length > 1 ? ` — ${p.name}` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${_escHtml(name)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Georgia, serif; font-size: 11pt; color: #222; padding: 20mm; }
  h1 { font-size: 18pt; margin-bottom: 4pt; }
  h2 { font-size: 12pt; margin: 14pt 0 6pt; border-bottom: 1px solid #aaa; padding-bottom: 3pt; }
  .meta { font-size: 10pt; color: #555; margin-bottom: 12pt; }
  .chart-img { max-width: 100%; height: auto; display: block; margin: 0 auto 16pt; border: 1px solid #ccc; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; margin-bottom: 12pt; }
  th { background: #f0f0f0; padding: 4pt 6pt; text-align: left; border-bottom: 1px solid #ccc; }
  td { padding: 3pt 6pt; border-bottom: 1px solid #eee; vertical-align: middle; }
  .swatch { display: inline-block; width: 14pt; height: 14pt; border: 1px solid #aaa; vertical-align: middle; }
  .sym { font-size: 13pt; text-align: center; }
  .num { text-align: right; font-family: monospace; }
  .dims { background: #f8f8f8; border: 1px solid #ddd; border-radius: 4pt; padding: 8pt 12pt; margin-bottom: 12pt; font-size: 10pt; display: flex; gap: 24pt; flex-wrap: wrap; }
  .dims span { display: block; }
  .dims strong { font-size: 12pt; }
  .row-instr { font-family: monospace; font-size: 9.5pt; padding: 2pt 4pt; white-space: pre-wrap; word-break: break-all; }
  .row-instr.alt { background: #f9f9f9; }
  @media print {
    body { padding: 10mm; }
    .no-print { display: none; }
    h2 { page-break-after: avoid; }
    .instructions { column-count: 2; column-gap: 12pt; }
  }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()" style="margin-bottom:12pt;padding:6pt 14pt;font-size:11pt;cursor:pointer;">Print / Save as PDF</button>

<h1>${_escHtml(name + panelLabel)}</h1>
<div class="meta">${techLabel} &nbsp;|&nbsp; ${p.grid.width} &times; ${p.grid.height} stitches &nbsp;|&nbsp; Generated ${new Date().toLocaleDateString()}</div>

<img class="chart-img" src="${chartDataURL}" alt="Pattern chart">

<h2>Finished Dimensions (based on gauge)</h2>
<div class="dims">
  <div><span>Gauge</span><strong>${gauge.stitchesPerInch} st/in &amp; ${gauge.rowsPerInch} rows/in</strong></div>
  <div><span>Width</span><strong>${dims.widthIn}" &nbsp;(${dims.widthCm} cm)</strong></div>
  <div><span>Height</span><strong>${dims.heightIn}" &nbsp;(${dims.heightCm} cm)</strong></div>
  <div><span>Total stitches</span><strong>${total.toLocaleString()}</strong></div>
</div>

<h2>Color Legend</h2>
<table>
  <thead><tr><th>Color</th><th>Symbol</th><th>Label</th><th class="num">Stitches</th><th class="num">%</th></tr></thead>
  <tbody>${legendHTML}</tbody>
</table>

<h2>Written Row Instructions</h2>
<p style="font-size:9.5pt;color:#666;margin-bottom:8pt;">Row 1 = bottom of finished piece. (-&gt;) = left to right, (&lt;-) = right to left.</p>
<div class="instructions">${instrHTML}</div>

</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Pop-up blocked. Please allow pop-ups for this page.'); return; }
  win.document.write(html);
  win.document.close();
};

// ─── Internal: chart image builder ────────────────────────────────────────────

function _buildChartDataURL(project, panel) {
  const p = _resolvePanel(project, panel);
  const { width, height, cells } = p.grid;
  const { palette }              = project;

  const CELL = 10, NUM_W = 28, NUM_H = 20, NUM_INTV = 5;
  const totalW = NUM_W + width  * CELL + 1;
  const totalH = NUM_H + height * CELL + 1;

  const canvas = document.createElement('canvas');
  canvas.width = totalW; canvas.height = totalH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, totalW, totalH);

  const chartMask = p.grid.mask || null;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i   = row * width + col;
      const idx = cells[i];
      const outside = chartMask && chartMask[i] === 0;
      if (outside) {
        ctx.fillStyle = '#c8c8c8';
      } else {
        ctx.fillStyle = idx === CrochetApp.EMPTY_CELL ? '#fff' : (palette[idx]?.hex ?? '#fff');
      }
      ctx.fillRect(NUM_W + col * CELL, NUM_H + row * CELL, CELL, CELL);
    }
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.5; ctx.beginPath();
  for (let col = 0; col <= width; col++) {
    const x = NUM_W + col * CELL + 0.5;
    ctx.moveTo(x, NUM_H); ctx.lineTo(x, NUM_H + height * CELL);
  }
  for (let row = 0; row <= height; row++) {
    const y = NUM_H + row * CELL + 0.5;
    ctx.moveTo(NUM_W, y); ctx.lineTo(NUM_W + width * CELL, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
  ctx.strokeRect(NUM_W + 0.5, NUM_H + 0.5, width * CELL, height * CELL);

  ctx.fillStyle = '#555'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
  for (let col = NUM_INTV - 1; col < width; col += NUM_INTV) {
    ctx.fillText(col + 1, NUM_W + col * CELL + CELL / 2, NUM_H - 5);
  }
  ctx.fillText(1, NUM_W + CELL / 2, NUM_H - 5);
  ctx.textAlign = 'right';
  for (let row = NUM_INTV - 1; row < height; row += NUM_INTV) {
    ctx.fillText(row + 1, NUM_W - 3, NUM_H + row * CELL + CELL / 2 + 3);
  }
  ctx.fillText(1, NUM_W - 3, NUM_H + CELL / 2 + 3);

  return canvas.toDataURL('image/png');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _safeName(name) {
  return (name || 'project').replace(/[^a-z0-9_\-]/gi, '_').replace(/_+/g, '_').slice(0, 60);
}

function _download(url, filename) {
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
}
