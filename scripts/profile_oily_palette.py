#!/usr/bin/env python3
import base64
import io
import json
import random
import sys
import urllib.error
import urllib.parse
import urllib.request

from PIL import Image


def clamp_channel(value):
    return max(0, min(255, int(round(value))))


def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(
        clamp_channel(rgb[0]),
        clamp_channel(rgb[1]),
        clamp_channel(rgb[2]),
    )


def validate_image_url(value):
    parsed = urllib.parse.urlparse(str(value or "").strip())
    if parsed.scheme not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return parsed.geturl()


def fetch_image_bytes(image_url):
    request = urllib.request.Request(
        image_url,
        headers={
            "User-Agent": "PhenoMedPalette/1.0",
            "Accept": "image/*",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read()


def extract_palette(image_bytes, color_count=6):
    with Image.open(io.BytesIO(image_bytes)).convert("RGB") as image:
        reduced = image.resize((96, 96), Image.Resampling.LANCZOS)
        indexed = reduced.convert(
            "P", palette=Image.Palette.ADAPTIVE, colors=color_count)
        palette_raw = indexed.getpalette()[: color_count * 3]

        palette = []
        for index in range(0, len(palette_raw), 3):
            if index + 2 >= len(palette_raw):
                break
            palette.append(
                (palette_raw[index], palette_raw[index + 1], palette_raw[index + 2]))

        if not palette:
            palette = [(34, 207, 187), (15, 162, 147), (124, 157, 165)]

        return palette


def build_oily_svg(palette, seed_value):
    width = 720
    height = 360
    randomizer = random.Random(seed_value)
    colors = [rgb_to_hex(color) for color in palette]
    background_a = colors[0]
    background_b = colors[1 if len(colors) > 1 else 0]

    strokes = []
    stroke_count = 52
    for _ in range(stroke_count):
        tone = colors[randomizer.randrange(0, len(colors))]
        cx = randomizer.uniform(0, width)
        cy = randomizer.uniform(0, height)
        rx = randomizer.uniform(22, 160)
        ry = randomizer.uniform(10, 62)
        rotate = randomizer.uniform(-40, 40)
        alpha = randomizer.uniform(0.34, 0.84)
        strokes.append(
            f'<ellipse cx="{cx:.2f}" cy="{cy:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" '
            f'fill="{tone}" fill-opacity="{alpha:.3f}" transform="rotate({rotate:.2f} {cx:.2f} {cy:.2f})" />'
        )

    texture = []
    for _ in range(150):
        x1 = randomizer.uniform(0, width)
        y1 = randomizer.uniform(0, height)
        x2 = x1 + randomizer.uniform(-54, 54)
        y2 = y1 + randomizer.uniform(-28, 28)
        shade = colors[randomizer.randrange(0, len(colors))]
        alpha = randomizer.uniform(0.14, 0.34)
        width_px = randomizer.uniform(2.4, 6.8)
        texture.append(
            f'<path d="M {x1:.2f} {y1:.2f} Q {(x1 + x2) / 2:.2f} {(y1 + y2) / 2:.2f} {x2:.2f} {y2:.2f}" '
            f'stroke="{shade}" stroke-opacity="{alpha:.3f}" stroke-width="{width_px:.2f}" fill="none" stroke-linecap="round" />'
        )

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" preserveAspectRatio="none">'
        "<defs>"
        f'<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="{background_a}"/><stop offset="100%" stop-color="{background_b}"/></linearGradient>'
        '<filter id="soft"><feGaussianBlur stdDeviation="1.8"/></filter>'
        '<filter id="impasto"><feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves="4" seed="7"/><feDisplacementMap in="SourceGraphic" scale="26"/></filter>'
        '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0 0.11"/></feComponentTransfer></filter>'
        "</defs>"
        '<rect width="100%" height="100%" fill="url(#bg)"/>'
        f'<g filter="url(#soft)">{"".join(strokes)}</g>'
        f'<g filter="url(#impasto)">{"".join(texture)}</g>'
        '<rect width="100%" height="100%" filter="url(#grain)"/>'
        "</svg>"
    )

    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        print(json.dumps({"ok": False, "error": "Invalid JSON payload."}))
        return

    image_url = validate_image_url(payload.get("imageUrl"))
    if not image_url:
        print(json.dumps(
            {"ok": False, "error": "A valid http/https imageUrl is required."}))
        return

    try:
        image_bytes = fetch_image_bytes(image_url)
        palette = extract_palette(image_bytes)
        overlay_svg_data_url = build_oily_svg(palette, seed_value=image_url)
        response = {
            "ok": True,
            "palette": [rgb_to_hex(color) for color in palette],
            "overlaySvgDataUrl": overlay_svg_data_url,
        }
        print(json.dumps(response))
    except urllib.error.URLError as error:
        print(json.dumps(
            {"ok": False, "error": f"Failed to fetch image: {error.reason}"}))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))


if __name__ == "__main__":
    main()
