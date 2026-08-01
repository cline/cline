import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { BaseUrlField } from "./BaseUrlField"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({
		checked,
		children,
		onChange,
	}: {
		checked?: boolean
		children?: ReactNode
		onChange?: ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
	VSCodeTextField: ({
		onInput,
		placeholder,
		value,
	}: {
		onInput?: ChangeEventHandler<HTMLInputElement>
		placeholder?: string
		value?: string
	}) => <input onChange={onInput} placeholder={placeholder} value={value} />,
}))

async function flushDebounce() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150))
	})
}

describe("BaseUrlField", () => {
	it("checks the box and shows the URL once the saved value loads asynchronously", () => {
		// Provider config is fetched after mount, so the saved base URL
		// arrives as an initialValue update rather than at first render.
		const onChange = vi.fn()
		const { rerender } = render(<BaseUrlField initialValue={undefined} onChange={onChange} />)

		expect(screen.getByRole("checkbox")).not.toBeChecked()

		rerender(<BaseUrlField initialValue="https://proxy.example.com" onChange={onChange} />)

		expect(screen.getByRole("checkbox")).toBeChecked()
		expect(screen.getByRole("textbox")).toHaveValue("https://proxy.example.com")
		expect(onChange).not.toHaveBeenCalled()
	})

	it("stays unchecked after the user unchecks it, even if a stale value echoes back", () => {
		const onChange = vi.fn()
		const { rerender } = render(<BaseUrlField initialValue="https://proxy.example.com" onChange={onChange} />)

		fireEvent.click(screen.getByRole("checkbox"))
		expect(screen.getByRole("checkbox")).not.toBeChecked()
		expect(onChange).toHaveBeenCalledWith("")

		// A stale echo of the old config must not re-check the box.
		rerender(<BaseUrlField initialValue="https://proxy.example.com" onChange={onChange} />)
		expect(screen.getByRole("checkbox")).not.toBeChecked()
	})

	it("saves the trimmed URL after typing", async () => {
		const onChange = vi.fn()
		render(<BaseUrlField initialValue={undefined} onChange={onChange} />)

		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://proxy.example.com " } })

		await flushDebounce()
		expect(onChange).toHaveBeenLastCalledWith("https://proxy.example.com")
	})
})
