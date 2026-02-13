---
"cline": patch
---

Fix duplicated/clumsy MiniMax streaming caused by interleaved partial `reasoning` and `text` updates being merged against only the last message.
