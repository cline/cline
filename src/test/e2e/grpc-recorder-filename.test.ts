import { expect } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

// Test to verify gRPC recorder filename generation works correctly
e2e("GRPC Recorder - generates test-specific filenames", async ({ page, sidebar }, testInfo) => {
	// This test verifies that the filename generation logic works correctly
	// The environment variable is set in the VSCode extension process, not the test process

	// Test the filename generation logic directly
	const testFileName = E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name)

	// Verify the generated filename contains expected components (allowing for multiple underscores)
	expect(testFileName).toContain("grpc_recorder")
	expect(testFileName).toContain("generates_test_specific_filenames")

	// Verify the filename contains a timestamp for uniqueness
	expect(testFileName).toMatch(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/)

	// Verify the filename is properly sanitized (no spaces or special characters)
	expect(testFileName).toMatch(/^[a-z0-9_-]+$/i)

	// Simple interaction to ensure the test framework is working
	await expect(sidebar.getByRole("button", { name: "Get Started for Free" })).toBeVisible()
})
