/**
 * Helper script to ensure TEST_MODE is set to true for test runs
 */

// Set the TEST_MODE environment variable to true
process.env.TEST_MODE = "true"

console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)
console.log("Platform:", process.platform)

// This script can be called as a pre-launch hook for vscode-test
