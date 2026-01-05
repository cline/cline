/**
 * Manual Test Script for Quantrel Authentication
 *
 * This script can be used to test the Quantrel authentication flow
 * outside of the VS Code extension context.
 *
 * Usage:
 * 1. Update the credentials below
 * 2. Run: npx tsx src/services/quantrel/test-auth.ts
 */

import { QuantrelAuthService } from "./QuantrelAuthService"
import { QuantrelModelService } from "./QuantrelModelService"

// Mock StateManager for testing
class MockStateManager {
	private secrets = new Map<string, string | undefined>()
	private state = new Map<string, any>()

	getSecretKey(key: string): string | undefined {
		return this.secrets.get(key)
	}

	setSecret(key: string, value: string | undefined): void {
		this.secrets.set(key, value)
	}

	getState(key: string): any {
		return this.state.get(key)
	}

	setState(key: string, value: any): void {
		this.state.set(key, value)
	}
}

async function testAuthentication() {
	console.log("🧪 Testing Quantrel Authentication\n")

	const mockStateManager = new MockStateManager() as any
	const baseUrl = "http://localhost:8080"

	// Create auth service
	const authService = new QuantrelAuthService(mockStateManager, baseUrl)
	console.log("✅ QuantrelAuthService created\n")

	// Test 1: Login
	console.log("📝 Test 1: Login")
	console.log("Please enter your credentials:")

	// In a real test, you'd prompt for these or use environment variables
	const email = process.env.QUANTREL_EMAIL || "gdeep.7314@gmail.com"
	const password = process.env.QUANTREL_PASSWORD || "YOUR_PASSWORD_HERE"

	if (password === "YOUR_PASSWORD_HERE") {
		console.error("❌ Please set QUANTREL_PASSWORD environment variable or update the script")
		process.exit(1)
	}

	const loginResult = await authService.login(email, password)

	if (!loginResult.success) {
		console.error(`❌ Login failed: ${loginResult.error}`)
		process.exit(1)
	}

	console.log("✅ Login successful!\n")

	// Test 2: Get User Info
	console.log("📝 Test 2: Get User Info")
	const userInfo = await authService.getUserInfo()

	if (!userInfo) {
		console.error("❌ Failed to get user info")
		process.exit(1)
	}

	console.log("✅ User Info:")
	console.log(`   Email: ${userInfo.email}`)
	console.log(`   Sub: ${userInfo.sub}`)
	console.log(`   Scope: ${userInfo.scope}`)
	console.log(`   Expires: ${userInfo.exp}`)
	console.log()

	// Test 3: Validate Token
	console.log("📝 Test 3: Validate Token")
	const isValid = await authService.validateToken()

	if (!isValid) {
		console.error("❌ Token validation failed")
		process.exit(1)
	}

	console.log("✅ Token is valid\n")

	// Test 4: Fetch Models
	console.log("📝 Test 4: Fetch Models")
	const modelService = new QuantrelModelService(mockStateManager, baseUrl)

	try {
		const agents = await modelService.fetchAgents()
		console.log(`✅ Fetched ${agents.length} models\n`)

		// Show first 5 models
		console.log("📋 Sample Models (first 5):")
		agents.slice(0, 5).forEach((agent, index) => {
			console.log(`   ${index + 1}. ${agent.name} (${agent.publisher})`)
			console.log(`      Model ID: ${agent.modelId}`)
			console.log(`      Price: $${agent.inputPrice}/1M in, $${agent.outputPrice}/1M out`)
			console.log(`      Context: ${agent.contextWindow.toLocaleString()} tokens`)
			console.log()
		})
	} catch (error) {
		console.error(`❌ Failed to fetch models: ${error}`)
		process.exit(1)
	}

	// Test 5: Search Models
	console.log("📝 Test 5: Search Models (Claude)")
	const claudeModels = modelService.searchAgents("Claude")
	console.log(`✅ Found ${claudeModels.length} Claude models`)
	claudeModels.slice(0, 3).forEach((agent) => {
		console.log(`   - ${agent.name}`)
	})
	console.log()

	// Test 6: Get Recommended for Coding
	console.log("📝 Test 6: Get Recommended Coding Models")
	const codingModels = modelService.getRecommendedForCoding()
	console.log(`✅ Found ${codingModels.length} recommended coding models (top 3):`)
	codingModels.slice(0, 3).forEach((agent) => {
		console.log(`   - ${agent.name} (Intelligence: ${agent.intelligence}/10)`)
	})
	console.log()

	// Test 7: Logout
	console.log("📝 Test 7: Logout")
	await authService.logout()
	console.log("✅ Logged out successfully\n")

	// Test 8: Verify logout
	console.log("📝 Test 8: Verify Logout")
	const isAuthenticatedAfterLogout = authService.isAuthenticated()

	if (isAuthenticatedAfterLogout) {
		console.error("❌ Still authenticated after logout")
		process.exit(1)
	}

	console.log("✅ Not authenticated (logout confirmed)\n")

	// Cleanup
	authService.dispose()

	console.log("🎉 All tests passed!")
}

// Run tests
testAuthentication().catch((error) => {
	console.error("💥 Test failed with error:", error)
	process.exit(1)
})
