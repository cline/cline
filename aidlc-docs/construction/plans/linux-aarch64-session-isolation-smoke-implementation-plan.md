# Implementation Plan - linux-aarch64-session-isolation-smoke

## Goal

Implement a Linux aarch64 smoke harness that exercises parallel Kiro CLI sessions and verifies the minimum isolation properties that matter for Cline's control-plane design.

## Plan Status

- [x] Step 1. Create a Linux-focused smoke entrypoint that runs on the current Ubuntu 24.04 aarch64 environment
- [x] Step 2. Prepare two isolated workspace fixtures with distinct working directories
- [x] Step 3. Prepare two isolated temp roots and two distinct session env markers
- [x] Step 4. Launch two Kiro runtime executions in parallel with separate output captures
- [x] Step 5. Verify per-session cwd and env expectations using prompt or wrapper-visible markers
- [x] Step 6. Verify stdout and stderr captures remain session-local
- [x] Step 7. Add one containment case for invalid binary path or forced failure in one session while the other remains valid
- [x] Step 8. Add a normalized smoke result summary with explicit pass/fail reasons per isolation rule
- [x] Step 9. Document execution prerequisites and expected outcomes in the Kiro onboarding docs

## Scope

- current server environment only
- Linux aarch64 runtime readiness
- dual-session isolation smoke
- failure containment smoke

## Out of Scope

- macOS validation
- full CI orchestration
- multi-user load testing

## Environment Assumptions

- Ubuntu 24.04 LTS
- aarch64
- glibc 2.39
- authenticated `kiro-cli` available on `PATH` or explicit configured path

## Verification Target

- session A and B stay isolated in cwd, env marker, temp usage, and output capture
- failure in one session does not contaminate the other
- operator can rerun the smoke with a single documented command
