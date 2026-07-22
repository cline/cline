import VertexData from "@shared/providers/vertex.json"
import type { Mode } from "@shared/storage/types"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { fromProtobufProviderModelOverrides, type ProviderModelOverrides, useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useProviderUsageCostDisplay } from "@/hooks/useProviderUsageCostDisplay"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { getModeSpecificFields } from "../utils/providerUtils"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

/**
 * Props for the VertexProvider component
 */
interface VertexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

const REGIONS = VertexData.regions
const CUSTOM_MODEL_DEFAULT_OVERRIDES: ProviderModelOverrides = {
	contextWindow: 200_000,
	maxInputTokens: 200_000,
	maxTokens: 64_000,
	supportsVision: true,
	supportsReasoning: true,
	capabilities: ["prompt-cache"],
}

type NumericOverrideKey = "contextWindow" | "maxTokens"

function withCustomModelDefaults(overrides?: ProviderModelOverrides): ProviderModelOverrides {
	return {
		...CUSTOM_MODEL_DEFAULT_OVERRIDES,
		...overrides,
		capabilities: Array.from(new Set([...(overrides?.capabilities ?? []), "prompt-cache"])),
	}
}

/**
 * The GCP Vertex AI provider configuration component
 */
export const VertexProvider = ({ showModelOptions, isPopup, currentMode }: VertexProviderProps) => {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { models: allVertexModels, defaultModelId, isLoading, isStale, error } = useProviderModels("vertex")
	const { config, write, commitSelection } = useProviderConfig("vertex")
	const { selectedModel, selectedModelId, selectedModelInfo } = useProviderModelSelection("vertex", currentMode, {
		models: allVertexModels,
		defaultModelId,
		config,
		commitSelection,
	})
	const hideUsageCost = useProviderUsageCostDisplay("vertex") === "hide"
	const modeFields = getModeSpecificFields(apiConfiguration, currentMode)
	const vertexProjectId = config?.gcp?.projectId ?? apiConfiguration?.vertexProjectId ?? ""
	const vertexRegion = config?.gcp?.region ?? config?.region ?? apiConfiguration?.vertexRegion ?? ""
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const committedOverrides = fromProtobufProviderModelOverrides(committedSelection?.overrides)
	const hasCommittedOverrides = committedOverrides !== undefined
	// The catalog hydrates asynchronously; while it loads (or failed) the map
	// is empty and any committed id would be misclassified as custom, letting
	// the seed effect below stamp generic 200k/64k overrides onto a catalog
	// model. Only classify once the catalog has resolved.
	const catalogResolved = !isLoading && Object.keys(allVertexModels).length > 0
	const isCustomModelSelected = catalogResolved && Boolean(selectedModelId) && !Object.hasOwn(allVertexModels, selectedModelId)
	const customOverrides = isCustomModelSelected ? withCustomModelDefaults(committedOverrides) : undefined
	const customOverridesRef = useRef<{ modelId: string; overrides: ProviderModelOverrides }>({
		modelId: selectedModelId,
		overrides: customOverrides ?? CUSTOM_MODEL_DEFAULT_OVERRIDES,
	})
	const pendingCommitsRef = useRef(0)
	const commitQueueRef = useRef<Promise<unknown>>(Promise.resolve())
	const [fieldErrors, setFieldErrors] = useState<Partial<Record<NumericOverrideKey, string>>>({})

	useEffect(() => {
		if (pendingCommitsRef.current === 0 && customOverrides) {
			customOverridesRef.current = { modelId: selectedModelId, overrides: customOverrides }
		}
	}, [committedSelection?.overrides, customOverrides, selectedModelId])

	const commitVertexSelection = useCallback(
		(modelId: string, overrides?: ProviderModelOverrides) => {
			pendingCommitsRef.current += 1
			// Serialize commits: rapid edits must apply in issue order. Each
			// commit ends with a config read() in useProviderConfig, so an older
			// commit resolving last can otherwise restore stale overrides in the
			// UI and persisted settings. Errors are swallowed per-link so one
			// failed commit never jams the queue.
			commitQueueRef.current = commitQueueRef.current
				.then(() =>
					commitSelection(currentMode, {
						providerId: "vertex",
						modelId,
						...(overrides !== undefined ? { overrides } : {}),
					}),
				)
				.catch((err) => console.error("Failed to commit Vertex model selection:", err))
				.finally(() => {
					pendingCommitsRef.current -= 1
				})
		},
		[commitSelection, currentMode],
	)

	// Seed durable defaults exactly once for a committed custom model with no
	// stored overrides, so the editor's displayed defaults match what the
	// runtime resolves instead of silently diverging from fallback model info.
	// Stored overrides live per (provider, modelId) in models.json and round-
	// trip through committedSelection.overrides, so `undefined` here proves
	// nothing is stored. The seed commit writes non-empty overrides, making
	// this condition false on the next round-trip — no loop. The pending-
	// commit guard keeps it from racing an in-flight user edit.
	useEffect(() => {
		if (
			isCustomModelSelected &&
			committedSelection?.modelId === selectedModelId &&
			!hasCommittedOverrides &&
			pendingCommitsRef.current === 0
		) {
			commitVertexSelection(selectedModelId, withCustomModelDefaults(undefined))
		}
	}, [isCustomModelSelected, committedSelection?.modelId, hasCommittedOverrides, selectedModelId, commitVertexSelection])

	const handleModelSelect = (selection: ModelPickerSelection) => {
		const custom = !Object.hasOwn(allVertexModels, selection.modelId)
		// Custom models: omit overrides (tri-state "preserve") so tuning stored
		// per (provider, modelId) in models.json survives re-selection and
		// plan/act mode switches; the seed effect above writes defaults only
		// when the round-tripped config proves nothing is stored. Catalog
		// models: an explicit `{}` clears any stale stored overrides.
		commitVertexSelection(selection.modelId, custom ? undefined : {})
	}

	const updateCustomOverrides = (updates: Partial<ProviderModelOverrides>) => {
		if (!isCustomModelSelected) {
			return
		}
		const current =
			customOverridesRef.current.modelId === selectedModelId
				? customOverridesRef.current.overrides
				: withCustomModelDefaults(committedOverrides)
		const next = withCustomModelDefaults({ ...current, ...updates })
		customOverridesRef.current = { modelId: selectedModelId, overrides: next }
		commitVertexSelection(selectedModelId, next)
	}

	const updateNumericOverride = (key: NumericOverrideKey, label: string, value: string) => {
		const parsed = Number(value)
		if (!Number.isInteger(parsed) || parsed <= 0) {
			setFieldErrors((current) => ({ ...current, [key]: `${label} must be a positive integer.` }))
			return
		}
		setFieldErrors((current) => ({ ...current, [key]: undefined }))
		const currentValue = customOverridesRef.current.overrides[key]
		if (currentValue === parsed) {
			return
		}
		updateCustomOverrides(key === "contextWindow" ? { contextWindow: parsed, maxInputTokens: parsed } : { maxTokens: parsed })
	}

	const writeProviderConfig = (patch: Parameters<typeof write>[0], label: string) => {
		void write(patch).catch((err) => console.error(`Failed to update Vertex ${label}:`, err))
	}
	const writeGcp = (gcp: NonNullable<Parameters<typeof write>[0]["gcp"]>, label: string) => {
		writeProviderConfig({ gcp }, label)
	}

	const handleProjectIdChange = (value: string) => {
		writeGcp({ projectId: value }, "project ID")
	}

	const handleRegionChange = (value: string) => {
		writeProviderConfig({ region: value, gcp: { region: value } }, "region")
	}

	// Catalog and selection come from the SDK via gRPC. Vertex carries a
	// per-model `supportsGlobalEndpoint` flag (populated host-side from
	// the allowlist in
	// `apps/vscode/src/sdk/model-catalog/vertex-global-endpoint.ts`).
	// When the user selects `vertexRegion === "global"` the picker is
	// filtered to only models known to work with that endpoint so the
	// runtime cannot produce a `model not available in region: global`
	// error from a user-pickable combination.
	const modelsToUse = useMemo(() => {
		if (vertexRegion !== "global") {
			return allVertexModels
		}
		return Object.fromEntries(Object.entries(allVertexModels).filter(([, info]) => info.supportsGlobalEndpoint === true))
	}, [allVertexModels, vertexRegion])
	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(selectedModelId)
	const supportsThinkingBudget =
		selectedModelInfo.supportsReasoning === true &&
		(isCustomModelSelected ||
			(selectedModelInfo.thinkingConfig !== undefined && selectedModelInfo.thinkingConfig.supportsThinkingLevel !== true))
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(modeFields.reasoningEffort, modeFields.thinkingBudgetTokens).effort ?? "none"

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.vertexProjectId === undefined}>
				<DebouncedTextField
					disabled={remoteConfigSettings?.vertexProjectId !== undefined}
					initialValue={vertexProjectId}
					onChange={handleProjectIdChange}
					placeholder="Enter Project ID..."
					style={{ width: "100%" }}>
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
						{remoteConfigSettings?.vertexProjectId !== undefined && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>

			<RemotelyConfiguredInputWrapper hidden={remoteConfigSettings?.vertexRegion === undefined}>
				<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 1}>
					<div
						className="flex items-center gap-2 mb-1"
						style={{ opacity: remoteConfigSettings?.vertexRegion !== undefined ? 0.4 : 1 }}>
						<label htmlFor="vertex-region-dropdown">
							<span className="font-medium">Google Cloud Region</span>
						</label>
						{remoteConfigSettings?.vertexRegion !== undefined && <LockIcon />}
					</div>
					<VSCodeDropdown
						disabled={remoteConfigSettings?.vertexRegion !== undefined}
						id="vertex-region-dropdown"
						onChange={(e: any) => handleRegionChange(e.target.value)}
						style={{ width: "100%" }}
						value={vertexRegion}>
						<VSCodeOption value="">Select a region...</VSCodeOption>
						{REGIONS.map((region) => (
							<VSCodeOption key={region} value={region}>
								{region}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			</RemotelyConfiguredInputWrapper>

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				To use Google Cloud Vertex AI, you need to
				<VSCodeLink
					href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"1) create a Google Cloud account › enable the Vertex AI API › enable the desired Claude models,"}
				</VSCodeLink>{" "}
				<VSCodeLink
					href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"2) install the Google Cloud CLI › configure Application Default Credentials."}
				</VSCodeLink>
			</p>

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={true}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={modelsToUse}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{isCustomModelSelected && customOverrides && (
						<div className="flex flex-col gap-1">
							<p className="m-0 text-sm text-description">
								Adjust the custom model's capabilities if they differ from the defaults.
							</p>
							<div className="flex gap-2">
								<div style={{ flex: 1 }}>
									<DebouncedTextField
										initialValue={String(customOverrides.contextWindow ?? 200_000)}
										onChange={(value) =>
											updateNumericOverride("contextWindow", "Context Window Size", value)
										}>
										<span className="font-medium">Context Window Size</span>
									</DebouncedTextField>
									{fieldErrors.contextWindow && <div role="alert">{fieldErrors.contextWindow}</div>}
								</div>
								<div style={{ flex: 1 }}>
									<DebouncedTextField
										initialValue={String(customOverrides.maxTokens ?? 64_000)}
										onChange={(value) => updateNumericOverride("maxTokens", "Max Output Tokens", value)}>
										<span className="font-medium">Max Output Tokens</span>
									</DebouncedTextField>
									{fieldErrors.maxTokens && <div role="alert">{fieldErrors.maxTokens}</div>}
								</div>
							</div>
							<VSCodeCheckbox
								checked={customOverrides.supportsVision !== false}
								onChange={(event: any) =>
									updateCustomOverrides({ supportsVision: event.target.checked === true })
								}>
								Supports Images
							</VSCodeCheckbox>
							<VSCodeCheckbox
								checked={customOverrides.supportsReasoning !== false}
								onChange={(event: any) =>
									updateCustomOverrides({ supportsReasoning: event.target.checked === true })
								}>
								Supports Reasoning
							</VSCodeCheckbox>
						</div>
					)}

					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							currentMode={currentMode}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
						/>
					) : supportsThinkingBudget ? (
						<ThinkingBudgetSlider currentMode={currentMode} maxBudget={selectedModelInfo.thinkingConfig?.maxBudget} />
					) : null}

					{selectedModelInfo.thinkingConfig?.supportsThinkingLevel && (
						<ReasoningEffortSelector currentMode={currentMode} />
					)}

					<ModelInfoView
						hideUsageCost={hideUsageCost}
						isPopup={isPopup}
						modelInfo={selectedModelInfo}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	)
}
