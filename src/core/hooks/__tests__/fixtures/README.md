# Hook Test Fixtures

This directory contains pre-written hook scripts for testing the Cline hooks system.

## Directory Structure

```
fixtures/
├── hooks/
│   ├── pretooluse/       # PreToolUse hook fixtures
│   │   ├── success/      # Returns success immediately
│   │   ├── blocking/     # Blocks tool execution
│   │   ├── context-injection/  # Adds context with type prefix
│   │   └── error/        # Exits with error code
│   ├── posttooluse/      # PostToolUse hook fixtures
│   │   ├── success/      # Returns success immediately
│   │   └── error/        # Exits with error code
│   └── template/         # Template for new hooks (future)
└── inputs/               # Sample input data (future)
```

## Using Fixtures in Tests

### With loadFixture()

The `loadFixture()` helper function copies a fixture to your test environment:

```typescript
import { loadFixture } from '../test-utils'

it("should work with real hook", async () => {
  const { getEnv } = setupHookTests()
  
  await loadFixture("hooks/pretooluse/success", getEnv().tempDir)
  
  const factory = new HookFactory()
  const runner = await factory.create("PreToolUse")
  const result = await runner.run(buildPreToolUseInput({ toolName: "test_tool" }))
  
  result.shouldContinue.should.be.true()
})
```

### Direct File Copy

For more control, you can also manually copy fixture files.

## Available Fixtures

### PreToolUse Hooks

#### `hooks/pretooluse/success`
- **Returns**: `{ shouldContinue: true, contextModification: "PreToolUse hook executed successfully", errorMessage: "" }`
- **Use for**: Testing happy path scenarios

#### `hooks/pretooluse/blocking`
- **Returns**: `{ shouldContinue: false, contextModification: "", errorMessage: "Tool execution blocked by hook" }`
- **Use for**: Testing tool execution blocking

#### `hooks/pretooluse/context-injection`
- **Returns**: `{ shouldContinue: true, contextModification: "WORKSPACE_RULES: Tool [toolName] requires review", errorMessage: "" }`
- **Use for**: Testing context injection with type prefixes
- **Note**: Dynamically includes tool name from input

#### `hooks/pretooluse/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling

### PostToolUse Hooks

#### `hooks/posttooluse/success`
- **Returns**: `{ shouldContinue: true, contextModification: "PostToolUse hook executed successfully", errorMessage: "" }`
- **Use for**: Testing PostToolUse execution

#### `hooks/posttooluse/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling in PostToolUse

## Platform Considerations

### Unix (Linux/macOS)
- Hooks are executable files without extensions
- Must have executable bit set (`chmod +x`)
- Include shebang: `#!/usr/bin/env node`

### Windows
- The `loadFixture()` function handles platform differences automatically
- Windows fixtures use the same files but permissions are handled differently

## Creating New Fixtures

1. Create a new directory under the appropriate hook type
2. Add the hook script (executable on Unix)
3. Test on both platforms if possible
4. Update this README with the new fixture

### Example: Creating a new fixture

```bash
# Create directory
mkdir -p src/core/hooks/__tests__/fixtures/hooks/pretooluse/my-new-scenario

# Create hook script
cat > src/core/hooks/__tests__/fixtures/hooks/pretooluse/my-new-scenario/PreToolUse << 'EOF'
#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: "My custom context",
  errorMessage: ""
}));
EOF

# Make executable (Unix)
chmod +x src/core/hooks/__tests__/fixtures/hooks/pretooluse/my-new-scenario/PreToolUse
```

## Maintenance

- Keep fixtures simple and focused on one scenario
- Test fixtures work on both Unix and Windows
- Update this README when adding new fixtures
- Remove obsolete fixtures and update references
