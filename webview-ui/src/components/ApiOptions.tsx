import { ApiConfiguration } from "@shared/api"
import { VSCodeDropdown, VSCodeLink, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import React from "react"

interface ApiOptionsProps {
	apiConfiguration?: ApiConfiguration
	setApiConfiguration: React.Dispatch<React.SetStateAction<ApiConfiguration | undefined>>
}

const ApiOptions: React.FC<ApiOptionsProps> = ({ apiConfiguration, setApiConfiguration }) => {
	const handleInputChange = (field: keyof ApiConfiguration) => (event: any) => {
		setApiConfiguration((prev) => ({ ...prev, [field]: event.target.value }))
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<div className="dropdown-container">
				<label htmlFor="api-provider">
					<span style={{ fontWeight: 500 }}>API Provider</span>
				</label>
				<VSCodeDropdown
					id="api-provider"
					value={apiConfiguration?.apiProvider || "anthropic"}
					onChange={handleInputChange("apiProvider")}>
					<VSCodeOption value="anthropic">Anthropic</VSCodeOption>
					<VSCodeOption value="openrouter">OpenRouter</VSCodeOption>
					<VSCodeOption value="bedrock">AWS Bedrock</VSCodeOption>
				</VSCodeDropdown>
			</div>

			{apiConfiguration?.apiProvider === "anthropic" && (
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

			{apiConfiguration?.apiProvider === "openrouter" && (
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

			{apiConfiguration?.apiProvider === "bedrock" && (
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
							{/* Currently Claude 3.5 Sonnet is only available in us-east-1 */}
							<VSCodeOption value="us-east-1">US East (N. Virginia)</VSCodeOption>
							{/* <VSCodeOption value="us-east-2">US East (Ohio)</VSCodeOption>
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
							<VSCodeOption value="sa-east-1">South America (São Paulo)</VSCodeOption> */}
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
		</div>
	)
}

export default ApiOptions
