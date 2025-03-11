import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem } from "@/components/ui/combobox"

import { ApiConfiguration, ModelInfo } from "../../../../src/shared/api"

import { normalizeApiConfiguration } from "./ApiOptions"
import { ThinkingBudget } from "./ThinkingBudget"
import { ModelInfoView } from "./ModelInfoView"

type ExtractType<T> = NonNullable<
	{ [K in keyof ApiConfiguration]: Required<ApiConfiguration>[K] extends T ? K : never }[keyof ApiConfiguration]
>

type ModelIdKeys = NonNullable<
	{ [K in keyof ApiConfiguration]: K extends `${string}ModelId` ? K : never }[keyof ApiConfiguration]
>

interface ModelPickerProps {
	defaultModelId: string
	defaultModelInfo?: ModelInfo
	models: Record<string, ModelInfo> | null
	modelIdKey: ModelIdKeys
	modelInfoKey: ExtractType<ModelInfo>
	serviceName: string
	serviceUrl: string
	apiConfiguration: ApiConfiguration
	setApiConfigurationField: <K extends keyof ApiConfiguration>(field: K, value: ApiConfiguration[K]) => void
}

export const ModelPicker = ({
	defaultModelId,
	models,
	modelIdKey,
	modelInfoKey,
	serviceName,
	serviceUrl,
	apiConfiguration,
	setApiConfigurationField,
	defaultModelInfo,
}: ModelPickerProps) => {
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const isInitialized = useRef(false)

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

	const inputValue = apiConfiguration[modelIdKey]

	useEffect(() => {
		if (!inputValue && !isInitialized.current) {
			const initialValue = modelIds.includes(selectedModelId) ? selectedModelId : defaultModelId
			setApiConfigurationField(modelIdKey, initialValue)
		}

		isInitialized.current = true
	}, [inputValue, modelIds, setApiConfigurationField, modelIdKey, selectedModelId, defaultModelId])

	return (
		<>
			<div>
				<div className="font-medium">Model</div>
				<Combobox type="single" inputValue={inputValue} onInputValueChange={onSelect}>
					<ComboboxInput placeholder="Search model..." data-testid="model-input" />
					<ComboboxContent>
						<ComboboxEmpty>No model found.</ComboboxEmpty>
						{modelIds.map((model) => (
							<ComboboxItem key={model} value={model}>
								{model}
							</ComboboxItem>
						))}
					</ComboboxContent>
				</Combobox>
			</div>
			{selectedModelId && selectedModelInfo && selectedModelId === inputValue && (
				<ModelInfoView
					selectedModelId={selectedModelId}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
				/>
			)}
			<ThinkingBudget
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				modelInfo={selectedModelInfo}
			/>
			<div className="text-sm text-vscode-descriptionForeground">
				The extension automatically fetches the latest list of models available on{" "}
				<VSCodeLink href={serviceUrl} className="text-sm">
					{serviceName}
				</VSCodeLink>
				. If you're unsure which model to choose, Roo Code works best with{" "}
				<VSCodeLink onClick={() => onSelect(defaultModelId)} className="text-sm">
					{defaultModelId}.
				</VSCodeLink>
				You can also try searching "free" for no-cost options currently available.
			</div>
		</>
	)
}
