# VSCode Integration Tests

This document describes the integration test setup for the Roo Code VSCode extension.

## Overview

The integration tests use the `@vscode/test-electron` package to run tests in a real VSCode environment. These tests verify that the extension works correctly within VSCode, including features like mode switching, webview interactions, and API communication.

## Test Setup

### Directory Structure

```
e2e/src/
├── runTest.ts          # Main test runner
├── suite/
│   ├── index.ts        # Test suite configuration
│   ├── modes.test.ts   # Mode switching tests
│   ├── tasks.test.ts   # Task execution tests
│   └── extension.test.ts # Extension activation tests
```

### Test Runner Configuration

The test runner (`runTest.ts`) is responsible for:

- Setting up the extension development path
- Configuring the test environment
- Running the integration tests using `@vscode/test-electron`

### Environment Setup

1. Create a `.env.local` file in the root directory with required environment variables:

```
OPENROUTER_API_KEY=sk-or-v1-...
```

2. The test suite (`suite/index.ts`) configures:

- Mocha test framework with TDD interface
- 10-minute timeout for LLM communication
- Global extension API access
- WebView panel setup
- OpenRouter API configuration

## Test Suite Structure

Tests are organized using Mocha's TDD interface (`suite` and `test` functions). The main test files are:

- `modes.test.ts`: Tests mode switching functionality
- `tasks.test.ts`: Tests task execution
- `extension.test.ts`: Tests extension activation

### Global Objects

The following global objects are available in tests:

```typescript
declare global {
	var api: RooCodeAPI
	var provider: ClineProvider
	var extension: vscode.Extension<RooCodeAPI>
	var panel: vscode.WebviewPanel
}
```

## Running Tests

1. Ensure you have the required environment variables set in `.env.local`

2. Run the integration tests:

```bash
npm run test:integration
```

3. If you want to run a specific test, you can use the `test.only` function in the test file. This will run only the test you specify and ignore the others. Be sure to remove the `test.only` function before committing your changes.

The tests will:

- Download and launch a clean VSCode instance
- Install the extension
- Execute the test suite
- Report results

## Writing New Tests

When writing new integration tests:

1. Create a new test file in `src/test/suite/` with the `.test.ts` extension

2. Structure your tests using the TDD interface:

```typescript
import * as assert from "assert"
import * as vscode from "vscode"

suite("Your Test Suite Name", () => {
	test("Should do something specific", async function () {
		// Your test code here
	})
})
```

3. Use the global objects (`api`, `provider`, `extension`, `panel`) to interact with the extension

### Best Practices

1. **Timeouts**: Use appropriate timeouts for async operations:

```typescript
const timeout = 30000
const interval = 1000
```

2. **State Management**: Reset extension state before/after tests:

```typescript
await globalThis.api.setConfiguration({
	mode: "Ask",
	alwaysAllowModeSwitch: true,
})
```

3. **Assertions**: Use clear assertions with meaningful messages:

```typescript
assert.ok(condition, "Descriptive message about what failed")
```

4. **Error Handling**: Wrap test code in try/catch blocks and clean up resources:

```typescript
try {
	// Test code
} finally {
	// Cleanup code
}
```

5. **Wait for Operations**: Use polling when waiting for async operations:

```typescript
let startTime = Date.now()

while (Date.now() - startTime < timeout) {
	if (condition) {
		break
	}

	await new Promise((resolve) => setTimeout(resolve, interval))
}
```

6. **Grading**: When grading tests, use the `Grade:` format to ensure the test is graded correctly (See modes.test.ts for an example).

```typescript
await globalThis.api.startNewTask({
	text: `Given this prompt: ${testPrompt} grade the response from 1 to 10 in the format of "Grade: (1-10)": ${output} \n Be sure to say 'I AM DONE GRADING' after the task is complete`,
})
```
