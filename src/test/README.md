# Testing Infrastructure

This directory contains the testing infrastructure for the Cline project. The testing setup is designed to be robust across different environments and to provide a consistent experience whether running tests via npm scripts or VS Code's Test Explorer.

> **New!** For detailed information about VS Code test discovery and troubleshooting, see [VSCODE-TEST.md](./VSCODE-TEST.md).

## Test Environment Setup

The project uses a combination of tools for testing:

- **Mocha**: The test framework used to define and run tests
- **Chai**: The assertion library used within tests
- **VS Code Test API**: Used for testing VS Code extension-specific functionality
- **nyc**: Used for code coverage reporting

## Key Components

### Test Mocking

- `mock/vscode.ts`: A mock implementation of the VS Code API for unit tests
- `test-helper.js`: Provides common utilities and setup for tests
- `set-test-mode.js`: Ensures the TEST_MODE environment variable is set correctly

### Test Discovery

- `setup-test-discovery.js`: Creates reference files for test discovery
- `basic-test-runner.js`: Simple test runner for quick test execution
- `run-all-tests.js`: Master script that runs all tests with proper environment setup

### Specialized Test Runners

- `run-path-tests.js`: Runs tests specific to path utilities
- Various other specialized runners in the `suite` directory

## Environment Variables

- `TEST_MODE`: When set to "true", enables testing behavior and uses mock paths where appropriate

## Running Tests

### Via npm

```bash
# Run all tests with TEST_MODE enabled
npm run test:reliable

# Run just the path utility tests
npm run test:path

# Run tests with coverage reporting
npm run test:coverage

# Verify the test setup is correct
npm run test:verify
```

### Via VS Code

The project includes VS Code configurations for:

- Test Explorer integration (with Mocha Explorer)
- Launch configurations for debugging tests
- Task configurations for test-related tasks

To use the Test Explorer:
1. Install the "Test Explorer UI" and "Mocha Test Explorer" extensions
2. Open the Test Explorer view in VS Code
3. Click the "Run All Tests" button

## Test Organization

Tests are organized into several categories:

- **Extension Tests**: Tests for the VS Code extension functionality
- **API Tests**: Tests for the API integration
- **Utility Tests**: Tests for utility functions (path, fs, etc.)

## Test Files

Each test file should follow these conventions:

- Named with `.test.ts` extension
- Include appropriate imports (`chai`, `mocha`, etc.)
- Define tests using BDD-style (`describe`, `it`)
- Use appropriate assertions (`should`, `expect`, etc.)

## Mocking VS Code

For tests that require VS Code API but run outside the extension host:

1. Import the mock module: `import * as vscode from '../mock/vscode'`
2. Ensure TEST_MODE is set to "true"

## Adding New Tests

When adding new tests:

1. Create a new file with `.test.ts` extension
2. Run `npm run test:setup-discovery` to update the test reference files
3. Run `npm run compile-tests` to compile the TypeScript files
4. Verify with `npm run test:verify` that everything is set up correctly

## Troubleshooting

If tests are not being discovered or not running correctly:

1. Run `npm run test:verify` to check for common issues
2. Ensure TEST_MODE is set to "true"
3. Check that test files have been compiled (`npm run compile-tests`)
4. Verify that the test discovery has been run (`npm run test:setup-discovery`)
5. Reload the VS Code window to refresh the Test Explorer

## Test Categories

The Cline project includes several categories of tests:

1. **Extension Tests** - Test the VS Code extension core functionality.
2. **API Tests** - Test API integration with various providers (Anthropic, Gemini, etc).
3. **Utility Tests** - Test helper functions used throughout the codebase.
4. **Webview Tests** - Test the webview UI components.

## Running Tests

There are several npm scripts available to run tests:

