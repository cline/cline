import * as assert from "assert"
import { describe, it } from "mocha"
import { shouldAutoApproveCommand, CommandAutoApproveRule } from "../shared/CommandAutoApproveRule"

describe("Command Auto Approve Rules", () => {
	describe("shouldAutoApproveCommand", () => {
		it("should return false when no rules are provided", () => {
			const result = shouldAutoApproveCommand("npm install", [])
			assert.strictEqual(result, false)
		})

		it("should return false when rules is undefined", () => {
			const result = shouldAutoApproveCommand("npm install", undefined as unknown as CommandAutoApproveRule[])
			assert.strictEqual(result, false)
		})

		it("should match simple string patterns", () => {
			const rules: CommandAutoApproveRule[] = [{ pattern: "npm install", action: "auto-approve" }]
			const result = shouldAutoApproveCommand("npm install express", rules)
			assert.strictEqual(result, true)
		})

		it('should follow the "last rule wins" principle', () => {
			const rules: CommandAutoApproveRule[] = [
				{ pattern: "npm", action: "auto-approve" },
				{ pattern: "install", action: "require-approval" },
			]
			const result = shouldAutoApproveCommand("npm install express", rules)
			assert.strictEqual(result, false)

			const reversedRules: CommandAutoApproveRule[] = [
				{ pattern: "install", action: "require-approval" },
				{ pattern: "npm", action: "auto-approve" },
			]
			const reversedResult = shouldAutoApproveCommand("npm install express", reversedRules)
			assert.strictEqual(reversedResult, true)
		})

		it("should handle regex patterns correctly", () => {
			const rules: CommandAutoApproveRule[] = [{ pattern: "/^npm (install|list)/", action: "auto-approve" }]

			// Should match
			assert.strictEqual(shouldAutoApproveCommand("npm install express", rules), true)
			assert.strictEqual(shouldAutoApproveCommand("npm list", rules), true)

			// Should not match
			assert.strictEqual(shouldAutoApproveCommand("npm uninstall express", rules), false)
			assert.strictEqual(shouldAutoApproveCommand("yarn install", rules), false)
		})

		it("should handle regex patterns with flags", () => {
			const rules: CommandAutoApproveRule[] = [{ pattern: "/npm/i", action: "auto-approve" }]

			// Should match case-insensitively
			assert.strictEqual(shouldAutoApproveCommand("NPM install express", rules), true)
			assert.strictEqual(shouldAutoApproveCommand("npm Install", rules), true)
		})

		it("should handle invalid regex patterns gracefully", () => {
			const rules: CommandAutoApproveRule[] = [
				{ pattern: "/npm(/i", action: "auto-approve" }, // Invalid regex
			]

			// Should not throw and should not match
			assert.strictEqual(shouldAutoApproveCommand("npm install express", rules), false)
		})

		it("should handle multiple matching rules correctly", () => {
			const rules: CommandAutoApproveRule[] = [
				{ pattern: "npm", action: "auto-approve" },
				{ pattern: "install", action: "auto-approve" },
				{ pattern: "express", action: "require-approval" },
			]

			// Last matching rule (express) requires approval
			assert.strictEqual(shouldAutoApproveCommand("npm install express", rules), false)

			// Only npm and install match, so auto-approve
			assert.strictEqual(shouldAutoApproveCommand("npm install react", rules), true)
		})
	})
})
