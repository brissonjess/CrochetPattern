# Crochet Tapestry Designer

A browser-based pixel design tool for planning tapestry crochet, graphghan, and other colorwork patterns. Design your project on a grid, calculate your gauge, generate written row-by-row instructions, and export a printable chart — all without installing anything.

---

## Features

- **Pixel grid editor** — pencil, eraser, fill bucket, eyedropper, and rectangle select tools
- **Color palette** — add, edit, delete, and toggle visibility of colors; view per-color stitch counts
- **Garment templates** — start from a pre-shaped panel (vest, sweater, sleeve, dress, beanie, tote, scarf, cardigan) or design a blank canvas
- **Multi-panel projects** — each garment piece lives on its own panel with independent undo history; switch between panels with a tab bar
- **Edit Garment Shape** — draw or erase the mask layer to define exactly which stitches are inside your garment piece
- **Swatch calculator** — enter your swatch dimensions and stitch counts to calculate gauge and automatically size the grid; lock aspect ratio to scale width and height together
- **Expand canvas** — add empty rows or columns to any side of the current panel without scaling or overwriting your design
- **Pattern & instructions** — written row-by-row instructions with color run-lengths; shaping analysis tab shows per-row increases and decreases
- **Aspect ratio preview** — render cells at the correct proportions for your stitch type
- **Reading mode** — step through rows one at a time while crocheting
- **Image import** — drop in a reference image and the app quantizes it to your palette and grid size
- **Export** — PNG chart image, print-ready PDF (with legend and written instructions), CSV instructions, and JSON project backup
- **Dark mode** — toggle from the toolbar
- **Auto-save** — changes save to your local projects folder automatically
- **No internet required** — runs entirely in your browser from a local file; no server, no account, no data leaves your machine

---

## Requirements

| Requirement | Notes |
|---|---|
| A modern browser | Chrome 86+ or Edge 86+ recommended. Firefox and Safari have limited or no support for the File System Access API used for project saving. |
| Windows (for the optional launcher) | The setup script that creates a desktop shortcut is Windows-only. On Mac/Linux just open `index.html` directly. |

> **Why Chrome/Edge?** The app saves projects to a folder on your computer using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API). This API is fully supported in Chrome and Edge. In Firefox you can still use the app, but saving to a local folder will not be available — use **Export → Save File (.json)** instead to back up your work.

---

## Setup

### Option A — Just open the file (all platforms)

1. Click the green **Code** button on this page and choose **Download ZIP**
2. Unzip the folder anywhere on your computer
3. Open **`index.html`** in Chrome or Edge

That's it. No install, no npm, no build step.

### Option B — Desktop shortcut on Windows

If you want a shortcut you can pin to your taskbar or Start menu:

1. Download and unzip the project (same as above)
2. Double-click **`setup.bat`** inside the unzipped folder
3. Allow PowerShell to run when prompted
4. A shortcut called **Crochet Tapestry Designer** will appear on your desktop

The shortcut opens the app in a minimal browser window (no address bar) so it feels like a standalone application.

> If Windows blocks the script, right-click `setup.bat` → **Run as administrator**, or run this in PowerShell:
> ```powershell
> powershell -ExecutionPolicy Bypass -File create-launcher.ps1
> ```

### Option C — Clone with Git

```bash
git clone https://github.com/brissonjess/CrochetPattern.git
cd CrochetPattern
# Open index.html in Chrome or Edge
```

---

## First-time use

1. **Set up a projects folder** — on the Projects screen, click **Set up projects folder** and choose (or create) a folder on your computer. The app will save all your projects there as `.json` files. You only need to do this once.

2. **Create a project** — click **New Project**, give it a name, pick a stitch type, and either choose a garment template or set a custom canvas size. You can enter the size in stitches, inches, or centimetres.

3. **Set your gauge** — open **Swatch Calc** from the editor toolbar. Measure a test swatch, enter its dimensions and stitch/row counts, and click **Apply Both** to set your gauge and resize the grid to match your finished size.

4. **Design** — use the color palette on the right to add colors and paint your design. Switch panels using the tabs at the top if you have a multi-panel garment project.

5. **Export** — when you're ready, use **Export** in the toolbar to download a PNG chart, a printable PDF with written instructions, or a CSV of the row-by-row instructions.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `P` | Pencil tool |
| `E` | Eraser tool |
| `B` | Fill bucket |
| `I` | Eyedropper |
| `S` | Select rectangle |
| `H` | Flip horizontal |
| `V` | Flip vertical |
| `Ctrl Z` | Undo |
| `Ctrl Y` | Redo |
| `Ctrl S` | Save |
| `Ctrl C` | Copy selection |
| `Ctrl V` | Paste |
| `Del` | Clear selection |
| `+` / `-` | Zoom in / out |
| `0` | Fit canvas to screen |
| `?` | Show all shortcuts |
| `Esc` | Close modal / exit mode |

---

## Project files

Your projects are saved as plain `.json` files in the folder you chose. You can:

- **Back them up** by copying the folder
- **Transfer them** to another computer by copying the `.json` files
- **Restore them** using **Export → Save File (.json)** to download a copy, then re-import with the Import button on the Projects screen

The `projects/` folder is excluded from this repository — your saved designs never leave your machine.

---

## License

This project is released for personal and educational use. Feel free to fork, modify, and share.
