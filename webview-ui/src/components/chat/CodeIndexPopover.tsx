import React, { useState, useEffect, useMemo } from "react"
import { Trans } from "react-i18next"
import {
	VSCodeButton,
	VSCodeTextField,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeLink,
} from "@vscode/webview-ui-toolkit/react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { buildDocLink } from "@src/utils/docLinks"
import { cn } from "@src/lib/utils"
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
	Popover,
	PopoverContent,
	PopoverTrigger,
	Slider,
	StandardTooltip,
} from "@src/components/ui"
import { useRooPortal } from "@src/components/ui/hooks/useRooPortal"
import type { EmbedderProvider } from "@roo/embeddingModels"
import type { IndexingStatus } from "@roo/ExtensionMessage"
import { CODEBASE_INDEX_DEFAULTS } from "@roo-code/types"

interface CodeIndexPopoverProps {
	children: React.ReactNode
	indexingStatus: IndexingStatus
}

interface LocalCodeIndexSettings {
	// Global state settings
	codebaseIndexEnabled: boolean
	codebaseIndexQdrantUrl: string
	codebaseIndexEmbedderProvider: EmbedderProvider
	codebaseIndexEmbedderBaseUrl?: string
	codebaseIndexEmbedderModelId: string
	codebaseIndexSearchMaxResults?: number
	codebaseIndexSearchMinScore?: number

	// Secret settings (start empty, will be loaded separately)
	codeIndexOpenAiKey?: string
	codeIndexQdrantApiKey?: string
	codebaseIndexOpenAiCompatibleBaseUrl?: string
	codebaseIndexOpenAiCompatibleApiKey?: string
	codebaseIndexOpenAiCompatibleModelDimension?: number
	codebaseIndexGeminiApiKey?: string
}

