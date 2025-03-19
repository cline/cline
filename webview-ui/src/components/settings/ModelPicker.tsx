import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { ChevronsUpDown, Check, X } from "lucide-react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { cn } from "@/lib/utils"
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
} from "@/components/ui"

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
	const { t } = useAppTranslation()

	const [open, setOpen] = useState(false)
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
	const isInitialized = useRef(false)
	const searchInputRef = useRef<HTMLInputElement>(null)
	const modelIds = useMemo(() => Object.keys(models ?? {}).sort((a, b) => a.localeCompare(b)), [models])

	const { selectedModelId, selectedModelInfo } = useMemo(
		() => normalizeApiConfiguration(apiConfiguration),
		[apiConfiguration],
	)

	const [searchValue, setSearchValue] = useState(selectedModelId || "")

	const onSelect = useCallback(
		(modelId: string) => {
			if (!modelId) return

			setOpen(false)
			const modelInfo = models?.[modelId]
			setApiConfigurationField(modelIdKey, modelId)
			setApiConfigurationField(modelInfoKey, modelInfo ?? defaultModelInfo)

			// Delay to ensure the popover is closed before setting the search value.
			setTimeout(() => setSearchValue(modelId), 100)
		},
		[modelIdKey, modelInfoKey, models, setApiConfigurationField, defaultModelInfo],
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
				<Trans
					i18nKey="settings:modelPicker.automaticFetch"
					components={{
						serviceLink: <VSCodeLink href={serviceUrl} className="text-sm" />,
						defaultModelLink: <VSCodeLink onClick={() => onSelect(defaultModelId)} className="text-sm" />,
					}}
					values={{
						serviceName,
						defaultModelId,
					}}
				/>
			</div>
		</>
	)
}
