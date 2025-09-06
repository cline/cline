import type { WorkspaceRootManager } from "@core/workspace/WorkspaceRootManager"
import { expect } from "chai"
import { shouldUseMultiRoot } from "../factory"

describe("shouldUseMultiRoot", () => {
	const makeWr = (roots: { path: string }[]): WorkspaceRootManager => {
		// minimal mock: only getRoots is used
		return {
			getRoots: () => roots as any,
		} as unknown as WorkspaceRootManager
	}

	it("returns true when feature flag is on, checkpoints enabled, and more than one root exists", () => {
		const wr = makeWr([{ path: "/r1" }, { path: "/r2" }])
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: true,
			workspaceManager: wr,
			enableCheckpoints: true,
		})
		expect(result).to.equal(true)
	})

	it("returns false when feature flag is off", () => {
		const wr = makeWr([{ path: "/r1" }, { path: "/r2" }])
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: false,
			workspaceManager: wr,
			enableCheckpoints: true,
		})

		expect(result).to.equal(false)
	})

	it("returns false when checkpoints are disabled", () => {
		const wr = makeWr([{ path: "/r1" }, { path: "/r2" }])
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: true,
			workspaceManager: wr,
			enableCheckpoints: false,
		})
		expect(result).to.equal(false)
	})

	it("returns false when workspaceManager is undefined", () => {
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: true,
			workspaceManager: undefined,
			enableCheckpoints: true,
		})
		expect(result).to.equal(false)
	})

	it("returns false when only a single root exists", () => {
		const wr = makeWr([{ path: "/r1" }])
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: true,
			workspaceManager: wr,
			enableCheckpoints: true,
		})
		expect(result).to.equal(false)
	})

	it("returns false when there are no roots", () => {
		const wr = makeWr([])
		const result = shouldUseMultiRoot({
			isMultiRootEnabled: true,
			workspaceManager: wr,
			enableCheckpoints: true,
		})
		expect(result).to.equal(false)
	})
})
