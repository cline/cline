# Test Orchestrator

The Test Orchestrator script provides automated server lifecycle management for running spec files against the Cline standalone server. It ensures clean isolation between test runs by starting a fresh server instance for each spec file.

## Overview

The orchestrator script (`scripts/test-orchestrator.ts`) manages the complete testing workflow:

1. **Server Lifecycle**: Starts a fresh standalone server for each spec file
2. **Test Execution**: Runs the testing platform against each spec
3. **Clean Teardown**: Gracefully shuts down the server after each test
4. **Isolation**: Ensures no state leakage between test runs

## Usage

### Prerequisites

Before running the orchestrator, ensure you have built the standalone version:

```bash
npm run compile-standalone
```

### Running Tests

#### Single Spec File
```bash
npm run test:orchestrator path/to/spec.json
```

#### All Specs in Directory
```bash
npm run test:orchestrator tests/specs
```

#### Direct Command
```bash
npx tsx scripts/test-orchestrator.ts <spec-file-or-folder>
```

## Configuration

### Environment Variables

- `HOSTBRIDGE_PORT`: gRPC server port (default: 26040)
- `SERVER_BOOT_DELAY`: Server startup delay in ms (default: 3000)
