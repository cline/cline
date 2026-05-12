import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

const selectedModel: ModelPickerSelection = {
	providerId: "ollama",
	modelId: "llama3",
	modelInfo: { name: "Llama 3", supportsPromptCache: false, contextWindow: 8192 },
}

const models = {
	llama3: { name: "Llama 3", supportsPromptCache: false, contextWindow: 8192 },
	mistral: { name: "Mistral", supportsPromptCache: false, contextWindow: 32768 },
}

describe("ModelPickerWithManualEntry", () => {
	it("selects a known model as a full selection triple", () => {
		const onSelect = vi.fn()
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={false}
				error={undefined}
				isLoading={false}
				isStale={false}
				models={models}
				onSelect={onSelect}
				selectedModel={selectedModel}
			/>,
		)

		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "mistral" } })

		expect(onSelect).toHaveBeenCalledWith({ providerId: "ollama", modelId: "mistral", modelInfo: models.mistral })
	})

	it("shows manual entry during loading when custom ids are allowed", () => {
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={true}
				error={undefined}
				isLoading={true}
				isStale={false}
				models={{}}
				onSelect={vi.fn()}
				selectedModel={selectedModel}
			/>,
		)

		expect(screen.getByText("Loading models…")).toBeInTheDocument()
		expect(screen.getByLabelText("Custom model ID")).toBeInTheDocument()
	})

	it("shows manual entry during error when custom ids are allowed", () => {
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={true}
				error="Could not fetch models"
				isLoading={false}
				isStale={false}
				models={{}}
				onSelect={vi.fn()}
				selectedModel={selectedModel}
			/>,
		)

		expect(screen.getByRole("alert")).toHaveTextContent("Could not fetch models")
		expect(screen.getByLabelText("Custom model ID")).toBeInTheDocument()
	})

	it("commits custom model ids with safe default model info", () => {
		const onSelect = vi.fn()
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={true}
				error={undefined}
				isLoading={false}
				isStale={false}
				models={{}}
				onSelect={onSelect}
				selectedModel={selectedModel}
			/>,
		)

		fireEvent.change(screen.getByLabelText("Custom model ID"), { target: { value: "my-custom:latest" } })
		fireEvent.click(screen.getByText("Use custom model"))

		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "ollama",
				modelId: "my-custom:latest",
				modelInfo: expect.objectContaining({ name: "my-custom:latest", supportsPromptCache: false }),
			}),
		)
	})

	it("reveals manual entry from the custom option when models are present", () => {
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={true}
				error={undefined}
				isLoading={false}
				isStale={false}
				models={models}
				onSelect={vi.fn()}
				selectedModel={selectedModel}
			/>,
		)

		expect(screen.queryByLabelText("Custom model ID")).not.toBeInTheDocument()
		fireEvent.change(screen.getByLabelText("Model"), { target: { value: "__custom__" } })
		expect(screen.getByLabelText("Custom model ID")).toBeInTheDocument()
	})

	it("shows stale and not-in-current-list indicators without replacing selection", () => {
		const onSelect = vi.fn()
		render(
			<ModelPickerWithManualEntry
				allowsCustomIds={true}
				error={undefined}
				isLoading={false}
				isStale={true}
				models={models}
				onSelect={onSelect}
				selectedModel={{ ...selectedModel, modelId: "custom-outside-list" }}
			/>,
		)

		expect(screen.getByText("Model list may be stale for the current provider configuration.")).toBeInTheDocument()
		expect(screen.getByText("Selected model “custom-outside-list” is not in the current list.")).toBeInTheDocument()
		expect(onSelect).not.toHaveBeenCalled()
	})
})
