import {
	ApiConfiguration,
	azureOpenAiDefaultApiVersion,
	openAiModelInfoSaneDefaults,
	openAiCompatibleDefaultConfig,
	OpenAiCompatibleModelInfo,
} from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/models"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { VSCodeTextField, VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import OpenRouterModelPicker, { ModelDescriptionMarkdown, OPENROUTER_MODEL_PICKER_Z_INDEX } from "../OpenRouterModelPicker"
import styled from "styled-components"
import { useCallback, useEffect, useRef, useState } from "react"
import { ModelInfoView } from "../common/ModelInfoView"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { normalizeApiConfiguration } from "../utils/providerUtils"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	apiConfiguration: ApiConfiguration
	setApiConfiguration: (config: ApiConfiguration) => void
	showModelOptions: boolean
	isPopup?: boolean
}

const DROPDOWN_Z_INDEX = OPENROUTER_MODEL_PICKER_Z_INDEX + 2 // Higher than the OpenRouterModelPicker's and ModelSelectorTooltip's z-index

export const DropdownContainer = styled.div<{ zIndex?: number }>`
	position: relative;
	z-index: ${(props) => props.zIndex || DROPDOWN_Z_INDEX};

	// Force dropdowns to open downward
	& vscode-dropdown::part(listbox) {
		position: absolute !important;
		top: 100% !important;
		bottom: auto !important;
	}
`

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({
	apiConfiguration,
	setApiConfiguration,
	showModelOptions,
	isPopup,
}: OpenAICompatibleProviderProps) => {
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isAddingProfile, setIsAddingProfile] = useState(false)
	const [newProfileName, setNewProfileName] = useState("")
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(false)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration)

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const debouncedRefreshOpenAiModels = useCallback((baseUrl?: string, apiKey?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		if (baseUrl && apiKey) {
			debounceTimerRef.current = setTimeout(() => {
				ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey,
					}),
				).catch((error) => {
					console.error("Failed to refresh OpenAI models:", error)
				})
			}, 500)
		}
	}, [])

	const handleOpenAiChange =
		(field: string, isModelInfo: boolean = false) =>
		(event: any) => {
			const rawValue = event.target.checked !== undefined ? event.target.checked : event.target.value

			const openAiConfigs = apiConfiguration?.openAiConfigs
				? [...apiConfiguration.openAiConfigs]
				: [openAiCompatibleDefaultConfig]
			const selectedIndex = apiConfiguration?.openAiSelectedConfigIndex ?? 0

			const currentConfig =
				openAiConfigs[selectedIndex] ||
				(isModelInfo
					? openAiCompatibleDefaultConfig
					: {
							profileName: "Default",
							openAiBaseUrl: "",
							openAiApiKey: "",
							openAiModelId: "",
							openAiModelInfo: { ...openAiModelInfoSaneDefaults },
							azureApiVersion: "",
						})

			if (isModelInfo) {
				let newValue: any = rawValue
				if (
					typeof rawValue === "string" &&
					["contextWindow", "maxTokens", "inputPrice", "outputPrice", "temperature"].includes(field)
				) {
					const key = field as keyof OpenAiCompatibleModelInfo
					const valueStr = rawValue
					const shouldPreserveFormat = valueStr.endsWith(".") || (valueStr.includes(".") && valueStr.endsWith("0"))
					newValue =
						rawValue === ""
							? currentConfig.openAiModelInfo?.[key] || openAiModelInfoSaneDefaults[key]
							: shouldPreserveFormat
								? valueStr
								: parseFloat(valueStr)
				}
				const updatedModelInfo: OpenAiCompatibleModelInfo = {
					...currentConfig.openAiModelInfo,
					[field]: newValue,
				}
				openAiConfigs[selectedIndex] = { ...currentConfig, openAiModelInfo: updatedModelInfo }
			} else {
				openAiConfigs[selectedIndex] = { ...currentConfig, [field]: rawValue }
			}

			setApiConfiguration({
				...apiConfiguration,
				openAiConfigs,
			} as ApiConfiguration)
		}

	const selectOpenAiProfile = (index: number) => {
		setApiConfiguration({ ...apiConfiguration, openAiSelectedConfigIndex: index })
		setModelConfigurationSelected(false)
	}

	const removeOpenAiProfile = (index: number) => {
		let currentConfigs = apiConfiguration?.openAiConfigs ? [...apiConfiguration.openAiConfigs] : []
		if (currentConfigs.length <= 1) return
		currentConfigs.splice(index, 1)
		let newSelectedIndex = apiConfiguration?.openAiSelectedConfigIndex ?? 0
		if (newSelectedIndex >= currentConfigs.length) {
			newSelectedIndex = currentConfigs.length - 1
		}
		setApiConfiguration({
			...apiConfiguration,
			openAiConfigs: currentConfigs,
			openAiSelectedConfigIndex: newSelectedIndex,
		})
	}

	const handleAddProfile = () => {
		if (newProfileName.trim() === "") return
		const currentConfigs = apiConfiguration?.openAiConfigs ? [...apiConfiguration.openAiConfigs] : []
		const newProfile = {
			profileName: newProfileName,
			openAiBaseUrl: "",
			openAiApiKey: "",
			openAiModelId: "",
			openAiModelInfo: openAiModelInfoSaneDefaults,
			azureApiVersion: "",
		}
		currentConfigs.push(newProfile)
		const newIndex = currentConfigs.length - 1
		setApiConfiguration({
			...apiConfiguration,
			openAiConfigs: currentConfigs,
			openAiSelectedConfigIndex: newIndex,
		})
		setNewProfileName("")
		setIsAddingProfile(false)
	}

	useEffect(() => {
		setAzureApiVersionSelected(
			!!(
				apiConfiguration?.openAiConfigs &&
				apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.azureApiVersion
			),
		)
	}, [apiConfiguration?.openAiConfigs, apiConfiguration?.openAiSelectedConfigIndex])

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
				<DropdownContainer zIndex={DROPDOWN_Z_INDEX - 3} className="dropdown-container">
					<label htmlFor="openai-profile">
						<span style={{ fontWeight: 500 }}>Profile</span>
					</label>
					<VSCodeDropdown
						key={`openai-dropdown-${apiConfiguration?.openAiSelectedConfigIndex}`}
						id="openai-profile-dropdown"
						value={(apiConfiguration?.openAiSelectedConfigIndex ?? 0).toString()}
						onChange={(e) => {
							const value = (e.target as HTMLSelectElement).value
							selectOpenAiProfile(Number(value))
						}}
						style={{
							minWidth: 130,
							position: "relative",
						}}>
						{(
							apiConfiguration?.openAiConfigs || [
								{
									profileName: "Default",
									openAiBaseUrl: "",
									openAiApiKey: "",
									openAiModelId: "",
									openAiModelInfo: openAiModelInfoSaneDefaults,
									azureApiVersion: "",
								},
							]
						).map((config, index) => (
							<VSCodeOption key={index} value={index.toString()}>
								{config.profileName || "Default"}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
				<div style={{ display: "flex", alignItems: "flex-end", gap: "5px" }}>
					<div
						data-testid="add-button"
						className="input-icon-button codicon codicon-add"
						onClick={() => setIsAddingProfile(true)}
						style={{ fontSize: 15, height: "16px", lineHeight: "32px", cursor: "pointer" }}></div>
					<div
						data-testid="delete-button"
						className="input-icon-button codicon codicon-trash"
						onClick={() => removeOpenAiProfile(apiConfiguration?.openAiSelectedConfigIndex ?? 0)}
						style={{ fontSize: 15, height: "16px", lineHeight: "32px", cursor: "pointer" }}></div>
				</div>
			</div>
			<div style={{ border: "1px solid var(--vscode-editorForeground)", padding: 0, marginBottom: 0 }}>
				{isAddingProfile && (
					<div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
						<VSCodeTextField
							value={newProfileName}
							onInput={(e) => setNewProfileName((e.target as HTMLInputElement).value)}
							placeholder="Enter a new profile name"
							style={{ width: "80%" }}
						/>
						<VSCodeButton onClick={handleAddProfile}>Add</VSCodeButton>
						<VSCodeButton
							onClick={() => {
								setIsAddingProfile(false)
								setNewProfileName("")
							}}>
							Cancel
						</VSCodeButton>
					</div>
				)}
			</div>
			<VSCodeTextField
				// value={apiConfiguration?.openAiBaseUrl || ""}
				value={
					(apiConfiguration?.openAiConfigs &&
						apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiBaseUrl) ||
					""
				}
				style={{ width: "100%", marginBottom: 10 }}
				type="url"
				onInput={(e: any) => {
					const baseUrl = e.target.value
					// handleInputChange("openAiBaseUrl")({ target: { value: baseUrl } })

					// debouncedRefreshOpenAiModels(baseUrl, apiConfiguration?.openAiApiKey)
					handleOpenAiChange("openAiBaseUrl")(e)
					debouncedRefreshOpenAiModels(
						baseUrl,
						apiConfiguration?.openAiConfigs?.[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiApiKey,
					)
				}}
				placeholder={"Enter base URL..."}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>

			<ApiKeyField
				// value={apiConfiguration?.openAiApiKey || ""}
				value={
					(apiConfiguration?.openAiConfigs &&
						apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiApiKey) ||
					""
				}
				onChange={(e: any) => {
					const apiKey = e.target.value
					// handleInputChange("openAiApiKey")({ target: { value: apiKey } })

					// debouncedRefreshOpenAiModels(apiConfiguration?.openAiBaseUrl, apiKey)
					handleOpenAiChange("openAiApiKey")(e)
					debouncedRefreshOpenAiModels(
						apiConfiguration?.openAiConfigs?.[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiBaseUrl,
						apiKey,
					)
				}}
				providerName="OpenAI Compatible"
			/>

			<VSCodeTextField
				// value={apiConfiguration?.openAiModelId || ""}
				value={
					(apiConfiguration?.openAiConfigs &&
						apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiModelId) ||
					""
				}
				style={{ width: "100%", marginBottom: 10 }}
				// onInput={handleInputChange("openAiModelId")}
				onInput={handleOpenAiChange("openAiModelId")}
				placeholder={"Enter Model ID..."}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</VSCodeTextField>

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headerEntries = Object.entries(apiConfiguration?.openAiHeaders ?? {})
				return (
					<div style={{ marginBottom: 10 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<span style={{ fontWeight: 500 }}>Custom Headers</span>
							<VSCodeButton
								onClick={() => {
									const currentHeaders = { ...(apiConfiguration?.openAiHeaders || {}) }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									setApiConfiguration({
										...apiConfiguration,
										openAiHeaders: currentHeaders,
									})
								}}>
								Add Header
							</VSCodeButton>
						</div>
						<div>
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<VSCodeTextField
										value={key}
										style={{ width: "40%" }}
										placeholder="Header name"
										onInput={(e: any) => {
											const currentHeaders = { ...(apiConfiguration?.openAiHeaders ?? {}) }
											const newValue = e.target.value
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												setApiConfiguration({
													...apiConfiguration,
													openAiHeaders: {
														...rest,
														[newValue]: value,
													},
												})
											}
										}}
									/>
									<VSCodeTextField
										value={value}
										style={{ width: "40%" }}
										placeholder="Header value"
										onInput={(e: any) => {
											setApiConfiguration({
												...apiConfiguration,
												openAiHeaders: {
													...(apiConfiguration?.openAiHeaders ?? {}),
													[key]: e.target.value,
												},
											})
										}}
									/>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
											setApiConfiguration({
												...apiConfiguration,
												openAiHeaders: rest,
											})
										}}>
										Remove
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			<BaseUrlField
				value={
					(apiConfiguration?.openAiConfigs &&
						apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.azureApiVersion) ||
					""
				}
				onChange={(e) => handleOpenAiChange("azureApiVersion")({ target: { value: e } })}
				label="Set Azure API version"
				placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
			/>

			<div
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}
				onClick={() => setModelConfigurationSelected((val) => !val)}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{
						marginRight: "4px",
					}}></span>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					Model Configuration
				</span>
			</div>

			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.supportsImages}
						onChange={handleOpenAiChange("supportsImages", true)}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={
							!!(
								apiConfiguration?.openAiConfigs &&
								apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiModelInfo
									?.supportsBrowser
							)
						}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							handleOpenAiChange("supportsBrowser", true)({ target: { value: isChecked } })
						}}>
						Supports browser use
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={
							!!(
								apiConfiguration?.openAiConfigs &&
								apiConfiguration.openAiConfigs[apiConfiguration.openAiSelectedConfigIndex ?? 0]?.openAiModelInfo
									?.isR1FormatRequired
							)
						}
						onChange={handleOpenAiChange("isR1FormatRequired", true)}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={(
								apiConfiguration?.openAiConfigs?.[apiConfiguration?.openAiSelectedConfigIndex ?? 0]
									?.openAiModelInfo?.contextWindow ?? ""
							).toString()}
							style={{ flex: 1 }}
							onInput={handleOpenAiChange("contextWindow", true)}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</VSCodeTextField>

						<VSCodeTextField
							value={(
								apiConfiguration?.openAiConfigs?.[apiConfiguration?.openAiSelectedConfigIndex ?? 0]
									?.openAiModelInfo?.maxTokens ?? ""
							).toString()}
							style={{ flex: 1 }}
							onInput={handleOpenAiChange("maxTokens", true)}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</VSCodeTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={(
								apiConfiguration?.openAiConfigs?.[apiConfiguration?.openAiSelectedConfigIndex ?? 0]
									?.openAiModelInfo?.inputPrice ?? ""
							).toString()}
							style={{ flex: 1 }}
							onInput={handleOpenAiChange("inputPrice", true)}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</VSCodeTextField>

						<VSCodeTextField
							value={(
								apiConfiguration?.openAiConfigs?.[apiConfiguration?.openAiSelectedConfigIndex ?? 0]
									?.openAiModelInfo?.outputPrice ?? ""
							).toString()}
							style={{ flex: 1 }}
							onInput={handleOpenAiChange("outputPrice", true)}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</VSCodeTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={(
								apiConfiguration?.openAiConfigs?.[apiConfiguration?.openAiSelectedConfigIndex ?? 0]
									?.openAiModelInfo?.temperature ?? ""
							).toString()}
							onInput={handleOpenAiChange("temperature", true)}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</VSCodeTextField>
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
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts and works best with Claude models.
					Less capable models may not work as expected.)
				</span>
			</p>

			{showModelOptions && (
				<ModelInfoView selectedModelId={selectedModelId} modelInfo={selectedModelInfo} isPopup={isPopup} />
			)}
		</div>
	)
}
