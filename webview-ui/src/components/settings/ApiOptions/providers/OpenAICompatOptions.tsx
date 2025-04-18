import { VSCodeCheckbox, VSCodeTextField, VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { openAiModelInfoSaneDefaults, azureOpenAiDefaultApiVersion } from "@shared/api"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ProviderOptionsProps } from "./types/ProviderOptions"

const OpenAICompatOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [azureApiVersionSelected, setAzureApiVersionSelected] = useState(!!apiConfiguration?.azureApiVersion)
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	return (
		<div>
			<VSCodeTextField
				value={apiConfiguration?.openAiBaseUrl || ""}
				style={{ width: "100%", marginBottom: 10 }}
				type="url"
				onInput={handleInputChange("openAiBaseUrl")}
				placeholder={"Enter base URL..."}>
				<span style={{ fontWeight: 500 }}>Base URL</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.openAiApiKey || ""}
				style={{ width: "100%", marginBottom: 10 }}
				type="password"
				onInput={handleInputChange("openAiApiKey")}
				placeholder="Enter API Key...">
				<span style={{ fontWeight: 500 }}>API Key</span>
			</VSCodeTextField>
			<VSCodeTextField
				value={apiConfiguration?.openAiModelId || ""}
				style={{ width: "100%", marginBottom: 10 }}
				onInput={handleInputChange("openAiModelId")}
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
									handleInputChange("openAiHeaders")({
										target: {
											value: currentHeaders,
										},
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
											const currentHeaders = apiConfiguration?.openAiHeaders ?? {}
											const newValue = e.target.value
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												handleInputChange("openAiHeaders")({
													target: {
														value: {
															...rest,
															[newValue]: value,
														},
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
											handleInputChange("openAiHeaders")({
												target: {
													value: {
														...(apiConfiguration?.openAiHeaders ?? {}),
														[key]: e.target.value,
													},
												},
											})
										}}
									/>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
											handleInputChange("openAiHeaders")({
												target: {
													value: rest,
												},
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

			<VSCodeCheckbox
				checked={azureApiVersionSelected}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					setAzureApiVersionSelected(isChecked)
					if (!isChecked) {
						setApiConfiguration({
							...apiConfiguration,
							azureApiVersion: "",
						})
					}
				}}>
				Set Azure API version
			</VSCodeCheckbox>
			{azureApiVersionSelected && (
				<VSCodeTextField
					value={apiConfiguration?.azureApiVersion || ""}
					style={{ width: "100%", marginTop: 3 }}
					onInput={handleInputChange("azureApiVersion")}
					placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
				/>
			)}
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
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							setApiConfiguration({
								...apiConfiguration,
								openAiModelInfo: modelInfo,
							})
						}}>
						Supports Images
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.supportsComputerUse}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo = { ...modelInfo, supportsComputerUse: isChecked }
							setApiConfiguration({
								...apiConfiguration,
								openAiModelInfo: modelInfo,
							})
						}}>
						Supports Computer Use
					</VSCodeCheckbox>
					<VSCodeCheckbox
						checked={!!apiConfiguration?.openAiModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = apiConfiguration?.openAiModelInfo
								? apiConfiguration.openAiModelInfo
								: { ...openAiModelInfoSaneDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							setApiConfiguration({
								...apiConfiguration,
								openAiModelInfo: modelInfo,
							})
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.contextWindow
									? apiConfiguration.openAiModelInfo.contextWindow.toString()
									: openAiModelInfoSaneDefaults.contextWindow?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(input.target.value)
								setApiConfiguration({
									...apiConfiguration,
									openAiModelInfo: modelInfo,
								})
							}}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</VSCodeTextField>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.maxTokens
									? apiConfiguration.openAiModelInfo.maxTokens.toString()
									: openAiModelInfoSaneDefaults.maxTokens?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.maxTokens = input.target.value
								setApiConfiguration({
									...apiConfiguration,
									openAiModelInfo: modelInfo,
								})
							}}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</VSCodeTextField>
					</div>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.inputPrice
									? apiConfiguration.openAiModelInfo.inputPrice.toString()
									: openAiModelInfoSaneDefaults.inputPrice?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.inputPrice = input.target.value
								setApiConfiguration({
									...apiConfiguration,
									openAiModelInfo: modelInfo,
								})
							}}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</VSCodeTextField>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.outputPrice
									? apiConfiguration.openAiModelInfo.outputPrice.toString()
									: openAiModelInfoSaneDefaults.outputPrice?.toString()
							}
							style={{ flex: 1 }}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }
								modelInfo.outputPrice = input.target.value
								setApiConfiguration({
									...apiConfiguration,
									openAiModelInfo: modelInfo,
								})
							}}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</VSCodeTextField>
					</div>
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<VSCodeTextField
							value={
								apiConfiguration?.openAiModelInfo?.temperature
									? apiConfiguration.openAiModelInfo.temperature.toString()
									: openAiModelInfoSaneDefaults.temperature?.toString()
							}
							onInput={(input: any) => {
								const modelInfo = apiConfiguration?.openAiModelInfo
									? apiConfiguration.openAiModelInfo
									: { ...openAiModelInfoSaneDefaults }

								// Check if the input ends with a decimal point or has trailing zeros after decimal
								const value = input.target.value
								const shouldPreserveFormat = value.endsWith(".") || (value.includes(".") && value.endsWith("0"))

								modelInfo.temperature =
									value === ""
										? openAiModelInfoSaneDefaults.temperature
										: shouldPreserveFormat
											? value // Keep as string to preserve decimal format
											: parseFloat(value)

								setApiConfiguration({
									...apiConfiguration,
									openAiModelInfo: modelInfo,
								})
							}}>
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
		</div>
	)
}

export default OpenAICompatOptions
