import { strict as assert } from "assert"
import { afterEach, describe, it } from "mocha"
import { getStateUpdateCadenceMs, isRemoteWorkspaceEnvironment } from "../latency"

describe("task latency helpers", () => {
	afterEach(() => {
		delete process.env.CLINE_STATE_UPDATE_CADENCE_MS
		delete process.env.CLINE_REMOTE_STATE_UPDATE_CADENCE_MS
		delete process.env.CLINE_STATE_UPDATE_LOW_CADENCE_MS
		delete process.env.CLINE_REMOTE_STATE_UPDATE_LOW_CADENCE_MS
	})

	it("detects remote workspaces from remoteName, platform, and version metadata", () => {
		assert.equal(isRemoteWorkspaceEnvironment({ remoteName: "ssh-remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "VS Code Remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ version: "Remote Server 1.0" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "darwin", version: "1.0.0", remoteName: null }), false)
	})

	it("uses remote-aware state update cadences", () => {
		assert.equal(getStateUpdateCadenceMs(false, "immediate"), 0)
		assert.equal(getStateUpdateCadenceMs(false, "normal"), 16)
		assert.equal(getStateUpdateCadenceMs(true, "normal"), 110)
		assert.equal(getStateUpdateCadenceMs(true, "low"), 150)
	})

	it("respects cadence overrides from environment variables", () => {
		process.env.CLINE_STATE_UPDATE_CADENCE_MS = "18"
		process.env.CLINE_REMOTE_STATE_UPDATE_CADENCE_MS = "99"
		process.env.CLINE_STATE_UPDATE_LOW_CADENCE_MS = "33"
		process.env.CLINE_REMOTE_STATE_UPDATE_LOW_CADENCE_MS = "144"

		assert.equal(getStateUpdateCadenceMs(false, "normal"), 18)
		assert.equal(getStateUpdateCadenceMs(true, "normal"), 99)
		assert.equal(getStateUpdateCadenceMs(false, "low"), 33)
		assert.equal(getStateUpdateCadenceMs(true, "low"), 144)
	})
})