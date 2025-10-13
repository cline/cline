# Hook Testing Guide

A comprehensive guide for testing Cline's hooks system.

## Quick Start

New hook? Follow this 3-step pattern:

### Step 1: Create Your Hook Input Builder

```typescript
export function buildMyNewHookInput(params: {
  someParam: string
  taskId?: string
}): NamedHookInput<"MyNewHook"> {
  return {
    taskId: params.taskId || "test-task-id",
    myNewHook: {
      someParam: params.someParam
    }
  }
}
```

### Step 2: Write Tests Using Standard Pattern

```typescript
import { setupHookTests, createTestHook, buildPreToolUseInput, assertHookOutput } from './test-utils'
import { HookFactory } from '../hook-factory'

describe("MyNewHook", () => {
  const { getEnv } = setupHookTests()
  
  it("should execute successfully", async () => {
    await createTestHook(getEnv().tempDir, "MyNewHook", {
      shouldContinue: true,
      contextModification: "Hook executed"
    })
    
    const factory = new HookFactory()
    const runner = await factory.create("MyNewHook")
    const result = await runner.run(buildMyNewHookInput({
      someParam: "test"
    }))
    
    assertHookOutput(result, {
      shouldContinue: true,
      contextModification: "Hook executed"
    })
  })
})
```

### Step 3: Add Integration Tests

```typescript
import { MockHookRunner } from './test-utils'

it("should call MyNewHook at the right time", async () => {
  const mockRunner = new MockHookRunner("MyNewHook")
  mockRunner.setResponse({ shouldContinue: true })
  
  // Test integration with ToolExecutor or other components
  // ...
  
  mockRunner.assertCalled(1)
})
```

## Test Utilities Reference

### setupHookTests()

Standard test environment setup. Use in every test file:

```typescript
describe("Hook Tests", () => {
  const { getEnv } = setupHookTests()
  
  it("should do something", async () => {
    const env = getEnv()
    // env.tempDir is ready to use
    // env.hooksDirs contains paths to hooks directories
  })
})
```

**What it does:**
- Creates temporary directory with `.clinerules/hooks` structure
- Mocks `StateManager` to return test workspace
- Automatically cleans up after each test
- Sets up sinon sandbox for stubs

### createTestHook()

Creates a test hook with specific behavior:

```typescript
await createTestHook(getEnv().tempDir, "PreToolUse", {
  shouldContinue: true,
  contextModification: "WORKSPACE_RULES: Some rule"
}, {
  delay: 100,        // Optional: delay in ms
  exitCode: 1,       // Optional: exit with error
  malformedJson: true // Optional: output invalid JSON
})
```

**Platform handling:**
- Unix: Creates executable script with shebang
- Windows: Creates `.js` file and `.cmd` wrapper
- Handles all platform differences automatically

### buildPreToolUseInput() / buildPostToolUseInput()

Builds complete hook input objects:

```typescript
const input = buildPreToolUseInput({
  toolName: "write_to_file",
  parameters: { path: "test.ts", content: "test" },
  taskId: "custom-task-id" // Optional
})

const input = buildPostToolUseInput({
  toolName: "write_to_file",
  result: "File created successfully",
  success: true,
  executionTimeMs: 250
})
```

### assertHookOutput()

Validates hook output:

```typescript
assertHookOutput(result, {
  shouldContinue: true,
  contextModification: "Expected context"
})
```

**Benefits:**
- Clear error messages on mismatch
- Partial matching (only check fields you care about)
- Type-safe

### MockHookRunner

For fast integration tests without spawning processes:

```typescript
const mockRunner = new MockHookRunner("PreToolUse")
mockRunner.setResponse({ 
  shouldContinue: true,
  contextModification: "TEST_CONTEXT",
  errorMessage: ""
})

// Use in your test
const result = await mockRunner.run(buildPreToolUseInput({ toolName: "test" }))

// Assert calls
mockRunner.assertCalled(1)
mockRunner.assertCalledWith({ 
  preToolUse: { toolName: "write_to_file" } 
})

// Reset for next test
mockRunner.reset()
```

## Using Fixtures

Fixtures are pre-written hook scripts for common scenarios.

### When to Use Fixtures

- Testing real-world hook behavior
- Testing complex multi-step scenarios
- Creating reusable test cases
- Documenting hook patterns

