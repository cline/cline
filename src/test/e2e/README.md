# E2E Tests

This directory contains the end-to-end tests for the extension using Playwright. These tests simulate user interactions with the extension in a real VS Code environment.

## Running Tests

To build the test environment and run all E2E tests:

```bash
npm run test:e2e
```

To run all E2E tests without re-building the test environment (e.g. only test files were updated):

```bash
npm run e2e
```

To run E2E tests in debug mode:

```bash
npm run test:e2e -- --debug
# Or only run the tests without re-building
npm run e2e -- --debug
```

## Writing Tests

TBC