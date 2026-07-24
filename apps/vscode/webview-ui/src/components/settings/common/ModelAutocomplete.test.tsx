import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { FocusEventHandler, FormEventHandler, KeyboardEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ModelAutocomplete } from "./ModelAutocomplete"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		id,
		onBlur,
		onFocus,
		onInput,
		onKeyDown,
		placeholder,
		role,
		value,
	}: {
		children?: ReactNode
		id?: string
		onBlur?: FocusEventHandler<HTMLInputElement>
		onFocus?: FocusEventHandler<HTMLInputElement>
		onInput?: FormEventHandler<HTMLInputElement>
		onKeyDown?: KeyboardEventHandler<HTMLInputElement>
		placeholder?: string
		role?: string
		value?: string
	}) => (
		<div>
			<label htmlFor={id}>{children}</label>
			<input
				id={id}
				onBlur={onBlur}
				onChange={onInput}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				role={role}
				value={value}
			/>
		</div>
	),
}))

const models = {
	"gpt-4o": { name: "GPT-4o", supportsPromptCache: false, contextWindow: 128_000 },
	"gpt-4o-mini": { name: "GPT-4o Mini", supportsPromptCache: false, contextWindow: 128_000 },
}

describe("ModelAutocomplete", () => {
	it("commits a clicked dropdown model only once when the input blur handler also runs", async () => {
		const onChange = vi.fn()
		render(<ModelAutocomplete models={models} onChange={onChange} selectedModelId="gpt-4o" />)

		const input = screen.getByRole("combobox")
		fireEvent.focus(input)

		const option = screen.getAllByRole("option").find((element) => element.textContent === "gpt-4o-mini")
		if (!option) {
			throw new Error("Expected gpt-4o-mini option to be rendered")
		}

		fireEvent.mouseDown(option)
		fireEvent.blur(input)
		fireEvent.click(option)

		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(onChange).toHaveBeenCalledWith("gpt-4o-mini", models["gpt-4o-mini"])
	})

	it("still commits a typed custom model id on blur", async () => {
		const onChange = vi.fn()
		render(<ModelAutocomplete models={models} onChange={onChange} selectedModelId="gpt-4o" />)

		const input = screen.getByRole("combobox")
		fireEvent.focus(input)
		fireEvent.change(input, { target: { value: "custom-model" } })
		fireEvent.blur(input)

		await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
		expect(onChange).toHaveBeenCalledWith("custom-model", undefined)
	})
})
