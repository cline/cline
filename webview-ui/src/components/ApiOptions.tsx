import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React, { useMemo } from "react"
import {
	ApiConfiguration,
	ApiModelId,
	ModelInfo,
	anthropicDefaultModelId,
	anthropicModels,
	bedrockDefaultModelId,
	bedrockModels,
	openRouterDefaultModelId,
	openRouterModels,
} from "../../../src/shared/api"

interface ApiOptionsProps {
	showModelOptions: boolean
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
}

const ApiOptions: React.FC<ApiOptionsProps> = ({ showModelOptions, apiConfiguration, setApiConfiguration }) => {
	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		setApiConfiguration((prev) => ({ ...prev, [field]: event.target.value }))
	}

	const { selectedProvider, selectedModelId, selectedModelInfo } = useMemo(() => {
		return normalizeApiConfiguration(apiConfiguration)
	}, [apiConfiguration])

	/*
	VSCodeDropdown has an open bug where dynamically rendered options don't auto select the provided value prop. You can see this for yourself by comparing  it with normal select/option elements, which work as expected.
	https://github.com/microsoft/vscode-webview-ui-toolkit/issues/433

	In our case, when the user switches between providers, we recalculate the selectedModelId depending on the provider, the default model for that provider, and a modelId that the user may have selected. Unfortunately, the VSCodeDropdown component wouldn't select this calculated value, and would default to the first "Select a model..." option instead, which makes it seem like the model was cleared out when it wasn't. 

	As a workaround, we create separate instances of the dropdown for each provider, and then conditionally render the one that matches the current provider.
	*/
	const createDropdown = (models: Record<string, ModelInfo>) => {
		return (
			<VSCodeDropdown
				id="model-id"
				value={selectedModelId}
				onChange={handleInputChange("apiModelId")}
				style={{ width: "100%" }}>
				<VSCodeOption value="">Select a model...</VSCodeOption>
				{Object.keys(models).map((modelId) => (
					<VSCodeOption
						key={modelId}
						value={modelId}
						style={{
							whiteSpace: "normal",
							wordWrap: "break-word",
							maxWidth: "100%",
						}}>
						{modelId}
					</VSCodeOption>
				))}
			</VSCodeDropdown>
		)
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API Provider</span>
				</label>
				<VSCodeDropdown id="api-provider" value={selectedProvider} onChange={handleInputChange("apiProvider")}>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="bedrock">AWS Bedrock</VSCodeOption>
				</VSCodeDropdown>
			</div>

			{selectedProvider === "anthropic" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.apiKey || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("apiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>Anthropic API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						<VSCodeLink href="https://console.anthropic.com/" style={{ display: "inline" }}>
							You can get an Anthropic API key by signing up here.
						</VSCodeLink>
					</p>
				</div>
			)}

			{selectedProvider === "openrouter" && (
				<div>
					<VSCodeTextField
						value={apiConfiguration?.openRouterApiKey || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("openRouterApiKey")}
						placeholder="Enter API Key...">
						<span style={{ fontWeight: 500 }}>OpenRouter API Key</span>
					</VSCodeTextField>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						This key is stored locally and only used to make API requests from this extension.
						<VSCodeLink href="https://openrouter.ai/" style={{ display: "inline" }}>
							You can get an OpenRouter API key by signing up here.
						</VSCodeLink>
					</p>
				</div>
			)}

			{selectedProvider === "bedrock" && (
				<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
					<VSCodeTextField
						value={apiConfiguration?.awsAccessKey || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("awsAccessKey")}
						placeholder="Enter Access Key...">
						<span style={{ fontWeight: 500 }}>AWS Access Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSecretKey || ""}
						style={{ width: "100%" }}
						onInput={handleInputChange("awsSecretKey")}
						placeholder="Enter Secret Key...">
						<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
					</VSCodeTextField>
					<div className="dropdown-container">
						<label htmlFor="aws-region-dropdown">
							<span style={{ fontWeight: 500 }}>AWS Region</span>
						</label>
						<VSCodeDropdown
							id="aws-region-dropdown"
							value={apiConfiguration?.awsRegion || ""}
							style={{ width: "100%" }}
							onChange={handleInputChange("awsRegion")}>
							<VSCodeOption value="">Select a region...</VSCodeOption>
							{/* The user will have to choose a region that supports the model they use, but this shouldn't be a problem since they'd have to request access for it in that region in the first place. */}
							<VSCodeOption value="us-east-1">US East (N. Virginia)</VSCodeOption>
							<VSCodeOption value="us-east-2">US East (Ohio)</VSCodeOption>
							<VSCodeOption value="us-west-1">US West (N. California)</VSCodeOption>
							<VSCodeOption value="us-west-2">US West (Oregon)</VSCodeOption>
							<VSCodeOption value="af-south-1">Africa (Cape Town)</VSCodeOption>
							<VSCodeOption value="ap-east-1">Asia Pacific (Hong Kong)</VSCodeOption>
							<VSCodeOption value="ap-south-1">Asia Pacific (Mumbai)</VSCodeOption>
							<VSCodeOption value="ap-northeast-1">Asia Pacific (Tokyo)</VSCodeOption>
							<VSCodeOption value="ap-northeast-2">Asia Pacific (Seoul)</VSCodeOption>
							<VSCodeOption value="ap-northeast-3">Asia Pacific (Osaka)</VSCodeOption>
							<VSCodeOption value="ap-southeast-1">Asia Pacific (Singapore)</VSCodeOption>
							<VSCodeOption value="ap-southeast-2">Asia Pacific (Sydney)</VSCodeOption>
							<VSCodeOption value="ca-central-1">Canada (Central)</VSCodeOption>
							<VSCodeOption value="eu-central-1">Europe (Frankfurt)</VSCodeOption>
							<VSCodeOption value="eu-west-1">Europe (Ireland)</VSCodeOption>
							<VSCodeOption value="eu-west-2">Europe (London)</VSCodeOption>
							<VSCodeOption value="eu-west-3">Europe (Paris)</VSCodeOption>
							<VSCodeOption value="eu-north-1">Europe (Stockholm)</VSCodeOption>
							<VSCodeOption value="me-south-1">Middle East (Bahrain)</VSCodeOption>
							<VSCodeOption value="sa-east-1">South America (São Paulo)</VSCodeOption>
						</VSCodeDropdown>
					</div>
					<p
						style={{
							fontSize: "12px",
							marginTop: "5px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						These credentials are stored locally and only used to make API requests from this extension.
						<VSCodeLink
							href="https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html"
							style={{ display: "inline" }}>
							You can find your AWS access key and secret key here.
						</VSCodeLink>
					</p>
				</div>
			)}

			{showModelOptions && (
				<>
					<div className="dropdown-container">
						<label htmlFor="model-id">
							<span style={{ fontWeight: 500 }}>Model</span>
						</label>
						{selectedProvider === "anthropic" && createDropdown(anthropicModels)}
						{selectedProvider === "openrouter" && createDropdown(openRouterModels)}
						{selectedProvider === "bedrock" && createDropdown(bedrockModels)}
					</div>

					<ModelInfoView modelInfo={selectedModelInfo} />
				</>
			)}
		</div>
	)
}

