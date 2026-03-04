import { describe, it } from "mocha"
import "should"
import { getHooksEnabledSafe } from "../hooks-utils"
import { withPlatform } from "./test-utils"

describe("hooks-utils", () => {
	describe("getHooksEnabledSafe", () => {
		it("returns false when user setting is false", () => {
			getHooksEnabledSafe(false).should.be.false()
		})

		it("returns true when user setting is true", () => {
			getHooksEnabledSafe(true).should.be.true()
		})

		it("is stable across repeated calls", () => {
			for (let i = 0; i < 5; i++) {
				getHooksEnabledSafe(true).should.be.true()
			}
		})

		it("returns false for undefined", () => {
			getHooksEnabledSafe(undefined).should.be.false()
		})

		it("does not depend on process.platform in current implementation", async () => {
			await withPlatform("win32", () => {
				getHooksEnabledSafe(true).should.be.true()
			})
			await withPlatform("linux", () => {
				getHooksEnabledSafe(true).should.be.true()
			})
		})
	})
})
