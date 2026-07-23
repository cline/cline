#!/usr/bin/env python3
"""
Real-ESRGAN Portable Image Upscale Skill - Upscales an image using a portable Real-ESRGAN binary.

Usage:
    python upscale_image.py <input-image> <output-image> [image_type] [extra_args...]

Arguments:
    <input-image>     Path to the input image
    <output-image>    Path to save the upscaled image
    [image_type]      Type of image: "anime" or "general" (default: "general")
    [extra_args...]   Any extra command-line arguments to pass to Real-ESRGAN

Examples:
    python upscale_image.py input.jpg output.png general
    python upscale_image.py input.png output.png anime
"""
import sys
import platform
import subprocess
import shutil
import urllib.request
import zipfile
from pathlib import Path

REAL_ESRGAN_VERSION = "v0.2.5.0"
REAL_ESRGAN_BUILD = "20220424"
BASE_DIR = Path(__file__).resolve().parent
FOLDER = BASE_DIR / "binary" / "realesrgan-ncnn-vulkan"
# FOLDER = Path("binary/realesrgan-ncnn-vulkan")

def safe_extract(zip_ref, path):
    for member in zip_ref.infolist():
        member_path = path / member.filename
        if not str(member_path.resolve()).startswith(str(path.resolve())):
            raise Exception("Attempted Path Traversal in Zip File")
    zip_ref.extractall(path)


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    INPUT = sys.argv[1]
    OUTPUT = sys.argv[2]
    IMAGE_TYPE = sys.argv[3] if len(sys.argv) > 3 else "general"
    EXTRA_ARGS = sys.argv[4:]

    input_path = Path(INPUT)
    if not input_path.exists():
        print(f"Error: Input file does not exist: {INPUT}")
        sys.exit(1)

    output_path = Path(OUTPUT)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if IMAGE_TYPE.lower() not in {"anime", "general"}:
        print("image_type must be 'anime' or 'general'")
        sys.exit(1)

    MODEL = (
        "realesrgan-x4plus-anime"
        if IMAGE_TYPE.lower() == "anime"
        else "realesrgan-x4plus"
    )

    OS_NAME = platform.system().lower()

    if OS_NAME == "linux":
        ZIP_URL = f"https://github.com/xinntao/Real-ESRGAN/releases/download/{REAL_ESRGAN_VERSION}/realesrgan-ncnn-vulkan-{REAL_ESRGAN_BUILD}-ubuntu.zip"
        binary_name = "realesrgan-ncnn-vulkan"
    elif OS_NAME == "darwin":
        ZIP_URL = f"https://github.com/xinntao/Real-ESRGAN/releases/download/{REAL_ESRGAN_VERSION}/realesrgan-ncnn-vulkan-{REAL_ESRGAN_BUILD}-macos.zip"
        binary_name = "realesrgan-ncnn-vulkan"
    elif OS_NAME in ["windows", "msys", "windowsnt"]:
        ZIP_URL = f"https://github.com/xinntao/Real-ESRGAN/releases/download/{REAL_ESRGAN_VERSION}/realesrgan-ncnn-vulkan-{REAL_ESRGAN_BUILD}-windows.zip"
        binary_name = "realesrgan-ncnn-vulkan.exe"
    else:
        print(f"Unsupported OS: {OS_NAME}")
        sys.exit(1)

    if not FOLDER.exists():
        print("Downloading Real-ESRGAN...")
        FOLDER.parent.mkdir(parents=True, exist_ok=True)
        zip_path = FOLDER.parent / "realesrgan.zip"

        try:
            with urllib.request.urlopen(ZIP_URL) as response, open(zip_path, "wb") as out_file:
                shutil.copyfileobj(response, out_file)
        except Exception as e:
            print(f"Download failed: {e}")
            sys.exit(1)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            safe_extract(zip_ref, FOLDER)

        zip_path.unlink()

    BINARY = FOLDER / binary_name

    if not BINARY.exists():
        print("Real-ESRGAN binary not found.")
        sys.exit(1)

    if OS_NAME != "windows":
        BINARY.chmod(BINARY.stat().st_mode | 0o111)

    cmd = [str(BINARY), "-i", INPUT, "-o", OUTPUT, "-n", MODEL] + EXTRA_ARGS

    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"Upscaling failed with exit code {e.returncode}")
        sys.exit(e.returncode)

    print(f"Upscale complete: {output_path.resolve()}")


if __name__ == "__main__":
    main()
