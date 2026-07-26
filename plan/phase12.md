# Phase 12 Handoff: Bedrock Coder Branding and Final Cleanup

## Goal

Convert the completed fork into a clean, independent VS Code extension named
**Bedrock Coder**, remove remaining obsolete Cline identity and unused project
dependencies, and leave a small, coherent production package.

Phase 12 does not publish, push, create a GitHub release, or add Marketplace
support. Packaging a local VSIX is required only to verify the final extension.

Repository:

```text
https://github.com/FFFalexgo/AWS_Bedrock_Coder
```

Local repository:

```text
C:\Coding\cline_aws
```

Prerequisite: Phase 11 is complete. Read `plan/scope.md`, this handoff, and the
applicable `AGENTS.md` files before editing.

## Final Identity

Use these values consistently:

```text
Display name: Bedrock Coder
Short name: Bedrock Coder
Package name: bedrock-coder
Publisher: fffalexgo
Extension ID: fffalexgo.bedrock-coder
Version: 0.1.0
Command namespace: bedrockCoder.*
Settings namespace: bedrockCoder.*
Context-key namespace: bedrockCoder.*
Workspace folder: .bedrock-coder/
Environment prefix: BEDROCK_CODER_
SDK package scope: @bedrock-coder/*
Copyright holder for modifications: FFFalexgo
License: Apache-2.0
```

Description:

```text
A local-first VS Code coding agent powered exclusively by Amazon Bedrock.
```

URLs:

```text
Repository: https://github.com/FFFalexgo/AWS_Bedrock_Coder
Issues: https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues
Homepage: https://github.com/FFFalexgo/AWS_Bedrock_Coder
```

## Clean-Extension Boundary

This is a new extension, not an in-place Cline upgrade.

- VS Code must identify it as `fffalexgo.bedrock-coder`.
- It must install alongside official Cline without command, setting, view,
  storage, URI, or icon collisions.
- It must not read, write, migrate, or delete official Cline data.
- Remove migrations and compatibility aliases that exist only for pre-fork
  Cline state.
- Keep only migrations required by Bedrock Coder after the new `0.1.0`
  baseline.
- Bedrock Coder history, checkpoints, teams, and settings must persist normally.

## Rename Map

Apply this map to executable source, generated contracts, tests, fixtures,
scripts, package metadata, and active documentation:

| Existing identity | Replacement |
|---|---|
| `Cline` | `Bedrock Coder` in user-facing text |
| `Cline*` TypeScript identifiers | `BedrockCoder*` |
| `cline*` internal identifiers | `bedrockCoder*` |
| `claude-dev` | `bedrock-coder` |
| `cline.*` command/settings/context IDs | `bedrockCoder.*` |
| `@cline/*` workspace packages | `@bedrock-coder/*` |
| `.cline/` | `.bedrock-coder/` |
| `CLINE_*` environment names | `BEDROCK_CODER_*` |
| `proto/cline/` | `proto/bedrock_coder/` |
| protobuf package `cline` | `bedrock_coder` |
| Cline product URLs and assets | Bedrock Coder equivalents |

Use:

- `Bedrock Coder` for display text;
- `bedrock-coder` for package and file identifiers;
- `bedrockCoder` for VS Code command, setting, and context namespaces;
- `BedrockCoder` for TypeScript types and classes;
- `bedrock_coder` for protobuf packages.

Do not blindly replace text in license notices, upstream attribution, Git
history, hashes, or completed historical plans.

## Extension and Workspace Identity

Update `apps/vscode/package.json` to the final identity, including:

```json
{
  "name": "bedrock-coder",
  "displayName": "Bedrock Coder",
  "description": "A local-first VS Code coding agent powered exclusively by Amazon Bedrock.",
  "version": "0.1.0",
  "publisher": "fffalexgo",
  "author": {
    "name": "FFFalexgo"
  },
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/FFFalexgo/AWS_Bedrock_Coder"
  },
  "homepage": "https://github.com/FFFalexgo/AWS_Bedrock_Coder",
  "bugs": {
    "url": "https://github.com/FFFalexgo/AWS_Bedrock_Coder/issues"
  }
}
```

Rename:

- activity-bar and sidebar IDs;
- commands, settings, context keys, views, menus, categories, URI schemes, and
  deep links;
- retained TypeScript identifiers and Cline-named files;
- internal packages `@cline/shared`, `@cline/llms`, `@cline/agents`, and
  `@cline/core` to `@bedrock-coder/*`;
- TypeScript paths, workspace filters, imports, dynamic imports, exports,
  build scripts, mocks, and generated declarations;
- local storage roots, output channels, database names, diagnostic prefixes,
  prompts, and environment variables;
- protobuf directories, packages, services, and generated namespaces.

Regenerate protobuf output with repository scripts. Preserve field numbers and
runtime behavior. Regenerate `bun.lock` with `bun install`; never hand-edit it.

Do not publish internal SDK packages to npm in this phase.

## User-Facing Cleanup

Replace remaining Cline product identity in:

