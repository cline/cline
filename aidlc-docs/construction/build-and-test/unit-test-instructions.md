# Unit Test Execution

## Scope
- Repository-wide unit testing is available through the existing npm script.
- Units 1 through 6 also have focused runtime-architecture checks that should be run separately because current repository test execution is affected by runtime/tooling constraints.

## Run Unit Tests

### 1. Execute Repository Unit Tests
```bash
npm run test:unit
```

### 2. Execute Focused Runtime Architecture Validation
```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -e "require('./src/core/api/runtime/registry.ts'); require('./src/core/api/runtime/legacy-provider-mapping.ts'); console.log('runtime-modules-ok')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { buildApiHandler } = require('./src/core/api/index.ts'); const { ClaudeCodeHandler } = require('./src/core/api/providers/claude-code.ts'); const handler = buildApiHandler({ actModeApiProvider: 'claude-code', planModeApiProvider: 'claude-code', actModeApiModelId: 'claude-opus-4-1-20250805', planModeApiModelId: 'claude-opus-4-1-20250805', claudeCodePath: '/mock/path' }, 'act'); console.log(handler instanceof ClaudeCodeHandler ? 'claude-code-registry-ok' : 'claude-code-registry-failed')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { RuntimePersistenceBoundary } = require('./src/core/api/runtime/persistence-boundary.ts'); const boundary = new RuntimePersistenceBoundary(); console.log(typeof boundary.loadRuntimeConfig === 'function' ? 'unit2-runtime-boundary-ok' : 'unit2-runtime-boundary-fail')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { RuntimeConfigFacade } = require('./src/core/api/runtime/runtime-config-facade.ts'); const facade = new RuntimeConfigFacade(); const state = { cfg: {}, globals: {}, getApiConfiguration(){ return this.cfg }, getGlobalSettingsKey(key){ return this.globals[key] }, getSecretKey(){ return undefined }, setApiConfiguration(update){ this.cfg = { ...this.cfg, ...update }; Object.assign(this.globals, update) }, setGlobalState(key, value){ this.globals[key] = value } }; facade.writeLegacyProviderConfig(state, { providerId: 'claude-code', modelId: 'claude-sonnet', source: 'cli' }); const selection = facade.readLegacyModelSelection(state, 'act'); console.log(selection.fullModelId === 'claude-code/claude-sonnet' ? 'unit2-facade-ok' : selection.fullModelId)"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "require('./src/core/api/runtime/shim-wrapper.ts'); require('./src/integrations/claude-code/stream-translator.ts'); require('./src/integrations/claude-code/run.ts'); console.log('unit3-runtime-shim-modules-ok')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { RuntimeShimWrapper } = require('./src/core/api/runtime/shim-wrapper.ts'); const wrapper = new RuntimeShimWrapper(); const translator = { translateStdout: (line) => [line], flush: () => [] }; (async () => { const chunks = []; for await (const chunk of wrapper.execute({ command: 'node', args: ['-e', \"console.log('alpha'); console.log('beta')\"], cwd: process.cwd() }, translator)) { chunks.push(chunk) } console.log(chunks.join(',') === 'alpha,beta' ? 'unit3-shim-runtime-ok' : chunks.join(',')) })().catch((error) => { console.error(error); process.exit(1) })"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { ClaudeCodeStreamTranslator } = require('./src/integrations/claude-code/stream-translator.ts'); const translator = new ClaudeCodeStreamTranslator(); const result = translator.translateStdout('{\"type\":\"result\",\"subtype\":\"success\",\"total_cost_usd\":0,\"is_error\":false,\"duration_ms\":1,\"duration_api_ms\":1,\"num_turns\":1,\"result\":\"ok\",\"session_id\":\"s\"}'); console.log(result.length === 1 ? 'unit3-claude-translator-ok' : 'unit3-claude-translator-fail')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { getRuntimeHandlerFactoryRegistry } = require('./src/core/api/runtime/runtime-handler-factory-registry.ts'); const registry = getRuntimeHandlerFactoryRegistry(); const handler = registry.get('claude-code').buildHandler({ mode: 'act', configuration: { actModeApiProvider: 'claude-code', planModeApiProvider: 'claude-code', actModeApiModelId: 'claude-opus-4-1-20250805', planModeApiModelId: 'claude-opus-4-1-20250805', claudeCodePath: '/mock/path' } }); console.log(handler.constructor.name === 'ClaudeCodeHandler' ? 'unit4-claude-migration-ok' : handler.constructor.name)"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { getFutureRuntimeDescriptors } = require('./src/core/api/runtime/future-runtime-framework.ts'); const descriptors = getFutureRuntimeDescriptors(); console.log(descriptors[0].runtimeId === 'github-cli' && descriptors[1].runtimeId === 'custom-langgraph-cli' ? 'unit5-future-runtime-ok' : 'unit5-future-runtime-fail')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { collectAsyncChunks, createRuntimeStateSourceFixture } = require('./src/core/api/runtime/test-kit.ts'); (async () => { const chunks = await collectAsyncChunks((async function*(){ yield 'a'; yield 'b'; })()); const fixture = createRuntimeStateSourceFixture({ settings: { actModeApiProvider: 'claude-code' } }); console.log(chunks.join('') === 'ab' && fixture.getGlobalSettingsKey('actModeApiProvider') === 'claude-code' ? 'unit6-test-kit-ok' : 'unit6-test-kit-fail') })().catch((error) => { console.error(error); process.exit(1) })"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { buildKiroCliPrompt } = require('./src/integrations/kiro-cli/prompt.ts'); const prompt = buildKiroCliPrompt('system', [{ role: 'user', content: 'hello' }]); console.log(prompt.includes('USER:\\nhello') ? 'kiro-prompt-ok' : 'kiro-prompt-fail')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { getRuntimeHandlerFactoryRegistry } = require('./src/core/api/runtime/runtime-handler-factory-registry.ts'); const registry = getRuntimeHandlerFactoryRegistry(); const handler = registry.get('kiro-cli').buildHandler({ mode: 'act', configuration: { actModeApiProvider: 'kiro-cli', planModeApiProvider: 'kiro-cli', kiroCliPath: '/mock/kiro-cli' } }); console.log(handler.constructor.name === 'KiroCliHandler' ? 'kiro-factory-ok' : handler.constructor.name)"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "require('./src/core/api/providers/kiro-cli.ts'); require('./src/integrations/kiro-cli/run.ts'); console.log('kiro-runtime-modules-ok')"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { convertApiConfigurationToProto, convertProtoToApiConfiguration } = require('./src/shared/proto-conversions/models/api-configuration-conversion.ts'); const proto = convertApiConfigurationToProto({ actModeApiProvider: 'kiro-cli', planModeApiProvider: 'kiro-cli' }); const roundTrip = convertProtoToApiConfiguration(proto); console.log(roundTrip.actModeApiProvider === 'kiro-cli' && roundTrip.planModeApiProvider === 'kiro-cli' ? 'kiro-proto-ok' : JSON.stringify(roundTrip))"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { runKiroCliAcceptance } = require('./src/integrations/kiro-cli/acceptance-harness.ts'); (async () => { const result = await runKiroCliAcceptance({ sessionId: 'session-a', cwd: process.cwd(), env: { CLINE_RUNTIME_SESSION_ID: 'session-a' } }, async function* () { yield 'READY' }); console.log(result.status === 'passed' && result.outputText === 'READY' ? 'kiro-acceptance-harness-ok' : JSON.stringify(result)); })().catch((error) => { console.error(error); process.exit(1); })"
```

