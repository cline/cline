# Build Instructions

## Scope
- These instructions reflect the current workspace state on 2026-03-27.
- They are valid for the repository as a whole, but only Unit 1 `runtime-contract-foundation` has been implemented in this AIDLC run.
- Build verification should therefore distinguish between:
  - repository-wide build health
  - Unit 1 change validation

## Prerequisites
- **Build Tool**: npm workspaces, Node.js, TypeScript, esbuild, Vite, Biome
- **Dependencies**:
  - root `package-lock.json`
  - workspace `webview-ui` dependencies via root install
  - generated proto artifacts
- **Environment Variables**:
  - no mandatory env vars for baseline build
  - optional env vars may be required for provider-specific tests and smoke suites
- **System Requirements**:
  - Node.js installed
  - npm installed
  - working internet connection for initial dependency install
  - enough disk space for `node_modules/` and generated artifacts

## Build Steps

### 1. Install Dependencies
```bash
npm ci
```

### 2. Regenerate Proto Artifacts
```bash
npm run protos
```

### 3. Build Webview Assets
```bash
npm run build:webview
```

### 4. Build Extension / Main Workspace Code
```bash
node esbuild.mjs
```

### 5. Run Repository Build Shortcut
```bash
npm run ci:build
```

### 6. Verify Build Success
- **Expected Output**:
  - proto generation completes without missing `protoc`
  - webview build completes
  - `esbuild.mjs` finishes without fatal errors
- **Build Artifacts**:
  - generated proto files under `src/generated/`
  - webview assets under the repo's existing build output locations
  - extension bundle output under the repo's standard dist path
- **Common Warnings**:
  - engine warnings may appear on Node 25
  - deprecated dependency warnings may appear during install

## Unit 1 Focused Validation
- For Unit 1 validation after build:
```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -e "require('./src/core/api/runtime/registry.ts'); require('./src/core/api/runtime/legacy-provider-mapping.ts'); console.log('runtime-modules-ok')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { buildApiHandler } = require('./src/core/api/index.ts'); const { ClaudeCodeHandler } = require('./src/core/api/providers/claude-code.ts'); const handler = buildApiHandler({ actModeApiProvider: 'claude-code', planModeApiProvider: 'claude-code', actModeApiModelId: 'claude-opus-4-1-20250805', planModeApiModelId: 'claude-opus-4-1-20250805', claudeCodePath: '/mock/path' }, 'act'); console.log(handler instanceof ClaudeCodeHandler ? 'claude-code-registry-ok' : 'claude-code-registry-failed')"
```

## Troubleshooting

### `protoc` Not Found
- **Cause**: `grpc-tools` binary was not installed because scripts were skipped or install was incomplete.
- **Solution**:
```bash
npm rebuild grpc-tools --foreground-scripts
npm run protos
```

### Build Fails with Node Version Friction
- **Cause**: some packages declare support for Node 20/22/24 ranges rather than Node 25.
- **Solution**:
  - prefer running the repo on a supported Node LTS version if full build/test parity is required
  - if only validating Unit 1 seams, use the focused validation commands above

### Build Fails with Missing Generated Sources
- **Cause**: proto generation has not been run after dependency install.
- **Solution**:
```bash
npm run protos
```
