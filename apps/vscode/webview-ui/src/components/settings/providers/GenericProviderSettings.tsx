import type { ProviderConfigField } from "@shared/proto/cline/models"
import { Mode } from "@shared/storage/types"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useRef, useState } from "react"
import { type ProviderId } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { useProviderModels } from "@/hooks/useProviderModels"
import { useDebounceEffect } from "@/utils/useDebounceEffect"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { getSavedApiKeyMask, sanitizeMaskedApiKeyInput } from "../utils/apiKeyMasking"
import { type ModelPickerSelection, ModelPickerWithManualEntry } from "./ModelPickerWithManualEntry"

export interface GenericProviderSettingsProps {
	providerId: ProviderId
	providerName: string
	allowsCustomIds: boolean
	configFields?: ProviderConfigField[]
	configValuesJson?: Record<string, string>
	lockedFieldPaths?: readonly string[]
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

function parseJsonPrimitive(value: string | undefined): string | number | boolean | null | undefined {
	if (value === undefined) {
		return undefined
	}
	try {
		const parsed = JSON.parse(value) as unknown
		if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean" || parsed === null) {
			return parsed
		}
	} catch {
		return undefined
	}
	return undefined
}

function parseHeadersJson(value: string): Record<string, string> | undefined {
	const trimmed = value.trim()
	if (!trimmed) {
		return {}
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return undefined
		}
		const headers: Record<string, string> = {}
		for (const [key, headerValue] of Object.entries(parsed)) {
			if (typeof headerValue !== "string") {
				return undefined
			}
			headers[key] = headerValue
		}
		return headers
	} catch {
		return undefined
	}
}

function headersFieldValue(values: Record<string, string> | undefined): string {
	const raw = values?.headers
	if (!raw) {
		return ""
	}
	try {
		const parsed = JSON.parse(raw) as unknown
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return JSON.stringify(parsed)
		}
	} catch {
		return ""
	}
	return ""
}

function fieldValue(field: ProviderConfigField, values: Record<string, string> | undefined): string | number | boolean {
	const current = parseJsonPrimitive(values?.[field.path])
	const fallback = parseJsonPrimitive(field.defaultValueJson)
	const value = current ?? fallback
	return value ?? (field.type === "boolean" ? false : "")
}

function selectOptionValue(field: ProviderConfigField, value: string): string | number | boolean {
	const option = field.options.find((candidate) => candidate.value === value)
	const parsed = parseJsonPrimitive(option?.valueJson)
	return typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean" ? parsed : value
}

type OptimisticFieldValueCacheKey = `${ProviderId}:${Mode}`

const optimisticFieldValuesByProviderMode = new Map<OptimisticFieldValueCacheKey, Record<string, string>>()

function optimisticFieldValueCacheKey(providerId: ProviderId, mode: Mode): OptimisticFieldValueCacheKey {
	return `${providerId}:${mode}`
}

function clearEchoedOptimisticFieldValues(
	cacheKey: OptimisticFieldValueCacheKey,
	values: Record<string, string> | undefined,
): void {
	const optimisticValues = optimisticFieldValuesByProviderMode.get(cacheKey)
	if (!optimisticValues || !values) {
		return
	}
	const next = { ...optimisticValues }
	for (const [path, optimisticValue] of Object.entries(optimisticValues)) {
		if (values[path] === optimisticValue) {
			delete next[path]
		}
	}
	if (Object.keys(next).length > 0) {
		optimisticFieldValuesByProviderMode.set(cacheKey, next)
	} else {
		optimisticFieldValuesByProviderMode.delete(cacheKey)
	}
}

function valuesWithOptimisticCache(
	cacheKey: OptimisticFieldValueCacheKey,
	values: Record<string, string> | undefined,
	lockedFieldPaths: readonly string[] = [],
): Record<string, string> | undefined {
	const optimisticValues = optimisticFieldValuesByProviderMode.get(cacheKey)
	if (!optimisticValues) {
		return values
	}
	const lockedPaths = new Set(lockedFieldPaths)
	const unlockedOptimisticValues = Object.fromEntries(
		Object.entries(optimisticValues).filter(([path]) => !lockedPaths.has(path)),
	)
	return { ...(values ?? {}), ...unlockedOptimisticValues }
}

function rememberOptimisticFieldValue(cacheKey: OptimisticFieldValueCacheKey, path: string, value: unknown): void {
	optimisticFieldValuesByProviderMode.set(cacheKey, {
		...(optimisticFieldValuesByProviderMode.get(cacheKey) ?? {}),
		[path]: JSON.stringify(value),
	})
}

function isGlobalVertexRegion(providerId: ProviderId, values: Record<string, string> | undefined): boolean {
	if (providerId !== "vertex") {
		return false
	}
	const configuredRegion = parseJsonPrimitive(values?.["gcp.region"]) ?? parseJsonPrimitive(values?.region)
	return configuredRegion === "global"
}

