#!/usr/bin/env python3
"""
build_atlas.py — Download 1000 SLIME PNGs from IPFS and pack into sprite atlases.

Art atlas:
  - Tile size: 128x128 (downscaled from 2500x2500 originals)
  - Atlas size: 4096x4096 (32x32 grid = 1024 slots, 1000 used)
  - Sheets: 1
  - Format: JPEG quality 85

Nameplate atlas:
  - Cell size: 256x40
  - Atlas width: 4096 (16 nameplates per row)
  - Atlas height: 2560 (63 rows for 1000 plates)
  - Sheets: 1
  - Format: PNG (text needs sharp edges)

Outputs:
  - assets/atlas_0.jpg     — art atlas
  - assets/plates_0.png    — nameplate atlas
  - assets/atlas_manifest.json

Usage:
  pip install Pillow requests
  python tools/build_atlas.py
"""

import json
import re
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow not installed. Run: pip install Pillow")

try:
    import requests
except ImportError:
    sys.exit("requests not installed. Run: pip install requests")

# --- Art atlas config ---
TILE_SIZE = 256
GRID_SIZE = 16          # 16x16 = 256 slots per atlas
ATLAS_SIZE = TILE_SIZE * GRID_SIZE  # 4096
JPEG_QUALITY = 85
MAX_TILES = 1000        # all SLIME tiles (4 sheets × 256, last partial)

# --- Nameplate atlas config ---
PLATE_W = 128
PLATE_H = 24
PLATE_COLS = 16         # 16 nameplates per row (16 * 128 = 2048)
PLATE_ATLAS_W = PLATE_COLS * PLATE_W  # 2048

# --- Download config ---
MAX_WORKERS = 20
RETRY_COUNT = 3
TIMEOUT = 30

PROJECT_ROOT = Path(__file__).resolve().parent.parent
URLS_FILE = PROJECT_ROOT / "tools" / "slime_urls.txt"
ASSETS_DIR = PROJECT_ROOT / "assets"
CACHE_DIR = PROJECT_ROOT / "tools" / ".download_cache"


def extract_urls():
    """Read URLs from slime_urls.txt, return list of (label, url) tuples."""
    if not URLS_FILE.exists():
        sys.exit(f"URL file not found: {URLS_FILE}")

    urls = [line.strip() for line in URLS_FILE.read_text(encoding="utf-8").splitlines() if line.strip()]
    print(f"Found {len(urls)} URLs in {URLS_FILE.name}")

    result = []
    for url in urls:
        num_match = re.search(r"SLIME(?:%23|%20)(\d+)\.png", url)
        label = f"SLIME #{num_match.group(1)}" if num_match else f"SLIME_unknown_{len(result)}"
        result.append((label, url))

    return result


def download_image(label, url, cache_dir):
    """Download a single image with retries. Returns (label, PIL.Image) or (label, None)."""
    safe_name = re.sub(r'[^\w#]', '_', label) + ".png"
    cache_path = cache_dir / safe_name
    if cache_path.exists():
        try:
            return label, Image.open(cache_path).convert("RGB")
        except Exception:
            cache_path.unlink(missing_ok=True)

    for attempt in range(RETRY_COUNT):
        try:
            gateways = [
                url,
                url.replace("ipfs.io", "cloudflare-ipfs.com"),
                url.replace("ipfs.io", "dweb.link"),
            ]
            gateway_url = gateways[min(attempt, len(gateways) - 1)]
            resp = requests.get(gateway_url, timeout=TIMEOUT)
            resp.raise_for_status()
            cache_path.write_bytes(resp.content)
            img = Image.open(cache_path).convert("RGB")
            return label, img
        except Exception as e:
            if attempt < RETRY_COUNT - 1:
                time.sleep(2 ** attempt)
            else:
                print(f"  FAILED: {label} — {e}")
                return label, None


def build_art_atlases(tiles):
    """
    Pack art tiles into atlas sheets (GRID_SIZE x GRID_SIZE each).
    tiles: list of (label, PIL.Image) — already resized to TILE_SIZE.
    Returns list of (atlas_image, entries) per sheet.
    """
    slots_per_sheet = GRID_SIZE * GRID_SIZE
    atlases = []
    tile_idx = 0

    while tile_idx < len(tiles):
        atlas_img = Image.new("RGB", (ATLAS_SIZE, ATLAS_SIZE), (10, 10, 20))
        entries = []

        for slot in range(slots_per_sheet):
            if tile_idx >= len(tiles):
                break
            label, img = tiles[tile_idx]
            col = slot % GRID_SIZE
            row = slot // GRID_SIZE
            x = col * TILE_SIZE
            y = (GRID_SIZE - 1 - row) * TILE_SIZE
            atlas_img.paste(img, (x, y))
            entries.append({"label": label, "atlas": len(atlases), "col": col, "row": row})
            tile_idx += 1

        atlases.append((atlas_img, entries))

    return atlases


