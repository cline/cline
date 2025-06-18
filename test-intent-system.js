// Test file for Intent System Testing
// This file will be modified multiple times to test intent tracking and restoration
// MAJOR MODIFICATION - Complete refactor

console.log("HEAVILY MODIFIED VERSION - This should be reverted!")
console.log("Adding complex new functionality")
console.log("This represents a major change that we might want to undo")

function originalFunction() {
	console.log("Function called - MODIFIED HEAVILY")
	console.log("Added complex logic that might break things")
	const result = "This implementation has been completely changed"
	console.log("Result:", result)
	return result
}

function newFeatureFunction() {
	console.log("New feature function - also heavily modified")
	return "This is a new feature added in modification 1 - CHANGED AGAIN"
}

function anotherNewFunction() {
	console.log("This is a completely new function added in the major modification")
	return {
		status: "new",
		complexity: "high",
		shouldRevert: true,
	}
}

function yetAnotherFunction() {
	return "Even more new functionality that we might want to remove"
}

const originalData = {
	version: 2,
	status: "modified",
	features: ["basic", "logging", "new-feature"],
}

const additionalConfig = {
	environment: "test",
	debug: true,
	timestamp: Date.now(),
}

module.exports = {
	originalFunction,
	newFeatureFunction,
	originalData,
	additionalConfig,
}
