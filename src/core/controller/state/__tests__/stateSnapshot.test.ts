import { strict as assert } from "node:assert"
import { describe, it } from "mocha"
import sinon from "sinon"
import { Logger } from "@/shared/services/Logger"
import { LARGE_STATE_SNAPSHOT_WARNING_BYTES, serializeStateSnapshot, warnOnLargeStateSnapshot } from "../stateSnapshot"

describe("stateSnapshot", () => {
	it("serializes state and measures UTF-8 byte size", () => {
		const state = { message: "hello🙂" } as any
		const serialized = serializeStateSnapshot(state)

		assert.equal(serialized.stateJson, JSON.stringify(state))
		assert.equal(serialized.sizeBytes, Buffer.byteLength(JSON.stringify(state), "utf8"))
	})

	it("does not warn when snapshot size stays within threshold", () => {
		const warnStub = sinon.stub(Logger, "warn")

		try {
			const didWarn = warnOnLargeStateSnapshot(LARGE_STATE_SNAPSHOT_WARNING_BYTES, "subscribeToState")
			assert.equal(didWarn, false)
			sinon.assert.notCalled(warnStub)
		} finally {
			warnStub.restore()
		}
	})

	it("warns when snapshot size exceeds threshold", () => {
		const warnStub = sinon.stub(Logger, "warn")

		try {
			const didWarn = warnOnLargeStateSnapshot(LARGE_STATE_SNAPSHOT_WARNING_BYTES + 1, "subscribeToState")
			assert.equal(didWarn, true)
			sinon.assert.calledOnce(warnStub)
			assert.match(String(warnStub.firstCall.args[0]), /Large state snapshot for subscribeToState/)
		} finally {
			warnStub.restore()
		}
	})
})
