# Immersive Stage — pre-deployment review

Date: 2026-10-23. Branch: `feat/editor-immersive-stage`.

Status: **owner approved the reviewed main-only layout and authorized commit, merge and deployment on 2026-10-23**. Approved content release: `r-8acb18e35a0108d5`. The checkpoint records below describe the local review before publication; they do not assert a completed production deployment.

## Scope

- Home and all six converters share the approved B direction: near-black/lilac, horizontal navigation and a generous main canvas. Following owner feedback, shared side panels and the mobile settings drawer have been removed; each tool now keeps its controls in the main workflow.
- The existing guide pages and sign-in callback use the same palette. Authentication logic, permissions, pricing and sign-in requirements are unchanged.
- Every converter remains available without signing in.
- Real 3D geometry, camera/bed framing, file processing, print checks and output formats are preserved. The mockup's decorative 3D sample is used only as Home artwork, not as a substitute for the working renderer.

## Structure

- `stage-theme.css` is the shared design system; existing component tokens alias its dark palette. `landing.css` now holds the B Home layout instead of the old light landing design.
- `3d-obj.html` remains the canonical tool shell. `sync:entrypoints` generates the six matching entrypoints; metadata and clean URLs are retained.
- Home, tools and guides share `modules/partials/header.html` and `footer-brand.html`. `scripts/sync-site-chrome.js` embeds both at build time, so navigation and company information do not depend on a successful runtime fetch. Edit the partials rather than their generated HTML blocks.
- All headers expose Home, the same six tool links, Guides and the same optional Genesis ID widget. Tool links retain in-app state, browser history, modified-click and no-JS navigation. The current tool uses `aria-current` and is revealed in the narrow-screen navigation rail.
- The company footer follows `/Users/jongmac/Documents/WebTools/footerguide`: 64px original logo, brand introduction, service links, email, LinkedIn and dynamic copyright year; 2fr/1fr/1fr desktop columns and stacking below 768px. Existing central Genesis ID account management remains in place instead of reintroducing the retired donation action. No legal address or company registration detail was invented.
- `modules/stage-layout.js` mounts bound shared import and 3D controls once into main-workflow hosts. Nodes are never cloned or relocated again on viewport changes. Controllers capture node lists and bind listeners **before** mounting. The empty source container is then removed.
- Import/replace controls sit above the workspace; 3D settings and export actions follow the preview. Logo's builder, Raster adjustments, Bulk controls, PDF task choices and all download actions remain inside their own main workflows. The redundant Raster replacement thumbnail is suppressed; the full canvas and main Import button remain available.
- Raster adjustment queries use the shared Raster component scope so relocated controls continue to update. Bulk resize/mode/format node lists are captured before relocation.
- Mobile uses the same normal document flow, not a hidden settings dialog or scroll-locking overlay. Navigation remains horizontally scrollable.
- PDF's compact five-task chooser lives above the selected task, without a sidebar or responsive reparenting. Its descriptions remain available through accessible names. The mobile auto-reveal offset uses the shared header.
- Annotate and Bulk respect controller-owned hidden flags; hidden editor/mode options no longer leak into empty or unrelated states.

## Function verification

Validation was proportional to a site-wide presentation change, not the full geometry/engine test suite on every CSS adjustment. Relevant failed checks were fixed and rerun; unrelated suites were not repeatedly executed.

Passing areas:

- Build, English UI check, synchronized entrypoints and content-release cache verification.
- Home navigation and recent-tool links, all six routes, canonical metadata and guide-to-tool links.
- Desktop and narrow-screen main-only layout, no horizontal overflow, directly reachable controls and normal document wheel scrolling.
- Stable export/source node identity: no cloned handlers, duplicate buttons or movement into a hidden panel after viewport changes.
- Raster rotation, flip, crop, adjustment presets, resize controls and WEBP output.
- Bulk multi-file ZIP names, single-file naming, Korean filename preservation, batch rotation/adjustments, WEBP ZIP, reset and HEIC input acceptance.
- Bambu and default Logo 3MF exports: real package metadata, physical size checks and watertight geometry verification. Ten Logo presets remain available.
- PDF automatic flattened measurement, direct download without checkbox, original preservation, cancellation/replacement, unsupported input errors and mobile chooser positioning.
- Annotate empty-state visibility, drawing, undo/redo and original-resolution PNG output.