def build_nameplate_atlas(labels):
    """
    Render all nameplate labels into a single atlas PNG.
    Returns (atlas_image, plate_rows, plate_cols, dict of {label: {col, row}}).
    """
    count = len(labels)
    rows_needed = (count + PLATE_COLS - 1) // PLATE_COLS
    atlas_h = rows_needed * PLATE_H

    atlas_img = Image.new("RGBA", (PLATE_ATLAS_W, atlas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas_img)

    # Use a monospace font — try common system fonts, fall back to default
    font = None
    for font_name in ["cour.ttf", "courbd.ttf", "consola.ttf", "consolab.ttf",
                       "DejaVuSansMono-Bold.ttf", "LiberationMono-Bold.ttf"]:
        try:
            font = ImageFont.truetype(font_name, 14)
            break
        except (IOError, OSError):
            continue
    if font is None:
        font = ImageFont.load_default()

    entries = {}
    for i, label in enumerate(labels):
        col = i % PLATE_COLS
        row = i // PLATE_COLS
        x = col * PLATE_W
        y = (rows_needed - 1 - row) * PLATE_H

        # Background
        draw.rectangle([x, y, x + PLATE_W - 1, y + PLATE_H - 1], fill=(26, 16, 8, 255))
        # Text centered
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        tx = x + (PLATE_W - tw) // 2
        ty = y + (PLATE_H - th) // 2
        draw.text((tx, ty), label, fill=(255, 245, 224, 255), font=font)

        entries[label] = {"col": col, "row": row}

    return atlas_img, rows_needed, entries


def main():
    ASSETS_DIR.mkdir(exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Extract URLs (capped to MAX_TILES)
    url_list = extract_urls()[:MAX_TILES]
    print(f"Using {len(url_list)} tiles (capped at {MAX_TILES})")

    # 2. Download all images in parallel
    print(f"Downloading {len(url_list)} images (cached in {CACHE_DIR})...")
    downloaded = [None] * len(url_list)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {}
        for i, (label, url) in enumerate(url_list):
            fut = pool.submit(download_image, label, url, CACHE_DIR)
            futures[fut] = i

        done_count = 0
        for fut in as_completed(futures):
            idx = futures[fut]
            label, img = fut.result()
            if img is not None:
                img = img.resize((TILE_SIZE, TILE_SIZE), Image.LANCZOS)
                downloaded[idx] = (label, img)
            else:
                placeholder = Image.new("RGB", (TILE_SIZE, TILE_SIZE), (26, 26, 46))
                downloaded[idx] = (label, placeholder)
            done_count += 1
            if done_count % 50 == 0 or done_count == len(url_list):
                print(f"  {done_count}/{len(url_list)} downloaded")

    tiles = [t for t in downloaded if t is not None]
    print(f"Packing {len(tiles)} tiles into art atlas...")

    # 3. Build art atlases (multiple sheets at 256px tiles)
    art_atlases = build_art_atlases(tiles)
    all_art_entries = []
    for i, (art_img, entries) in enumerate(art_atlases):
        art_path = ASSETS_DIR / f"atlas_{i}.jpg"
        art_img.save(str(art_path), "JPEG", quality=JPEG_QUALITY)
        size_mb = art_path.stat().st_size / (1024 * 1024)
        print(f"  {art_path.name}: {size_mb:.1f} MB ({len(entries)} tiles)")
        all_art_entries.extend(entries)

    # Remove stale atlas sheets beyond what we generated
    for i in range(len(art_atlases), 20):
        old = ASSETS_DIR / f"atlas_{i}.jpg"
        if old.exists():
            old.unlink()
            print(f"  Removed old {old.name}")

    # 4. Build nameplate atlas
    labels = [entry["label"] for entry in all_art_entries]
    print(f"Building nameplate atlas for {len(labels)} labels...")
    plate_img, plate_rows, plate_entries = build_nameplate_atlas(labels)
    plate_path = ASSETS_DIR / "plates_0.png"
    plate_img.save(str(plate_path), "PNG")
    size_kb = plate_path.stat().st_size / 1024
    print(f"  {plate_path.name}: {size_kb:.0f} KB ({len(plate_entries)} nameplates, {PLATE_COLS}x{plate_rows})")

    # 5. Generate manifest
    manifest = {
        "tileSize": TILE_SIZE,
        "gridSize": GRID_SIZE,
        "atlasSize": ATLAS_SIZE,
        "atlasCount": len(art_atlases),
        "plate": {
            "cellWidth": PLATE_W,
            "cellHeight": PLATE_H,
            "cols": PLATE_COLS,
            "rows": plate_rows,
            "atlasWidth": PLATE_ATLAS_W,
            "atlasHeight": plate_rows * PLATE_H,
        },
        "tiles": {},
    }

    for entry in all_art_entries:
        label = entry["label"]
        plate = plate_entries[label]
        manifest["tiles"][label] = {
            "atlas": 0,
            "col": entry["col"],
            "row": entry["row"],
            "plateCol": plate["col"],
            "plateRow": plate["row"],
        }

    manifest_path = ASSETS_DIR / "atlas_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"  Manifest: {manifest_path.name} ({len(manifest['tiles'])} tiles)")

    print("\nDone! Atlas files written to assets/")


if __name__ == "__main__":
    main()
