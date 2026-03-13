---
name: real-esrgan-image-upscale
description: "Use this skill whenever the user wants to upscale, enhance, or improve the resolution and quality of images. This includes increasing image size without losing detail, restoring compressed or blurry images, enhancing anime or photo images, batch upscaling, and improving image clarity for print or digital use. It uses the portable NCNN Vulkan build of Real-ESRGAN, automatically downloads the correct OS version if missing, runs fully offline after the first download, requires Python and leverages Vulkan GPU acceleration when available (falling back to CPU if not)."
---

# Real-ESRGAN Portable Image Upscaler

Upscale and enhance images locally using portable NCNN Vulkan build of Real-ESRGAN via CLI.

## Workflow

1. Ask the user to choose the image type if not specified by user:
   - `general` for normal photos
   - `anime` for anime-style images
2. Based on the choice, run [script](./scripts/upscale.py)
3. Detect Operating System (OS).
4. Download the correct pre-built ZIP for OS if the portable folder is missing (one-time download only).
5. Extract it.
6. Find the binary within the folder and set permissions.
7. Ask user permission to run the binary for upscaling image.
8. Run the binary to upscale the image.
9. Respond with a user-friendly message that states the file path where the upscaled image has been saved.
10. DO NOT try to open the upscaled image.

## CLI Usage

### Upscale a general image:
```bash
upscale.py image.jpg upscaled_image.jpg general
```

### Upscale an anime image:
```bash
upscale.py anime.jpg upscaled_anime.jpg anime
```
