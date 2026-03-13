import { strict as assert } from "assert"
import {
	getPresentationCadenceMs,
	isPresentationSchedulingDisabled,
	isRemoteWorkspaceEnvironment,
	summarizeChunkToWebviewDelays,
} from "../latency"

describe("task latency helpers", () => {
	afterEach(() => {
		delete process.env.CLINE_PRESENTATION_CADENCE_MS
		delete process.env.CLINE_REMOTE_PRESENTATION_CADENCE_MS
		delete process.env.CLINE_DISABLE_PRESENTATION_SCHEDULER
	})

	it("detects remote workspaces from remoteName, platform, and version metadata", () => {
		assert.equal(isRemoteWorkspaceEnvironment({ remoteName: "ssh-remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "VS Code Remote" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ version: "Remote Server 1.0" }), true)
		assert.equal(isRemoteWorkspaceEnvironment({ platform: "darwin", version: "1.0.0", remoteName: null }), false)
	})

	it("uses remote-aware presentation cadences", () => {
		assert.equal(getPresentationCadenceMs(false, "immediate"), 0)
		assert.equal(getPresentationCadenceMs(false, "normal"), 40)
		assert.equal(getPresentationCadenceMs(true, "normal"), 90)
		assert.equal(getPresentationCadenceMs(true, "low"), 125)
	})

	it("respects cadence overrides from environment variables", () => {
		process.env.CLINE_PRESENTATION_CADENCE_MS = "22"
		process.env.CLINE_REMOTE_PRESENTATION_CADENCE_MS = "77"

		assert.equal(getPresentationCadenceMs(false, "normal"), 22)
		assert.equal(getPresentationCadenceMs(true, "normal"), 77)
	})

	it("supports development flags for disabling presentation scheduling", () => {
		process.env.CLINE_DISABLE_PRESENTATION_SCHEDULER = "true"
		assert.equal(isPresentationSchedulingDisabled(), true)
	})

	it("summarizes chunk-to-webview delays using median and p95", () => {
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([]), { medianMs: 0, p95Ms: 0 })
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([10, 20, 30, 40, 50]), { medianMs: 30, p95Ms: 50 })
	})
})
