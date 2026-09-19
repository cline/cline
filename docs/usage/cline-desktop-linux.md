# Cline Desktop — Linux Build (source)
Release desktop-v0.0.32 has no official Linux binary. Build from source:
```bash
sudo pacman -S libayatana-appindicator
bun run build:sdk
cd src-tauri && tauri build
```
