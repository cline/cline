import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import { azureOpenAiDefaultApiVersion, type OpenAiCompatibleModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Tooltip } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { fromProtobufProviderModelOverrides, type ProviderModelOverrides, useProviderConfig } from "@/hooks/useProviderConfig"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { DropdownContainer } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	providerId: string
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({
	providerId,
	showModelOptions,
	isPopup,
	currentMode,
}: OpenAICompatibleProviderProps) => {
	const { t } = useTranslation()
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig(providerId)

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isCustomOpenAiModelEntryVisible, setIsCustomOpenAiModelEntryVisible] = useState(false)
	const [availableOpenAiModels, setAvailableOpenAiModels] = useState<string[]>([])
	const [isRefreshingOpenAiModels, setIsRefreshingOpenAiModels] = useState(false)
	const [openAiModelsError, setOpenAiModelsError] = useState<string | undefined>(undefined)
	const [modelFieldErrors, setModelFieldErrors] = useState<Partial<Record<NumericModelOverrideKey, string>>>({})
	// Only the built-in "openai" provider stores its API key in the legacy
	// ApiConfiguration field; custom providers keep it in their per-provider
	// config (available only as a masked length), so there is no plaintext key
	// to seed the model-refresh request with.
	const legacyOpenAiApiKey = providerId === "openai" ? apiConfiguration?.openAiApiKey || "" : ""
	const latestOpenAiBaseUrlRef = useRef(config?.baseUrl || "")
	const latestOpenAiApiKeyRef = useRef(legacyOpenAiApiKey)
	const openAiModelsRequestRef = useRef(0)

	useEffect(() => {
		latestOpenAiBaseUrlRef.current = config?.baseUrl || ""
	}, [config?.baseUrl])

	useEffect(() => {
		latestOpenAiApiKeyRef.current = legacyOpenAiApiKey
	}, [legacyOpenAiApiKey])

	const handleProviderConfigWriteError = useCallback((fieldName: string, error: unknown) => {
		console.error(`Failed to update OpenAI Compatible ${fieldName}:`, error)
	}, [])

	// Built-in "openai" persists model selection to its legacy ApiConfiguration
	// fields; custom/unknown providers persist via their per-provider committed
	// selection. Prefer the committed selection and fall back to the legacy
	// fields so the built-in provider keeps working unchanged.
	const isOpenAiProvider = providerId === "openai" || providerId === "openai-compatible"
	const { selectedModelId: legacySelectedModelId, selectedModelInfo: legacySelectedModelInfo } = useDynamicProviderSelection(
		providerId,
		apiConfiguration,
		currentMode,
	)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const selectedModelId = committedSelection?.modelId ?? legacySelectedModelId
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: legacySelectedModelInfo
	// The Model Configuration section reads/writes the resolved model info.
	// OpenAiCompatibleModelInfo only adds optional fields over ModelInfo, so a
	// resolved ModelInfo satisfies it structurally.
	const openAiModelInfo: OpenAiCompatibleModelInfo = selectedModelInfo ?? openAiModelInfoSafeDefaults
	const selectedModelOverrides = fromProtobufProviderModelOverrides(committedSelection?.overrides) ?? {}
	// Plan and Act have independent selections, so each mode gets its own
	// pending accumulator: a pending commit in one mode must never become
	// the base (or the model id) for an edit in the other mode, and a round
	// trip to the other mode must not disturb this mode's pending state.
	// Slots start empty; the reseed effect below fills a mode's slot before
	// it can be edited.
	const selectedModelOverridesRef = useRef<Record<Mode, PendingModelSelection>>({
		plan: { modelId: undefined, overrides: {} },
		act: { modelId: undefined, overrides: {} },
	})

	// Counts commits whose commit+read-back round-trip has not finished yet,
	// per mode.
	const pendingCommitsRef = useRef<Record<Mode, number>>({ plan: 0, act: 0 })

	useEffect(() => {
		// Do not reseed the pending-override accumulator from server state
		// while this mode's commits are in flight: an earlier commit's
		// read-back can land after a later local edit, and reseeding from
		// that stale snapshot would silently drop the already-committed
		// newer field.
		if (pendingCommitsRef.current[currentMode] > 0) {
			return
		}
		selectedModelOverridesRef.current[currentMode] = { modelId: selectedModelId, overrides: selectedModelOverrides }
	}, [committedSelection?.overrides, selectedModelId, currentMode])

	const commitOpenAiSelection = useCallback(
		(modelId: string, overrides?: ProviderModelOverrides) => {
			if (!modelId.trim()) {
				return
			}

			const mode = currentMode
			pendingCommitsRef.current[mode] += 1
			void commitSelection(mode, {
				providerId,
				modelId,
				...(overrides !== undefined ? { overrides } : {}),
			})
				.catch((error) => handleProviderConfigWriteError("model selection", error))
				.finally(() => {
					pendingCommitsRef.current[mode] -= 1
				})
		},
		[commitSelection, currentMode, handleProviderConfigWriteError, providerId],
	)

	const updateModelOverride = useCallback(
		<K extends keyof ProviderModelOverrides>(key: K, value: ProviderModelOverrides[K] | undefined) => {
			// Prefer this mode's pending model id: while a model-id commit is
			// still round-tripping, `selectedModelId` reads back the old id
			// and an edit would be committed against the model just switched
			// away from.
			const pending = selectedModelOverridesRef.current[currentMode]
			const modelId = (pending.modelId ?? selectedModelId)?.trim()
			if (!modelId) {
				return
			}

			const currentOverrides = pending.modelId === modelId ? pending.overrides : {}
			const nextOverrides = { ...currentOverrides }
			if (value === undefined) {
				delete nextOverrides[key]
			} else {
				Object.assign(nextOverrides, { [key]: value })
			}
			selectedModelOverridesRef.current[currentMode] = { modelId, overrides: nextOverrides }
			commitOpenAiSelection(modelId, nextOverrides)
		},
		[commitOpenAiSelection, currentMode, selectedModelId],
	)

	const updateNumericModelOverride = useCallback(
		(key: NumericModelOverrideKey, label: string, value: string) => {
			const parsed = parseOptionalFiniteNumber(value)
			if (!parsed.valid) {
				setModelFieldErrors((current) => ({ ...current, [key]: t("providers:shared.mustBeValidNumber", { label }) }))
				return
			}
			setModelFieldErrors((current) => {
				const next = { ...current }
				delete next[key]
				return next
			})
			// Debounced fields fire with their initial value on mount and on
			// model/mode switches; committing that echo would persist resolved
			// catalog values as user overrides. Only commit actual edits.
			// Compare against the pending override when one is in flight so a
			// quick revert during a commit round-trip is not mistaken for an
			// echo of the (stale) displayed value.
			const pending = selectedModelOverridesRef.current[currentMode]
			const pendingOverrides = pending.modelId === selectedModelId?.trim() ? pending.overrides : undefined
			const effectiveValue =
				pendingOverrides && Object.hasOwn(pendingOverrides, key)
					? displayedModelNumber(pendingOverrides[key] as number | undefined)
					: displayedModelNumber(openAiModelInfo?.[key])
			if (parsed.value === effectiveValue) {
				return
			}
			updateModelOverride(key, parsed.value)
		},
		[updateModelOverride, currentMode, openAiModelInfo, selectedModelId, t],
	)

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
			openAiModelsRequestRef.current += 1
		}
	}, [])

	const refreshOpenAiModels = useCallback(
		async (baseUrl?: string, apiKey?: string) => {
			const trimmedBaseUrl = baseUrl?.trim()
			const requestId = openAiModelsRequestRef.current + 1
			openAiModelsRequestRef.current = requestId

			if (!trimmedBaseUrl) {
				setAvailableOpenAiModels([])
				setOpenAiModelsError(undefined)
				setIsRefreshingOpenAiModels(false)
				return
			}

			setIsRefreshingOpenAiModels(true)
			setOpenAiModelsError(undefined)

			try {
				// providerId lets the host back the request with this provider's
				// stored API key and headers — the webview only sees a masked key
				// for custom providers, so it can't send the credential itself.
				const response = await ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						providerId,
						baseUrl: trimmedBaseUrl,
						apiKey,
					}),
				)

				if (openAiModelsRequestRef.current === requestId) {
					setAvailableOpenAiModels(response.values)
				}
			} catch (error) {
				console.error("Failed to refresh OpenAI models:", error)
				if (openAiModelsRequestRef.current === requestId) {
					setAvailableOpenAiModels([])
					setOpenAiModelsError(error instanceof Error ? error.message : String(error))
				}
			} finally {
				if (openAiModelsRequestRef.current === requestId) {
					setIsRefreshingOpenAiModels(false)
				}
			}
		},
		[providerId],
	)

	const debouncedRefreshOpenAiModels = useCallback(
		(baseUrl?: string, apiKey?: string) => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			debounceTimerRef.current = setTimeout(() => {
				void refreshOpenAiModels(baseUrl, apiKey)
			}, 500)
		},
		[refreshOpenAiModels],
	)

	useEffect(() => {
		void refreshOpenAiModels(config?.baseUrl, latestOpenAiApiKeyRef.current)
	}, [config?.baseUrl, refreshOpenAiModels])

	const handleOpenAiModelSelection = useCallback(
		(modelId: string) => {
			if (isOpenAiProvider) {
				handleModeFieldChange({ plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" }, modelId, currentMode)
			}
			// Model metadata here is user-authored (prices, context window,
			// capabilities), not catalog data, so it must survive a model-id
			// edit like it did when the legacy extension kept it in a single
			// id-independent blob. Recommit the displayed overrides under the
			// new id; otherwise an unknown id resolves to safe defaults whose
			// zero prices misbill paid requests as $0.
			const overrides = selectedModelOverridesRef.current[currentMode].overrides
			const hasOverrides = Object.keys(overrides).length > 0
			selectedModelOverridesRef.current[currentMode] = { modelId, overrides }
			commitOpenAiSelection(modelId, hasOverrides ? overrides : undefined)
		},
		[commitOpenAiSelection, currentMode, handleModeFieldChange, isOpenAiProvider],
	)

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		onApiKeyChange: (apiKey) => {
			latestOpenAiApiKeyRef.current = apiKey
			debouncedRefreshOpenAiModels(latestOpenAiBaseUrlRef.current, apiKey)
		},
		providerName: "OpenAI Compatible",
		write,
	})

	return (
		<div>
			<Tooltip>
				<TooltipTrigger>
					<div className="mb-2.5">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>{t("providers:shared.baseUrlLabel")}</span>
							{remoteConfigSettings?.openAiBaseUrl !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
						<DebouncedTextField
							disabled={remoteConfigSettings?.openAiBaseUrl !== undefined}
							initialValue={config?.baseUrl || ""}
							// Intentionally not gated on `config` having loaded:
							// write() works before the initial read resolves, and a
							// guard here would silently discard text typed right
							// after mount, which the late resync then wipes.
							onChange={(value) => {
								latestOpenAiBaseUrlRef.current = value
								void write({ baseUrl: value }).catch((error) => handleProviderConfigWriteError("base URL", error))
								debouncedRefreshOpenAiModels(value, latestOpenAiApiKeyRef.current)
							}}
							placeholder={t("providers:shared.enterBaseUrlPlaceholder")}
							style={{ width: "100%", marginBottom: 10 }}
							type="text"
						/>
					</div>
				</TooltipTrigger>
				<TooltipContent hidden={remoteConfigSettings?.openAiBaseUrl === undefined}>
					{t("providers:shared.remoteConfigManaged")}
				</TooltipContent>
			</Tooltip>

			<ApiKeyField initialValue={savedApiKeyMask} onChange={handleApiKeyChange} providerName="OpenAI Compatible" />

			<label htmlFor="openai-compatible-model-picker">
				<span style={{ fontWeight: 500 }}>{t("providers:openaiCompatible.modelIdLabel")}</span>
				{isRefreshingOpenAiModels && <span> {t("providers:shared.loadingModels")}</span>}
			</label>
			{openAiModelsError && <div role="alert">{openAiModelsError}</div>}
			{availableOpenAiModels.length > 0 ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 10,
					}}>
					<DropdownContainer className="dropdown-container">
						<VSCodeDropdown
							aria-label={t("providers:openaiCompatible.modelIdLabel")}
							className="w-full"
							id="openai-compatible-model-picker"
							// Force VSCodeDropdown to re-initialize after async
							// model-list/selection hydration, otherwise it ignores the
							// value prop for dynamically rendered options.
							// https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433
							key={`${selectedModelId ?? ""}:${isCustomOpenAiModelEntryVisible}:${availableOpenAiModels.join("\u0000")}`}
							onChange={(event) => {
								const modelId = (event.target as HTMLSelectElement).value
								if (modelId === "__custom__") {
									setIsCustomOpenAiModelEntryVisible(true)
									return
								}

								setIsCustomOpenAiModelEntryVisible(false)
								handleOpenAiModelSelection(modelId)
							}}
							value={selectedModelId && availableOpenAiModels.includes(selectedModelId) ? selectedModelId : ""}>
							{selectedModelId && !availableOpenAiModels.includes(selectedModelId) && (
								<VSCodeOption value="">
									{t("providers:modelPicker.notInCurrentList", { modelId: selectedModelId })}
								</VSCodeOption>
							)}
							{availableOpenAiModels.map((modelId) => (
								<VSCodeOption className="break-words whitespace-normal max-w-full" key={modelId} value={modelId}>
									{modelId}
								</VSCodeOption>
							))}
							<VSCodeOption value="__custom__">{t("providers:modelPicker.useCustomModelIdOption")}</VSCodeOption>
						</VSCodeDropdown>
					</DropdownContainer>

					{(isCustomOpenAiModelEntryVisible ||
						(selectedModelId && !availableOpenAiModels.includes(selectedModelId))) && (
						<DebouncedTextField
							initialValue={selectedModelId || ""}
							onChange={(value) => handleOpenAiModelSelection(value)}
							placeholder={t("providers:openaiCompatible.modelIdPlaceholder")}
							style={{ width: "100%" }}>
							<span style={{ fontWeight: 500 }}>{t("providers:openaiCompatible.customModelIdLabel")}</span>
						</DebouncedTextField>
					)}
				</div>
			) : (
				<DebouncedTextField
					initialValue={selectedModelId || ""}
					onChange={(value) => handleOpenAiModelSelection(value)}
					placeholder={t("providers:openaiCompatible.modelIdPlaceholder")}
					style={{ width: "100%", marginBottom: 10 }}
				/>
			)}

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headers = config?.headers ?? {}
				const headerEntries = Object.entries(headers)

				return (
					<div style={{ marginBottom: 10 }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}>
							<Tooltip>
								<TooltipTrigger>
									<div className="flex items-center gap-2">
										<span style={{ fontWeight: 500 }}>
											{t("providers:openaiCompatible.customHeadersLabel")}
										</span>
										{remoteConfigSettings?.openAiHeaders !== undefined && (
											<i className="codicon codicon-lock text-description text-sm" />
										)}
									</div>
								</TooltipTrigger>
								<TooltipContent hidden={remoteConfigSettings?.openAiHeaders === undefined}>
									{t("providers:shared.remoteConfigManaged")}
								</TooltipContent>
							</Tooltip>
							<VSCodeButton
								disabled={remoteConfigSettings?.openAiHeaders !== undefined}
								onClick={() => {
									const currentHeaders = { ...headers }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									void write({ headers: currentHeaders }).catch((error) =>
										handleProviderConfigWriteError("headers", error),
									)
								}}>
								{t("providers:openaiCompatible.addHeader")}
							</VSCodeButton>
						</div>

						<div>
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={key}
										onChange={(newValue) => {
											const currentHeaders = config?.headers ?? {}
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												void write({
													headers: {
														...rest,
														[newValue]: value,
													},
												}).catch((error) => handleProviderConfigWriteError("headers", error))
											}
										}}
										placeholder={t("providers:openaiCompatible.headerNamePlaceholder")}
										style={{ width: "40%" }}
									/>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={value}
										onChange={(newValue) => {
											void write({
												headers: {
													...(config?.headers ?? {}),
													[key]: newValue,
												},
											}).catch((error) => handleProviderConfigWriteError("headers", error))
										}}
										placeholder={t("providers:openaiCompatible.headerValuePlaceholder")}
										style={{ width: "40%" }}
									/>
									<VSCodeButton
										appearance="secondary"
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										onClick={() => {
											const { [key]: _, ...rest } = config?.headers ?? {}
											void write({ headers: rest }).catch((error) =>
												handleProviderConfigWriteError("headers", error),
											)
										}}>
										{t("providers:openaiCompatible.removeHeader")}
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			{remoteConfigSettings?.azureApiVersion !== undefined ? (
				<Tooltip>
					<TooltipTrigger>
						<BaseUrlField
							disabled={true}
							initialValue={apiConfiguration?.azureApiVersion}
							label={t("providers:openaiCompatible.azureApiVersionLabel")}
							onChange={(value) => handleFieldChange("azureApiVersion", value)}
							placeholder={t("providers:shared.defaultPlaceholder", { value: azureOpenAiDefaultApiVersion })}
							showLockIcon={true}
						/>
					</TooltipTrigger>
					<TooltipContent>{t("providers:shared.remoteConfigManaged")}</TooltipContent>
				</Tooltip>
			) : (
				<BaseUrlField
					initialValue={apiConfiguration?.azureApiVersion}
					label={t("providers:openaiCompatible.azureApiVersionLabel")}
					onChange={(value) => handleFieldChange("azureApiVersion", value)}
					placeholder={t("providers:shared.defaultPlaceholder", { value: azureOpenAiDefaultApiVersion })}
				/>
			)}

			<VSCodeCheckbox
				checked={apiConfiguration?.azureIdentity || false}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					return handleFieldChange("azureIdentity", isChecked)
				}}>
				{t("providers:openaiCompatible.azureIdentityCheckbox")}
			</VSCodeCheckbox>

			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{
						marginRight: "4px",
					}}
				/>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					{t("providers:openaiCompatible.modelConfigurationTitle")}
				</span>
			</div>

			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!openAiModelInfo?.supportsImages}
						onChange={(e: any) => updateModelOverride("supportsVision", e.target.checked === true)}>
						{t("providers:shared.supportsImagesLabel")}
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<div style={{ flex: 1 }}>
							<DebouncedTextField
								initialValue={formatOptionalModelNumber(openAiModelInfo?.contextWindow)}
								onChange={(value) =>
									updateNumericModelOverride(
										"contextWindow",
										t("providers:shared.contextWindowSizeLabel"),
										value,
									)
								}>
								<span style={{ fontWeight: 500 }}>{t("providers:shared.contextWindowSizeLabel")}</span>
							</DebouncedTextField>
							{modelFieldErrors.contextWindow && <div role="alert">{modelFieldErrors.contextWindow}</div>}
						</div>

						<div style={{ flex: 1 }}>
							<DebouncedTextField
								initialValue={formatOptionalModelNumber(openAiModelInfo?.maxTokens)}
								onChange={(value) =>
									updateNumericModelOverride("maxTokens", t("providers:shared.maxOutputTokensLabel"), value)
								}
								placeholder={t("providers:openaiCompatible.notSetPlaceholder")}>
								<span style={{ fontWeight: 500 }}>{t("providers:shared.maxOutputTokensLabel")}</span>
							</DebouncedTextField>
							{modelFieldErrors.maxTokens && <div role="alert">{modelFieldErrors.maxTokens}</div>}
						</div>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<div style={{ flex: 1 }}>
							<DebouncedTextField
								initialValue={formatOptionalModelNumber(openAiModelInfo?.inputPrice)}
								onChange={(value) =>
									updateNumericModelOverride(
										"inputPrice",
										t("providers:openaiCompatible.inputPriceLabel"),
										value,
									)
								}>
								<span style={{ fontWeight: 500 }}>{t("providers:openaiCompatible.inputPriceLabel")}</span>
							</DebouncedTextField>
							{modelFieldErrors.inputPrice && <div role="alert">{modelFieldErrors.inputPrice}</div>}
						</div>

						<div style={{ flex: 1 }}>
							<DebouncedTextField
								initialValue={formatOptionalModelNumber(openAiModelInfo?.outputPrice)}
								onChange={(value) =>
									updateNumericModelOverride(
										"outputPrice",
										t("providers:openaiCompatible.outputPriceLabel"),
										value,
									)
								}>
								<span style={{ fontWeight: 500 }}>{t("providers:openaiCompatible.outputPriceLabel")}</span>
							</DebouncedTextField>
							{modelFieldErrors.outputPrice && <div role="alert">{modelFieldErrors.outputPrice}</div>}
						</div>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<div>
							<DebouncedTextField
								initialValue={formatOptionalModelNumber(openAiModelInfo?.temperature)}
								onChange={(value) =>
									updateNumericModelOverride(
										"temperature",
										t("providers:openaiCompatible.temperatureLabel"),
										value,
									)
								}
								placeholder={t("providers:openaiCompatible.notSetPlaceholder")}>
								<span style={{ fontWeight: 500 }}>{t("providers:openaiCompatible.temperatureLabel")}</span>
							</DebouncedTextField>
							{modelFieldErrors.temperature && <div role="alert">{modelFieldErrors.temperature}</div>}
						</div>
					</div>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>{t("providers:shared.noteLabel")}</span>{" "}
					{t("providers:shared.complexPromptsNote")})
				</span>
			</p>

			{showModelOptions && (
				<>
					<ReasoningEffortSelector
						currentMode={currentMode}
						defaultEffort="none"
						onEffortChange={(effort) => {
							void write({
								reasoning: {
									enabled: effort !== "none",
									effort: effort !== "none" ? effort : undefined,
								},
							}).catch((err) => console.error("Failed to update OpenAI Compatible reasoning effort:", err))
						}}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

type NumericModelOverrideKey = "contextWindow" | "maxTokens" | "inputPrice" | "outputPrice" | "temperature"

type PendingModelSelection = { modelId: string | undefined; overrides: ProviderModelOverrides }

type ParsedOptionalNumber = { valid: true; value: number | undefined } | { valid: false }

// -1 is the legacy UI sentinel for "not set"; it renders (and compares) as unset.
function displayedModelNumber(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value !== -1 ? value : undefined
}

function formatOptionalModelNumber(value: number | undefined): string {
	return displayedModelNumber(value)?.toString() ?? ""
}

function parseOptionalFiniteNumber(value: string): ParsedOptionalNumber {
	const trimmed = value.trim()
	if (!trimmed) {
		return { valid: true, value: undefined }
	}
	const parsed = Number(trimmed)
	return Number.isFinite(parsed) ? { valid: true, value: parsed } : { valid: false }
}