function setPathValue(path: string, value: unknown): Record<string, unknown> {
	const segments = path.split(".").filter(Boolean)
	if (segments.length === 0) {
		return {}
	}
	const root: Record<string, unknown> = {}
	let cursor = root
	for (const segment of segments.slice(0, -1)) {
		const next: Record<string, unknown> = {}
		cursor[segment] = next
		cursor = next
	}
	cursor[segments[segments.length - 1]] = value
	return root
}

function SdkProviderTextField({
	field,
	initialValue,
	disabled,
	onChange,
}: {
	field: ProviderConfigField
	initialValue: string
	disabled?: boolean
	onChange: (value: string) => void
}) {
	const [localValue, setLocalValue] = useState(initialValue)
	const changedRef = useRef(false)
	const localValueRef = useRef(initialValue)
	const onChangeRef = useRef(onChange)

	useEffect(() => {
		changedRef.current = false
		setLocalValue(initialValue)
		localValueRef.current = initialValue
	}, [initialValue])

	useEffect(() => {
		localValueRef.current = localValue
	}, [localValue])

	useEffect(() => {
		onChangeRef.current = onChange
	}, [onChange])

	useEffect(
		() => () => {
			if (changedRef.current) {
				changedRef.current = false
				onChangeRef.current(localValueRef.current)
			}
		},
		[],
	)

	const flushPendingChange = () => {
		if (!changedRef.current) {
			return
		}
		changedRef.current = false
		onChange(localValueRef.current)
	}

	useDebounceEffect(
		() => {
			flushPendingChange()
		},
		100,
		[localValue],
	)

	return (
		<VSCodeTextField
			disabled={disabled}
			onBlur={flushPendingChange}
			onInput={(event: any) => {
				if (disabled) {
					return
				}
				changedRef.current = true
				const value = event.target.value
				localValueRef.current = value
				setLocalValue(value)
			}}
			placeholder={field.placeholder}
			style={{ width: "100%" }}
			type={field.type === "password" ? "password" : "text"}
			value={localValue}>
			<span style={{ fontWeight: 500 }}>{field.label}</span>
		</VSCodeTextField>
	)
}

/**
 * Shared settings shell for SDK catalog-backed providers. Provider-specific
 * field knowledge comes from `configFields`; VS Code only renders those fields,
 * persists edits, and hosts the model picker.
 */
