# Performance Test Instructions

## Applicability
- No dedicated load-test harness was added in Unit 1.
- Performance validation at this stage should focus on regression risk in runtime resolution, not high-volume throughput testing.

## Performance Requirements
- **Runtime Selection Overhead**: registry-based selection should remain effectively negligible relative to handler execution cost.
- **Expected Behavior**:
  - runtime resolution should be deterministic
  - no repeated expensive initialization should occur during normal handler construction beyond the singleton registry setup

## Recommended Checks

### 1. Cold-Start Sanity Check
```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { buildApiHandler } = require('./src/core/api/index.ts'); console.time('buildApiHandler'); buildApiHandler({ actModeApiProvider: 'claude-code', planModeApiProvider: 'claude-code', actModeApiModelId: 'claude-opus-4-1-20250805', planModeApiModelId: 'claude-opus-4-1-20250805', claudeCodePath: '/mock/path' }, 'act'); console.timeEnd('buildApiHandler')"
```

### 2. Repeated Resolution Check
```bash
TS_NODE_PROJECT=./tsconfig.unit-test.json node -r ts-node/register -r tsconfig-paths/register -r ./src/test/requires.ts -e "const { buildApiHandler } = require('./src/core/api/index.ts'); console.time('loop'); for (let i = 0; i < 100; i++) { buildApiHandler({ actModeApiProvider: 'claude-code', planModeApiProvider: 'claude-code', actModeApiModelId: 'claude-opus-4-1-20250805', planModeApiModelId: 'claude-opus-4-1-20250805', claudeCodePath: '/mock/path' }, 'act') } console.timeEnd('loop')"
```

## Analyze Results
- **Expected**:
  - no obvious runaway latency
  - no crash during repeated runtime resolution
  - registry singleton remains stable across repeated calls

## If Performance Regresses
1. inspect registry initialization in `src/core/api/index.ts`
2. confirm no repeated heavy computation is happening during each call
3. defer deeper profiling until more runtime units are implemented
