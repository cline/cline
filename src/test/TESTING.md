# Running Tests in Cline

This guide explains how to run tests for the Cline project using both npm commands and VS Code's integrated test explorer.

## Test Categories

Cline's tests are organized into several categories:

1. **Extension Tests** - Test the VS Code extension functionality
2. **API Tests** - Test API integrations (Anthropic, Gemini, etc.)
3. **Utility Tests** - Test helper functions (path handling, filesystem, etc.)
4. **Webview Tests** - Test the UI components

## Setup

Before running tests, ensure your environment is properly set up:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Compile TypeScript Test Files**:
   ```bash
   npm run compile-tests
   ```

3. **Setup Test Discovery** (required for VS Code test explorer):
   ```bash
   npm run test:setup-discovery
   ```

## Running Tests with npm

### Running All Tests

```bash
npm test
```
or for a more reliable approach that ensures TEST_MODE is set:
```bash
npm run test:reliable
```

### Running Specific Test Categories

```bash
# Run only extension core tests
npm run test:core

# Run path handling tests specifically
npm run test:path

# Run all utility tests
npm run test:utils

# Run API integration tests
npm run test:api
```

### Running Tests with Coverage

```bash
npm run test:coverage
```

## Running Tests in VS Code

### Using the Test Explorer

1. Install the recommended extensions:
   - Test Explorer UI (`hbenl.vscode-test-explorer`)
   - Mocha Test Explorer (`hbenl.vscode-mocha-test-adapter`)

2. Open the Test Explorer view in VS Code (flask/test tube icon in sidebar)

3. Click the Refresh button if tests aren't already loaded

4. Run tests:
   - Click the play button next to individual tests to run them
   - Click the play button next to test suites to run all tests in that suite
   - Click the main play button to run all tests

### Using Launch Configurations

VS Code also includes several launch configurations for running and debugging tests:

1. Open the Debug view (Ctrl+Shift+D / Cmd+Shift+D)

2. Select one of the following configurations from the dropdown:
   - **Extension Tests** - Run tests within VS Code extension host
   - **Debug Current Test File** - Run and debug the currently open test file
   - **Run Path Tests** - Run the path utility tests specifically
   - **Run All Tests** - Run all tests with proper environment setup

3. Click the green play button or press F5 to start debugging

## Cross-Platform Testing Considerations

### TEST_MODE Environment Variable

The `TEST_MODE` environment variable is crucial for consistent test behavior across platforms, especially for path-related tests. When this variable is set:

1. **Path Tests:** Use consistent behavior for path comparison and display, regardless of platform
2. **File Path Display:** Normalize paths to use forward slashes for consistent display
3. **Path Comparison:** Handle case sensitivity differently based on the current platform

All our test scripts set this variable appropriately, but if you're creating custom test commands, ensure it's set:

```js
process.env.TEST_MODE = "true";
```

Our npm scripts use `cross-env` to ensure this environment variable works correctly across platforms:

```json
"test:all": "cross-env TEST_MODE=true npx vscode-test..."
```

### VS Code vs. npm Test Differences

When running tests in VS Code's Test Explorer, the environment is automatically configured with TEST_MODE set. When running via npm, we use cross-env to ensure consistent behavior.

If you encounter any differences between running tests in VS Code versus npm, verify that TEST_MODE is properly set.

## Troubleshooting

### Tests Not Appearing in VS Code

1. Make sure you've run the test discovery script:
   ```bash
   npm run test:setup-discovery
   ```

2. Check that the Test Explorer extensions are installed and enabled

3. Reload the VS Code window (Ctrl+Shift+P / Cmd+Shift+P, then "Developer: Reload Window")

### Path Tests Failing

Path tests require the TEST_MODE environment variable to be set to "true". The custom test runners handle this automatically, but if you're running tests in another way, make sure to set this variable:

```javascript
process.env.TEST_MODE = "true";
```

### VS Code Extension Tests Failing

Extension tests require VS Code's extension testing infrastructure. Make sure you're using the proper launch configuration or npm script.

## Verifying Test Setup

We provide a verification script to check if the test environment is properly configured:

```bash
npm run test:verify
```

This script checks for:
- Test helper existence
- VS Code mock compilation
- Test discovery setup
- Required npm scripts
- VS Code configuration

## Best Practices

1. **Write Platform-Agnostic Tests**: Use the utilities in `src/utils/path.ts` for path operations

2. **Use TEST_MODE for Special Cases**: Set TEST_MODE for tests that need consistent cross-platform behavior

3. **Group Related Tests**: Keep tests organized by category

4. **Run Tests Regularly**: Make it a habit to run tests before and after making changes

5. **Maintain Test Coverage**: Write tests for new functionality and bug fixes 