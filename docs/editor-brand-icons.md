# Editor brand icon source

The approved master is the **Image Tool robot with image/3D printer**, not the
Genesis ID `genesis-i-app-icon` or a promotional poster.

- Canonical workspace reference: `BrandIdentity/assets/app-icons/references/genesis-image-tool.png`
- Checked-in byte-identical master: `icon-512.png`
- SHA-256: `a9c538a5340261c561e0400e110bb9a3a161c7c8ced966831383d655f5d77b8a`

`scripts/generate-brand-icons.py` uses Pillow to resize this master to browser
favicons, a multi-size ICO, Apple Touch and PWA sizes. It never crops, redraws or
generates artwork. Maskable variants use an opaque background with the entire
artwork inside the 80%-diameter safe circle. Python is not needed at deploy time;
the generated assets are committed.

`npm run build` synchronizes all public page heads and the callback with the
same content-derived `brand-…` asset version and updates PWA references. The
shared header partial uses the mascot image with intrinsic dimensions and no
additional background, border, shadow or clipping radius. Its accessible link
name remains Genesis Editor home. Public Home, tools and guides share this
header; there is no separate current sidebar brand logo.

The Genesis Frameworks company-information footer is a different brand and
retains its existing corporate logo. Functional tool icons and illustrative
workspace content are not app-brand icons and remain unchanged.

Verification: `tests/brand-icons.spec.js`, existing site-chrome/entrypoint/cache
tests, and actual deployed desktop/mobile header inspection. Do not request a
new versioned asset URL before the deployment manifest announces the release:
that can populate CDN caches with a previous deployment's asset.
