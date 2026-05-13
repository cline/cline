import { beforeEach, describe, expect, it, vi } from "vitest"

const { clineCoreCreate, createVscodeExtraTools } = vi.hoisted(() => ({
	clineCoreCreate: vi.fn(),
	createVscodeExtraTools: vi.fn(),
}))

vi.mock("@cline/core", () => ({
	ClineCore: { create: clineCoreCreate },
}))

vi.mock("./vscode-runtime-builder", () => ({
	createVscodeExtraTools,
}))

vi.mock("@/services/logging/distinctId", () => ({ getDistinctId: () => "distinct-id" }))
vi.mock("@/shared/services/Logger", () => ({ Logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

import { VscodeSessionHost } from "./vscode-session-host"

describe("VscodeSessionHost remote config composition", () => {
	beforeEach(() => {
		clineCoreCreate.mockReset()
		createVscodeExtraTools.mockReset().mockResolvedValue([{ name: "vscode-tool" }])
		clineCoreCreate.mockResolvedValue({
			runtimeAddress: undefined,
			start: vi.fn(),
			send: vi.fn(),
			subscribe: vi.fn(),
		})
	})

	it("applies remote config before appending VS Code extra tools", async () => {
		const applyToStartSessionInput = vi.fn(async (input) => ({
			...input,
			config: {
				...input.config,
				extensions: [{ name: "remote-config" }],
				extraTools: [{ name: "remote-tool" }],
			},
		}))
		await VscodeSessionHost.create({
			mcpHub: {} as never,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput,
					dispose: vi.fn(),
				}) as never,
		})

		const createArg = clineCoreCreate.mock.calls[0]?.[0]
		const bootstrap = await createArg.prepare({ config: { cwd: "/workspace" } })
		const result = await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })

		expect(applyToStartSessionInput).toHaveBeenCalledWith({ config: { cwd: "/workspace" } })
		expect(createVscodeExtraTools).toHaveBeenCalledWith({} as never, {
			cwd: "/workspace",
			getTerminalManager: undefined,
		})
		expect(result.source).toBe("vscode")
		expect(result.config.extensions).toEqual([{ name: "remote-config" }])
		expect(result.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
	})
})