Manual browser review used local sample files only: real image import and 3D generation, Logo Update 3D, Raster canvas/settings, Bulk folder scan, PDF measured before/after sizes, Annotate arrow drawing, and mobile settings open/close. No real Google identity session or live Bambu desktop-app launch was needed. Those external flows are not claimed as newly verified.

The original local screenshot gallery and ZIP in `mockups/implemented-stage-review-20261023/` preserve the earlier inspector-layout checkpoint. Current review is the live app at `http://127.0.0.1:5196/`; the latest main-only captures use the `inline-*.png` filenames in that folder. Review artifacts and original A/B/C mockups remain local and are not part of the production source commit.

### Initial Stage verification record

Local content release: `r-dd34831b95192447`.

- `npm run build` and `npm run check:cache`: passed.
- `stage-ui`, `pdf-scroll`, `pdf-compression`, and `mobile-layout`: 23 tests passed on the final release.
- Focused Bambu package metadata, default Logo export and Logo preset registry checks: 3 tests passed on the final release.
- Raster edit and Bulk edit/ZIP checks passed in the preceding focused batch; the final change after that batch only corrected PDF task-menu height.
- Actual desktop captures cover Home and six tools; mobile captures cover the workspace and settings drawer. The review gallery was opened and checked locally.

These batches overlap; they are not a cumulative test count. No remote release action was taken.

### Header and company-footer follow-up

Local content release: `r-81d6851b0eeac384`. Build, English UI and content-cache checks pass.

- Initial focused header/footer, Home, entrypoint and Stage batch: 20 tests passed.
- Manual mobile inspection caught inherited card-style tabs; their CSS precedence was corrected. The strengthened shared-chrome and Stage batch then passed all 9 tests, including compact tab size checks at 320, 390, 768, 1024, 1280 and 1440px.
- Manual local-browser QA confirmed Home-to-PDF navigation, active-tool indication, the full desktop company footer and the stacked phone footer.
- Final release-cache and footer accessibility batch: 10 tests passed, including early import during boot and the versioned shared-chrome script on Home, tools and guides.
- The live owner-review server remains at `http://127.0.0.1:5196/` by request. Extra QA tabs are closed after inspection; no deployment has occurred.

## Owner review checklist

Current main-only content release: `r-8acb18e35a0108d5`.

- Removed the shared side rail, its export/source hosts, responsive reparenting, settings toggle, backdrop, drawer script and scroll lock. Shared controls are mounted once inside `main`; per-tool controls remain in their native tool markup.
- PDF stays in its native workspace host at every width. A leftover old navigation call and grid ordering were fixed; the compact chooser keeps measured before/after sizes visible at desktop review sizes. Mobile still reveals the compression chooser below the sticky header.
- Focused Stage/Raster/header/cache batch: 16 passed. Focused Bambu/Logo package and preset checks: 3 passed. PDF compression/scroll follow-up: 13 passed. These checks preceded only the final Bulk active-text contrast adjustment; the final route/contrast and WEBP ZIP recheck passed 3 tests. Counts overlap.
- Manual browser QA used only local samples: Bambu image import and real 3D generation; Logo Update 3D; Raster editing canvas; Bulk folder scan with 2 images and 1 skipped PDF; measured PDF 2.26 KB → 1.37 KB; Annotate canvas; and phone-sized inline input/settings. No external identity, paid API or Bambu desktop launch was used.
- Build, English-only UI, cache graph and whitespace checks pass. No push, merge, deployment or account/payment mutation has occurred. The owner's existing review tab and localhost server remain by request; temporary QA tabs and test servers are closed.

1. Home: hero scale, the six-tool launcher and readability.
2. Bambu/Logo: full-width stage and inline conversion/print settings; actual 3D camera/bed framing is unchanged, not the mockup framing.
3. Raster/Bulk: finding dimensions, adjustments, format and download controls.
4. PDF: original/copy sizes and primary action stay together; all five tasks remain reachable.
5. Annotate/mobile: canvas access, wrapped tools, horizontal tab navigation and directly reachable main controls.

## Release only after approval

1. Confirm the owner approves this visual implementation and the exact local revision.
2. Merge the feature branch, rebuild and verify that `check:cache` passes. The generated release key must include `stage-theme.css`, guides and all mutable modules.
3. Deploy the exact approved commit through the existing Render workflow. Do not publish the local review/mockup folders.
4. Verify Home, every clean tool URL, metadata, CSS release keys and representative file exports on the deployed origin.

No production deployment, provider change, account mutation or payment action was performed in this task.