### How to Use Fixtures

```typescript
import { loadFixture } from './test-utils'

it("should work with real hook", async () => {
  const { getEnv } = setupHookTests()
  
  await loadFixture("hooks/pretooluse/success", getEnv().tempDir)
  
  const factory = new HookFactory()
  const runner = await factory.create("PreToolUse")
  const result = await runner.run(buildPreToolUseInput({ toolName: "test" }))
  
  result.shouldContinue.should.be.true()
})
```

### Available Fixtures

See [fixtures/README.md](./fixtures/README.md) for the complete list.

**Common fixtures:**
- `hooks/pretooluse/success` - Returns success immediately
- `hooks/pretooluse/blocking` - Blocks tool execution
- `hooks/pretooluse/context-injection` - Adds context with type prefix
- `hooks/pretooluse/error` - Exits with error code
- `hooks/pretooluse/timeout` - Times out (for timeout tests)

## Platform-Specific Testing

Hooks behave differently on Unix vs Windows:
- **Unix**: Uses executable bit (`chmod +x`)
- **Windows**: Uses file extensions (`.cmd`, `.bat`, `.exe`)

### Writing Platform-Specific Tests

```typescript
it("should find executable hook on Unix", async function () {
  if (process.platform === "win32") {
    this.skip()  // Skip on Windows
    return
  }
  
  // Unix-specific test
  const hookPath = path.join(tempDir, ".clinerules", "hooks", "PreToolUse")
  await fs.writeFile(hookPath, "#!/usr/bin/env node\nconsole.log(...)")
  await fs.chmod(hookPath, 0o755)
  
  // Test that hook is found and executable
})

it("should find hook with .cmd extension on Windows", async function () {
  if (process.platform !== "win32") {
    this.skip()  // Skip on Unix
    return
  }
  
  // Windows-specific test
})
```

## Best Practices

### 1. Keep Tests Simple

```typescript
// GOOD: One assertion per test
it("should call PreToolUse before tool execution", async () => {
  mockRunner.setResponse({ shouldContinue: true })
  await executor.executeTool({...})
  mockRunner.assertCalled(1)
})

it("should inject context from PreToolUse", async () => {
  mockRunner.setResponse({ contextModification: "TEST" })
  await executor.executeTool({...})
  executor.taskState.userMessageContent.should.include("TEST")
})

// BAD: Testing multiple things
it("should handle hooks correctly", async () => {
  // Tests calling, context injection, error handling, timing...
})
```

### 2. Test Real Execution

- Use `createTestHook()` for unit tests (real execution)
- Use `MockHookRunner` for integration tests (fast execution)
- Use fixtures for complex scenarios

```typescript
// Unit test: Real hook execution
it("should execute hook and parse output", async () => {
  await createTestHook(getEnv().tempDir, "PreToolUse", { shouldContinue: true })
  // Test real execution
})

// Integration test: Fast mock
it("should integrate with ToolExecutor", async () => {
  const mockRunner = new MockHookRunner("PreToolUse")
  // Test integration without spawning process
})
```

### 3. Maintain Low Complexity

- Each test function should be < 15 lines
- Use helper functions for complex setup
- Keep cyclomatic complexity < 5

```typescript
// GOOD: Simple and clear
it("should block when shouldContinue is false", async () => {
  mockRunner.setResponse({ shouldContinue: false })
  await executor.executeTool({...})
  mockRunner.assertCalled(1)
})

// BAD: Too complex
it("should handle all scenarios", async () => {
  for (const scenario of scenarios) {
    if (scenario.type === "blocking") {
      // Complex nested logic...
    } else if (scenario.type === "success") {
      // More complex logic...
    }
  }
})
```

### 4. Use AAA Pattern

Arrange, Act, Assert:

```typescript
it("should inject context modification", async () => {
  // Arrange
  mockRunner.setResponse({ contextModification: "TEST_CONTEXT" })
  const executor = createTestExecutor()
  
  // Act
  await executor.executeTool({...})
  
  // Assert
  executor.taskState.userMessageContent.should.include("TEST_CONTEXT")
})
```

### 5. Clear Test Names

Test name should explain what and why:

