import { Text } from "ink"
import { render } from "ink-testing-library"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

const CLEAR_SEQUENCE = "\x1b[2J\x1b[3J\x1b[H"

function setTerminalSize(columns: number, rows: number) {
	Object.defineProperty(process.stdout, "columns", {
		configurable: true,
		writable: true,
		value: columns,
	})

	Object.defineProperty(process.stdout, "rows", {
		configurable: true,
		writable: true,
		value: rows,
	})
}

function hasClearSequenceCall(calls: unknown[][]): boolean {
	return calls.some((call) => call[0] === CLEAR_SEQUENCE)
}

vi.mock("./ChatView", () => ({
	ChatView: ({ controller, initialPrompt, initialImages }: any) => {
		React.useEffect(() => {
			if (initialPrompt || (initialImages && initialImages.length > 0)) {
				controller?.initTask(initialPrompt || "", initialImages)
			}
		}, [])

		return React.createElement(Text, null, "ChatView")
	},
}))

vi.mock("./TaskJsonView", () => ({
	TaskJsonView: () => React.createElement(Text, null, "TaskJsonView"),
}))

vi.mock("./HistoryView", () => ({
	HistoryView: () => React.createElement(Text, null, "HistoryView"),
}))

vi.mock("./ConfigView", () => ({
	ConfigView: () => React.createElement(Text, null, "ConfigView"),
}))

vi.mock("./AuthView", () => ({
	AuthView: () => React.createElement(Text, null, "AuthView"),
}))

vi.mock("../context/TaskContext", () => ({
	TaskContextProvider: ({ children }: any) => children,
}))

vi.mock("../context/StdinContext", () => ({
	StdinProvider: ({ children }: any) => children,
}))

describe("App startup prompt resize behavior", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
		delete (process.stdout as any).columns
		delete (process.stdout as any).rows
	})

	it("does not replay initialPrompt after a width resize", async () => {
		const initTask = vi.fn()
		setTerminalSize(120, 40)

		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((...args: any[]) => {
			const callback = args.find((arg) => typeof arg === "function")
			if (callback) {
				callback()
			}
			return true
		}) as any)

		const { unmount } = render(
			<App controller={{ initTask }} initialPrompt="hello" isRawModeSupported={true} view="welcome" />,
		)

		await vi.advanceTimersByTimeAsync(0)
		expect(initTask).toHaveBeenCalledTimes(1)
		writeSpy.mockClear()

		setTerminalSize(121, 40)
		process.stdout.emit("resize")
		await vi.advanceTimersByTimeAsync(350)
		await vi.advanceTimersByTimeAsync(0)

		expect(initTask).toHaveBeenCalledTimes(1)
		expect(hasClearSequenceCall(writeSpy.mock.calls as unknown[][])).toBe(true)

		unmount()
	})

	it("does not remount on height-only resize", async () => {
		const initTask = vi.fn()
		setTerminalSize(120, 40)

		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(((...args: any[]) => {
			const callback = args.find((arg) => typeof arg === "function")
			if (callback) {
				callback()
			}
			return true
		}) as any)

		const { unmount } = render(
			<App controller={{ initTask }} initialPrompt="hello" isRawModeSupported={true} view="welcome" />,
		)

		await vi.advanceTimersByTimeAsync(0)
		expect(initTask).toHaveBeenCalledTimes(1)
		writeSpy.mockClear()

		setTerminalSize(120, 45)
		process.stdout.emit("resize")
		await vi.advanceTimersByTimeAsync(350)
		await vi.advanceTimersByTimeAsync(0)

		expect(initTask).toHaveBeenCalledTimes(1)
		expect(hasClearSequenceCall(writeSpy.mock.calls as unknown[][])).toBe(false)

		unmount()
	})
})
