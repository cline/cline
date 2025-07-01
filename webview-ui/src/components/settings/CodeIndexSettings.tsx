import React, { useState, useEffect } from "react"
import { z } from "zod"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { VSCodeCheckbox, VSCodeTextField, VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"

import { CodebaseIndexConfig, CodebaseIndexModels, ProviderSettings } from "@roo-code/types"

import { EmbedderProvider } from "@roo/embeddingModels"
import { SEARCH_MIN_SCORE } from "../../../../src/services/code-index/constants"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
	Slider,
	Button,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@src/components/ui"

import { SetCachedStateField } from "./types"

interface CodeIndexSettingsProps {
	codebaseIndexModels: CodebaseIndexModels | undefined
	codebaseIndexConfig: CodebaseIndexConfig | undefined
	apiConfiguration: ProviderSettings
	setCachedStateField: SetCachedStateField<"codebaseIndexConfig">
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void
	areSettingsCommitted: boolean
}

import type { IndexingStatusUpdateMessage } from "@roo/ExtensionMessage"

export const CodeIndexSettings: React.FC<CodeIndexSettingsProps> = ({
	codebaseIndexModels,
	codebaseIndexConfig,
	apiConfiguration,
	setCachedStateField,
	setApiConfigurationField,
	areSettingsCommitted,
}) => {
	const { t } = useAppTranslation()
	const DEFAULT_QDRANT_URL = "http://localhost:6333"
	const [indexingStatus, setIndexingStatus] = useState({
		systemStatus: "Standby",
		message: "",
		processedItems: 0,
		totalItems: 0,
		currentItemUnit: "items",
	})
	const [advancedExpanded, setAdvancedExpanded] = useState(false)

	// Safely calculate available models for current provider
	const currentProvider = codebaseIndexConfig?.codebaseIndexEmbedderProvider
	const modelsForProvider =
		currentProvider === "openai" || currentProvider === "ollama" || currentProvider === "openai-compatible"
			? codebaseIndexModels?.[currentProvider] || codebaseIndexModels?.openai
			: codebaseIndexModels?.openai
	const availableModelIds = Object.keys(modelsForProvider || {})

	useEffect(() => {
		// Request initial indexing status from extension host
		vscode.postMessage({ type: "requestIndexingStatus" })

		// Set up interval for periodic status updates

		// Set up message listener for status updates
		const handleMessage = (event: MessageEvent<IndexingStatusUpdateMessage>) => {
			if (event.data.type === "indexingStatusUpdate") {
				setIndexingStatus({
					systemStatus: event.data.values.systemStatus,
					message: event.data.values.message || "",
					processedItems: event.data.values.processedItems,
					totalItems: event.data.values.totalItems,
					currentItemUnit: event.data.values.currentItemUnit || "items",
				})
			}
		}

		window.addEventListener("message", handleMessage)

		// Cleanup function
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [codebaseIndexConfig, codebaseIndexModels])

	/**
	 * Determines the appropriate model ID when changing providers
	 */
	function getModelIdForProvider(
		newProvider: EmbedderProvider,
		currentProvider: EmbedderProvider | undefined,
		currentModelId: string | undefined,
		availableModels: CodebaseIndexModels | undefined,
	): string {
		if (newProvider === currentProvider && currentModelId) {
			return currentModelId
		}

		const models = availableModels?.[newProvider]
		const modelIds = models ? Object.keys(models) : []

		if (currentModelId && modelIds.includes(currentModelId)) {
			return currentModelId
		}

		const selectedModel = modelIds.length > 0 ? modelIds[0] : ""
		return selectedModel
	}

	function validateIndexingConfig(config: CodebaseIndexConfig | undefined, apiConfig: ProviderSettings): boolean {
		if (!config) return false

		const baseSchema = z.object({
			codebaseIndexQdrantUrl: z.string().url("Qdrant URL must be a valid URL"),
			codebaseIndexEmbedderModelId: z.string().min(1, "Model ID is required"),
		})

		const providerSchemas = {
			openai: baseSchema.extend({
				codebaseIndexEmbedderProvider: z.literal("openai"),
				codeIndexOpenAiKey: z.string().min(1, "OpenAI key is required"),
			}),
			ollama: baseSchema.extend({
				codebaseIndexEmbedderProvider: z.literal("ollama"),
				codebaseIndexEmbedderBaseUrl: z.string().url("Ollama URL must be a valid URL"),
			}),
			"openai-compatible": baseSchema.extend({
				codebaseIndexEmbedderProvider: z.literal("openai-compatible"),
				codebaseIndexOpenAiCompatibleBaseUrl: z.string().url("Base URL must be a valid URL"),
				codebaseIndexOpenAiCompatibleApiKey: z.string().min(1, "API key is required"),
				codebaseIndexOpenAiCompatibleModelDimension: z
					.number()
					.int("Dimension must be an integer")
					.positive("Dimension must be a positive number")
					.optional(),
			}),
		}

		try {
			const schema =
				config.codebaseIndexEmbedderProvider === "openai"
					? providerSchemas.openai
					: config.codebaseIndexEmbedderProvider === "ollama"
						? providerSchemas.ollama
						: providerSchemas["openai-compatible"]

			schema.parse({
				...config,
				codeIndexOpenAiKey: apiConfig.codeIndexOpenAiKey,
				codebaseIndexOpenAiCompatibleBaseUrl: apiConfig.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexOpenAiCompatibleApiKey: apiConfig.codebaseIndexOpenAiCompatibleApiKey,
				codebaseIndexOpenAiCompatibleModelDimension: apiConfig.codebaseIndexOpenAiCompatibleModelDimension,
			})
			return true
		} catch {
			return false
		}
	}

	const progressPercentage =
		indexingStatus.totalItems > 0
			? (indexingStatus.processedItems / indexingStatus.totalItems) * 100
			: indexingStatus.totalItems === 0 && indexingStatus.processedItems === 0
				? 100
				: 0

	const transformValue = 100 - progressPercentage
	const transformStyleString = `translateX(-${transformValue}%)`

	return (
		<>
			<div>
				<div className="flex items-center gap-2">
					<VSCodeCheckbox
						checked={codebaseIndexConfig?.codebaseIndexEnabled}
						onChange={(e: any) =>
							setCachedStateField("codebaseIndexConfig", {
								...codebaseIndexConfig,
								codebaseIndexEnabled: e.target.checked,
							})
						}>
						<span className="font-medium">{t("settings:codeIndex.enableLabel")}</span>
					</VSCodeCheckbox>
				</div>
				<p className="text-vscode-descriptionForeground text-sm mt-0">
					<Trans i18nKey="settings:codeIndex.enableDescription">
						<VSCodeLink
							href={buildDocLink("features/experimental/codebase-indexing", "settings")}
							style={{ display: "inline" }}></VSCodeLink>
					</Trans>
				</p>
			</div>

			{codebaseIndexConfig?.codebaseIndexEnabled && (
				<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
					<div className="text-sm text-vscode-descriptionForeground">
						<span
							className={`
								inline-block w-3 h-3 rounded-full mr-2
								${
									indexingStatus.systemStatus === "Standby"
										? "bg-gray-400"
										: indexingStatus.systemStatus === "Indexing"
											? "bg-yellow-500 animate-pulse"
											: indexingStatus.systemStatus === "Indexed"
												? "bg-green-500"
												: indexingStatus.systemStatus === "Error"
													? "bg-red-500"
													: "bg-gray-400"
								}
							`}></span>
						{indexingStatus.systemStatus}
						{indexingStatus.message ? ` - ${indexingStatus.message}` : ""}
					</div>

					{indexingStatus.systemStatus === "Indexing" && (
						<div className="space-y-1">
							<ProgressPrimitive.Root
								className="relative h-2 w-full overflow-hidden rounded-full bg-secondary"
								value={progressPercentage}>
								<ProgressPrimitive.Indicator
									className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-in-out"
									style={{
										transform: transformStyleString,
									}}
								/>
							</ProgressPrimitive.Root>
						</div>
					)}

					<div className="flex items-center gap-4 font-bold">
						<div>{t("settings:codeIndex.providerLabel")}</div>
					</div>
					<div>
						<div className="flex items-center gap-2">
							<Select
								value={codebaseIndexConfig?.codebaseIndexEmbedderProvider || "openai"}
								onValueChange={(value) => {
									const newProvider = value as EmbedderProvider
									const currentProvider = codebaseIndexConfig?.codebaseIndexEmbedderProvider
									const currentModelId = codebaseIndexConfig?.codebaseIndexEmbedderModelId

									const modelIdToUse = getModelIdForProvider(
										newProvider,
										currentProvider,
										currentModelId,
										codebaseIndexModels,
									)

									if (codebaseIndexConfig) {
										setCachedStateField("codebaseIndexConfig", {
											...codebaseIndexConfig,
											codebaseIndexEmbedderProvider: newProvider,
											codebaseIndexEmbedderModelId: modelIdToUse,
										})
									}
								}}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:codeIndex.selectProviderPlaceholder")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="openai">{t("settings:codeIndex.openaiProvider")}</SelectItem>
									<SelectItem value="ollama">{t("settings:codeIndex.ollamaProvider")}</SelectItem>
									<SelectItem value="openai-compatible">
										{t("settings:codeIndex.openaiCompatibleProvider")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{codebaseIndexConfig?.codebaseIndexEmbedderProvider === "openai" && (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<div>{t("settings:codeIndex.openaiKeyLabel")}</div>
							</div>
							<div>
								<VSCodeTextField
									type="password"
									value={apiConfiguration.codeIndexOpenAiKey || ""}
									onInput={(e: any) => setApiConfigurationField("codeIndexOpenAiKey", e.target.value)}
									style={{ width: "100%" }}></VSCodeTextField>
							</div>
						</div>
					)}

					{codebaseIndexConfig?.codebaseIndexEmbedderProvider === "openai-compatible" && (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<div>{t("settings:codeIndex.openaiCompatibleBaseUrlLabel")}</div>
							</div>
							<div>
								<VSCodeTextField
									value={apiConfiguration.codebaseIndexOpenAiCompatibleBaseUrl || ""}
									onInput={(e: any) =>
										setApiConfigurationField("codebaseIndexOpenAiCompatibleBaseUrl", e.target.value)
									}
									style={{ width: "100%" }}></VSCodeTextField>
							</div>
							<div className="flex items-center gap-4 font-bold">
								<div>{t("settings:codeIndex.openaiCompatibleApiKeyLabel")}</div>
							</div>
							<div>
								<VSCodeTextField
									type="password"
									value={apiConfiguration.codebaseIndexOpenAiCompatibleApiKey || ""}
									onInput={(e: any) =>
										setApiConfigurationField("codebaseIndexOpenAiCompatibleApiKey", e.target.value)
									}
									style={{ width: "100%" }}></VSCodeTextField>
							</div>
						</div>
					)}

					<div className="flex items-center gap-4 font-bold">
						<div>{t("settings:codeIndex.modelLabel")}</div>
					</div>
					<div>
						<div className="flex items-center gap-2">
							{codebaseIndexConfig?.codebaseIndexEmbedderProvider === "openai-compatible" ? (
								<VSCodeTextField
									value={codebaseIndexConfig?.codebaseIndexEmbedderModelId || ""}
									onInput={(e: any) =>
										setCachedStateField("codebaseIndexConfig", {
											...codebaseIndexConfig,
											codebaseIndexEmbedderModelId: e.target.value,
										})
									}
									placeholder="Enter custom model ID"
									style={{ width: "100%" }}></VSCodeTextField>
							) : (
								<Select
									value={codebaseIndexConfig?.codebaseIndexEmbedderModelId || ""}
									onValueChange={(value) =>
										setCachedStateField("codebaseIndexConfig", {
											...codebaseIndexConfig,
											codebaseIndexEmbedderModelId: value,
										})
									}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder={t("settings:codeIndex.selectModelPlaceholder")} />
									</SelectTrigger>
									<SelectContent>
										{availableModelIds.map((modelId) => (
											<SelectItem key={modelId} value={modelId}>
												{modelId}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>
					</div>

					{codebaseIndexConfig?.codebaseIndexEmbedderProvider === "openai-compatible" && (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<div>{t("settings:codeIndex.openaiCompatibleModelDimensionLabel")}</div>
							</div>
							<div>
								<VSCodeTextField
									type="text"
									value={
										apiConfiguration.codebaseIndexOpenAiCompatibleModelDimension?.toString() || ""
									}
									onInput={(e: any) => {
										const value = e.target.value
										if (value === "") {
											setApiConfigurationField(
												"codebaseIndexOpenAiCompatibleModelDimension",
												undefined,
											)
										} else {
											const parsedValue = parseInt(value, 10)
											if (!isNaN(parsedValue)) {
												setApiConfigurationField(
													"codebaseIndexOpenAiCompatibleModelDimension",
													parsedValue,
												)
											}
										}
									}}
									placeholder={t("settings:codeIndex.openaiCompatibleModelDimensionPlaceholder")}
									style={{ width: "100%" }}></VSCodeTextField>
								<p className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:codeIndex.openaiCompatibleModelDimensionDescription")}
								</p>
							</div>
						</div>
					)}

					{codebaseIndexConfig?.codebaseIndexEmbedderProvider === "ollama" && (
						<div className="flex flex-col gap-3">
							<div className="flex items-center gap-4 font-bold">
								<div>{t("settings:codeIndex.ollamaUrlLabel")}</div>
							</div>
							<div>
								<VSCodeTextField
									value={codebaseIndexConfig.codebaseIndexEmbedderBaseUrl || ""}
									onInput={(e: any) =>
										setCachedStateField("codebaseIndexConfig", {
											...codebaseIndexConfig,
											codebaseIndexEmbedderBaseUrl: e.target.value,
										})
									}
									style={{ width: "100%" }}></VSCodeTextField>
							</div>
						</div>
					)}

					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-4 font-bold">
							<div>{t("settings:codeIndex.qdrantUrlLabel")}</div>
						</div>
						<div>
							<VSCodeTextField
								value={codebaseIndexConfig.codebaseIndexQdrantUrl ?? DEFAULT_QDRANT_URL}
								placeholder={DEFAULT_QDRANT_URL}
								onInput={(e: any) =>
									setCachedStateField("codebaseIndexConfig", {
										...codebaseIndexConfig,
										codebaseIndexQdrantUrl: e.target.value,
									})
								}
								onBlur={(e: any) => {
									// Set default value if field is empty on blur
									if (!e.target.value) {
										setCachedStateField("codebaseIndexConfig", {
											...codebaseIndexConfig,
											codebaseIndexQdrantUrl: DEFAULT_QDRANT_URL,
										})
									}
								}}
								style={{ width: "100%" }}></VSCodeTextField>
						</div>
					</div>

					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-4 font-bold">
							<div>{t("settings:codeIndex.qdrantKeyLabel")}</div>
						</div>
						<div>
							<VSCodeTextField
								type="password"
								value={apiConfiguration.codeIndexQdrantApiKey}
								onInput={(e: any) => setApiConfigurationField("codeIndexQdrantApiKey", e.target.value)}
								style={{ width: "100%" }}></VSCodeTextField>
						</div>
					</div>

					{(!areSettingsCommitted || !validateIndexingConfig(codebaseIndexConfig, apiConfiguration)) && (
						<p className="text-sm text-vscode-descriptionForeground mb-2">
							{t("settings:codeIndex.unsavedSettingsMessage")}
						</p>
					)}

					<div className="flex gap-2">
						{(indexingStatus.systemStatus === "Error" || indexingStatus.systemStatus === "Standby") && (
							<VSCodeButton
								onClick={() => vscode.postMessage({ type: "startIndexing" })}
								disabled={
									!areSettingsCommitted ||
									!validateIndexingConfig(codebaseIndexConfig, apiConfiguration)
								}>
								{t("settings:codeIndex.startIndexingButton")}
							</VSCodeButton>
						)}
						{(indexingStatus.systemStatus === "Indexed" || indexingStatus.systemStatus === "Error") && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<VSCodeButton appearance="secondary">
										{t("settings:codeIndex.clearIndexDataButton")}
									</VSCodeButton>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											{t("settings:codeIndex.clearDataDialog.title")}
										</AlertDialogTitle>
										<AlertDialogDescription>
											{t("settings:codeIndex.clearDataDialog.description")}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>
											{t("settings:codeIndex.clearDataDialog.cancelButton")}
										</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => vscode.postMessage({ type: "clearIndexData" })}>
											{t("settings:codeIndex.clearDataDialog.confirmButton")}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
					</div>

					{/* Advanced Configuration Section */}
					<div className="mt-4">
						<button
							onClick={() => setAdvancedExpanded(!advancedExpanded)}
							className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
							aria-expanded={advancedExpanded}>
							<span
								className={`codicon codicon-${advancedExpanded ? "chevron-down" : "chevron-right"} mr-1`}></span>
							<span>{t("settings:codeIndex.advancedConfigLabel")}</span>
						</button>

						{advancedExpanded && (
							<div className="text-xs text-vscode-descriptionForeground mt-2 ml-5">
								<div className="flex flex-col gap-3">
									<div>
										<span className="block font-medium mb-1">
											{t("settings:codeIndex.searchMinScoreLabel")}
										</span>
										<div className="flex items-center gap-2">
											<Slider
												min={0}
												max={1}
												step={0.05}
												value={[
													codebaseIndexConfig.codebaseIndexSearchMinScore ?? SEARCH_MIN_SCORE,
												]}
												onValueChange={([value]) =>
													setCachedStateField("codebaseIndexConfig", {
														...codebaseIndexConfig,
														codebaseIndexSearchMinScore: value,
													})
												}
												data-testid="search-min-score-slider"
												aria-label={t("settings:codeIndex.searchMinScoreLabel")}
											/>
											<span className="w-10">
												{(
													codebaseIndexConfig.codebaseIndexSearchMinScore ?? SEARCH_MIN_SCORE
												).toFixed(2)}
											</span>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<Button
															variant="ghost"
															size="sm"
															onClick={() =>
																setCachedStateField("codebaseIndexConfig", {
																	...codebaseIndexConfig,
																	codebaseIndexSearchMinScore: SEARCH_MIN_SCORE,
																})
															}
															className="h-8 w-8 p-0"
															data-testid="search-min-score-reset-button">
															<span className="codicon codicon-debug-restart w-4 h-4" />
														</Button>
													</TooltipTrigger>
													<TooltipContent>
														<p>{t("settings:codeIndex.searchMinScoreResetTooltip")}</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</div>
										<div className="text-vscode-descriptionForeground text-sm mt-1">
											{t("settings:codeIndex.searchMinScoreDescription")}
										</div>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>
			)}
		</>
	)
}
