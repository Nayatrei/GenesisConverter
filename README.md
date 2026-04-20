Genesis Image Converter
=======================

Browser-based tool that converts images (PNG/JPG) and HTML snippets into multi-color SVG layers and 3D-printable models, optimized for Bambu Lab / Bambu Studio workflows.

Launch: https://editor.genesisframeworks.com/

## Tabs

The app is a static multi-tab site. The main shell is `converter.html` (loaded via `index.html`); each tab is an HTML partial in `modules/tabs/html/` driven by a controller in `modules/tabs/`:

- **Logo** — HTML or PNG input → color-layered SVG → Three.js 3D preview → OBJ / 3MF / STL export. Backing-plate and per-layer thickness controls for multi-filament AMS printing.
- **SVG** — Image tracing via ImageTracer.js with presets for 3D-print, sharp detail, silhouette, multi-color.
- **Raster** — Raster-level color quantization utilities.
- **Bulk** — Batch conversion across multiple inputs.

## 3D export formats

- **3MF** — Bambu Studio native; embeds per-layer colors via `<m:basematerials>`.
- **OBJ + MTL** — General-purpose 3D model with materials.
- **STL** — Per-layer binary STL files for manual filament assignment. Named `{image}_{thickness}mm_L{n}_{hex}.stl`.

The Logo tab can optionally open the exported 3MF directly in Bambu Studio (macOS/Windows) via a protocol handler bridge (`modules/bambu-bridge.js`).

## Running locally

Static site — serve any way you like:

```bash
npx http-server . -p 8080
# or
python -m http.server 8080
```

Tests use Playwright:

```bash
npm install
npx playwright test
```

## Presets (SVG tab)

- 3D Print (Tinkercad Ready) — clean extrusion, minimal paths
- Smooth Curves — flowing, soft edges
- Sharp Details — preserves crisp edges
- High Contrast Silhouette — bold two-tone
- Multi-Color Detailed / Simple Colors — color-layer preservation

## Tips

- Use simple, high-contrast inputs for the cleanest prints.
- Limit colors to 2-4 for practical multi-filament printing.
- Backing plate (Logo tab) gives letters/graphics a solid foundation to sit on.

## Technical

- `imagetracer_v1.2.6.js` — raster-to-vector tracing
- Three.js — 3D preview and geometry (`modules/preview3d.js`)
- `modules/export3d.js` — OBJ / 3MF / STL generation (including in-browser ZIP for 3MF)
- `modules/layer-layout.js` — per-layer Z stacking, base/backing layer handling
