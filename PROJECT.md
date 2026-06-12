# AI-Hydro

## What It Is

AI-Hydro is an agent-native hydrology research platform built around a VS Code extension, map workspace, Python/MCP tools, and reproducible analysis artifacts. It helps researchers move from hydrologic data discovery and watershed delineation to analysis, visualization, provenance, and publication-ready outputs without leaving one research environment.

## Status

Active product hardening — last updated 2026-05-29.

## Where To Read Next

- Continue work: read [PROGRESS.md](PROGRESS.md) and the newest relevant plan or issue.
- Understand decisions: read `DECISIONS.md` if present, otherwise inspect recent commits and `docs/`.
- Modify map or extension behavior: inspect `src/hosts/vscode/`, `webview-ui/src/components/map/`, and `src/config.ts`.
- Modify Python/MCP tools: inspect the editable `aihydro-tools` workspace used by the platform.

## Current State (2026-06-10)

- Phases shipped: Phase 0 ✅, Phase 1.1 Answer Auditor ✅, Phase 1.2 Claim chips ✅, Phase 1.3 Uncertainty ✅, Phase 1.4 Evidence board panel ✅.
- Active next phase: **Phase 1.5 — Capsule export + replay CI**.
- Last commit: 26009da (2026-06-01) — always-available stop button + collapsed verbose commands in ChatRow.
- Dirty: working-tree has Phase 1.2–1.4 extension changes uncommitted — commit when ready.
- Phase 1.4 TypeScript: both host and webview pass `tsc --noEmit` with zero errors.

## Non-Goals

- Do not replace the hydrology-specific map with a generic GIS viewer.
- Do not silently download global datasets when a regional or viewport-scoped asset is sufficient.
- Do not bypass provenance, citation, license, or readiness checks for agent convenience.

## How To Run / Test

Use the repository scripts in `package.json`; common checks are TypeScript compilation, targeted Mocha tests under `src/hosts/vscode/__tests__/`, and packaging through the existing VSIX build workflow.
