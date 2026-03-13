import { strict as assert } from "assert"
import { afterEach, describe, it } from "mocha"
import { getEphemeralMessageFlushCadenceMs, isEphemeralMessagePersistenceDisabled } from "../latency"

describe("ephemeral message latency helpers", () => {
	afterEach(() => {
		delete process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE
		delete process.env.CLINE_EPHEMERAL_MESSAGE_FLUSH_CADENCE_MS
	})

	it("defaults ephemeral persistence to enabled", () => {
		assert.equal(isEphemeralMessagePersistenceDisabled(), false)
	})

	it("supports disabling ephemeral message persistence via env flag", () => {
		process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE = "1"
		assert.equal(isEphemeralMessagePersistenceDisabled(), true)

		process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE = "true"
		assert.equal(isEphemeralMessagePersistenceDisabled(), true)

		process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE = "yes"
		assert.equal(isEphemeralMessagePersistenceDisabled(), true)
	})

	it("uses a conservative default flush cadence", () => {
		assert.equal(getEphemeralMessageFlushCadenceMs(), 1500)
	})

	it("supports overriding the flush cadence via env flag", () => {
		process.env.CLINE_EPHEMERAL_MESSAGE_FLUSH_CADENCE_MS = "2000"
		assert.equal(getEphemeralMessageFlushCadenceMs(), 2000)
	})

	it("falls back to the default cadence when the override is invalid", () => {
		process.env.CLINE_EPHEMERAL_MESSAGE_FLUSH_CADENCE_MS = "invalid"
		assert.equal(getEphemeralMessageFlushCadenceMs(), 1500)

		process.env.CLINE_EPHEMERAL_MESSAGE_FLUSH_CADENCE_MS = "-1"
		assert.equal(getEphemeralMessageFlushCadenceMs(), 1500)
	})
})
