import { afterEach, beforeEach, describe, it } from "mocha"
import "should"
import sinon from "sinon"
import { getHooksEnabledSafe } from "../hooks-utils"

describe("hooks-utils", () => {
	let sandbox: sinon.SinonSandbox
	let originalPlatform: string

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		originalPlatform = process.platform
	})

	afterEach(() => {
		sandbox.restore()
		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			writable: true,
			configurable: true,
		})
	})

	describe("getHooksEnabledSafe", () => {
		describe("on Windows platform", () => {
			beforeEach(() => {
				// Mock Windows platform
				Object.defineProperty(process, "platform", {
					value: "win32",
					writable: true,
					configurable: true,
				})
			})

			it("should return false when user setting is true", () => {
				const result = getHooksEnabledSafe(true)
				result.should.be.false()
			})

			it("should return false when user setting is false", () => {
				const result = getHooksEnabledSafe(false)
				result.should.be.false()
			})

			it("should return false when user setting is undefined", () => {
				const result = getHooksEnabledSafe(undefined)
				result.should.be.false()
			})
		})

		describe("on non-Windows platforms", () => {
			const platforms = ["darwin", "linux", "freebsd", "openbsd", "sunos", "aix"]

			platforms.forEach((platform) => {
				describe(`on ${platform}`, () => {
					beforeEach(() => {
						Object.defineProperty(process, "platform", {
							value: platform,
							writable: true,
							configurable: true,
						})
					})

					it("should return true when user setting is true", () => {
						const result = getHooksEnabledSafe(true)
						result.should.be.true()
					})

					it("should return false when user setting is false", () => {
						const result = getHooksEnabledSafe(false)
						result.should.be.false()
					})

					it("should return false when user setting is undefined (default)", () => {
						const result = getHooksEnabledSafe(undefined)
						result.should.be.false()
					})
				})
			})
		})

		describe("edge cases", () => {
			it("should handle macOS platform correctly", () => {
				Object.defineProperty(process, "platform", {
					value: "darwin",
					writable: true,
					configurable: true,
				})

				// macOS should respect user setting
				getHooksEnabledSafe(true).should.be.true()
				getHooksEnabledSafe(false).should.be.false()
				getHooksEnabledSafe(undefined).should.be.false()
			})

			it("should handle Linux platform correctly", () => {
				Object.defineProperty(process, "platform", {
					value: "linux",
					writable: true,
					configurable: true,
				})

				// Linux should respect user setting
				getHooksEnabledSafe(true).should.be.true()
				getHooksEnabledSafe(false).should.be.false()
				getHooksEnabledSafe(undefined).should.be.false()
			})
		})
	})
})
