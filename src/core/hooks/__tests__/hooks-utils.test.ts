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

			it("should return false", () => {
				const result = getHooksEnabledSafe()
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
						const result = getHooksEnabledSafe()
						result.should.be.true()
					})

					it("should return true", () => {
						const result = getHooksEnabledSafe()
						result.should.be.true()
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

				getHooksEnabledSafe().should.be.true()
			})

			it("should handle Linux platform correctly", () => {
				Object.defineProperty(process, "platform", {
					value: "linux",
					writable: true,
					configurable: true,
				})

				getHooksEnabledSafe().should.be.true()
			})
		})
	})
})
