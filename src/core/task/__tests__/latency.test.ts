import { strict as assert } from "assert"
import {
	getEnvironmentDetailsStaticCacheTtlMs,
	getPresentationCadenceMs,
	getRequestBoundaryCacheTtlMs,
	getStateUpdateCadenceMs,
	getUsageUpdateCadenceMs,
	isEphemeralMessagePersistenceDisabled,
	isPresentationSchedulingDisabled,
	isRemoteWorkspaceEnvironment,
	isTaskUiDeltaSyncDisabled,
	shouldWaitForTerminalCooldown,
	summarizeChunkToWebviewDelays,
} from "../latency"

describe("task latency helpers", () => {
	afterEach(() => {
		delete process.env.CLINE_PRESENTATION_CADENCE_MS
		delete process.env.CLINE_REMOTE_PRESENTATION_CADENCE_MS
		delete process.env.CLINE_STATE_UPDATE_CADENCE_MS
		delete process.env.CLINE_REMOTE_STATE_UPDATE_CADENCE_MS
		delete process.env.CLINE_USAGE_UPDATE_CADENCE_MS
		delete process.env.CLINE_REMOTE_USAGE_UPDATE_CADENCE_MS
		delete process.env.CLINE_REQUEST_BOUNDARY_CACHE_TTL_MS
		delete process.env.CLINE_REMOTE_REQUEST_BOUNDARY_CACHE_TTL_MS
		delete process.env.CLINE_ENVIRONMENT_DETAILS_STATIC_CACHE_TTL_MS
		delete process.env.CLINE_REMOTE_ENVIRONMENT_DETAILS_STATIC_CACHE_TTL_MS
		delete process.env.CLINE_DISABLE_PRESENTATION_SCHEDULER
		delete process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE
		delete process.env.CLINE_DISABLE_TASK_UI_DELTA_SYNC
	})

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
		assert.equal(getRequestBoundaryCacheTtlMs(false), 500)
		assert.equal(getRequestBoundaryCacheTtlMs(true), 1000)
		assert.equal(getEnvironmentDetailsStaticCacheTtlMs(false), 30_000)
		assert.equal(getEnvironmentDetailsStaticCacheTtlMs(true), 60_000)
	})

	it("respects cadence overrides from environment variables", () => {
		process.env.CLINE_PRESENTATION_CADENCE_MS = "22"
		process.env.CLINE_REMOTE_PRESENTATION_CADENCE_MS = "77"
		process.env.CLINE_STATE_UPDATE_CADENCE_MS = "18"
		process.env.CLINE_REMOTE_STATE_UPDATE_CADENCE_MS = "99"
		process.env.CLINE_USAGE_UPDATE_CADENCE_MS = "333"
		process.env.CLINE_REMOTE_USAGE_UPDATE_CADENCE_MS = "555"
		process.env.CLINE_REQUEST_BOUNDARY_CACHE_TTL_MS = "444"
		process.env.CLINE_REMOTE_REQUEST_BOUNDARY_CACHE_TTL_MS = "888"
		process.env.CLINE_ENVIRONMENT_DETAILS_STATIC_CACHE_TTL_MS = "1234"
		process.env.CLINE_REMOTE_ENVIRONMENT_DETAILS_STATIC_CACHE_TTL_MS = "5678"

		assert.equal(getPresentationCadenceMs(false, "normal"), 22)
		assert.equal(getPresentationCadenceMs(true, "normal"), 77)
		assert.equal(getStateUpdateCadenceMs(false, "normal"), 18)
		assert.equal(getStateUpdateCadenceMs(true, "normal"), 99)
		assert.equal(getUsageUpdateCadenceMs(false), 333)
		assert.equal(getUsageUpdateCadenceMs(true), 555)
		assert.equal(getRequestBoundaryCacheTtlMs(false), 444)
		assert.equal(getRequestBoundaryCacheTtlMs(true), 888)
		assert.equal(getEnvironmentDetailsStaticCacheTtlMs(false), 1234)
		assert.equal(getEnvironmentDetailsStaticCacheTtlMs(true), 5678)
	})

	it("supports development flags for disabling schedulers and delta sync", () => {
		process.env.CLINE_DISABLE_PRESENTATION_SCHEDULER = "true"
		process.env.CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE = "1"
		process.env.CLINE_DISABLE_TASK_UI_DELTA_SYNC = "yes"

		assert.equal(isPresentationSchedulingDisabled(), true)
		assert.equal(isEphemeralMessagePersistenceDisabled(), true)
		assert.equal(isTaskUiDeltaSyncDisabled(), true)
	})

	it("waits for terminal cooldown only when there is active heat or a recent edit", () => {
		assert.equal(
			shouldWaitForTerminalCooldown({
				busyTerminalIds: [],
				isProcessHot: () => true,
				didEditFile: false,
			}),
			false,
		)

		assert.equal(
			shouldWaitForTerminalCooldown({
				busyTerminalIds: [1, 2],
				isProcessHot: () => false,
				didEditFile: false,
			}),
			false,
		)

		assert.equal(
			shouldWaitForTerminalCooldown({
				busyTerminalIds: [1, 2],
				isProcessHot: (terminalId) => terminalId === 2,
				didEditFile: false,
			}),
			true,
		)

		assert.equal(
			shouldWaitForTerminalCooldown({
				busyTerminalIds: [1],
				isProcessHot: () => false,
				didEditFile: true,
			}),
			true,
		)
	})

	it("summarizes chunk-to-webview delays with median and p95 percentiles", () => {
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([]), { medianMs: 0, p95Ms: 0 })
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([10, 20, 30, 40, 50]), { medianMs: 30, p95Ms: 50 })
		assert.deepStrictEqual(summarizeChunkToWebviewDelays([5, 15, 25, 35]), { medianMs: 15, p95Ms: 35 })
	})
})
