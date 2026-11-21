import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AddOpenAICompatibleProvider } from "./AddOpenAICompatibleProvider"

const createProvider = vi.hoisted(() => vi.fn())
vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: { createOpenAiCompatibleProvider: createProvider },
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ appearance: _, ...props }: ComponentProps<"button"> & { appearance?: string }) => <button {...props} />,
	VSCodeTextField: ({
		children,
		maxlength,
		...props
	}: ComponentProps<"input"> & { children?: ReactNode; maxlength?: number }) => (
		<label>
			{children}
			<input maxLength={maxlength} {...props} />
		</label>
	),
}))

describe("AddOpenAICompatibleProvider", () => {
	beforeEach(() => vi.clearAllMocks())

	it("creates a named endpoint and selects it after saving", async () => {
		createProvider.mockResolvedValue({ id: "custom-openai-work", name: "Work" })
		const onCreated = vi.fn().mockResolvedValue(undefined)
		render(<AddOpenAICompatibleProvider onCreated={onCreated} />)
		fireEvent.click(screen.getByText("Add OpenAI Compatible provider"))
		expect(screen.getByText("Add provider")).toBeDisabled()
		fireEvent.input(screen.getByLabelText("Provider name"), { target: { value: "Work" } })
		fireEvent.input(screen.getByLabelText("Base URL"), { target: { value: "https://work.example/v1" } })
		fireEvent.click(screen.getByText("Add provider"))
		await waitFor(() => expect(onCreated).toHaveBeenCalledWith("custom-openai-work"))
		expect(createProvider).toHaveBeenCalledWith({ name: "Work", baseUrl: "https://work.example/v1" })
		await waitFor(() => expect(screen.queryByLabelText("Provider name")).toBeNull())
	})

	it("preserves entered values and displays host validation errors", async () => {
		createProvider.mockRejectedValue(new Error("A provider with this name already exists."))
		render(<AddOpenAICompatibleProvider onCreated={vi.fn()} />)
		fireEvent.click(screen.getByText("Add OpenAI Compatible provider"))
		fireEvent.input(screen.getByLabelText("Provider name"), { target: { value: "Work" } })
		fireEvent.input(screen.getByLabelText("Base URL"), { target: { value: "https://work.example/v1" } })
		fireEvent.click(screen.getByText("Add provider"))
		expect(await screen.findByRole("alert")).toHaveTextContent("already exists")
		expect(screen.getByLabelText("Provider name")).toHaveValue("Work")
		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByRole("alert")).toBeNull()
	})
})
