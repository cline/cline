import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useMemo, useState, useCallback, useEffect } from "react"

import { normalizeApiConfiguration } from "./ApiOptions"
import { ModelInfoView } from "./ModelInfoView"
import { ApiConfiguration, ModelInfo } from "../../../../src/shared/api"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem } from "../ui/combobox"

type ExtractType<T> = NonNullable<
	{ [K in keyof ApiConfiguration]: Required<ApiConfiguration>[K] extends T ? K : never }[keyof ApiConfiguration]
>

type ModelIdKeys = NonNullable<
	{ [K in keyof ApiConfiguration]: K extends `${string}ModelId` ? K : never }[keyof ApiConfiguration]
>
declare module "react" {
	interface CSSProperties {
		// Allow CSS variables
		[key: `--${string}`]: string | number
	}
}
interface ModelPickerProps {
	defaultModelId?: string
	models: Record<string, ModelInfo> | null
	modelIdKey: ModelIdKeys
	modelInfoKey: ExtractType<ModelInfo>
	serviceName: string
	serviceUrl: string
	recommendedModel: string
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
	defaultModelInfo?: ModelInfo
}

export const ModelPicker = ({
	defaultModelId,
	models,
	modelIdKey,
	modelInfoKey,
	serviceName,
	serviceUrl,
	recommendedModel,
	apiConfiguration,
	setApiConfigurationField,
	defaultModelInfo,
}: ModelPickerProps) => {
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const modelIds = useMemo(() => Object.keys(models ?? {}).sort((a, b) => a.localeCompare(b)), [models])

	const { selectedModelId, selectedModelInfo } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration),
		[apiConfiguration],
	)
	const onSelect = useCallback(
		(modelId: string) => {
			const modelInfo = models?.[modelId]
			setApiConfigurationField(modelIdKey, modelId)
			setApiConfigurationField(modelInfoKey, modelInfo ?? defaultModelInfo)
		},
		[modelIdKey, modelInfoKey, models, setApiConfigurationField, defaultModelInfo],
	)
	useEffect(() => {
		if (apiConfiguration[modelIdKey] == null && defaultModelId) {
			onSelect(defaultModelId)
		}
	}, [apiConfiguration, defaultModelId, modelIdKey, onSelect])

	return (
		<>
			<div className="font-semibold">Model</div>
			<Combobox type="single" inputValue={apiConfiguration[modelIdKey]} onInputValueChange={onSelect}>
				<ComboboxInput
					className="border-vscode-errorForeground tefat"
					placeholder="Search model..."
					data-testid="model-input"
				/>
				<ComboboxContent>
					<ComboboxEmpty>No model found.</ComboboxEmpty>
					{modelIds.map((model) => (
						<ComboboxItem key={model} value={model}>
							{model}
						</ComboboxItem>
					))}
				</ComboboxContent>
			</Combobox>

			{selectedModelId && selectedModelInfo && (
				<ModelInfoView
					selectedModelId={selectedModelId}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
				/>
			)}
			<p>
				The extension automatically fetches the latest list of models available on{" "}
				<VSCodeLink style={{ display: "inline", fontSize: "inherit" }} href={serviceUrl}>
					{serviceName}.
				</VSCodeLink>
				If you're unsure which model to choose, Roo Code works best with{" "}
				<VSCodeLink onClick={() => onSelect(recommendedModel)}>{recommendedModel}.</VSCodeLink>
				You can also try searching "free" for no-cost options currently available.
			</p>
		</>
	)
}
