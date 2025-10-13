# Hook Template for New Fixtures

This directory contains templates and examples for creating new hook fixtures. When adding a new hook fixture, copy from these templates and customize as needed.

## Files in This Template

- `HookName` - Shell script template (works on all platforms via embedded shell)
- `README.md` - This file

## How to Create a New Fixture

### Step 1: Choose the Scenario Type

Decide what your hook fixture should test:
- `success` - Returns success immediately
- `blocking` - Blocks tool execution
- `context-injection` - Adds context information
- `error` - Exits with error code

### Step 2: Create the Directory Structure

```bash
# Example for a new PreToolUse validation fixture
mkdir -p src/core/hooks/__tests__/fixtures/hooks/pretooluse/validation/
cd src/core/hooks/__tests__/fixtures/hooks/pretooluse/validation/

# Copy template file as starting point (works on all platforms)
cp ../../../template/HookName ./
mv HookName PreToolUse  # Rename for the specific hook type
# Note: No .cmd or .js files needed - embedded shell handles execution
```

### Step 3: Customize the Hook Script

Edit `PreToolUse` to implement your fixture logic:

```javascript
#!/usr/bin/env node

// Parse the input from stdin (what gets passed to the hook)
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Example: Validate that tool parameters exist
const { toolName, parameters } = input.preToolUse;

let shouldContinue = true;
let contextModification = "";
let errorMessage = "";

// Your validation logic here
if (!parameters || !parameters.path) {
  shouldContinue = false;
  errorMessage = "ERROR: Tool requires a 'path' parameter";
} else {
  contextModification = "VALIDATION: Basic input validation passed";
}

// Return the standardized output
console.log(JSON.stringify({
  shouldContinue,
  contextModification,
  errorMessage
}));
```

### Step 4: Make the Script Executable (Unix/macOS/Linux)

```bash
# Make the hook executable (on Unix/macOS/Linux)
chmod +x PreToolUse

# On Windows, the embedded shell handles execution automatically
```

### Step 5: Test Your Fixture

```javascript
// In your test file:
await createTestHook(tempDir, "PreToolUse", {
  shouldContinue: false,
  errorMessage: "ERROR: Tool requires a 'path' parameter"
})

const factory = new HookFactory()
const runner = await factory.create("PreToolUse")
const result = await runner.run(buildPreToolUseInput({
  toolName: "write_to_file",
  parameters: {}  // Missing path parameter
}))

result.shouldContinue.should.be.false()
result.errorMessage.should.equal("ERROR: Tool requires a 'path' parameter")
```

### Step 6: Update Documentation

Add your new fixture to all relevant documentation:

1. Update `fixtures/README.md` with your new fixture
2. Update `TESTING_GUIDE.md` if introducing new patterns
3. Add examples to relevant test files

## Template Hook Patterns

### Input Validation Template

```javascript
#!/usr/bin/env node

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Validate required fields exist
const { toolName, parameters } = input.hookType; // preToolUse/postToolUse

if (!parameters?.requiredField) {
  console.log(JSON.stringify({
    shouldContinue: false,
    contextModification: "",
    errorMessage: `ERROR: Missing required field 'requiredField'`
  }));
} else {
  console.log(JSON.stringify({
    shouldContinue: true,
    contextModification: "VALIDATION: Input validation passed",
    errorMessage: ""
  }));
}
```

### Context Injection Template

```javascript
#!/usr/bin/env node

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Add context based on input analysis
const { toolName, parameters } = input.hookType;

let contextType = "GENERAL";
let context = "Basic tool usage";

// Analyze and add specific context
if (toolName === "write_to_file") {
  contextType = "FILE_OPERATIONS";
  context = `Creating or editing file: ${parameters?.path || 'unknown'}`;
} else if (toolName === "run_command") {
  contextType = "SYSTEM_OPERATIONS";
  context = `Running system command: ${parameters?.command?.substring(0, 20) || 'unknown'}`;
}

console.log(JSON.stringify({
  shouldContinue: true,
  contextModification: `${contextType}: ${context}`,
  errorMessage: ""
}));
```

### Permissions/Blocking Template

```javascript
#!/usr/bin/env node

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

const { toolName, parameters } = input.hookType;
const sensitivePaths = ['/etc', '/var', 'C:\\Windows'];

// Check for security violations
const path = parameters?.path || parameters?.destination;
const isSensitivePath = sensitivePaths.some(sensitive =>
  path?.startsWith(sensitive)
);

if (isSensitivePath) {
  console.log(JSON.stringify({
    shouldContinue: false,
    contextModification: "",
    errorMessage: `SECURITY: Access to sensitive path '${path}' is blocked`
  }));
} else {
  console.log(JSON.stringify({
    shouldContinue: true,
    contextModification: "SECURITY: Path access approved",
    errorMessage: ""
  }));
}
```

### Error Simulation Template

```javascript
#!/usr/bin/env node

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Simulate error exit
console.error("Hook execution failed");
process.exit(1);
```

## Variable Naming Convention

### Input Variables
```javascript
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// PreToolUse hooks
const { toolName, parameters } = input.preToolUse;

// PostToolUse hooks
const { toolName, parameters, result, success, executionTimeMs } = input.postToolUse;

// Common metadata
const { hookName, timestamp, taskId, workspaceRoots, userId } = input;
```

### Output Variables
```javascript
console.log(JSON.stringify({
  shouldContinue: boolean,        // Allow/deny execution
  contextModification: string,    // Context for future AI decisions (optional)
  errorMessage: string            // Error description on blocking (optional)
}));
```

## Best Practices for New Fixtures

### Keep Fixtures Focused
- **One purpose per fixture**: Test one specific scenario
- **Simple logic**: Easy to understand and debug
- **Document thoroughly**: Comment complex logic

### Make Fixtures Platform-Neutral
- Written in Node.js, works on all platforms
- Platform-specific logic abstracted away
- Test fixtures on both Unix and Windows

### Include Errors and Edge Cases
- **Error fixtures**: Test error handling paths
- **Edge cases**: Missing inputs, malformed data

### Consistent Naming
- Use UPPERCASE for context type prefixes
- Be descriptive about what the fixture tests
- Follow existing naming patterns

## Examples from Existing Fixtures

See the existing fixtures in parent directories for real examples:
- `../success/` - Simple success case
- `../blocking/` - How to block execution
- `../context-injection/` - How to inject context
- `../error/` - How to return errors

## Need Help?

1. **Copy an existing fixture** as starting point
2. **Look at template patterns** in this README
3. **Check TESTING_GUIDE.md** for usage examples
4. **Test on both platforms** before submitting
5. **Add documentation** for the new fixture
