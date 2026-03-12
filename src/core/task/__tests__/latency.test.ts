import { strict as assert } from "assert"
import {
	getPresentationCadenceMs,
	getStateUpdateCadenceMs,
	getUsageUpdateCadenceMs,
	isRemoteWorkspaceEnvironment,
	summarizeChunkToWebviewDelays,
} from "../latency"

describe("task latency helpers", () => {
	it("detects remote workspaces from remoteName, platform, and version metadata", () => {
		assert.equal(isRemoteWorkspaceEnvironment({ remoteName: "ssh-remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "VS Code Remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ version: "Remote Server 1.0" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "darwin", version: "1.0.0", remoteName: null }), false)
	})

	it("uses remote-aware presentation and state update cadences", () => {
		assert.equal(getPresentationCadenceMs(false, "immediate"), 0)
		assert.equal(getPresentationCadenceMs(false, "normal"), 40)
		assert.equal(getPresentationCadenceMs(true, "normal"), 90)
		assert.equal(getPresentationCadenceMs(true, "low"), 125)

		assert.equal(getStateUpdateCadenceMs(false, "immediate"), 0)
		assert.equal(getStateUpdateCadenceMs(false, "normal"), 16)
		assert.equal(getStateUpdateCadenceMs(true, "normal"), 110)
		assert.equal(getStateUpdateCadenceMs(true, "low"), 150)
		assert.equal(getUsageUpdateCadenceMs(false), 250)
		assert.equal(getUsageUpdateCadenceMs(true), 400)
	})

	it("summarizes chunk-to-webview delays with median and p95 percentiles", () => {
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([]), { medianMs: 0, p95Ms: 0 })
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([10, 20, 30, 40, 50]), { medianMs: 30, p95Ms: 50 })
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([5, 15, 25, 35]), { medianMs: 15, p95Ms: 35 })
	})
})
