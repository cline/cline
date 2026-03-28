# macOS and Linux Runtime Matrix Checklist - Kiro CLI

## Purpose

Provide an operator-facing matrix for validating Kiro CLI runtime readiness in the same class of conditions that matter for real isolated terminal-session execution.

## Matrix

| Platform | Arch | Runtime prereq | Install | Auth | Non-interactive chat | Session isolation smoke | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| macOS | arm64 | `kiro-cli` on `PATH` | Pending | Pending | Pending | Pending | Planned |
| Linux glibc 2.34+ | x86_64 | supported Kiro package | Pending | Pending | Pending | Pending | Planned |
| Linux glibc 2.34+ | aarch64 | supported Kiro package | Pending | Pending | Pending | Pending | Planned |
| Linux musl | x86_64 or aarch64 | musl package if needed | Pending | Pending | Pending | Pending | Optional |

## Common Checklist

- `kiro-cli` is discoverable from the session `PATH`
- `kiro-cli doctor` passes or reports no blocking issue
- browser-based authentication is completed
- `kiro-cli chat --no-interactive` returns a successful text response
- invalid command path handling is normalized by the shim
- cancellation behavior is observable and bounded
- session A and session B remain isolated in cwd, env, output, and temp usage

## Linux-Specific Checklist

- glibc version checked with `ldd --version`
- if glibc is below 2.34, musl package selection confirmed
- architecture matches package type
- executable bit and shell launch behavior confirmed

## macOS-Specific Checklist

- install script completed successfully
- shell path update confirmed
- browser authentication callback flow completed
- terminal launch works under the same shell profile used by Cline

## Current Reference Environment

- OS: Ubuntu 24.04.4 LTS
- Arch: aarch64
- glibc: 2.39
- Node: 25.8.0
- Notes:
  - suitable for Linux aarch64 runtime validation
  - not suitable as the sole evidence for macOS readiness
  - Mocha path-alias issues on Node 25 must not be treated as Kiro runtime failures