```typescript
// GOOD: Explains what and why
it("should not call PostToolUse when PreToolUse blocks execution")
it("should truncate context modifications larger than 50KB")
it("should parse WORKSPACE_RULES prefix from context")

// BAD: Vague or implementation-focused
it("works correctly")
it("test hook execution")
it("checks the context string")
```

## Common Testing Patterns

### Pattern 1: Testing Hook Discovery

```typescript
it("should find hook in workspace", async () => {
  const { getEnv } = setupHookTests()
  
  await createTestHook(getEnv().tempDir, "PreToolUse", {
    shouldContinue: true
  })
  
  const factory = new HookFactory()
  const runner = await factory.create("PreToolUse")
  
  // Should not be NoOpRunner
  runner.constructor.name.should.not.equal("NoOpRunner")
})
```

### Pattern 2: Testing Hook Execution

```typescript
it("should execute hook and return result", async () => {
  const { getEnv } = setupHookTests()
  
  await createTestHook(getEnv().tempDir, "PreToolUse", {
    shouldContinue: true,
    contextModification: "TEST_CONTEXT"
  })
  
  const factory = new HookFactory()
  const runner = await factory.create("PreToolUse")
  const result = await runner.run(buildPreToolUseInput({ 
    toolName: "write_to_file" 
  }))
  
  assertHookOutput(result, {
    shouldContinue: true,
    contextModification: "TEST_CONTEXT"
  })
})
```

### Pattern 3: Testing Error Handling

```typescript
it("should handle hook errors gracefully", async () => {
  const { getEnv } = setupHookTests()
  
  await createTestHook(getEnv().tempDir, "PreToolUse", {
    shouldContinue: false
  }, { exitCode: 1 })
  
  const factory = new HookFactory()
  const runner = await factory.create("PreToolUse")
  
  try {
    await runner.run(buildPreToolUseInput({ toolName: "test" }))
    throw new Error("Should have thrown")
  } catch (error: any) {
    error.message.should.match(/exited with code 1/)
  }
})
```

### Pattern 4: Testing Integration

```typescript
it("should call hook at the right time", async () => {
  const mockRunner = new MockHookRunner("PreToolUse")
  mockRunner.setResponse({ shouldContinue: true })
  
  // Stub HookFactory to return mock
  sinon.stub(HookFactory.prototype, "create").resolves(mockRunner)
  
  // Execute component logic
  await component.doSomething()
  
  // Verify hook was called
  mockRunner.assertCalled(1)
  mockRunner.assertCalledWith({ 
    preToolUse: { toolName: "expected_tool" } 
  })
})
```

## Debugging Tests

### Enable Verbose Output

```bash
# Run with debug output
DEBUG=cline:hooks npm test

# Run specific test file
npm test -- --grep "PreToolUse"
```

### Common Issues

**Issue: "Test environment not initialized"**
- Cause: Called `getEnv()` outside of test function
- Fix: Only call `getEnv()` inside `it()` blocks

**Issue: "Hook not found"**
- Cause: Hook not created or not executable
- Fix: Verify `createTestHook()` was called and succeeded

**Issue: "Expected X calls but got Y"**
- Cause: Mock wasn't reset between tests or extra calls
- Fix: Use `mockRunner.reset()` in `afterEach()`

**Issue: Platform-specific test failures**
- Cause: Test assumes Unix or Windows behavior
- Fix: Add platform check with `this.skip()`

## Examples from Existing Tests

See the existing test files for real-world examples:
- `hook-factory.test.ts` - Hook discovery and execution
- `ToolExecutor.test.ts` - Context injection and integration
- `disk.test.ts` - Workspace hook directory discovery

## Checklist for New Hook Tests

- [ ] Created input builder function
- [ ] Written unit tests with `createTestHook()`
- [ ] Added integration tests with `MockHookRunner`
- [ ] Tested on both Unix and Windows (if applicable)
- [ ] Used `setupHookTests()` for environment
- [ ] Kept test functions < 15 lines
- [ ] Used clear, descriptive test names
- [ ] Added platform-specific skips where needed
- [ ] Verified all tests pass

## Additional Resources

- [Fixtures README](./fixtures/README.md) - Guide to using fixture scripts
- [Requirements Doc](../../../../HOOKS_TESTING_INFRASTRUCTURE.md) - Original requirements
- [Testing Status](../../../../TESTING_STATUS.md) - Implementation progress
