import { beforeEach, describe, expect, it, vi } from "vitest"

const registerHandler = vi.fn()
vi.mock("@cline/llms", () => ({ registerHandler }))
vi.mock("@/shared/services/Logger", () => ({ Logger: { debug: vi.fn() } }))

// `vscode.lm` presence is the gate. Use a mutable mock so each test controls it.
const lm: { selectChatModels?: unknown } = {}
vi.mock("vscode", () => ({
	get lm() {
		return lm
	},
}))

describe("registerVsCodeLmHandler gating", () => {
	beforeEach(() => {
		vi.resetModules()
		registerHandler.mockClear()
		delete lm.selectChatModels
	})

	it("does not register when the vscode.lm API is unavailable (e.g. JetBrains)", async () => {
		const { registerVsCodeLmHandler, isVsCodeLmApiAvailable } = await import("./register-vscode-lm")
		expect(isVsCodeLmApiAvailable()).toBe(false)
		registerVsCodeLmHandler()
		expect(registerHandler).not.toHaveBeenCalled()
	})

	it("registers once when the vscode.lm API is available", async () => {
		lm.selectChatModels = vi.fn()
		const { registerVsCodeLmHandler, isVsCodeLmApiAvailable, VSCODE_LM_PROVIDER_ID } = await import("./register-vscode-lm")
		expect(isVsCodeLmApiAvailable()).toBe(true)
		registerVsCodeLmHandler()
		registerVsCodeLmHandler() // idempotent
		expect(registerHandler).toHaveBeenCalledTimes(1)
		expect(registerHandler).toHaveBeenCalledWith(VSCODE_LM_PROVIDER_ID, expect.any(Function))
	})
})
