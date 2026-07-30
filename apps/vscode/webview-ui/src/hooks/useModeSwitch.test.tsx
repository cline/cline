import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { useModeSwitch } from "./useModeSwitch"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(),
	},
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function installContext(mode: "plan" | "act") {
	const settle = vi.fn()
	const beginModeSwitch = vi.fn(() => settle)
	vi.mocked(useExtensionState).mockReturnValue({
		mode,
		beginModeSwitch,
	} as unknown as ReturnType<typeof useExtensionState>)
	return { beginModeSwitch, settle }
}

describe("useModeSwitch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("applies the switch locally before the toggle RPC resolves", async () => {
		const { beginModeSwitch, settle } = installContext("act")
		const pending = deferred<{ value: boolean }>()
		vi.mocked(StateServiceClient.togglePlanActModeProto).mockReturnValue(pending.promise as never)

		const { result } = renderHook(() => useModeSwitch())
		let switched!: Promise<boolean>
		act(() => {
			switched = result.current.switchMode("plan")
		})

		expect(beginModeSwitch).toHaveBeenCalledWith("plan")
		expect(settle).not.toHaveBeenCalled()

		await act(async () => {
			pending.resolve({ value: false })
			await switched
		})

		await waitFor(() => expect(settle).toHaveBeenCalledOnce())
	})

	it("forwards the target mode and composer content to the extension", async () => {
		installContext("plan")
		vi.mocked(StateServiceClient.togglePlanActModeProto).mockResolvedValue({ value: true } as never)

		const { result } = renderHook(() => useModeSwitch())
		await act(async () => {
			await expect(result.current.switchMode("act", { message: "ship it", images: [], files: [] })).resolves.toBe(true)
		})

		expect(StateServiceClient.togglePlanActModeProto).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 1, // PlanActMode.ACT
				chatContent: expect.objectContaining({ message: "ship it" }),
			}),
		)
	})

	it("settles the local switch when the toggle RPC fails", async () => {
		const { settle } = installContext("act")
		vi.mocked(StateServiceClient.togglePlanActModeProto).mockRejectedValue(new Error("rebuild failed"))

		const { result } = renderHook(() => useModeSwitch())
		await act(async () => {
			await expect(result.current.switchMode("plan")).rejects.toThrow("rebuild failed")
		})

		expect(settle).toHaveBeenCalledOnce()
	})

	it("does nothing when already in the requested mode", async () => {
		const { beginModeSwitch } = installContext("plan")

		const { result } = renderHook(() => useModeSwitch())
		await act(async () => {
			await expect(result.current.switchMode("plan")).resolves.toBe(false)
		})

		expect(beginModeSwitch).not.toHaveBeenCalled()
		expect(StateServiceClient.togglePlanActModeProto).not.toHaveBeenCalled()
	})
})
