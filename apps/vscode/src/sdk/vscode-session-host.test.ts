import { type ClineCoreStartInput, type ITelemetryService, toClineCoreStartInput } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClineCoreCreate = vi.hoisted(() => vi.fn())
const mockCreateVscodeExtraTools = vi.hoisted(() => vi.fn(async () => []))
const mockInnerStart = vi.hoisted(() => vi.fn())

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return { ...actual, ClineCore: { create: mockClineCoreCreate } }
})
vi.mock("@/services/logging/distinctId", () => ({ getDistinctId: () => "distinct-id" }))
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalStateKey: () => undefined }) },
}))
vi.mock("./vscode-runtime-builder", () => ({ createVscodeExtraTools: mockCreateVscodeExtraTools }))

import { VscodeSessionHost } from "./vscode-session-host"

const startInput: ClineCoreStartInput = {
	config: {
		sessionId: "task",
		cwd: "/workspace",
		providerId: "cline",
		modelId: "test",
		systemPrompt: "test",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	},
}

function makeTelemetry(): ITelemetryService {
	return {
		setDistinctId() {},
		setMetadata() {},
		updateMetadata() {},
		setCommonProperties() {},
		updateCommonProperties() {},
		isEnabled: () => true,
		capture() {},
		captureRequired() {},
		recordCounter() {},
		recordHistogram() {},
		recordGauge() {},
		flush: async () => {},
		dispose: async () => {},
	}
}

