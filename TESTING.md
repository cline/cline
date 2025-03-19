# Testing Guide for Cline

This document provides comprehensive guidance on the testing infrastructure and practices in the Cline project.

## Quick Start

To run all tests:

```bash
npm run test:master
```

To run a specific test category:

```bash
npm run test:master -- path  # Run path utility tests
npm run test:master -- api   # Run API integration tests
```

## Testing Infrastructure

The Cline project uses a comprehensive testing infrastructure designed to be robust across different environments. This setup ensures a consistent experience whether running tests via npm scripts or VS Code's Test Explorer.

### Key Components

- **Test Framework**: Mocha with Chai assertions
- **VS Code Testing**: Custom infrastructure for VS Code extension testing
- **Mock VS Code API**: A lightweight mock implementation for unit tests
- **Test Discovery**: Automatic discovery of test files
- **Environment Variables**: `TEST_MODE` flag for consistent test behavior

## Running Tests

### Via npm

Several npm scripts are available for running tests:

```bash
# Run all tests with verification
npm run test:master

# Run specific test categories
npm run test:master -- extension  # VS Code extension tests
npm run test:master -- utils      # Utility tests
npm run test:master -- api        # API integration tests
npm run test:master -- path       # Path utility tests
npm run test:master -- coverage   # Run with coverage reporting

# Legacy commands
npm run test:reliable    # Run all tests with TEST_MODE enabled
npm run test:path        # Run path utility tests
npm run test:verify      # Verify test setup
```

### Via VS Code

The project is configured to work with VS Code's Test Explorer:

1. Install the "Test Explorer UI" and "Mocha Test Explorer" extensions
2. Open the Test Explorer view in VS Code
3. Click on the "Refresh" button to discover tests
4. Run tests by clicking on the "Run All Tests" button or individual test cases

## Test Organization

Tests are organized into several categories:

- **Extension Tests**: Tests for the VS Code extension functionality
- **API Tests**: Tests for API integration
- **Utility Tests**: Tests for utility functions (path, fs, etc.)

## Test Configuration

### Environment Variables

- `TEST_MODE`: When set to "true", enables testing behavior and uses mock paths where appropriate

### VS Code Configuration

The `.vscode/settings.json` file includes configuration for Mocha Explorer:

```json
"mochaExplorer.files": ["out/**/*.test.js", "src/**/*.test.js"],
"mochaExplorer.require": ["src/test/test-helper.js", "src/test/set-test-mode.js"],
"mochaExplorer.env": {
  "TEST_MODE": "true"
}
```

## Adding New Tests

When adding new tests:

1. Create a new file with `.test.ts` extension
2. Run `npm run test:setup-discovery` to update test references
3. Run `npm run compile-tests` to compile the TypeScript files
4. Verify with `npm run test:verify` that everything is set up correctly

## Mocking VS Code

For tests that require VS Code API:

```typescript
// Import the mock
import * as vscode from '../mock/vscode';

// Use VS Code API as normal
vscode.window.showInformationMessage('Test message');
```

## Troubleshooting

If tests are not being discovered or running correctly:

1. Run `npm run test:verify` to check for common issues
2. Ensure TEST_MODE is set to "true"
3. Run `npm run compile-tests` to compile test files
4. Run `npm run test:setup-discovery` to update test references
5. Reload the VS Code window

## Additional Resources

For more detailed information about the testing infrastructure, see [src/test/README.md](src/test/README.md). 