const ModelInfoView = ({ modelInfo }: { modelInfo: ModelInfo }) => {
	const formatPrice = (price: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(price)
	}

	return (
		<p style={{ fontSize: "12px", marginTop: "2px", color: "var(--vscode-descriptionForeground)" }}>
			<span
				style={{
					fontWeight: 500,
					color: modelInfo.supportsImages
						? "var(--vscode-testing-iconPassed)"
						: "var(--vscode-errorForeground)",
				}}>
				<i
					className={`codicon codicon-${modelInfo.supportsImages ? "check" : "x"}`}
					style={{
						marginRight: 4,
						marginBottom: modelInfo.supportsImages ? 1 : -1,
						fontSize: modelInfo.supportsImages ? 11 : 13,
						fontWeight: 700,
						display: "inline-block",
						verticalAlign: "bottom",
					}}></i>
				{modelInfo.supportsImages ? "Supports images" : "Does not support images"}
			</span>
			<br />
			<span style={{ fontWeight: 500 }}>Max output:</span> {modelInfo.maxTokens.toLocaleString()} tokens
			<br />
			<span style={{ fontWeight: 500 }}>Input price:</span> {formatPrice(modelInfo.inputPrice)} per million tokens
			<br />
			<span style={{ fontWeight: 500 }}>Output price:</span> {formatPrice(modelInfo.outputPrice)} per million
			tokens
		</p>
	)
}

export function normalizeApiConfiguration(apiConfiguration?: ApiConfiguration) {
	const provider = apiConfiguration?.apiProvider || "anthropic"
	const modelId = apiConfiguration?.apiModelId

	const getProviderData = (models: Record<string, ModelInfo>, defaultId: ApiModelId) => {
		let selectedModelId: ApiModelId
		let selectedModelInfo: ModelInfo
		if (modelId && modelId in models) {
			selectedModelId = modelId
			selectedModelInfo = models[modelId]
		} else {
			selectedModelId = defaultId
			selectedModelInfo = models[defaultId]
		}
		return { selectedProvider: provider, selectedModelId, selectedModelInfo }
	}
	switch (provider) {
		case "anthropic":
			return getProviderData(anthropicModels, anthropicDefaultModelId)
		case "openrouter":
			return getProviderData(openRouterModels, openRouterDefaultModelId)
		case "bedrock":
			return getProviderData(bedrockModels, bedrockDefaultModelId)
	}
}

export default ApiOptions
