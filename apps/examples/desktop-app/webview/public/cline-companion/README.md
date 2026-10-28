# Cline generating companion sprites

These are the approved grayscale Cline companion dances. Each WebP is a
lossless horizontal strip of 56 × 56 pixel frames for rendering at 28 CSS pixels.

| Dance | Frames | Loop duration | Bytes |
| --- | ---: | ---: | ---: |
| Mr. Robot | 36 | 4.28 s | 95,686 |
| Cline Shuffle | 24 | 3.90 s | 64,152 |
| Slow Groove | 36 | 5.19 s | 93,960 |

Frame timing lives beside the component in `generating-companion/dances.ts`.
The 253,798-byte set is bundled with the desktop webview. Keep these assets
local so provider latency and network quality do not affect playback.

Each sequence contains individually drawn poses. The player changes sprite
cells with discrete holds; it does not rotate or deform one image. There is no
departure animation. The host removes the companion when activity ends.
