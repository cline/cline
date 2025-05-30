/**
 * This is a simple JavaScript file for testing breakpoint functionality.
 * It contains functions that can be used to test breakpoints.
 */
function add(a, b) {
	const result = a + b
	return result
}

// A function with a loop
function countToTen() {
	let count = 0
	for (let i = 0; i < 10; i++) {
		count += 1
	}
	return count
}

// Immediately execute the add function to ensure the breakpoint is hit
// This helps with the integration test that waits for a breakpoint to be hit
add(5, 10)
