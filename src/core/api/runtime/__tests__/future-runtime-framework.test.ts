import { describe, it } from "mocha"
import "should"
import { getFutureRuntimeDescriptor, getFutureRuntimeDescriptors, validateFutureRuntimeDescriptorCoverage } from "../future-runtime-framework"

describe("FutureRuntimeFramework", () => {
	it("should keep GitHub CLI as a todo-grade later candidate", () => {
		const descriptor = getFutureRuntimeDescriptor("github-cli")

		descriptor.lifecycleStatus.should.equal("todo")
		descriptor.mvpStage.should.equal(3)
	})

	it("should cover all declared future runtime ids", () => {
		validateFutureRuntimeDescriptorCoverage().should.equal(true)
		getFutureRuntimeDescriptors().map((entry) => entry.runtimeId).should.deepEqual(["github-cli", "custom-langgraph-cli"])
	})
})
