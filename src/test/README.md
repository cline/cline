# Testing in Cline

This document explains the testing setup and configuration for the Cline VS Code extension.

## Test Infrastructure

The project uses VS Code's testing infrastructure (`@vscode/test-cli`) along with Mocha as the test framework. The tests are organized into several categories:

- **Extension Tests**: Core functionality tests for the VS Code extension
- **API Integration Tests**: Tests for API providers like Gemini, Anthropic, etc.
- **Retry Mechanism Tests**: Tests for the API retry functionality

## Module Setup and Configuration

### Dual Module Configuration

The project uses a dual module configuration:
- **Main Codebase**: Uses ES Modules (ESM) with `"module": "esnext"` and `"moduleResolution": "Bundler"`
- **Test Files**: Use CommonJS output with `"module": "NodeNext"` and `"moduleResolution": "nodenext"`

This dual setup is necessary because VS Code's test runner requires CommonJS modules.

### Import Style in Tests

Test files use CommonJS-style imports for test framework components (e.g., `const mocha = require("mocha")`) despite the `nodenext` module resolution setting. This is because:

1. **VS Code Test Runner Compatibility**: VS Code's test infrastructure requires CommonJS modules.
2. **Integration with Test Frameworks**: The CommonJS import style ensures compatibility with Mocha and VS Code's test runner.

```typescript
// Example of required import style in test files
const mocha = require("mocha")
const { describe, it } = mocha
import "should" // This type of import is still fine
```

## Running Tests

Tests can be run using the following npm scripts:

- `npm test`: Run all tests
- `npm run test:api`: Run only API integration tests
- `npm run test:retry`: Run only retry mechanism tests
- `npm run test:gemini`: Run only Gemini API integration tests

## Future Considerations

As VS Code's testing infrastructure evolves to better support ESM, we may revisit this approach. The current setup represents a pragmatic solution to work within the constraints of VS Code's testing tools while maintaining compatibility with the project's modern module structure.

## Contributing Tests

When adding new tests:

1. Follow the existing pattern of using CommonJS imports for Mocha
2. Group related tests in appropriate describe blocks
3. Ensure tests are properly compiled before running with `npm run compile-tests`
4. For API integration tests, create them in the appropriate directory under `src/test/api/` 