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
})
