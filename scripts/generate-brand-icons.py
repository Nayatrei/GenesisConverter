"""Resize the approved Image Tool master. No image generation or cropping.

Run with Python + Pillow. Runtime/build has no Python dependency: commit outputs.
The 512px icon is the unchanged master from BrandIdentity's references folder.
"""
from pathlib import Path
import hashlib
from PIL import Image

root = Path(__file__).resolve().parent.parent
if hashlib.sha256((root / "icon-512.png").read_bytes()).hexdigest() != "a9c538a5340261c561e0400e110bb9a3a161c7c8ced966831383d655f5d77b8a":
    raise ValueError("Master differs from the approved Image Tool reference; review before regenerating")
source = Image.open(root / "icon-512.png").convert("RGBA")
if source.size != (512, 512):
    raise ValueError("Expected the approved square 512px master")

for filename, size in [("favicon-16x16.png", 16), ("favicon-32x32.png", 32),
                       ("apple-touch-icon.png", 180), ("icon-192.png", 192)]:
    source.resize((size, size), Image.Resampling.LANCZOS).save(root / filename)
source.save(root / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

# Entire square artwork fits inside the central 80%-diameter maskable safe
# circle: 56% * sqrt(2) < 80%. Opaque background fills the remaining canvas.
for size in [192, 512]:
    canvas = Image.new("RGBA", (size, size), "#111827")
    side = int(size * 0.56)
    artwork = source.resize((side, side), Image.Resampling.LANCZOS)
    canvas.alpha_composite(artwork, ((size - side) // 2, (size - side) // 2))
    canvas.convert("RGB").save(root / f"maskable-icon-{size}.png")
print("Resized approved Editor master; ICO, PNG, Apple and maskable outputs ready.")
