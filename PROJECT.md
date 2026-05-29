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

## Current State

- Active phase: AI-Hydro Map product refinement, Research Gallery, and contributor recognition.
- Last notable feature work: Cloudflare Workers + D1 recognition API deployed for Gallery/Skills/Modules usage counts.
- Open question: which community contribution review rules should become automated CI checks in `AI-Hydro/Gallery`.
- Next step: verify live recognition counts from the installed extension UI and extend the same usage-count display to Skills/Modules surfaces.

## Non-Goals

- Do not replace the hydrology-specific map with a generic GIS viewer.
- Do not silently download global datasets when a regional or viewport-scoped asset is sufficient.
- Do not bypass provenance, citation, license, or readiness checks for agent convenience.

## How To Run / Test

Use the repository scripts in `package.json`; common checks are TypeScript compilation, targeted Mocha tests under `src/hosts/vscode/__tests__/`, and packaging through the existing VSIX build workflow.
