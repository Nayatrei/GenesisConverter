Genesis Image Converter
=======================

Browser-based tool that converts images (PNG/JPG) and HTML snippets into multi-color SVG layers and 3D-printable models, optimized for Bambu Lab / Bambu Studio workflows.

Launch: https://editor.genesisframeworks.com/

## Tabs

The frontend is a client-side multi-tab app served by a lightweight Node transfer server. Every clean tab URL has a matching static entrypoint (`3d-obj.html`, `logo.html`, `raster.html`, `bulk.html`, and `pdf.html`). Those files share one synchronized app shell and select the active tab from the URL. Run `npm run sync:entrypoints` after changing `3d-obj.html`; the test suite rejects drift between entrypoints. Each tab's content is an HTML partial in `modules/tabs/html/` driven by a controller in `modules/tabs/`:

- **Logo** — HTML or PNG input → color-layered SVG → Three.js 3D preview → OBJ / 3MF / STL export. Backing-plate and per-layer thickness controls for multi-filament AMS printing.
- **SVG** — Image tracing via ImageTracer.js with presets for 3D-print, sharp detail, silhouette, multi-color.
- **Raster** — Raster-level color quantization utilities.
- **Bulk** — Batch conversion across multiple inputs.

## 3D export formats

- **3MF** — Bambu Studio native; embeds per-layer colors via `<m:basematerials>`.
- **OBJ + MTL** — General-purpose 3D model with materials.
- **STL** — Per-layer binary STL files for manual filament assignment. Named `{image}_{thickness}mm_L{n}_{hex}.stl`.

The 3D and Logo tabs build the 3MF in the browser. When the optional transfer API is available they can prepare a private 10-minute link; on a static host they download the same 3MF locally. A second trusted click opens Bambu Studio on macOS/Windows, with clear instructions to finish the import.

## Running locally

Run the included Node server to enable the optional direct-link handoff. Static hosting continues to work through the local-download fallback:

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173/`. Serving the files as a static site still supports normal 3MF downloads, but direct Bambu Studio handoff will fall back to download-and-open because it needs the temporary transfer endpoint.

Tests use Playwright and start the same server:

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