export const CodeIndexPopover: React.FC<CodeIndexPopoverProps> = ({
	children,
	indexingStatus: externalIndexingStatus,
}) => {
	const SECRET_PLACEHOLDER = "••••••••••••••••"
	const { t } = useAppTranslation()
	const { codebaseIndexConfig, codebaseIndexModels } = useExtensionState()
	const [open, setOpen] = useState(false)
	const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false)

	const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>(externalIndexingStatus)

	const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
	const [saveError, setSaveError] = useState<string | null>(null)

	// Default settings template
	const getDefaultSettings = (): LocalCodeIndexSettings => ({
		codebaseIndexEnabled: false,
		codebaseIndexQdrantUrl: "",
		codebaseIndexEmbedderProvider: "openai",
		codebaseIndexEmbedderBaseUrl: "",
		codebaseIndexEmbedderModelId: "",
		codebaseIndexSearchMaxResults: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
		codebaseIndexSearchMinScore: CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
		codeIndexOpenAiKey: "",
		codeIndexQdrantApiKey: "",
		codebaseIndexOpenAiCompatibleBaseUrl: "",
		codebaseIndexOpenAiCompatibleApiKey: "",
		codebaseIndexOpenAiCompatibleModelDimension: undefined,
		codebaseIndexGeminiApiKey: "",
	})

	// Initial settings state - stores the settings when popover opens
	const [initialSettings, setInitialSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Current settings state - tracks user changes
	const [currentSettings, setCurrentSettings] = useState<LocalCodeIndexSettings>(getDefaultSettings())

	// Update indexing status from parent
	useEffect(() => {
		setIndexingStatus(externalIndexingStatus)
	}, [externalIndexingStatus])

	// Initialize settings from global state
	useEffect(() => {
		if (codebaseIndexConfig) {
			const settings = {
				codebaseIndexEnabled: codebaseIndexConfig.codebaseIndexEnabled || false,
				codebaseIndexQdrantUrl: codebaseIndexConfig.codebaseIndexQdrantUrl || "",
				codebaseIndexEmbedderProvider: codebaseIndexConfig.codebaseIndexEmbedderProvider || "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig.codebaseIndexEmbedderBaseUrl || "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig.codebaseIndexEmbedderModelId || "",
				codebaseIndexSearchMaxResults:
					codebaseIndexConfig.codebaseIndexSearchMaxResults ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
				codebaseIndexSearchMinScore:
					codebaseIndexConfig.codebaseIndexSearchMinScore ?? CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
				codeIndexOpenAiKey: "",
				codeIndexQdrantApiKey: "",
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl || "",
				codebaseIndexOpenAiCompatibleApiKey: "",
				codebaseIndexOpenAiCompatibleModelDimension:
					codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension || undefined,
				codebaseIndexGeminiApiKey: "",
			}
			setInitialSettings(settings)
			setCurrentSettings(settings)

			// Request secret status to check if secrets exist
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
	}, [codebaseIndexConfig])

	// Request initial indexing status
	useEffect(() => {
		if (open) {
			vscode.postMessage({ type: "requestIndexingStatus" })
			vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
		}
	}, [open])

	// Listen for indexing status updates and save responses
	useEffect(() => {
		const handleMessage = (event: MessageEvent<any>) => {
			if (event.data.type === "indexingStatusUpdate") {
				setIndexingStatus({
					systemStatus: event.data.values.systemStatus,
					message: event.data.values.message || "",
					processedItems: event.data.values.processedItems,
					totalItems: event.data.values.totalItems,
					currentItemUnit: event.data.values.currentItemUnit || "items",
				})
			} else if (event.data.type === "codeIndexSettingsSaved") {
				if (event.data.success) {
					setSaveStatus("saved")
					// Don't update initial settings here - wait for the secret status response
					// Request updated secret status after save
					vscode.postMessage({ type: "requestCodeIndexSecretStatus" })
					// Reset status after 3 seconds
					setTimeout(() => {
						setSaveStatus("idle")
					}, 3000)
				} else {
					setSaveStatus("error")
					setSaveError(event.data.error || t("settings:codeIndex.saveError"))
					// Clear error message after 5 seconds
					setTimeout(() => {
						setSaveStatus("idle")
						setSaveError(null)
					}, 5000)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [t])

	// Listen for secret status
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.data.type === "codeIndexSecretStatus") {
				// Update settings to show placeholders for existing secrets
				const secretStatus = event.data.values

				// Update both current and initial settings based on what secrets exist
				const updateWithSecrets = (prev: LocalCodeIndexSettings): LocalCodeIndexSettings => {
					const updated = { ...prev }

					// Only update to placeholder if the field is currently empty or already a placeholder
					// This preserves user input when they're actively editing
					if (!prev.codeIndexOpenAiKey || prev.codeIndexOpenAiKey === SECRET_PLACEHOLDER) {
						updated.codeIndexOpenAiKey = secretStatus.hasOpenAiKey ? SECRET_PLACEHOLDER : ""
					}
					if (!prev.codeIndexQdrantApiKey || prev.codeIndexQdrantApiKey === SECRET_PLACEHOLDER) {
						updated.codeIndexQdrantApiKey = secretStatus.hasQdrantApiKey ? SECRET_PLACEHOLDER : ""
					}
					if (
						!prev.codebaseIndexOpenAiCompatibleApiKey ||
						prev.codebaseIndexOpenAiCompatibleApiKey === SECRET_PLACEHOLDER
					) {
						updated.codebaseIndexOpenAiCompatibleApiKey = secretStatus.hasOpenAiCompatibleApiKey
							? SECRET_PLACEHOLDER
							: ""
					}
					if (!prev.codebaseIndexGeminiApiKey || prev.codebaseIndexGeminiApiKey === SECRET_PLACEHOLDER) {
						updated.codebaseIndexGeminiApiKey = secretStatus.hasGeminiApiKey ? SECRET_PLACEHOLDER : ""
					}

					return updated
				}

				setCurrentSettings(updateWithSecrets)
				setInitialSettings(updateWithSecrets)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Generic comparison function that detects changes between initial and current settings
	const hasUnsavedChanges = useMemo(() => {
		// Get all keys from both objects to handle any field
		const allKeys = [...Object.keys(initialSettings), ...Object.keys(currentSettings)] as Array<
			keyof LocalCodeIndexSettings
		>

		// Use a Set to ensure unique keys
		const uniqueKeys = Array.from(new Set(allKeys))

		for (const key of uniqueKeys) {
			const currentValue = currentSettings[key]
			const initialValue = initialSettings[key]

			// For secret fields, check if the value has been modified from placeholder
			if (currentValue === SECRET_PLACEHOLDER) {
				// If it's still showing placeholder, no change
				continue
			}

			// Compare values - handles all types including undefined
			if (currentValue !== initialValue) {
				return true
			}
		}

		return false
	}, [currentSettings, initialSettings])

	const updateSetting = (key: keyof LocalCodeIndexSettings, value: any) => {
		setCurrentSettings((prev) => ({ ...prev, [key]: value }))
	}

	const handleSaveSettings = () => {
		setSaveStatus("saving")
		setSaveError(null)

		// Prepare settings to save - include all fields except secrets with placeholder values
		const settingsToSave: any = {}

		// Iterate through all current settings
		for (const [key, value] of Object.entries(currentSettings)) {
			// Skip secret fields that still have placeholder value
			if (value === SECRET_PLACEHOLDER) {
				continue
			}

			// Include all other fields
			settingsToSave[key] = value
		}

		// Save settings to backend
		vscode.postMessage({
			type: "saveCodeIndexSettingsAtomic",
			codeIndexSettings: settingsToSave,
		})
	}

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const transformStyleString = `translateX(-${100 - progressPercentage}%)`

	const getAvailableModels = () => {
		if (!codebaseIndexModels) return []

		const models = codebaseIndexModels[currentSettings.codebaseIndexEmbedderProvider]
		return models ? Object.keys(models) : []
	}

	const portalContainer = useRooPortal("roo-portal")

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				className="w-[calc(100vw-32px)] max-w-[450px] max-h-[80vh] overflow-y-auto p-4"
				align="end"
				alignOffset={0}
				side="bottom"
				sideOffset={5}
				collisionPadding={16}
				avoidCollisions={true}
				container={portalContainer}>
				<div className="mb-4">
					<h3 className="text-base font-medium mb-2">{t("settings:codeIndex.title")}</h3>
					<p className="text-sm text-vscode-descriptionForeground">
						<Trans i18nKey="settings:codeIndex.description">
							<VSCodeLink
								href={buildDocLink("features/experimental/codebase-indexing", "settings")}
								style={{ display: "inline" }}
							/>
						</Trans>
					</p>
				</div>

				<div className="space-y-4">
					{/* Status Section */}
					<div className="space-y-2">
						<h4 className="text-sm font-medium">{t("settings:codeIndex.statusTitle")}</h4>
						<div className="text-sm text-vscode-descriptionForeground">
							<span
								className={cn("inline-block w-3 h-3 rounded-full mr-2", {
									"bg-gray-400": indexingStatus.systemStatus === "Standby",
									"bg-yellow-500 animate-pulse": indexingStatus.systemStatus === "Indexing",
									"bg-green-500": indexingStatus.systemStatus === "Indexed",
									"bg-red-500": indexingStatus.systemStatus === "Error",
								})}
							/>
							{t(`settings:codeIndex.indexingStatuses.${indexingStatus.systemStatus.toLowerCase()}`)}
							{indexingStatus.message ? ` - ${indexingStatus.message}` : ""}
						</div>

						{indexingStatus.systemStatus === "Indexing" && (
							<div className="mt-2">
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
					</div>

					{/* Embedder Provider Section */}
					<div className="space-y-2">
						<label className="text-sm font-medium">{t("settings:codeIndex.embedderProviderLabel")}</label>
						<Select
							value={currentSettings.codebaseIndexEmbedderProvider}
							onValueChange={(value: EmbedderProvider) =>
								updateSetting("codebaseIndexEmbedderProvider", value)
							}>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="openai">{t("settings:codeIndex.openaiProvider")}</SelectItem>
								<SelectItem value="ollama">{t("settings:codeIndex.ollamaProvider")}</SelectItem>
								<SelectItem value="openai-compatible">
									{t("settings:codeIndex.openaiCompatibleProvider")}
								</SelectItem>
								<SelectItem value="gemini">{t("settings:codeIndex.geminiProvider")}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Provider-specific settings */}
					{currentSettings.codebaseIndexEmbedderProvider === "openai" && (
						<>
							<div className="space-y-2">
								<label className="text-sm font-medium">{t("settings:codeIndex.openAiKeyLabel")}</label>
								<VSCodeTextField
									type="password"
									value={currentSettings.codeIndexOpenAiKey || ""}
									onInput={(e: any) => updateSetting("codeIndexOpenAiKey", e.target.value)}
									placeholder={t("settings:codeIndex.openAiKeyPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">{t("settings:codeIndex.modelLabel")}</label>
								<VSCodeDropdown
									value={currentSettings.codebaseIndexEmbedderModelId}
									onChange={(e: any) => updateSetting("codebaseIndexEmbedderModelId", e.target.value)}
									className="w-full">
									<VSCodeOption value="">{t("settings:codeIndex.selectModel")}</VSCodeOption>
									{getAvailableModels().map((modelId) => {
										const model =
											codebaseIndexModels?.[currentSettings.codebaseIndexEmbedderProvider]?.[
												modelId
											]
										return (
											<VSCodeOption key={modelId} value={modelId}>
												{modelId}{" "}
												{model
													? t("settings:codeIndex.modelDimensions", {
															dimension: model.dimension,
														})
													: ""}
											</VSCodeOption>
										)
									})}
								</VSCodeDropdown>
							</div>
						</>
					)}

					{currentSettings.codebaseIndexEmbedderProvider === "ollama" && (
						<>
							<div className="space-y-2">
								<label className="text-sm font-medium">
									{t("settings:codeIndex.ollamaBaseUrlLabel")}
								</label>
								<VSCodeTextField
									value={currentSettings.codebaseIndexEmbedderBaseUrl || ""}
									onInput={(e: any) => updateSetting("codebaseIndexEmbedderBaseUrl", e.target.value)}
									placeholder={t("settings:codeIndex.ollamaUrlPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">{t("settings:codeIndex.modelLabel")}</label>
								<VSCodeDropdown
									value={currentSettings.codebaseIndexEmbedderModelId}
									onChange={(e: any) => updateSetting("codebaseIndexEmbedderModelId", e.target.value)}
									className="w-full">
									<VSCodeOption value="">{t("settings:codeIndex.selectModel")}</VSCodeOption>
									{getAvailableModels().map((modelId) => {
										const model =
											codebaseIndexModels?.[currentSettings.codebaseIndexEmbedderProvider]?.[
												modelId
											]
										return (
											<VSCodeOption key={modelId} value={modelId}>
												{modelId}{" "}
												{model
													? t("settings:codeIndex.modelDimensions", {
															dimension: model.dimension,
														})
													: ""}
											</VSCodeOption>
										)
									})}
								</VSCodeDropdown>
							</div>
						</>
					)}

					{currentSettings.codebaseIndexEmbedderProvider === "openai-compatible" && (
						<>
							<div className="space-y-2">
								<label className="text-sm font-medium">
									{t("settings:codeIndex.openAiCompatibleBaseUrlLabel")}
								</label>
								<VSCodeTextField
									value={currentSettings.codebaseIndexOpenAiCompatibleBaseUrl || ""}
									onInput={(e: any) =>
										updateSetting("codebaseIndexOpenAiCompatibleBaseUrl", e.target.value)
									}
									placeholder={t("settings:codeIndex.openAiCompatibleBaseUrlPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">
									{t("settings:codeIndex.openAiCompatibleApiKeyLabel")}
								</label>
								<VSCodeTextField
									type="password"
									value={currentSettings.codebaseIndexOpenAiCompatibleApiKey || ""}
									onInput={(e: any) =>
										updateSetting("codebaseIndexOpenAiCompatibleApiKey", e.target.value)
									}
									placeholder={t("settings:codeIndex.openAiCompatibleApiKeyPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">{t("settings:codeIndex.modelLabel")}</label>
								<VSCodeTextField
									value={currentSettings.codebaseIndexEmbedderModelId || ""}
									onInput={(e: any) => updateSetting("codebaseIndexEmbedderModelId", e.target.value)}
									placeholder={t("settings:codeIndex.modelPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">
									{t("settings:codeIndex.modelDimensionLabel")}
								</label>
								<VSCodeTextField
									value={
										currentSettings.codebaseIndexOpenAiCompatibleModelDimension?.toString() || ""
									}
									onInput={(e: any) => {
										const value = e.target.value ? parseInt(e.target.value) : undefined
										updateSetting("codebaseIndexOpenAiCompatibleModelDimension", value)
									}}
									placeholder={t("settings:codeIndex.modelDimensionPlaceholder")}
									className="w-full"
								/>
							</div>
						</>
					)}

					{currentSettings.codebaseIndexEmbedderProvider === "gemini" && (
						<>
							<div className="space-y-2">
								<label className="text-sm font-medium">
									{t("settings:codeIndex.geminiApiKeyLabel")}
								</label>
								<VSCodeTextField
									type="password"
									value={currentSettings.codebaseIndexGeminiApiKey || ""}
									onInput={(e: any) => updateSetting("codebaseIndexGeminiApiKey", e.target.value)}
									placeholder={t("settings:codeIndex.geminiApiKeyPlaceholder")}
									className="w-full"
								/>
							</div>

							<div className="space-y-2">
								<label className="text-sm font-medium">{t("settings:codeIndex.modelLabel")}</label>
								<VSCodeDropdown
									value={currentSettings.codebaseIndexEmbedderModelId}
									onChange={(e: any) => updateSetting("codebaseIndexEmbedderModelId", e.target.value)}
									className="w-full">
									<VSCodeOption value="">{t("settings:codeIndex.selectModel")}</VSCodeOption>
									{getAvailableModels().map((modelId) => {
										const model =
											codebaseIndexModels?.[currentSettings.codebaseIndexEmbedderProvider]?.[
												modelId
											]
										return (
											<VSCodeOption key={modelId} value={modelId}>
												{modelId}{" "}
												{model
													? t("settings:codeIndex.modelDimensions", {
															dimension: model.dimension,
														})
													: ""}
											</VSCodeOption>
										)
									})}
								</VSCodeDropdown>
							</div>
						</>
					)}

					{/* Qdrant Settings */}
					<div className="space-y-2">
						<label className="text-sm font-medium">{t("settings:codeIndex.qdrantUrlLabel")}</label>
						<VSCodeTextField
							value={currentSettings.codebaseIndexQdrantUrl || ""}
							onInput={(e: any) => updateSetting("codebaseIndexQdrantUrl", e.target.value)}
							placeholder={t("settings:codeIndex.qdrantUrlPlaceholder")}
							className="w-full"
						/>
					</div>

					<div className="space-y-2">
						<label className="text-sm font-medium">{t("settings:codeIndex.qdrantApiKeyLabel")}</label>
						<VSCodeTextField
							type="password"
							value={currentSettings.codeIndexQdrantApiKey || ""}
							onInput={(e: any) => updateSetting("codeIndexQdrantApiKey", e.target.value)}
							placeholder={t("settings:codeIndex.qdrantApiKeyPlaceholder")}
							className="w-full"
						/>
					</div>

					{/* Advanced Settings Disclosure */}
					<div className="mt-4">
						<button
							onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
							className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus:outline-none"
							aria-expanded={isAdvancedSettingsOpen}>
							<span
								className={`codicon codicon-${isAdvancedSettingsOpen ? "chevron-down" : "chevron-right"} mr-1`}></span>
							<span>{t("settings:codeIndex.advancedConfigLabel")}</span>
						</button>

						{isAdvancedSettingsOpen && (
							<div className="mt-4 space-y-4 pl-4">
								{/* Search Score Threshold Slider */}
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<label className="text-sm font-medium">
											{t("settings:codeIndex.searchMinScoreLabel")}
										</label>
										<StandardTooltip content={t("settings:codeIndex.searchMinScoreDescription")}>
											<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
										</StandardTooltip>
									</div>
									<div className="flex items-center gap-2">
										<Slider
											min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_SCORE}
											max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_SCORE}
											step={CODEBASE_INDEX_DEFAULTS.SEARCH_SCORE_STEP}
											value={[
												currentSettings.codebaseIndexSearchMinScore ??
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
											]}
											onValueChange={(values) =>
												updateSetting("codebaseIndexSearchMinScore", values[0])
											}
											className="flex-1"
											data-testid="search-min-score-slider"
										/>
										<span className="w-12 text-center">
											{(
												currentSettings.codebaseIndexSearchMinScore ??
												CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE
											).toFixed(2)}
										</span>
										<VSCodeButton
											appearance="icon"
											title={t("settings:codeIndex.resetToDefault")}
											onClick={() =>
												updateSetting(
													"codebaseIndexSearchMinScore",
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE,
												)
											}>
											<span className="codicon codicon-discard" />
										</VSCodeButton>
									</div>
								</div>

								{/* Maximum Search Results Slider */}
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<label className="text-sm font-medium">
											{t("settings:codeIndex.searchMaxResultsLabel")}
										</label>
										<StandardTooltip content={t("settings:codeIndex.searchMaxResultsDescription")}>
											<span className="codicon codicon-info text-xs text-vscode-descriptionForeground cursor-help" />
										</StandardTooltip>
									</div>
									<div className="flex items-center gap-2">
										<Slider
											min={CODEBASE_INDEX_DEFAULTS.MIN_SEARCH_RESULTS}
											max={CODEBASE_INDEX_DEFAULTS.MAX_SEARCH_RESULTS}
											step={CODEBASE_INDEX_DEFAULTS.SEARCH_RESULTS_STEP}
											value={[
												currentSettings.codebaseIndexSearchMaxResults ??
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
											]}
											onValueChange={(values) =>
												updateSetting("codebaseIndexSearchMaxResults", values[0])
											}
											className="flex-1"
											data-testid="search-max-results-slider"
										/>
										<span className="w-12 text-center">
											{currentSettings.codebaseIndexSearchMaxResults ??
												CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS}
										</span>
										<VSCodeButton
											appearance="icon"
											title={t("settings:codeIndex.resetToDefault")}
											onClick={() =>
												updateSetting(
													"codebaseIndexSearchMaxResults",
													CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS,
												)
											}>
											<span className="codicon codicon-discard" />
										</VSCodeButton>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Action Buttons */}
					<div className="flex items-center justify-between gap-2 pt-2">
						<div className="flex gap-2">
							{(indexingStatus.systemStatus === "Error" || indexingStatus.systemStatus === "Standby") && (
								<VSCodeButton
									onClick={() => vscode.postMessage({ type: "startIndexing" })}
									disabled={saveStatus === "saving" || hasUnsavedChanges}>
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

						<VSCodeButton
							onClick={handleSaveSettings}
							disabled={!hasUnsavedChanges || saveStatus === "saving"}>
							{saveStatus === "saving"
								? t("settings:codeIndex.saving")
								: t("settings:codeIndex.saveSettings")}
						</VSCodeButton>
					</div>

					{/* Save Status Messages */}
					{saveStatus === "error" && (
						<div className="mt-2">
							<span className="text-sm text-red-600 block">
								{saveError || t("settings:codeIndex.saveError")}
							</span>
						</div>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
