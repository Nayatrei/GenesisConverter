# Immersive Stage — pre-deployment review

Date: 2026-10-23. Branch: `feat/editor-immersive-stage`.

Status: implemented locally; **owner visual approval is required before merge/push/deployment**. Production and Render settings have not changed.

## Scope

- Home and all six converters share the approved B direction: near-black/lilac, horizontal navigation, a generous main canvas and a subordinate right inspector.
- The existing guide pages and sign-in callback use the same palette. Authentication logic, permissions, pricing and sign-in requirements are unchanged.
- Every converter remains available without signing in.
- Real 3D geometry, camera/bed framing, file processing, print checks and output formats are preserved. The mockup's decorative 3D sample is used only as Home artwork, not as a substitute for the working renderer.

## Structure

- `stage-theme.css` is the shared design system; existing component tokens alias its dark palette. `landing.css` now holds the B Home layout instead of the old light landing design.
- `3d-obj.html` remains the canonical tool shell. `sync:entrypoints` generates the six matching entrypoints; metadata and clean URLs are retained.
- `modules/stage-layout.js` reparents live controls on desktop and restores them to comment anchors on mobile. Nodes are never cloned. Controllers capture their node lists and bind listeners **before** layout relocation.
- Logo's builder and Raster/Bulk settings move to the right inspector. Export actions stay near that inspector on desktop and return to normal document flow on mobile.
- Raster adjustment queries use the shared Raster component scope so relocated controls continue to update. Bulk resize/mode/format node lists are captured before relocation.
- Mobile settings include a visible close button, Escape dismissal, focus restoration and keyboard focus containment.
- PDF's task chooser remains scrollable without trapping document scrolling. The mobile auto-reveal offset uses the new shared header.
- Annotate and Bulk respect controller-owned hidden flags; hidden editor/mode options no longer leak into empty or unrelated states.

## Function verification

Validation was proportional to a site-wide presentation change, not the full geometry/engine test suite on every CSS adjustment. Relevant failed checks were fixed and rerun; unrelated suites were not repeatedly executed.

Passing areas:

- Build, English UI check, synchronized entrypoints and content-release cache verification.
- Home navigation and recent-tool links, all six routes, canonical metadata and guide-to-tool links.
- Desktop and narrow-screen layout, right inspector positioning, no horizontal overflow, settings dismissal and normal document wheel scrolling.
- Responsive export/source node identity: no cloned handlers or duplicate buttons after viewport changes.
- Raster rotation, flip, crop, adjustment presets, resize controls and WEBP output.
- Bulk multi-file ZIP names, single-file naming, Korean filename preservation, batch rotation/adjustments, WEBP ZIP, reset and HEIC input acceptance.
- Bambu and default Logo 3MF exports: real package metadata, physical size checks and watertight geometry verification. Ten Logo presets remain available.
- PDF automatic flattened measurement, direct download without checkbox, original preservation, cancellation/replacement, unsupported input errors and mobile chooser positioning.
- Annotate empty-state visibility, drawing, undo/redo and original-resolution PNG output.

Manual browser review used local sample files only: real image import and 3D generation, Logo Update 3D, Raster canvas/settings, Bulk folder scan, PDF measured before/after sizes, Annotate arrow drawing, and mobile settings open/close. No real Google identity session or live Bambu desktop-app launch was needed. Those external flows are not claimed as newly verified.

The local screenshot gallery is `mockups/implemented-stage-review-20261023/index.html`. It contains actual implementation captures, not concept renders. Review artifacts and original A/B/C mockups remain local and are not part of the production source commit.

### Final verification record

Local content release: `r-dd34831b95192447`.

- `npm run build` and `npm run check:cache`: passed.
- `stage-ui`, `pdf-scroll`, `pdf-compression`, and `mobile-layout`: 23 tests passed on the final release.
- Focused Bambu package metadata, default Logo export and Logo preset registry checks: 3 tests passed on the final release.
- Raster edit and Bulk edit/ZIP checks passed in the preceding focused batch; the final change after that batch only corrected PDF task-menu height.
- Actual desktop captures cover Home and six tools; mobile captures cover the workspace and settings drawer. The review gallery was opened and checked locally.

These batches overlap; they are not a cumulative test count. No remote release action was taken.

## Owner review checklist

1. Home: hero scale, the six-tool launcher and readability.
2. Bambu/Logo: main stage versus settings density; actual 3D camera/bed framing is unchanged, not the mockup framing.
3. Raster/Bulk: finding dimensions, adjustments, format and download controls.
4. PDF: original/copy sizes and primary action stay together; all five tasks remain reachable.
5. Annotate/mobile: canvas access, wrapped tools, horizontal tab navigation and settings drawer.

## Release only after approval

1. Confirm the owner approves this visual implementation and the exact local revision.
2. Merge the feature branch, rebuild and verify that `check:cache` passes. The generated release key must include `stage-theme.css`, guides and all mutable modules.
3. Deploy the exact approved commit through the existing Render workflow. Do not publish the local review/mockup folders.
4. Verify Home, every clean tool URL, metadata, CSS release keys and representative file exports on the deployed origin.

No production deployment, provider change, account mutation or payment action was performed in this task.