export const GenericProviderSettings = ({
	providerId,
	providerName,
	allowsCustomIds,
	configFields,
	configValuesJson,
	lockedFieldPaths,
	showModelOptions,
	isPopup,
	currentMode,
}: GenericProviderSettingsProps) => {
	const { models, defaultModelId, isLoading, isStale, error, refresh } = useProviderModels(providerId)
	const { config, write, commitSelection } = useProviderConfig(providerId)
	const optimisticCacheKey = useMemo(() => optimisticFieldValueCacheKey(providerId, currentMode), [currentMode, providerId])
	const [fieldValuesJson, setFieldValuesJson] = useState<Record<string, string> | undefined>(() =>
		valuesWithOptimisticCache(optimisticFieldValueCacheKey(providerId, currentMode), configValuesJson, lockedFieldPaths),
	)
	const [headersValidationError, setHeadersValidationError] = useState<string | undefined>()

	const modelsForPicker = useMemo(() => {
		if (!isGlobalVertexRegion(providerId, fieldValuesJson)) {
			return models
		}
		return Object.fromEntries(Object.entries(models).filter(([, modelInfo]) => modelInfo.supportsGlobalEndpoint === true))
	}, [fieldValuesJson, models, providerId])

	const { selectedModel, commitModelSelection } = useProviderModelSelection(providerId, currentMode, {
		models: modelsForPicker,
		defaultModelId,
		config,
		commitSelection,
		allowsCustomIds,
	})

	const handleModelSelect = (selection: ModelPickerSelection) => {
		void commitModelSelection(selection).catch((err) =>
			console.error(`Failed to commit ${providerName} model selection:`, err),
		)
	}

	useEffect(() => {
		clearEchoedOptimisticFieldValues(optimisticCacheKey, configValuesJson)
		setHeadersValidationError(undefined)
		setFieldValuesJson(valuesWithOptimisticCache(optimisticCacheKey, configValuesJson, lockedFieldPaths))
	}, [configValuesJson, lockedFieldPaths, optimisticCacheKey])

	const fields = useMemo(
		() => (configFields ?? []).filter((field) => field.path && field.label && field.type !== "hidden"),
		[configFields],
	)
	const lockedFields = useMemo(() => new Set(lockedFieldPaths ?? []), [lockedFieldPaths])

	const writeField = (field: ProviderConfigField, value: unknown) => {
		const path = field.path
		if (lockedFields.has(path)) {
			return
		}
		const normalizedValue =
			field.secret === true && path === "apiKey"
				? sanitizeMaskedApiKeyInput(String(value), getSavedApiKeyMask(config?.apiKeyLength))
				: value
		if (normalizedValue === undefined) {
			return
		}
		if (field.secret !== true) {
			rememberOptimisticFieldValue(optimisticCacheKey, path, normalizedValue)
		}
		setFieldValuesJson((previous) => ({
			...(previous ?? {}),
			[path]: JSON.stringify(normalizedValue),
		}))
		void write({ settingsJson: JSON.stringify(setPathValue(path, normalizedValue)) })
			.then(() => refresh())
			.catch((err) => console.error(`Failed to update ${providerName} provider setting ${path}:`, err))
	}

	const writeHeadersField = (value: string) => {
		if (lockedFields.has("headers")) {
			return
		}
		const headers = parseHeadersJson(value)
		if (headers === undefined) {
			setHeadersValidationError("Headers must be a JSON object with string values.")
			return
		}
		setHeadersValidationError(undefined)
		rememberOptimisticFieldValue(optimisticCacheKey, "headers", headers)
		setFieldValuesJson((previous) => ({
			...(previous ?? {}),
			headers: JSON.stringify(headers),
		}))
		void write({ settingsJson: JSON.stringify({ headers }) })
			.then(() => refresh())
			.catch((err) => console.error(`Failed to update ${providerName} provider setting headers:`, err))
	}

	return (
		<div>
			{fields.map((field) => (
				<div key={field.path} style={{ marginBottom: 8 }}>
					{field.path === "headers" ? (
						<SdkProviderTextField
							disabled={lockedFields.has(field.path)}
							field={field}
							initialValue={headersFieldValue(fieldValuesJson)}
							key={`${providerId}:${field.path}`}
							onChange={writeHeadersField}
						/>
					) : field.type === "boolean" ? (
						<VSCodeCheckbox
							checked={fieldValue(field, fieldValuesJson) === true}
							disabled={lockedFields.has(field.path)}
							onClick={() => {
								if (!lockedFields.has(field.path)) {
									writeField(field, fieldValue(field, fieldValuesJson) !== true)
								}
							}}>
							{field.label}
						</VSCodeCheckbox>
					) : field.type === "select" ? (
						<>
							<label htmlFor={`provider-field-${field.path}`}>
								<span style={{ fontWeight: 500 }}>{field.label}</span>
							</label>
							<VSCodeDropdown
								disabled={lockedFields.has(field.path)}
								id={`provider-field-${field.path}`}
								onChange={(event: any) => writeField(field, selectOptionValue(field, String(event.target.value)))}
								style={{ width: "100%", marginTop: 3 }}
								value={String(fieldValue(field, fieldValuesJson))}>
								{field.options.map((option) => (
									<VSCodeOption key={option.value} value={option.value}>
										{option.label}
									</VSCodeOption>
								))}
							</VSCodeDropdown>
						</>
					) : (
						<SdkProviderTextField
							disabled={lockedFields.has(field.path)}
							field={field}
							initialValue={
								field.secret === true && field.path === "apiKey" && fieldValuesJson?.[field.path] === undefined
									? getSavedApiKeyMask(config?.apiKeyLength)
									: String(fieldValue(field, fieldValuesJson))
							}
							key={`${providerId}:${field.path}`}
							onChange={(value) =>
								writeField(field, field.type === "number" && value.trim() !== "" ? Number(value) : value)
							}
						/>
					)}
					{field.description && (
						<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
							{field.description}
						</p>
					)}
					{field.path === "headers" && headersValidationError && (
						<p role="alert" style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-errorForeground)" }}>
							{headersValidationError}
						</p>
					)}
				</div>
			))}

			{showModelOptions && (
				<>
					<ModelPickerWithManualEntry
						allowsCustomIds={allowsCustomIds}
						error={error}
						isLoading={isLoading}
						isStale={isStale}
						models={modelsForPicker}
						onSelect={handleModelSelect}
						selectedModel={selectedModel}
					/>

					{selectedModel.modelInfo.supportsReasoning === true && (
						<ReasoningEffortSelector
							currentMode={currentMode}
							onEffortChange={(effort) => {
								void write({
									reasoning: {
										enabled: effort !== "none",
										effort: effort !== "none" ? effort : undefined,
									},
								}).catch((err) => console.error(`Failed to update ${providerName} reasoning effort:`, err))
							}}
						/>
					)}

					<ModelInfoView
						isPopup={isPopup}
						modelInfo={selectedModel.modelInfo}
						selectedModelId={selectedModel.modelId}
					/>
				</>
			)}
		</div>
	)
}
