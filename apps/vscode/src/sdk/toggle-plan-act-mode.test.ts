// Integration-style tests for the plan/act mode toggle flow.
//
// These tests verify the Controller → gRPC handler boundary for mode toggling:
// 1. togglePlanActModeProto correctly decodes the PlanActMode enum to "plan"/"act"
// 2. The boolean return value semantics match the classic extension:
//    - `false` when no chatContent was consumed (webview preserves input)
//    - `false` when mode is unchanged (no-op)
// 3. The delegated controller.togglePlanActMode() is called with the decoded mode.

import { PlanActMode, TogglePlanActModeRequest } from "@shared/proto/cline/state"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Silence the Logger output during tests
vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

// We don't need the full Controller — just a mock that implements togglePlanActMode.
import { togglePlanActModeProto } from "../core/controller/state/togglePlanActModeProto"

// biome-ignore lint/suspicious/noExplicitAny: minimal mock for the controller surface we exercise
type MockController = any

describe("togglePlanActModeProto", () => {
	let mockController: MockController
	let toggleSpy: ReturnType<typeof vi.fn>

	beforeEach(() => {
		toggleSpy = vi.fn()
		mockController = {
			togglePlanActMode: toggleSpy,
		}
	})

	it("decodes PLAN mode and passes it to the controller", async () => {
		toggleSpy.mockResolvedValue(false)
		const request = TogglePlanActModeRequest.create({ mode: PlanActMode.PLAN })

		await togglePlanActModeProto(mockController, request)

		expect(toggleSpy).toHaveBeenCalledWith("plan", undefined)
	})

	it("decodes ACT mode and passes it to the controller", async () => {
		toggleSpy.mockResolvedValue(false)
		const request = TogglePlanActModeRequest.create({ mode: PlanActMode.ACT })

		await togglePlanActModeProto(mockController, request)

		expect(toggleSpy).toHaveBeenCalledWith("act", undefined)
	})

	it("passes chatContent through to the controller", async () => {
		toggleSpy.mockResolvedValue(false)
		const request = TogglePlanActModeRequest.create({
			mode: PlanActMode.ACT,
			chatContent: { message: "hello", images: ["img.png"], files: ["a.txt"] },
		})

		await togglePlanActModeProto(mockController, request)

		expect(toggleSpy).toHaveBeenCalledTimes(1)
		const [mode, chatContent] = toggleSpy.mock.calls[0]
		expect(mode).toBe("act")
		expect(chatContent).toMatchObject({
			message: "hello",
			images: ["img.png"],
			files: ["a.txt"],
		})
	})

	it("returns a Boolean proto reflecting controller.togglePlanActMode's return value (false)", async () => {
		toggleSpy.mockResolvedValue(false)
		const request = TogglePlanActModeRequest.create({ mode: PlanActMode.PLAN })

		const response = await togglePlanActModeProto(mockController, request)

		expect(response.value).toBe(false)
	})

	it("returns a Boolean proto reflecting controller.togglePlanActMode's return value (true)", async () => {
		// Some SDK flows may return true if they consumed chat content as a message.
		// The proto handler must pass that through verbatim to the webview.
		toggleSpy.mockResolvedValue(true)
		const request = TogglePlanActModeRequest.create({ mode: PlanActMode.PLAN })

		const response = await togglePlanActModeProto(mockController, request)

		expect(response.value).toBe(true)
	})

	it("throws on invalid mode values", async () => {
		// Create a request with an unknown enum value (simulating a future proto variant).
		const request = TogglePlanActModeRequest.create({ mode: 999 as PlanActMode })

		await expect(togglePlanActModeProto(mockController, request)).rejects.toThrow("Invalid mode value")
		expect(toggleSpy).not.toHaveBeenCalled()
	})

	it("propagates errors from controller.togglePlanActMode", async () => {
		toggleSpy.mockRejectedValue(new Error("oops"))
		const request = TogglePlanActModeRequest.create({ mode: PlanActMode.ACT })

		await expect(togglePlanActModeProto(mockController, request)).rejects.toThrow("oops")
	})
})