- sidebar, settings, command palette, notifications, and errors;
- welcome/walkthrough content;
- Plan/Act and team/subagent prompts;
- tool descriptions and approval UI;
- local diagnostics;
- MCP, skill, plugin, worktree, Kanban, checkpoint, and Git documentation;
- README and screenshots.

Remove stale documentation and UI for accounts, subscriptions, hosted
services, Marketplace distribution, removed providers, telemetry, Jupyter,
autocomplete, and approval bypasses.

Do not claim Bedrock Coder is an official AWS product. Use Amazon Bedrock only
to describe the supported service.

## Visual Brand

Use an original merged `B/C` geometric monogram with:

- silver, cool grey, and gunmetal;
- deep graphite or black application-icon background;
- subtle brushed-metal texture;
- strong negative space and restrained bevel;
- a simplified shape readable at 16-32 pixels;
- no AWS logo, AWS orange, cloud, circuit-board, or Cline imagery.

Reference brand family:

```text
C:\Users\chang\Desktop\Hyperentanglement Technologies Inc\Brand
```

Initial concept:

```text
C:\Users\chang\.codex\generated_images\019f9078-cfdf-7f72-b495-709880924559\call_C73iIoYHcOdfmmlJ4WDoyM4s.png
```

Rebuild the approved geometry as a clean original vector; do not auto-trace
raster texture.

Produce:

```text
apps/vscode/assets/brand/bedrock-coder-mark.svg
apps/vscode/assets/brand/bedrock-coder-mark-1024.png
apps/vscode/assets/icons/icon.png
apps/vscode/assets/icons/icon.svg
```

The PNG must be a square production icon of at least 256x256. The activity-bar
SVG must work in light, dark, and high-contrast themes. Remove old icons, fonts,
and brand assets after verifying that no retained code imports them.

## Legal Attribution

Remove Cline product identity, but retain legally required attribution.

Preserve:

- Apache License 2.0;
- applicable Cline Bot Inc. notices;
- third-party licenses and notices;
- Git history;
- attribution required by retained upstream code.

Add `NOTICE` or `ATTRIBUTION.md`:

```text
Bedrock Coder
Copyright 2026 FFFalexgo

This software is an independent derivative of Cline:
https://github.com/cline/cline

Portions copyright 2026 Cline Bot Inc.
Licensed under the Apache License, Version 2.0.

Bedrock Coder is independently maintained and is not affiliated with,
sponsored by, or endorsed by Cline Bot Inc. or Amazon Web Services.
```

Add a short acknowledgement to the README. Keep applicable source headers and
add `MODIFICATIONS.md` for changed files that cannot carry comments. Do not
claim ownership of unchanged upstream code.

## Dependency and Folder-Size Cleanup

### Measured baseline

At plan creation, `C:\Coding\cline_aws` measured approximately:

```text
Total working folder: 1.15 GiB
node_modules:         910 MiB
.git:                 126 MiB
apps:                 105 MiB
assets:                18 MiB
sdk:                   14 MiB
```

The installed dependency tree, not application source, is the primary reason
the folder is large. `node_modules\.bun` alone accounts for essentially all of
the 910 MiB.

Large installed entries include:

```text
Buf Windows codegen binary: about 115 MiB
Mermaid:                    about 80 MiB
Biome Windows binary:       about 51 MiB
Storybook:                  about 35 MiB
Lucide React:               about 32 MiB
pdf-parse:                  about 27 MiB
TypeScript:                 about 23 MiB
exceljs:                    about 21 MiB
Playwright core:            about 12 MiB
Puppeteer core:              about 8 MiB
```

These figures describe the developer checkout, not the packaged VSIX.

### Current dependency findings

- Removed model providers and telemetry are no longer direct manifest
  dependencies.
- `@ai-sdk/anthropic` and `@ai-sdk/openai` still occur transitively through
  `@ai-sdk/amazon-bedrock`. Do not delete transitive lockfile entries manually.
- `@opentelemetry/api` occurs transitively through the retained `ai` SDK. Its
  presence in the lockfile does not mean product telemetry remains.
- `exceljs`, `mammoth`, and `pdf-parse` are imported by
  `src/integrations/misc/extract-text.ts`; removing them requires deliberately
  removing Office/PDF text extraction.
- Playwright is required only by E2E/test files and must not be a production
  runtime dependency.
- Browser automation remains in scope, so Puppeteer/browser packages may be
  retained when runtime imports prove they are used.
- The existing `analyze:unused:prod` Knip task currently marks almost the whole
  dependency set unused, including known imports. Its configuration or
  entrypoints are incomplete; do not use its current output for bulk deletion.

### Required cleanup

1. Fix `apps/vscode/knip.json` entrypoints/workspaces until known runtime
   imports are recognized. Use Knip as evidence, not as an automatic delete
   command.
2. Move `@playwright/test` to `devDependencies` if it remains under
   `dependencies`.
3. Remove Storybook scripts, configuration, stories, and dependencies if
   Storybook is not needed for retained UI development.
