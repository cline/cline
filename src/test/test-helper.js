/**
 * Test helper that sets up module aliasing for the 'vscode' module
 * This file should be required at the beginning of test files
 * that need to mock the VS Code API
 */

const path = require("path")
const moduleAlias = require("module-alias")

// Register alias for 'vscode' to point to our mock implementation
moduleAlias.addAlias("vscode", path.join(__dirname, "mock", "vscode.js"))

// Set up test environment variables
process.env.TEST_MODE = "true"
