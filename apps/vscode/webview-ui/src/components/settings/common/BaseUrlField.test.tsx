import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { BaseUrlField } from "./BaseUrlField"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({
		checked,
		children,
		disabled,
		onChange,
	}: {
		checked?: boolean
		children?: ReactNode
		disabled?: boolean
		onChange?: ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} disabled={disabled} onChange={onChange} type="checkbox" />
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

	it("restores the checked state when clearing the persisted URL fails", async () => {
		const onChange = vi.fn()
		const onClear = vi.fn().mockRejectedValue(new Error("write failed"))
		render(<BaseUrlField initialValue="https://proxy.example.com" onChange={onChange} onClear={onClear} />)

		fireEvent.click(screen.getByRole("checkbox"))
		expect(screen.getByRole("checkbox")).not.toBeChecked()

		await act(async () => {})
		expect(onClear).toHaveBeenCalledTimes(1)
		expect(onChange).not.toHaveBeenCalled()
		expect(screen.getByRole("checkbox")).toBeChecked()
		expect(screen.getByRole("textbox")).toHaveValue("https://proxy.example.com")
	})

	it("clears the hidden input value after persistence succeeds", async () => {
		const onChange = vi.fn()
		const onClear = vi.fn().mockResolvedValue(undefined)
		const { rerender } = render(
			<BaseUrlField initialValue="https://proxy.example.com" onChange={onChange} onClear={onClear} />,
		)

		fireEvent.click(screen.getByRole("checkbox"))
		await act(async () => {})
		rerender(<BaseUrlField initialValue={undefined} onChange={onChange} onClear={onClear} />)
		fireEvent.click(screen.getByRole("checkbox"))

		expect(screen.getByRole("textbox")).toHaveValue("")
		expect(onChange).not.toHaveBeenCalled()
	})

	it("cancels a pending URL edit before clearing", async () => {
		const onChange = vi.fn()
		let resolveClear: () => void = () => {}
		const onClear = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveClear = resolve
				}),
		)
		const { unmount } = render(
			<BaseUrlField initialValue="https://saved.example.com" onChange={onChange} onClear={onClear} />,
		)

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "https://pending.example.com" } })
		fireEvent.click(screen.getByRole("checkbox"))
		await flushDebounce()
		unmount()

		expect(onClear).toHaveBeenCalledTimes(1)
		expect(onChange).not.toHaveBeenCalled()

		await act(async () => resolveClear())
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
