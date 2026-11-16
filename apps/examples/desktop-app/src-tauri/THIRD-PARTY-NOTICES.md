# Third-party notices

## FFmpeg (Playwright's video encoder)

The app bundles the FFmpeg executable that Playwright uses to record video, at
`bin/playwright/ffmpeg-<revision>/` in the app's resources. It is copied
unmodified from Playwright's published build for the revision that the bundled
`playwright-core` lists in its `browsers.json` (the executable reports
`playwright-build-<revision>` as its version suffix).

- FFmpeg is licensed under the GNU Lesser General Public License, version 2.1.
  The licence text ships next to the executable as `COPYING.LGPLv2.1`.
- The build statically links libvpx (BSD 3-Clause licence) and zlib (zlib
  licence).
- FFmpeg source code: https://ffmpeg.org/download.html
- The scripts and configuration Playwright builds it with are published by
  Microsoft with Playwright's browser builds, under `browser_patches/ffmpeg`:
  https://github.com/microsoft/playwright
