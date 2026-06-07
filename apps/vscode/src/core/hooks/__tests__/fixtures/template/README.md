# Hook Template for New Fixtures

This directory contains a template for creating new hook fixtures. When adding a new hook fixture, copy from this template and customize as needed.

## Files in This Template

- `HookName` - Hook script template (executable Node.js script)
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

# Copy template file
cp src/core/hooks/__tests__/fixtures/template/HookName src/core/hooks/__tests__/fixtures/hooks/pretooluse/validation/PreToolUse

# Make executable
chmod +x src/core/hooks/__tests__/fixtures/hooks/pretooluse/validation/PreToolUse
```

### Step 3: Customize the Hook Script

Edit the new fixture file to implement your specific logic:

```javascript
#!/usr/bin/env node

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));

// Extract relevant data
const { toolName, parameters } = input.preToolUse;

let shouldContinue = true;
let contextModification = "";
let errorMessage = "";

// Your custom logic here
if (!parameters || !parameters.path) {
  shouldContinue = false;
  errorMessage = "ERROR: Tool requires a 'path' parameter";
} else {
  contextModification = "VALIDATION: Basic input validation passed";
}

// Return standardized output
console.log(JSON.stringify({
  shouldContinue,
  contextModification,
  errorMessage
}));
```

### Step 4: Update Documentation

Add your new fixture to `fixtures/README.md` with:
- Fixture path
- What it returns
- What it's used for testing
- Any special behavior notes

## Best Practices

### Keep Fixtures Focused
- Test one specific scenario per fixture
- Use simple, easy-to-understand logic
- Document complex behavior with comments

### Platform Compatibility
- Write portable Node.js code
- These fixtures work via embedded shell (like git hooks)
- Avoid platform-specific logic

### Naming Conventions
- Use UPPERCASE for context type prefixes (e.g., `WORKSPACE_RULES:`, `FILE_OPERATIONS:`)
- Be descriptive about what the fixture tests
- Follow existing naming patterns in other fixtures

## Examples from Existing Fixtures

See the existing fixtures for real-world examples:
- `../hooks/pretooluse/success/` - Simple success case
- `../hooks/pretooluse/blocking/` - How to block execution
- `../hooks/pretooluse/context-injection/` - How to inject context
- `../hooks/pretooluse/error/` - How to return errors
