import { RunCommandExecutionController, type ClineCoreStartInput, type ITelemetryService } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClineCoreCreate = vi.hoisted(() => vi.fn())
const mockCreateVscodeExtraTools = vi.hoisted(() => vi.fn(async () => []))

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return {
		...actual,
		ClineCore: {
			create: mockClineCoreCreate,
		},
	}
})

vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: () => "distinct-id",
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalStateKey: () => undefined,
		}),
	},
}))

vi.mock("./vscode-runtime-builder", () => ({
	createVscodeExtraTools: mockCreateVscodeExtraTools,
}))

import { VscodeSessionHost } from "./vscode-session-host"

describe("VscodeSessionHost telemetry wiring", () => {
	beforeEach(() => {
		mockClineCoreCreate.mockReset()
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined })
		mockCreateVscodeExtraTools.mockReset().mockResolvedValue([])
	})

	it("passes shared telemetry to ClineCore.create", async () => {
		const telemetry = makeTelemetry()

		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
		})

		expect(mockClineCoreCreate).toHaveBeenCalledWith(expect.objectContaining({ telemetry }))
	})

	it("passes the shared command controller to ClineCore and VS Code tools", async () => {
		const commandExecutions = new RunCommandExecutionController()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			commandExecutions: commandExecutions as never,
		})

		expect(mockClineCoreCreate).toHaveBeenCalledWith(
			expect.objectContaining({ runCommandExecutionController: commandExecutions }),
		)
		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })
		expect(mockCreateVscodeExtraTools).toHaveBeenCalledWith({}, expect.objectContaining({ commandExecutions }))
	})

	it("injects shared telemetry into CoreSessionConfig when remote config did not provide one", async () => {
		const telemetry = makeTelemetry()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const prepared = await bootstrap.applyToStartSessionInput({
			source: undefined,
			config: {
				cwd: "/tmp/workspace",
				extraTools: [],
			},
		})

		expect(prepared.source).toBe("vscode")
		expect(prepared.config.telemetry).toBe(telemetry)
	})

	it("preserves telemetry already supplied by remote config", async () => {
		const telemetry = makeTelemetry()
		const remoteTelemetry = makeTelemetry()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => ({
						...input,
						config: {
							...input.config,
							telemetry: remoteTelemetry,
						},
					}),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const prepared = await bootstrap.applyToStartSessionInput({
			source: undefined,
			config: {
				cwd: "/tmp/workspace",
				extraTools: [],
			},
		})

		expect(prepared.config.telemetry).toBe(remoteTelemetry)
	})

	it("passes custom editor and apply_patch executors into tool executor capabilities", async () => {
		const editorExecutor = vi.fn()
		const applyPatchExecutor = vi.fn()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			editorExecutor,
			applyPatchExecutor,
		})

		const capabilities = mockClineCoreCreate.mock.calls[0][0].capabilities
		expect(capabilities.toolExecutors.editor).toBe(editorExecutor)
		expect(capabilities.toolExecutors.applyPatch).toBe(applyPatchExecutor)
	})

	it("leaves the SDK's default edit executors in place when no overrides are provided", async () => {
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
		})

		const capabilities = mockClineCoreCreate.mock.calls[0][0].capabilities
		expect(capabilities.toolExecutors).toBeUndefined()
	})

	it("waits for policy readiness before selecting and applying remote config", async () => {
		const events: string[] = []
		const beforeStartSession = vi.fn(async () => {
			events.push("ready")
		})
		const applyToStartSessionInput = vi.fn(async (input: ClineCoreStartInput) => {
			events.push("apply")
			return input
		})
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput,
					dispose: vi.fn(),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })

		expect(events).toEqual(["ready", "apply"])
	})

	it("applies remote config before appending VS Code extra tools", async () => {
		mockCreateVscodeExtraTools.mockResolvedValueOnce([{ name: "vscode-tool" }] as never)
		const applyToStartSessionInput = vi.fn(async (input: ClineCoreStartInput) => ({
			...input,
			config: {
				...input.config,
				extensions: [{ name: "remote-config" }],
				extraTools: [{ name: "remote-tool" }],
			},
		}))
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput,
					dispose: vi.fn(),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const result = await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })

		expect(applyToStartSessionInput).toHaveBeenCalledWith({ config: { cwd: "/workspace" } })
		expect(mockCreateVscodeExtraTools).toHaveBeenCalledWith({} as never, {
			cwd: "/workspace",
			getTerminalManager: undefined,
			vscodeTerminalExecutionMode: undefined,
			commandExecutions: undefined,
		})
		expect(result.source).toBe("vscode")
		expect(result.config.extensions).toEqual([{ name: "remote-config" }])
		expect(result.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
	})

	it("runs the session gate and remote-config integration on a checkpoint restore with a replacement session", async () => {
		const events: string[] = []
		const innerRestore = vi.fn(async (_input: unknown) => ({ checkpoint: {} }))
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined, restore: innerRestore })
		const host = await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession: async () => {
				events.push("gate")
			},
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => {
						events.push("integration")
						return input
					},
				}) as never,
		})

		await host.restore({
			sessionId: "session-1",
			checkpointRunCount: 1,
			start: { config: { cwd: "/workspace", extraTools: [] } } as never,
		})

		// The gate must resolve before the integration is read; ClineCore.restore
		// does not run the prepare hook, so the host must apply it itself.
		expect(events).toEqual(["gate", "integration"])
		const restoredInput = innerRestore.mock.calls[0][0] as { start: ClineCoreStartInput }
		expect(restoredInput.start.source).toBe("vscode")
	})

	it("does not gate a workspace-only restore that starts no replacement session", async () => {
		const innerRestore = vi.fn(async () => ({ checkpoint: {} }))
		const beforeStartSession = vi.fn()
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined, restore: innerRestore })
		const host = await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession,
		})

		await host.restore({ sessionId: "session-1", checkpointRunCount: 1 })

		expect(beforeStartSession).not.toHaveBeenCalled()
		expect(innerRestore).toHaveBeenCalledWith({ sessionId: "session-1", checkpointRunCount: 1 })
	})
})

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
