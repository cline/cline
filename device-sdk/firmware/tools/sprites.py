#!/usr/bin/env python3
"""Validate the shared avatar catalog and compile a selected mono variant.

TXT uses '.' for white and '#' for black. PNG compilation requires Pillow.
GIF/WebP are browser image variants; firmware does not decode them.
"""
import argparse
import json
from pathlib import Path
import struct

CATALOG = Path(__file__).resolve().parents[2] / "assets/avatars/manifest.json"
STATES = ("idle", "working", "waiting", "listening", "thinking", "done", "error", "sleeping", "offline")
FORMATS = {"txt", "png", "gif", "webp"}
RENDERERS = {"mono-1bit", "mono-tinted", "image"}


def asset_path(root, name):
    if not isinstance(name, str) or not name or any(c in name for c in "\\?#:"):
        raise ValueError(f"Invalid asset path: {name!r}")
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f"Missing or out-of-root asset: {name}")
    return path


def dimensions(path, fmt):
    if fmt == "txt":
        rows = path.read_text().splitlines()
        if not rows or not rows[0] or any(len(r) != len(rows[0]) or set(r) - {".", "#"} for r in rows):
            raise ValueError(f"Malformed TXT sprite: {path}")
        return len(rows[0]), len(rows)
    data = path.read_bytes()
    if fmt == "gif" and data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if fmt == "png" and data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if fmt == "webp":
        from PIL import Image
        with Image.open(path) as img:
            if img.format == "WEBP":
                return img.size
    raise ValueError(f"Invalid {fmt} image: {path}")


def validate_catalog(catalog_path):
    data = json.loads(catalog_path.read_text())
    if data.get("schemaVersion") != 1:
        raise ValueError("Unsupported avatar manifest schemaVersion")
    avatars = data.get("avatars", {})
    if data.get("defaultAvatar") not in avatars or not data.get("devices"):
        raise ValueError("Manifest needs a valid defaultAvatar and device selections")
    for avatar_id, avatar in avatars.items():
        if not avatar.get("name") or not avatar.get("variants"):
            raise ValueError(f"Avatar {avatar_id} needs a name and variants")
        for variant_id, variant in avatar["variants"].items():
            fmt = variant.get("format")
            if fmt not in FORMATS or type(variant.get("version")) is not int or variant["version"] < 1:
                raise ValueError(f"Invalid format/version: {avatar_id}/{variant_id}")
            size = variant.get("width"), variant.get("height")
            if any(type(n) is not int or n < 1 for n in size):
                raise ValueError(f"Invalid dimensions: {avatar_id}/{variant_id}")
            states = variant.get("states", {})
            if set(states) != set(STATES):
                raise ValueError(f"All nine states must be explicit: {avatar_id}/{variant_id}")
            for state, frames in states.items():
                if not isinstance(frames, list) or not frames or len(frames) > 255:
                    raise ValueError(f"State {state} needs 1..255 ordered frames")
                for name in frames:
                    path = asset_path(catalog_path.parent, name)
                    if path.suffix.lower() != "." + fmt or dimensions(path, fmt) != size:
                        raise ValueError(f"Asset format/dimensions differ from manifest: {name}")
    for device, selection in data["devices"].items():
        if selection.get("renderer") not in RENDERERS:
            raise ValueError(f"Unknown renderer for {device}")
        for avatar in avatars.values():
            variant = avatar["variants"].get(selection.get("variant"))
            if not variant:
                raise ValueError(f"Missing selected variant for {device}")
            if selection["renderer"].startswith("mono"):
                if variant["format"] not in ("txt", "png") or max(variant["width"], variant["height"]) > 96:
                    raise ValueError(f"{device} needs a mono TXT/PNG variant no larger than 96x96")
            elif variant["format"] not in ("gif", "png", "webp"):
                raise ValueError(f"{device} needs a browser image variant")
    return data


def load(path, fmt):
    if fmt == "txt":
        rows = path.read_text().splitlines()
        return [[ch == "#" for ch in row] for row in rows]
    from PIL import Image
    with Image.open(path) as image:
        img = image.convert("L")
        return [[img.getpixel((x, y)) < 128 for x in range(img.width)] for y in range(img.height)]


def pack(px):
    width = len(px[0])
    result = []
    for row in px:
        for start in range(0, width, 8):
            result.append(sum(0x80 >> bit for bit in range(8) if start + bit < width and row[start + bit]))
    return result


def compile_variant(catalog_path, data, board, avatar_id):
    avatar_id = avatar_id or data["defaultAvatar"]
    if board not in data["devices"] or avatar_id not in data["avatars"]:
        raise ValueError(f"Unknown device/avatar: {board}/{avatar_id}")
    selection = data["devices"][board]
    variant_id = selection["variant"]
    variant = data["avatars"][avatar_id]["variants"][variant_id]
    if not selection["renderer"].startswith("mono"):
        raise ValueError(f"{board} is an image-renderer target, not a firmware sprite target")
    lines = ['// Generated from assets/avatars/manifest.json; do not edit.', '#pragma once', '#include "cline_assets.h"',
             f'#define CLINE_AVATAR_ID {json.dumps(avatar_id)}', f'#define CLINE_AVATAR_VARIANT {json.dumps(variant_id)}',
             f'#define CLINE_AVATAR_VERSION {variant["version"]}', '']
    table = []
    for state in STATES:
        names = []
        for index, file in enumerate(variant["states"][state]):
            pixels = load(asset_path(catalog_path.parent, file), variant["format"])
            name = f"spr_{state}_{index}"
            values = ", ".join(f"0x{n:02x}" for n in pack(pixels))
            lines += [f'static const uint8_t {name}_bits[] = {{{values}}};',
                      f'static const sprite_t {name} = {{{variant["width"]}, {variant["height"]}, {name}_bits}};']
            names.append("&" + name)
        lines.append(f'static const sprite_t *const anim_{state}[] = {{{", ".join(names)}}};')
        table.append(f'    [MOOD_{state.upper()}] = {{anim_{state}, {len(names)}}},')
    lines += ['static const animation_t ANIMATIONS[MOOD_COUNT] = {', *table, '};', '']
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=CATALOG)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--board")
    parser.add_argument("--avatar", default="")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    data = validate_catalog(args.catalog)
    if args.check:
        print("Avatar catalog and all referenced assets valid")
        return
    if not args.board or not args.output:
        parser.error("compilation requires --board and --output")
    result = compile_variant(args.catalog, data, args.board, args.avatar)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result)
    print(f"Generated {args.output} for {args.board}")


if __name__ == "__main__":
    main()
