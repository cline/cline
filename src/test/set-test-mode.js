/**
 * Helper script to set TEST_MODE environment variable
 * This ensures that tests using mock paths will function correctly
 * across different operating systems.
 */

// Set TEST_MODE environment variable
process.env.TEST_MODE = "true"

// Log for debugging
console.log("TEST_MODE environment variable set to:", process.env.TEST_MODE)

// This file can be required at the beginning of test runs
// or as a pre-launch hook to ensure proper test environment
