import { expect } from "chai"
import { describe, it } from "mocha"
import { buildKernelSessionKey } from "../kernelSessionKey"

describe("kernelSessionKey", () => {
	it("produces different keys for different artifacts with same profile", () => {
		const ws = "vscode://folder/workspace"
		const profile = "profile_abc"
		const a = buildKernelSessionKey(ws, "artifact_a", profile)
		const b = buildKernelSessionKey(ws, "artifact_b", profile)
		expect(a).to.not.equal(b)
		expect(a).to.have.length(24)
	})

	it("is stable for the same inputs", () => {
		const key1 = buildKernelSessionKey("ws", "art", "prof")
		const key2 = buildKernelSessionKey("ws", "art", "prof")
		expect(key1).to.equal(key2)
	})
})
