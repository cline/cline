# VS Code Test Discovery Guide

This document explains how the VS Code Test Explorer integration works in the Cline project and how to troubleshoot common issues.

## How Test Discovery Works

The test discovery process in VS Code uses a dual approach:

1. **Reference Files**: The `setup-test-discovery.js` script creates reference files in the `src/test/suite` directory that point to actual test files throughout the codebase. This is the primary mechanism.

2. **Direct Discovery**: As a fallback, the `index.ts` file also uses glob patterns to find test files directly.

## Key Components

### 1. Test Reference Files

Reference files are JavaScript files created in the `src/test/suite` directory that require the actual test files. They follow this naming pattern:
- `src-test-*.test.ts` - References to source TypeScript test files
- `out-*.test.js` - References to compiled JavaScript test files

### 2. The index.ts File

The `src/test/suite/index.ts` file is responsible for:
- Finding test files (both through references and direct glob patterns)
- Setting the TEST_MODE environment variable
- Organizing tests into categories
- Running the tests via Mocha

### 3. VS Code Settings

The `.vscode/settings.json` file contains Mocha Explorer settings that control how tests are discovered and run in VS Code:

```json
"mochaExplorer.files": ["out/**/*.test.js", "src/**/*.test.js"],
"mochaExplorer.require": ["src/test/test-helper.js", "src/test/set-test-mode.js"],
"mochaExplorer.ui": "bdd",
"mochaExplorer.timeout": 10000,
"mochaExplorer.env": {
    "TEST_MODE": "true"
}
```

## How to Fix Common Issues

### VS Code Not Finding All Tests

1. **Run Test Discovery Setup**:
   ```
   npm run test:setup-discovery
   ```
   This creates reference files for all tests in your codebase.

2. **Compile TypeScript Tests**:
   ```
   npm run compile-tests
   ```
   Ensures all TypeScript tests are compiled to JavaScript.

3. **Reload VS Code Window**:
   Use the command palette (Ctrl+Shift+P) and select "Developer: Reload Window".

4. **Verify Test Setup**:
   ```
   npm run test:verify
   ```
   Checks that all components of the test infrastructure are working.

### Tests Running in VS Code But Failing

1. **Check TEST_MODE**:
   Ensure the TEST_MODE environment variable is set to "true" in VS Code settings.

2. **Check VS Code Mock**:
   Make sure the VS Code mock is compiled:
   ```
   npm run test:update-mocks
   ```

3. **Run Tests from Terminal**:
   Try running the tests from the terminal to see if they pass:
   ```
   npm run test:reliable
   ```

### Adding New Tests

When adding new test files:

1. Create your test file with the `.test.ts` extension
2. Run test discovery setup:
   ```
   npm run test:setup-discovery
   ```
3. Compile your tests:
   ```
   npm run compile-tests
   ```
4. Reload the VS Code window

## Test Categories

The test discovery process organizes tests into these categories:

1. **Extension Tests**: Tests in the `test/suite` directory
2. **API Tests**: Tests in the `test/api` directory
3. **Utility Tests**: Tests in the `utils` or `test/utilities` directories
4. **Other Tests**: Tests that don't fit any of the above categories

## Advanced Troubleshooting

If you're still having issues with test discovery:

1. Check the console output when VS Code is loading tests (Output > Mocha Test Explorer)
2. Examine the reference files in `src/test/suite` to ensure they're properly referencing tests
3. Try running tests using the specific test categories:
   ```
   npm run test:master extension
   npm run test:master utils
   npm run test:master api
   ```

Remember that every time you add or move test files, you should run `npm run test:setup-discovery` to update the reference files. 