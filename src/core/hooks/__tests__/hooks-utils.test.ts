import { describe, it } from "mocha"
import "should"
import { getHooksEnabledSafe } from "../hooks-utils"
import { withPlatform } from "./test-utils"

describe("hooks-utils", () => {
	describe("getHooksEnabledSafe", () => {
		// If hooks-enabled logic becomes platform/config dependent in the future,
		// expand this suite with behavior-specific cases at that time.
		it("returns true", () => {
			getHooksEnabledSafe().should.be.true()
		})

		it("is stable across repeated calls", () => {
			for (let i = 0; i < 5; i++) {
				getHooksEnabledSafe().should.be.true()
			}
		})

		it("does not depend on process.platform in current implementation", async () => {
			await withPlatform("win32", () => {
				getHooksEnabledSafe().should.be.true()
			})
			await withPlatform("linux", () => {
				getHooksEnabledSafe().should.be.true()
			})
		})
	})
})
