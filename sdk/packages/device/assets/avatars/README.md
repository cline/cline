# Avatar catalog

`manifest.json` is the shared source of truth for browser and firmware assets.
`manifest.schema.json` describes its structure for editors. Firmware builds and
host tests validate files, dimensions, device compatibility, and all states.

The catalog has three independent identifiers:

- `schemaVersion` describes the JSON structure.
- An avatar ID identifies the character, such as `cline`.
- A variant ID identifies an asset release, such as `mono-v1` or `animated-v1`.
  Each variant records its numeric `version`, `format`, dimensions, and ordered
  frames for all nine states.

Paths are relative to this directory. Frame names have no special meaning;
ordering and state associations come entirely from the manifest. Reuse a file
across states by referencing it more than once. All states must be explicit:
`idle`, `working`, `waiting`, `listening`, `thinking`, `done`, `error`, `sleeping`,
and `offline`.

## Device selections

| Device ID | Variant | Renderer |
| --- | --- | --- |
| `waveshare-s3-epaper-154` | `mono-v1` | `mono-1bit` |
| `m5stack-cardputer-adv` | `mono-v1` | `mono-tinted` |
| `waveshare-s3-175c` | `mono-v1` | `mono-tinted` |
| `browser` | `animated-v1` | `image` |

`devices` selects a variant and compatible renderer for each target. Registered
avatars supply each selected variant ID so changing characters works on every
target. Firmware's `DEVICE_AVATAR_ID` setting selects a character; an empty value
uses `defaultAvatar`. The browser accepts `?avatar=cline` and otherwise uses the
default character.

Current firmware renderers accept TXT or PNG variants up to 96×96 and compile
them into row-major, MSB-first monochrome arrays. PNG dark pixels become black;
PNG compilation needs Pillow. Color screens currently tint these same arrays.
The browser accepts GIF, PNG, and WebP; WebP validation also needs Pillow.
Registering a GIF does not add GIF decoding to firmware. A future full-color
firmware renderer needs its own compiler/decoder and compatibility rule.

## Add or update a variant

1. Add files under `<avatar>/<variant>/`, leaving other releases available.
2. Register the variant's version, format, dimensions, and ordered state arrays
   under `avatars.<avatar>.variants`.
3. Set the desired target's `devices.<device>.variant` to the new variant ID.
   Supply that variant for every registered character.
4. Run `python3 sdk/packages/device/firmware/tools/sprites.py --check` from the
   repository root, then build the target normally. The build regenerates its
   private header when the catalog, compiler, or assets change.

Example variant entry (every remaining state must also be listed):

```json
{
  "version": 2,
  "format": "txt",
  "width": 96,
  "height": 96,
  "states": {
    "idle": ["cline/mono-v2/rest.txt"],
    "working": ["cline/mono-v2/work-a.txt", "cline/mono-v2/work-b.txt"]
  }
}
```

Screen layout, scaling, and refresh timing belong to the renderer, not the asset
catalog. E-paper refresh limits remain independent of browser GIF timing. Do not
check generated firmware arrays into source control.