4. Review the legacy test stack. Keep the smallest framework set used by the
   focused retained tests; remove unused combinations of Mocha, Chai, Should,
   Sinon, c8, Vitest, VS Code test runners, and Playwright.
5. Remove `dotenv` if executable source and retained scripts do not import it.
   Bedrock Coder uses the normal AWS credential chain and must not require a
   project `.env` loader.
6. Decide whether Office/PDF extraction is part of “read files.” If plain text
   and code files are sufficient, delete the document extraction branches,
   related tests/types, and `exceljs`, `mammoth`, and `pdf-parse`. If retained,
   document why they are intentional.
7. Keep Mermaid only if rendered Mermaid diagrams remain a supported chat
   feature. Otherwise remove its UI path and dependency together.
8. Keep Buf/protobuf codegen until the branding namespace migration is
   complete. Afterwards, retain it as development tooling only if proto
   regeneration remains part of normal development.
9. Remove obsolete Marketplace publishing scripts and their exclusive
   dependencies. Do not add replacement release automation.
10. Remove unused assets, fixtures, snapshots, generated leftovers, caches, and
    build output. Do not delete retained tests solely to reduce disk usage.
11. After manifest edits, remove verified repository-local `node_modules`
    directories, run one clean `bun install`, and regenerate `bun.lock`.
12. Record the clean working-folder size and packaged VSIX size. Inspect the
    VSIX contents for test fixtures, source maps, browser binaries, generated
    duplicates, and development-only packages; exclude them through packaging
    configuration rather than deleting valid source.

Do not optimize for a tiny `node_modules` directory at the cost of removing
features in `plan/scope.md`. Development-only packages may remain when they
have a clear role and do not enter the VSIX.

## Implementation Order

1. Record the Phase 11 commit and measured size baseline.
2. Add legal attribution and modification records.
3. Apply extension, command, setting, storage, SDK, and protobuf renames.
4. Regenerate contracts and the lockfile; resolve broken imports.
5. Replace user-facing and model-facing product identity.
6. Produce and wire the B/C icons; remove obsolete brand assets.
7. Remove stale product UI, documentation, compatibility paths, and publishing
   machinery.
8. Repair dependency analysis, remove only proven unused packages, and perform
   a clean install.
9. Build and package once, inspect the VSIX, and measure final sizes.
10. Run focused identity checks and a short manual smoke test.
11. Commit Phase 12 independently.

Use logical commits or checkpoints so namespace-renaming failures are easy to
isolate.

## Verification

Identity searches:

```powershell
rg -n -i "cline|claude-dev|saoudrizwan|cline\.bot|@cline/" apps/vscode sdk package.json
rg -n "cline\.|CLINE_|\.cline" apps/vscode sdk package.json
```

Allowed matches are limited to legal attribution, third-party notices, README
acknowledgement, and completed historical planning documents. No executable
source, package identifier, configuration key, storage path, prompt, generated
namespace, icon, or active user-facing text may retain Cline branding.

Add one small manifest/identity check that verifies:

- publisher and package name are `fffalexgo` and `bedrock-coder`;
- commands and settings use `bedrockCoder.*`;
- views and menus reference valid new IDs;
- workspace dependencies use `@bedrock-coder/*`;
- forbidden old identities are absent outside the approved allowlist.

Run only:

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs --production
bun run package
```

Then install the local VSIX in a clean VS Code profile and verify:

1. manifest identity is `fffalexgo.bedrock-coder`;
2. the icon is readable in light, dark, and high-contrast themes;
3. commands and settings use only the Bedrock Coder namespace;
4. storage and logs contain no Cline product identity;
5. startup doctor and model selection open;
6. one chat, edit approval, terminal approval, and checkpoint resume work;
7. official Cline can coexist without collisions;
8. the VSIX contains required licenses but no test fixtures, browser binaries,
   caches, or obsolete branding.

Do not add a broad branding test suite or rerun unrelated heavy test suites.

## Done When

- extension identity is `fffalexgo.bedrock-coder`;
- executable, internal, generated, and user-facing identity is consistently
  renamed;
- official Cline state is neither imported nor modified;
- the original B/C visual identity is wired and readable;
- required upstream and third-party attribution remains;
- stale Cline, Marketplace, hosted-service, and compatibility artifacts are
  removed;
- direct dependencies are justified by retained code or development tasks;
- production-only dependencies do not include test frameworks;
- a clean install, required builds, identity check, VSIX inspection, and short
  manual smoke test pass;
- final working-folder and VSIX sizes are recorded.

## Commit

Suggested message:

```text
refactor: rebrand and clean up Bedrock Coder
```

## Completion Handoff

Report:

- commit SHA;
- final extension identity and namespace changes;
- SDK/protobuf/storage rename results;
- removed compatibility, branding, publishing, and dependency paths;
- icon source and exported assets;
- legal attribution files;
- remaining Cline search matches with justification;
- clean install and required build results;
- dependency removals and intentionally retained large packages;
- before/after working-folder size and final VSIX size.
