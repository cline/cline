import type { ClineCoreStartInput, ITelemetryService } from "@cline/core"
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
		})
		expect(result.source).toBe("vscode")
		expect(result.config.extensions).toEqual([{ name: "remote-config" }])
		expect(result.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
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
