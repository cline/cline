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
│   └── template/         # Template for new hooks
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
  
  result.cancel.should.be.false()
})
```

### Direct File Copy

For more control, you can also manually copy fixture files.

## Available Fixtures

### PreToolUse Hooks

#### `hooks/pretooluse/success`
- **Returns**: `{ cancel: false, contextModification: "PreToolUse hook executed successfully", errorMessage: "" }`
- **Use for**: Testing happy path scenarios

#### `hooks/pretooluse/blocking`
- **Returns**: `{ cancel: true, contextModification: "", errorMessage: "Tool execution blocked by hook" }`
- **Use for**: Testing tool execution blocking

#### `hooks/pretooluse/context-injection`
- **Returns**: `{ cancel: false, contextModification: "WORKSPACE_RULES: Tool [toolName] requires review", errorMessage: "" }`
- **Use for**: Testing context injection with type prefixes
- **Note**: Dynamically includes tool name from input

#### `hooks/pretooluse/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling

### PostToolUse Hooks

#### `hooks/posttooluse/success`
- **Returns**: `{ cancel: false, contextModification: "PostToolUse hook executed successfully", errorMessage: "" }`
- **Use for**: Testing PostToolUse execution

#### `hooks/posttooluse/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling in PostToolUse

### UserPromptSubmit Hooks

#### `hooks/userpromptsubmit/success`
- **Returns**: `{ cancel: false, contextModification: "Prompt approved", errorMessage: "" }`
- **Use for**: Testing successful prompt submission

#### `hooks/userpromptsubmit/blocking`
- **Returns**: `{ cancel: true, contextModification: "", errorMessage: "Prompt violates policy" }`
- **Use for**: Testing prompt submission blocking

#### `hooks/userpromptsubmit/context-injection`
- **Returns**: `{ cancel: false, contextModification: "CONTEXT_INJECTION: User is in plan mode", errorMessage: "" }`
- **Use for**: Testing context injection into task request

#### `hooks/userpromptsubmit/multiline`
- **Returns**: `{ cancel: false, contextModification: "Line count: N", errorMessage: "" }`
- **Use for**: Testing multiline prompt handling
- **Note**: Dynamically counts newlines in the prompt

#### `hooks/userpromptsubmit/large-prompt`
- **Returns**: `{ cancel: false, contextModification: "Prompt size: N", errorMessage: "" }`
- **Use for**: Testing large prompt handling
- **Note**: Dynamically reports prompt character count

#### `hooks/userpromptsubmit/special-chars`
- **Returns**: `{ cancel: false, contextModification: "Special chars preserved" | "Missing special chars", errorMessage: "" }`
- **Use for**: Testing special character preservation
- **Note**: Checks for @, #, and $ characters

#### `hooks/userpromptsubmit/empty-prompt`
- **Returns**: `{ cancel: false, contextModification: "Prompt length: 0", errorMessage: "" }`
- **Use for**: Testing empty prompt handling
- **Note**: Safely handles undefined or empty prompts

#### `hooks/userpromptsubmit/malformed-json`
- **Behavior**: Outputs invalid JSON ("not valid json")
- **Use for**: Testing malformed JSON error handling

#### `hooks/userpromptsubmit/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling in UserPromptSubmit

### TaskStart Hooks

#### `hooks/taskstart/success`
- **Returns**: `{ cancel: false, contextModification: "TaskStart hook executed successfully", errorMessage: "" }`
- **Use for**: Testing TaskStart hook success path, allowing task to proceed

#### `hooks/taskstart/blocking`
- **Returns**: `{ cancel: true, contextModification: "", errorMessage: "Task execution blocked by hook" }`
- **Use for**: Testing task blocking at start (e.g., policy enforcement)

#### `hooks/taskstart/error`
- **Behavior**: Prints error to stderr and exits with code 1
- **Use for**: Testing error handling in TaskStart hooks

## Platform Considerations

These fixtures are designed for the embedded shell architecture (similar to git hooks). They work uniformly across all platforms once the embedded shell is implemented.

### Current Status
- **Linux/macOS**: Fully functional - executable scripts with shebangs
- **Windows**: Pending embedded shell implementation

### Creating New Fixtures

1. Create a new directory under the appropriate hook type
2. Add the hook script with shebang `#!/usr/bin/env node`
3. Make executable: `chmod +x HookName`
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
  cancel: false,
  contextModification: "My custom context",
  errorMessage: ""
}));
EOF

# Make executable
chmod +x src/core/hooks/__tests__/fixtures/hooks/pretooluse/my-new-scenario/PreToolUse
```

## Maintenance

- Keep fixtures simple and focused on one scenario
- Fixtures are Node.js scripts that work across platforms
- Update this README when adding new fixtures
- Remove obsolete fixtures and update references
