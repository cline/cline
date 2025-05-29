import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { ChevronsUpDown, Check, X } from "lucide-react"

import type { ProviderSettings, ModelInfo, OrganizationAllowList } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { filterModels } from "./utils/organizationFilters"
import { cn } from "@src/lib/utils"
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Button,
} from "@src/components/ui"

import { ModelInfoView } from "./ModelInfoView"

type ModelIdKey = keyof Pick<
	ProviderSettings,
	"glamaModelId" | "openRouterModelId" | "unboundModelId" | "requestyModelId" | "openAiModelId" | "litellmModelId"
>

interface ModelPickerProps {
	defaultModelId: string
	models: Record<string, ModelInfo> | null
	modelIdKey: ModelIdKey
	serviceName: string
	serviceUrl: string
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	organizationAllowList: OrganizationAllowList
}

export const ModelPicker = ({
	defaultModelId,
	models,
	modelIdKey,
	serviceName,
	serviceUrl,
	apiConfiguration,
	setApiConfigurationField,
	organizationAllowList,
}: ModelPickerProps) => {
	const { t } = useAppTranslation()

	const [open, setOpen] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const isInitialized = useRef(false)
	const searchInputRef = useRef<HTMLInputElement>(null)

	const modelIds = useMemo(() => {
		const filteredModels = filterModels(models, apiConfiguration.apiProvider, organizationAllowList)

		return Object.keys(filteredModels ?? {}).sort((a, b) => a.localeCompare(b))
	}, [models, apiConfiguration.apiProvider, organizationAllowList])

	const { id: selectedModelId, info: selectedModelInfo } = useSelectedModel(apiConfiguration)

	const [searchValue, setSearchValue] = useState(selectedModelId || "")

	const onSelect = useCallback(
		(modelId: string) => {
			if (!modelId) {
				return
			}

			setOpen(false)
			setApiConfigurationField(modelIdKey, modelId)

			// Delay to ensure the popover is closed before setting the search value.
			setTimeout(() => setSearchValue(modelId), 100)
		},
		[modelIdKey, setApiConfigurationField],
	)

	const onOpenChange = useCallback(
		(open: boolean) => {
			setOpen(open)

			// Abandon the current search if the popover is closed.
			if (!open) {
				// Delay to ensure the popover is closed before setting the search value.
				setTimeout(() => setSearchValue(selectedModelId), 100)
			}
		},
		[selectedModelId],
	)

	const onClearSearch = useCallback(() => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}, [])

	useEffect(() => {
		if (!selectedModelId && !isInitialized.current) {
			const initialValue = modelIds.includes(selectedModelId) ? selectedModelId : defaultModelId
			setApiConfigurationField(modelIdKey, initialValue)
		}

		isInitialized.current = true
	}, [modelIds, setApiConfigurationField, modelIdKey, selectedModelId, defaultModelId])

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:modelPicker.label")}</label>
				<Popover open={open} onOpenChange={onOpenChange}>
					<PopoverTrigger asChild>
						<Button
							variant="combobox"
							role="combobox"
							aria-expanded={open}
							className="w-full justify-between">
							<div>{selectedModelId ?? t("settings:common.select")}</div>
							<ChevronsUpDown className="opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
						<Command>
							<div className="relative">
								<CommandInput
									ref={searchInputRef}
									value={searchValue}
									onValueChange={setSearchValue}
									placeholder={t("settings:modelPicker.searchPlaceholder")}
									className="h-9 mr-4"
									data-testid="model-input"
								/>
								{searchValue.length > 0 && (
									<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
										<X
											className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
											onClick={onClearSearch}
										/>
									</div>
								)}
							</div>
							<CommandList>
								<CommandEmpty>
									{searchValue && (
										<div className="py-2 px-1 text-sm">
											{t("settings:modelPicker.noMatchFound")}
										</div>
									)}
								</CommandEmpty>
								<CommandGroup>
									{modelIds.map((model) => (
										<CommandItem key={model} value={model} onSelect={onSelect}>
											{model}
											<Check
												className={cn(
													"size-4 p-0.5 ml-auto",
													model === selectedModelId ? "opacity-100" : "opacity-0",
												)}
											/>
										</CommandItem>
									))}
								</CommandGroup>
							</CommandList>
							{searchValue && !modelIds.includes(searchValue) && (
								<div className="p-1 border-t border-vscode-input-border">
									<CommandItem data-testid="use-custom-model" value={searchValue} onSelect={onSelect}>
										{t("settings:modelPicker.useCustomModel", { modelId: searchValue })}
									</CommandItem>
								</div>
							)}
						</Command>
					</PopoverContent>
				</Popover>
			</div>
			{selectedModelId && selectedModelInfo && (
				<ModelInfoView
					apiProvider={apiConfiguration.apiProvider}
					selectedModelId={selectedModelId}
					modelInfo={selectedModelInfo}
					isDescriptionExpanded={isDescriptionExpanded}
					setIsDescriptionExpanded={setIsDescriptionExpanded}
				/>
			)}
			<div className="text-sm text-vscode-descriptionForeground">
				<Trans
					i18nKey="settings:modelPicker.automaticFetch"
					components={{
						serviceLink: <VSCodeLink href={serviceUrl} className="text-sm" />,
						defaultModelLink: <VSCodeLink onClick={() => onSelect(defaultModelId)} className="text-sm" />,
					}}
					values={{ serviceName, defaultModelId }}
				/>
			</div>
		</>
	)
}
