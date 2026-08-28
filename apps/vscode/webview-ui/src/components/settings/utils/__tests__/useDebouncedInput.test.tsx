import { act, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useDebouncedInput } from "../useDebouncedInput"

function Harness({
	initialValue,
	onChange,
	onRender,
}: {
	initialValue: string
	onChange: (value: string) => void
	onRender: (value: string, setValue: (value: string) => void) => void
}) {
	const [value, setValue] = useDebouncedInput(initialValue, onChange)
	onRender(value, setValue)
	return <span>{value}</span>
}

async function flushDebounce() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150))
	})
}

describe("useDebouncedInput", () => {
	it("does not echo the initial value to onChange on mount", async () => {
		// Secret fields mount with an empty mask while their provider config
		// is still loading; echoing that to the backend would delete the
		// stored key.
		const onChange = vi.fn()
		render(<Harness initialValue="" onChange={onChange} onRender={() => {}} />)

		await flushDebounce()
		expect(onChange).not.toHaveBeenCalled()
	})

	it("does not echo an external initialValue resync to onChange", async () => {
		const onChange = vi.fn()
		const { rerender } = render(<Harness initialValue="" onChange={onChange} onRender={() => {}} />)

		rerender(<Harness initialValue="••••••••" onChange={onChange} onRender={() => {}} />)

		await flushDebounce()
		expect(onChange).not.toHaveBeenCalled()
	})

	it("fires onChange for user edits, debounced to the latest value", async () => {
		const onChange = vi.fn()
		let latestSetValue: (value: string) => void = () => {}
		render(
			<Harness
				initialValue=""
				onChange={onChange}
				onRender={(_, setValue) => {
					latestSetValue = setValue
				}}
			/>,
		)

		act(() => latestSetValue("a"))
		act(() => latestSetValue("ab"))

		await flushDebounce()
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("ab")
	})

	it("resyncs the displayed value when initialValue changes externally", async () => {
		const onChange = vi.fn()
		const values: string[] = []
		const { rerender } = render(<Harness initialValue="first" onChange={onChange} onRender={(value) => values.push(value)} />)

		rerender(<Harness initialValue="second" onChange={onChange} onRender={(value) => values.push(value)} />)

		await flushDebounce()
		expect(values.at(-1)).toBe("second")
		expect(onChange).not.toHaveBeenCalled()
	})

	it("does not clobber a pending user edit when an earlier save echoes back", async () => {
		// Saves round-trip through the backend and update initialValue. While
		// the user is still typing, an in-flight save can echo back an older
		// prefix; resyncing to it would delete the newest keystrokes.
		const onChange = vi.fn()
		const values: string[] = []
		let latestSetValue: (value: string) => void = () => {}
		const { rerender } = render(
			<Harness
				initialValue=""
				onChange={onChange}
				onRender={(value, setValue) => {
					values.push(value)
					latestSetValue = setValue
				}}
			/>,
		)

		act(() => latestSetValue("https://proxy"))
		// Echo of an earlier, shorter write arrives while the edit is pending.
		rerender(
			<Harness
				initialValue="https://p"
				onChange={onChange}
				onRender={(value, setValue) => {
					values.push(value)
					latestSetValue = setValue
				}}
			/>,
		)

		expect(values.at(-1)).toBe("https://proxy")

		await flushDebounce()
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("https://proxy")
	})

	it("flushes a pending edit on unmount", async () => {
		const onChange = vi.fn()
		let latestSetValue: (value: string) => void = () => {}
		const { unmount } = render(
			<Harness
				initialValue=""
				onChange={onChange}
				onRender={(_, setValue) => {
					latestSetValue = setValue
				}}
			/>,
		)

		act(() => latestSetValue("typed-then-closed"))
		// Unmount before the debounce fires (e.g. clicking Done in settings).
		unmount()

		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith("typed-then-closed")
	})

	it("does not flush on unmount without a pending edit", async () => {
		const onChange = vi.fn()
		const { unmount } = render(<Harness initialValue="saved" onChange={onChange} onRender={() => {}} />)

		unmount()

		expect(onChange).not.toHaveBeenCalled()
	})
})
