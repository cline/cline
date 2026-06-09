import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { useState } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"

export interface ModelPickerSelection {
	providerId: ProviderId
	modelId: string
	modelInfo: ModelInfo
}

export interface ModelPickerWithManualEntryProps {
	models: Record<string, ModelInfo>
	isLoading: boolean
	isStale: boolean
	error?: string
	allowsCustomIds: boolean
	selectedModel: ModelPickerSelection
	onSelect: (selection: ModelPickerSelection) => void
}

function customModelInfo(modelId: string): ModelInfo {
	return {
		...openAiModelInfoSafeDefaults,
		name: modelId,
	}
}

export function ModelPickerWithManualEntry({
	models,
	isLoading,
	isStale,
	error,
	allowsCustomIds,
	selectedModel,
	onSelect,
}: ModelPickerWithManualEntryProps) {
	const [isManualEntryVisible, setIsManualEntryVisible] = useState(false)
	const modelIds = Object.keys(models).sort((a, b) => a.localeCompare(b))
	const hasModels = modelIds.length > 0
	const selectedModelInList = selectedModel.modelId in models
	const showManualEntry =
		allowsCustomIds && (isManualEntryVisible || !hasModels || isLoading || Boolean(error) || !selectedModelInList)

	const commitCustomModel = (modelId: string) => {
		const trimmed = modelId.trim()
		if (!trimmed) {
			return
		}
		onSelect({
			providerId: selectedModel.providerId,
			modelId: trimmed,
			modelInfo: models[trimmed] ?? customModelInfo(trimmed),
		})
		setIsManualEntryVisible(false)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<label htmlFor="provider-model-picker">
				<span className="font-medium">Model</span>
			</label>

			{isStale && <div role="status">Model list may be stale for the current provider configuration.</div>}
			{isLoading && <div role="status">Loading models…</div>}
			{error && <div role="alert">{error}</div>}

			{hasModels && (
				<select
					aria-label="Model"
					id="provider-model-picker"
					onChange={(event) => {
						const modelId = event.target.value
						if (modelId === "__custom__") {
							setIsManualEntryVisible(true)
							return
						}
						const modelInfo = models[modelId]
						if (modelInfo) {
							setIsManualEntryVisible(false)
							onSelect({ providerId: selectedModel.providerId, modelId, modelInfo })
						}
					}}
					value={selectedModelInList ? selectedModel.modelId : ""}>
					{!selectedModelInList && allowsCustomIds && selectedModel.modelId && (
						<option value="">{selectedModel.modelId} (not in current list)</option>
					)}
					{modelIds.map((modelId) => (
						<option key={modelId} value={modelId}>
							{modelId}
						</option>
					))}
					{allowsCustomIds && <option value="__custom__">Use custom model ID…</option>}
				</select>
			)}

			{!selectedModelInList && selectedModel.modelId && hasModels && (
				<div role="status">Selected model “{selectedModel.modelId}” is not in the current list.</div>
			)}

			{showManualEntry && (
				<form
					onSubmit={(event) => {
						event.preventDefault()
						const form = event.currentTarget
						const input = form.elements.namedItem("customModelId")
						commitCustomModel(input instanceof HTMLInputElement ? input.value : "")
					}}>
					<label htmlFor="custom-model-id">Custom model ID</label>
					<div style={{ display: "flex", gap: 6 }}>
						<input
							defaultValue={!selectedModelInList ? selectedModel.modelId : ""}
							id="custom-model-id"
							name="customModelId"
							placeholder="Enter custom model ID"
						/>
						<button type="submit">Use custom model</button>
					</div>
				</form>
			)}
		</div>
	)
}

export default ModelPickerWithManualEntry
