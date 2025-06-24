import { describe, it } from "mocha"
import "should"
import { isCommandTransformed, transformCommandForPlatform } from "./platform"

describe("Platform utilities", () => {
	let originalPlatform: string

	beforeEach(() => {
		originalPlatform = process.platform
	})

	afterEach(() => {
		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})

	describe("transformCommandForPlatform", () => {
		it("should not transform commands on non-Windows platforms", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
			})

			const result = transformCommandForPlatform("npx", ["-y", "server-perplexity-ask"])
			result.should.deepEqual({
				command: "npx",
				args: ["-y", "server-perplexity-ask"],
			})
		})

		it("should transform npx commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("npx", ["-y", "server-perplexity-ask"])
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "npx", "-y", "server-perplexity-ask"],
			})
		})

		it("should transform npm commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("npm", ["install"])
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "npm", "install"],
			})
		})

		it("should transform yarn commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("yarn", ["add", "package"])
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "yarn", "add", "package"],
			})
		})

		it("should transform pnpm commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("pnpm", ["install"])
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "pnpm", "install"],
			})
		})

		it("should not transform non-Node commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("python", ["-m", "pip", "install"])
			result.should.deepEqual({
				command: "python",
				args: ["-m", "pip", "install"],
			})
		})

		it("should handle empty args array", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("npx", [])
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "npx"],
			})
		})

		it("should handle undefined args", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			const result = transformCommandForPlatform("npx")
			result.should.deepEqual({
				command: "cmd",
				args: ["/c", "npx"],
			})
		})
	})

	describe("isCommandTransformed", () => {
		it("should return false on non-Windows platforms", () => {
			Object.defineProperty(process, "platform", {
				value: "darwin",
			})

			isCommandTransformed("npx").should.equal(false)
		})

		it("should return true for Node commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			isCommandTransformed("npx").should.equal(true)
			isCommandTransformed("npm").should.equal(true)
			isCommandTransformed("yarn").should.equal(true)
			isCommandTransformed("pnpm").should.equal(true)
		})

		it("should return false for non-Node commands on Windows", () => {
			Object.defineProperty(process, "platform", {
				value: "win32",
			})

			isCommandTransformed("python").should.equal(false)
			isCommandTransformed("git").should.equal(false)
		})
	})
})
