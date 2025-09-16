/**
 * Tests for HookConfiguration utilities
 */

import { expect } from "chai"
import { describe, it } from "mocha"
import {
	getMatchingHooks,
	HookConfiguration,
	HookDefinition,
	matchesPattern,
	validateHookConfiguration,
} from "./HookConfiguration"

describe("HookConfiguration Utilities", () => {
	describe("matchesPattern", () => {
		it("should match exact tool names", () => {
			expect(matchesPattern("read_file", "read_file")).to.equal(true)
			expect(matchesPattern("read_file", "write_file")).to.equal(false)
		})

		it("should match wildcard pattern", () => {
			expect(matchesPattern("read_file", "*")).to.equal(true)
			expect(matchesPattern("write_file", "*")).to.equal(true)
			expect(matchesPattern("anything", "*")).to.equal(true)
		})

		it("should match OR patterns", () => {
			expect(matchesPattern("read_file", "read_file|write_file")).to.equal(true)
			expect(matchesPattern("write_file", "read_file|write_file")).to.equal(true)
			expect(matchesPattern("delete_file", "read_file|write_file")).to.equal(false)
		})

		it("should match glob patterns", () => {
			expect(matchesPattern("read_file", "read_*")).to.equal(true)
			expect(matchesPattern("write_file", "read_*")).to.equal(false)
			expect(matchesPattern("file_read", "*_read")).to.equal(true)
			expect(matchesPattern("test_file_read", "*_file_*")).to.equal(true)
		})

		it("should handle spaces in OR patterns", () => {
			expect(matchesPattern("read_file", "read_file | write_file | delete_file")).to.equal(true)
			expect(matchesPattern("write_file", "read_file | write_file | delete_file")).to.equal(true)
		})
	})

	describe("getMatchingHooks", () => {
		const testHook1: HookDefinition = {
			type: "command",
			command: "hook1.js",
		}

		const testHook2: HookDefinition = {
			type: "command",
			command: "hook2.js",
			timeout: 30,
		}

		const testHook3: HookDefinition = {
			type: "command",
			command: ["node", "hook3.js"],
		}

		const config: HookConfiguration = {
			hooks: {
				PreToolUse: [
					{
						matcher: "*",
						hooks: [testHook1],
					},
					{
						matcher: "read_file|write_file",
						hooks: [testHook2],
					},
				],
				PostToolUse: [
					{
						matcher: "write_*",
						hooks: [testHook3],
					},
				],
			},
		}

		it("should get hooks matching wildcard", () => {
			const hooks = getMatchingHooks(config, "PreToolUse", "any_tool")
			expect(hooks).to.have.length(1)
			expect(hooks[0]).to.equal(testHook1)
		})

		it("should get hooks matching specific tool", () => {
			const hooks = getMatchingHooks(config, "PreToolUse", "read_file")
			expect(hooks).to.have.length(2) // Matches both "*" and "read_file|write_file"
			expect(hooks).to.include(testHook1)
			expect(hooks).to.include(testHook2)
		})

		it("should get hooks matching glob pattern", () => {
			const hooks = getMatchingHooks(config, "PostToolUse", "write_to_file")
			expect(hooks).to.have.length(1)
			expect(hooks[0]).to.equal(testHook3)
		})

		it("should return empty array for non-matching tools", () => {
			const hooks = getMatchingHooks(config, "PostToolUse", "read_file")
			expect(hooks).to.have.length(0)
		})

		it("should return empty array for non-existent event", () => {
			const hooks = getMatchingHooks(config, "SessionStart", "any_tool")
			expect(hooks).to.have.length(0)
		})

		it("should handle non-tool events", () => {
			const nonToolConfig: HookConfiguration = {
				hooks: {
					UserPromptSubmit: [
						{
							matcher: "*",
							hooks: [testHook1],
						},
					],
				},
			}

			const hooks = getMatchingHooks(nonToolConfig, "UserPromptSubmit")
			expect(hooks).to.have.length(1)
			expect(hooks[0]).to.equal(testHook1)
		})
	})

	describe("validateHookConfiguration", () => {
		it("should validate correct configuration", () => {
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
									command: "hook.js",
								},
							],
						},
					],
				},
			}

			expect(validateHookConfiguration(config)).to.equal(true)
		})

		it("should accept configuration with settings", () => {
			const config = {
				hooks: {
					PostToolUse: [
						{
							matcher: "write_file",
							hooks: [
								{
									type: "command",
									command: ["node", "hook.js"],
									timeout: 30,
								},
							],
						},
					],
				},
				settings: {
					defaultTimeout: 45,
					parallel: false,
					debug: true,
				},
			}

			expect(validateHookConfiguration(config)).to.equal(true)
		})

		it("should reject invalid configuration - no hooks object", () => {
			expect(validateHookConfiguration({})).to.equal(false)
			expect(validateHookConfiguration({ hooks: null })).to.equal(false)
		})

		it("should reject invalid configuration - hooks not array", () => {
			const config = {
				hooks: {
					PreToolUse: "not an array",
				},
			}
			expect(validateHookConfiguration(config)).to.equal(false)
		})

		it("should reject invalid configuration - missing matcher", () => {
			const config = {
				hooks: {
					PreToolUse: [
						{
							hooks: [
								{
									type: "command",
									command: "hook.js",
								},
							],
						},
					],
				},
			}
			expect(validateHookConfiguration(config)).to.equal(false)
		})

		it("should reject invalid configuration - missing command", () => {
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "command",
								},
							],
						},
					],
				},
			}
			expect(validateHookConfiguration(config)).to.equal(false)
		})

		it("should reject invalid configuration - wrong type", () => {
			const config = {
				hooks: {
					PreToolUse: [
						{
							matcher: "*",
							hooks: [
								{
									type: "invalid",
									command: "hook.js",
								},
							],
						},
					],
				},
			}
			expect(validateHookConfiguration(config)).to.equal(false)
		})

		it("should reject non-object input", () => {
			expect(validateHookConfiguration(null)).to.equal(false)
			expect(validateHookConfiguration(undefined)).to.equal(false)
			expect(validateHookConfiguration("string")).to.equal(false)
			expect(validateHookConfiguration(123)).to.equal(false)
		})
	})
})