- `npm run test` - Run all tests using VS Code test infrastructure
- `npm run test:core` - Run only the extension core tests
- `npm run test:path` - Run path utility tests directly with Mocha (ensures TEST_MODE is set)
- `npm run test:utils` - Run all utility tests
- `npm run test:api` - Run API integration tests
- `npm run test:reliable` - Run all tests with the custom test runner (ensures TEST_MODE is set)

## Test Environment

### TEST_MODE Environment Variable

Some tests, particularly path-related tests, require a special environment variable `TEST_MODE=true` to function correctly across different platforms. This is handled in the following ways:

1. The `set-test-mode.js` script can be used as a pre-launch hook in test commands
2. The `run-path-tests.js` script directly runs Mocha tests with TEST_MODE set
3. The `run-all-tests.js` script provides a reliable way to run all tests with proper environment setup

Example:
```javascript
process.env.TEST_MODE = "true";
```

### Cross-Platform Path Handling

Path tests are designed to work across platforms (Windows, macOS, Linux) by:

1. Using standardized forward-slash paths for display
2. Handling platform-specific path comparisons in utility functions
3. Using special handling in test mode for predictable test results

## Mock Implementation

For tests that require VS Code API access outside the extension host, mocks are provided:

- `src/test/mock/vscode.js` - JavaScript mock implementation of VS Code APIs
- `test-helper.js` - Sets up module aliasing to redirect VS Code imports to the mock

## Best Practices

1. Add the pre-launch hook to test commands to ensure TEST_MODE is set
2. Use `toPosixPath` to normalize path separators for display
3. Use `arePathsEqual` for path comparisons
4. Group related tests in appropriate categories
5. Consider platform differences when writing path-related tests
6. Include detailed error messages and logging in test failures

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

## Test Discovery

This project uses both npm scripts and VS Code's Test Explorer for running tests. For optimal experience with VS Code's Test Explorer:

1. **Install the recommended extensions**:
   - Test Explorer UI (`hbenl.vscode-test-explorer`)
   - Mocha Test Explorer (`hbenl.vscode-mocha-test-adapter`)

2. **Setup Test Discovery**:
   To make VS Code discover all tests:
   ```
   npm run test:setup-discovery
   ```
   This creates reference files in the `src/test/suite` directory pointing to test files in other locations. The approach uses file references rather than symbolic links to ensure compatibility across all platforms (especially Windows where symlinks require administrator privileges).

3. **Git Configuration**:
   The reference files created by the discovery script are excluded from version control via entries in `.gitignore`:
   ```
   # Test discovery reference files
   src/test/suite/*-*
   src/test/suite/test-helper.js
   ```

## Running Tests with Coverage

You can generate test coverage reports using:

```
npm run test:coverage
```

This creates coverage reports in both text and LCOV formats in the `coverage` directory (also excluded from git).

## Future Considerations

As VS Code's testing infrastructure evolves to better support ESM, we may revisit this approach. The current setup represents a pragmatic solution to work within the constraints of VS Code's testing tools while maintaining compatibility with the project's modern module structure.

## Test Categories and VS Code API

This project has three categories of tests:

1. **Extension Host Tests**: Tests that must run within the VS Code extension host
   - These tests interact with the actual VS Code API
   - Examples: extension activation, webview handling, UI commands

2. **Unit Tests**: Tests that don't require VS Code
   - These are standalone and don't interact with VS Code APIs
   - Examples: utility functions, API transformations

3. **Tests with VS Code Mocking**: Tests that use VS Code APIs but can run with mocks
   - These tests import the 'vscode' module but can run with our mock implementation
   - Examples: ClineIgnoreController, TerminalProcess tests

## VS Code Mocking

For tests that import the 'vscode' module but don't need to run in the extension host, we use a mock implementation:

1. A mock 'vscode' module is provided in `src/test/mock/vscode.ts`
2. Module aliasing is set up in `src/test/test-helper.js`
3. Test references automatically include the necessary setup

This approach allows more tests to run in the Mocha Test Explorer without requiring the extension host. 