---
"@cline/cli": patch
---

fix: add no-AVX2 baseline binaries and resolver for Sandy Bridge CPUs (issue #10514)

The standard Bun-compiled x64 binary requires AVX2 and crashes with SIGILL (exit 132) on Intel Sandy Bridge and similar pre-Haswell CPUs. This patch adds the `@cline/cli-linux-x64-baseline` package compiled with `--target=bun-linux-x64-baseline`, and updates the `bin/cline` resolver to prefer the baseline binary on no-AVX2 hosts (detected via `/proc/cpuinfo`) with a SIGILL safety-net fallback for partial-upgrade scenarios. Windows and macOS detection is out of scope for this patch.
