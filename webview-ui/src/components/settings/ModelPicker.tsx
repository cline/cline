import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import { useMemo, useState, useCallback, useEffect } from "react"
import { useMount } from "react-use"
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons"

import { cn } from "@/lib/utils"
import {
	Button,
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui"

import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { normalizeApiConfiguration } from "./ApiOptions"
import { ModelInfoView } from "./ModelInfoView"

interface ModelPickerProps {
	defaultModelId: string
	modelsKey: "glamaModels" | "openRouterModels" | "unboundModels" | "requestyModels" | "openAiModels"
	configKey: "glamaModelId" | "openRouterModelId" | "unboundModelId" | "requestyModelId" | "openAiModelId"
	infoKey: "glamaModelInfo" | "openRouterModelInfo" | "unboundModelInfo" | "requestyModelInfo" | "openAiModelInfo"
	refreshMessageType:
		| "refreshGlamaModels"
		| "refreshOpenRouterModels"
		| "refreshUnboundModels"
		| "refreshRequestyModels"
		| "refreshOpenAiModels"
	refreshValues?: Record<string, any>
	serviceName: string
	serviceUrl: string
	recommendedModel: string
}

export const ModelPicker = ({
	defaultModelId,
	modelsKey,
	configKey,
	infoKey,
	refreshMessageType,
	refreshValues,
	serviceName,
	serviceUrl,
	recommendedModel,
}: ModelPickerProps) => {
	const [open, setOpen] = useState(false)
	const [value, setValue] = useState(defaultModelId)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const { apiConfiguration, setApiConfiguration, [modelsKey]: models, onUpdateApiConfig } = useExtensionState()
	const modelIds = useMemo(
		() => (Array.isArray(models) ? models : Object.keys(models)).sort((a, b) => a.localeCompare(b)),
		[models],
	)

	const { selectedModelId, selectedModelInfo } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration),
		[apiConfiguration],
	)

	const onSelect = useCallback(
		(modelId: string) => {
			const modelInfo = Array.isArray(models)
				? { id: modelId } // For OpenAI models which are just strings
				: models[modelId] // For other models that have full info objects
			const apiConfig = { ...apiConfiguration, [configKey]: modelId, [infoKey]: modelInfo }
			setApiConfiguration(apiConfig)
			onUpdateApiConfig(apiConfig)
			setValue(modelId)
			setOpen(false)
		},
		[apiConfiguration, configKey, infoKey, models, onUpdateApiConfig, setApiConfiguration],
	)

	const debouncedRefreshModels = useMemo(
		() =>
			debounce(() => {
				const message = refreshValues
					? { type: refreshMessageType, values: refreshValues }
					: { type: refreshMessageType }
				vscode.postMessage(message)
			}, 50),
		[refreshMessageType, refreshValues],
	)

	useMount(() => {
		debouncedRefreshModels()
		return () => debouncedRefreshModels.clear()
	})

	useEffect(() => setValue(selectedModelId), [selectedModelId])

	return (
		<>
			<div className="font-semibold">Model</div>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button variant="combobox" role="combobox" aria-expanded={open} className="w-full justify-between">
						{value ?? "Select model..."}
						<CaretSortIcon className="opacity-50" />
					</Button>
				</PopoverTrigger>
				<PopoverContent align="start" className="p-0">
					<Command>
						<CommandInput placeholder="Search model..." className="h-9" />
						<CommandList>
							<CommandEmpty>No model found.</CommandEmpty>
							<CommandGroup>
								{modelIds.map((model) => (
									<CommandItem key={model} value={model} onSelect={onSelect}>
										{model}
										<CheckIcon
											className={cn("ml-auto", value === model ? "opacity-100" : "opacity-0")}
										/>
									</CommandItem>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
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