describe("VscodeSessionHost telemetry wiring", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		mockInnerStart.mockReset().mockResolvedValue({ sessionId: "core-task" })
		mockClineCoreCreate.mockReset().mockResolvedValue({
			start: mockInnerStart,
			stop: async () => {},
			dispose: async () => {},
		})
		mockCreateVscodeExtraTools.mockReset().mockResolvedValue([])
	})

	it("passes shared telemetry to Core and injects it into session config", async () => {
		const telemetry = makeTelemetry()
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry })
		await host.start(startInput)
		expect(mockClineCoreCreate).toHaveBeenCalledWith(expect.objectContaining({ telemetry }))
		expect(mockClineCoreCreate.mock.calls[0][0].prepare).toBeUndefined()
		expect(mockInnerStart.mock.calls[0][0]).toMatchObject({ source: "vscode", config: { telemetry } })
		await host.dispose()
	})

	it("preserves remote-config telemetry", async () => {
		const telemetry = makeTelemetry()
		const remoteTelemetry = makeTelemetry()
		const host = await VscodeSessionHost.create({
			mcpHub: {} as never,
			telemetry,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => ({
						...input,
						config: { ...input.config, telemetry: remoteTelemetry },
					}),
				}) as never,
		})
		await host.start(startInput)
		expect(mockInnerStart.mock.calls[0][0].config.telemetry).toBe(remoteTelemetry)
		await host.dispose()
	})

	it.each([
		{ method: "start", requestedId: undefined },
		{ method: "restore", requestedId: undefined },
		{ method: "start", requestedId: " existing-task " },
	])("preserves session ID intent ($method, $requestedId)", async ({ method, requestedId }) => {
		const telemetry = makeTelemetry()
		const actualId = requestedId?.trim() ?? "core-generated-task"
		const input: ClineCoreStartInput = {
			initialMessages: [{ id: "previous", role: "user", content: [{ type: "text", text: "previous turn" }] }],
			config: {
				...startInput.config,
				sessionId: requestedId,
				extensions: [{ name: "existing-extension", manifest: { capabilities: [] }, setup: vi.fn() }],
			},
		}
		let preparedConfig: ClineCoreStartInput["config"] | undefined
		const checkPrepared = (prepared: ClineCoreStartInput) => {
			expect(prepared.config.sessionId).toBe(requestedId)
			expect(prepared.initialMessages).toBe(input.initialMessages)
			expect(prepared.config.extensions).toEqual(input.config.extensions)
			preparedConfig = prepared.config
		}
		mockClineCoreCreate.mockResolvedValue({
			start: async (start: ClineCoreStartInput) => {
				checkPrepared(start)
				return { sessionId: actualId }
			},
			restore: async (restore: { start: ClineCoreStartInput }) => {
				checkPrepared(restore.start)
				return { sessionId: actualId, startResult: { sessionId: actualId } }
			},
			stop: async () => {},
			dispose: async () => {},
		})
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry })
		if (method === "start") await host.start(input)
		else await host.restore({ sessionId: "source", checkpointRunCount: 1, start: input })
		expect(preparedConfig).toBeDefined()
		expect(input.config.sessionId).toBe(requestedId)
		await host.stop(actualId)
		await host.dispose()
	})

	it("passes custom editor and apply_patch executors into tool executor capabilities", async () => {
		const editorExecutor = vi.fn()
		const applyPatchExecutor = vi.fn()
		await VscodeSessionHost.create({ mcpHub: {} as never, editorExecutor, applyPatchExecutor })
		expect(mockClineCoreCreate.mock.calls[0][0].capabilities.toolExecutors).toMatchObject({
			editor: editorExecutor,
			applyPatch: applyPatchExecutor,
		})
	})

	it("leaves default executors in place when no overrides are provided", async () => {
		await VscodeSessionHost.create({ mcpHub: {} as never })
		expect(mockClineCoreCreate.mock.calls[0][0].capabilities.toolExecutors).toBeUndefined()
	})

	it.each(["start", "restore"])("prepares %s once: readiness, remote config, then extra tools", async (method) => {
		const events: string[] = []
		const restore = vi.fn(async (_input: unknown) => ({ checkpoint: {} }))
		mockClineCoreCreate.mockResolvedValue({ start: mockInnerStart, restore })
		mockCreateVscodeExtraTools.mockImplementationOnce(async () => {
			events.push("tools")
			return [{ name: "vscode-tool" }] as never
		})
		const host = await VscodeSessionHost.create({
			mcpHub: {} as never,
			beforeStartSession: async () => {
				events.push("ready")
			},
			getRemoteConfigIntegration: () => {
				events.push("select")
				return {
					applyToStartSessionInput: (input: ClineCoreStartInput) => {
						events.push("apply")
						return { ...input, config: { ...input.config, extraTools: [{ name: "remote-tool" }] } }
					},
				} as never
			},
		})
		if (method === "start") await host.start(startInput)
		else await host.restore({ sessionId: "source", checkpointRunCount: 1, start: startInput })
		expect(events).toEqual(["ready", "select", "apply", "tools"])
		const prepared =
			method === "start"
				? mockInnerStart.mock.calls[0][0]
				: (restore.mock.calls[0][0] as { start: ClineCoreStartInput }).start
		expect(prepared.source).toBe("vscode")
		expect(prepared.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
		expect(prepared.localRuntime.configExtensions).not.toContain("hooks")
	})

	it("normalizes local-runtime hooks before preparation without losing them", async () => {
		const afterModel = vi.fn()
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		const input = { ...startInput, localRuntime: { hooks: { afterModel } } }
		await host.start(input)
		expect(input.config.hooks).toBeUndefined()
		expect(input.localRuntime.hooks.afterModel).toBe(afterModel)
		const prepared = mockInnerStart.mock.calls[0][0]
		expect(prepared.config.hooks.afterModel).toBe(afterModel)
		expect(toClineCoreStartInput(prepared).config.hooks?.afterModel).toBe(afterModel)
		await host.dispose()
	})

	it("does not prepare a workspace-only restore", async () => {
		const restore = vi.fn(async () => ({ checkpoint: {} }))
		const beforeStartSession = vi.fn()
		mockClineCoreCreate.mockResolvedValue({ restore })
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, beforeStartSession })
		await host.restore({ sessionId: "session-1", checkpointRunCount: 1 })
		expect(beforeStartSession).not.toHaveBeenCalled()
		expect(restore).toHaveBeenCalledWith({ sessionId: "session-1", checkpointRunCount: 1 })
	})
})
