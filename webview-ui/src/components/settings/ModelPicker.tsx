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
	modelsKey: "glamaModels" | "openRouterModels"
	configKey: "glamaModelId" | "openRouterModelId"
	infoKey: "glamaModelInfo" | "openRouterModelInfo"
	refreshMessageType: "refreshGlamaModels" | "refreshOpenRouterModels"
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
	serviceName,
	serviceUrl,
	recommendedModel,
}: ModelPickerProps) => {
	const [open, setOpen] = useState(false)
	const [value, setValue] = useState(defaultModelId)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)

	const { apiConfiguration, setApiConfiguration, [modelsKey]: models, onUpdateApiConfig } = useExtensionState()
	const modelIds = useMemo(() => Object.keys(models).sort((a, b) => a.localeCompare(b)), [models])

	const { selectedModelId, selectedModelInfo } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration),
		[apiConfiguration],
	)

	const onSelect = useCallback(
		(modelId: string) => {
			const apiConfig = { ...apiConfiguration, [configKey]: modelId, [infoKey]: models[modelId] }
			setApiConfiguration(apiConfig)
			onUpdateApiConfig(apiConfig)
			setValue(modelId)
			setOpen(false)
		},
		[apiConfiguration, configKey, infoKey, models, onUpdateApiConfig, setApiConfiguration],
	)

	const debouncedRefreshModels = useMemo(
		() => debounce(() => vscode.postMessage({ type: refreshMessageType }), 50),
		[refreshMessageType],
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