```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { runLinuxAarch64KiroCliIsolationSmoke } = require('./src/integrations/kiro-cli/session-isolation-smoke.ts'); (async () => { const result = await runLinuxAarch64KiroCliIsolationSmoke({ runner: async (request) => ({ sessionId: request.sessionId, status: request.sessionId === 'session-b' ? 'failed' : 'passed', cwd: request.cwd, envMarker: request.env?.CLINE_RUNTIME_SESSION_ID, command: request.path?.trim() || 'kiro-cli', durationMs: 1, outputText: request.sessionId, outputFilePath: request.outputFilePath, failureType: request.sessionId === 'session-b' ? 'spawn_failed' : undefined, errorMessage: request.sessionId === 'session-b' ? 'missing binary' : undefined }) }); console.log(result.passed ? 'kiro-isolation-harness-ok' : JSON.stringify(result)); })().catch((error) => { console.error(error); process.exit(1); })"
```

### 3. Review Test Results
- **Expected**:
  - commands emit the corresponding `*-ok` markers documented above
- **Repository Unit Test Report**:
  - use terminal output from `npm run test:unit`
  - current worktree may still surface unrelated repository-level failures

### 4. Known Limitation
- Direct targeted Mocha execution for the new runtime tests is currently unstable in this workspace because Node 25 and Mocha are interacting poorly with the repo's ESM/path-alias test loading.
- If exact test-file execution is required, rerun on a supported Node LTS environment and keep `TS_NODE_PROJECT=./tsconfig.unit-test.json`.

### 5. Fix Failing Tests
1. Confirm `npm ci` has completed.
2. Confirm `npm run protos` has completed.
3. Re-run focused runtime-architecture validation commands.
4. If repository-wide failures remain, separate:
   - failures introduced by Unit 1 changes
   - pre-existing repository/tooling failures
