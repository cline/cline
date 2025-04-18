import {
	VSCodeTextField,
	VSCodeRadioGroup,
	VSCodeRadio,
	VSCodeCheckbox,
	VSCodeDropdown,
	VSCodeOption,
} from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ProviderOptionsProps } from "./types/ProviderOptions"
import DropdownContainer from "../DropdownContainer"
import { OPENROUTER_MODEL_PICKER_Z_INDEX } from "../model/OpenRouterModelPicker"
import { useState } from "react"

const BedrockOptions = ({ handleInputChange }: ProviderOptionsProps) => {
	const { apiConfiguration, setApiConfiguration } = useExtensionState()
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpoint)

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: 5,
			}}>
			<VSCodeRadioGroup
				value={apiConfiguration?.awsUseProfile ? "profile" : "credentials"}
				onChange={(e) => {
					const value = (e.target as HTMLInputElement)?.value
					const useProfile = value === "profile"
					setApiConfiguration({
						...apiConfiguration,
						awsUseProfile: useProfile,
					})
				}}>
				<VSCodeRadio value="credentials">AWS Credentials</VSCodeRadio>
				<VSCodeRadio value="profile">AWS Profile</VSCodeRadio>
			</VSCodeRadioGroup>

			{apiConfiguration?.awsUseProfile ? (
				<VSCodeTextField
					value={apiConfiguration?.awsProfile || ""}
					style={{ width: "100%" }}
					onInput={handleInputChange("awsProfile")}
					placeholder="Enter profile name (default if empty)">
					<span style={{ fontWeight: 500 }}>AWS Profile Name</span>
				</VSCodeTextField>
			) : (
				<>
					<VSCodeTextField
						value={apiConfiguration?.awsAccessKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsAccessKey")}
						placeholder="Enter Access Key...">
						<span style={{ fontWeight: 500 }}>AWS Access Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSecretKey || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSecretKey")}
						placeholder="Enter Secret Key...">
						<span style={{ fontWeight: 500 }}>AWS Secret Key</span>
					</VSCodeTextField>
					<VSCodeTextField
						value={apiConfiguration?.awsSessionToken || ""}
						style={{ width: "100%" }}
						type="password"
						onInput={handleInputChange("awsSessionToken")}
						placeholder="Enter Session Token...">
						<span style={{ fontWeight: 500 }}>AWS Session Token</span>
					</VSCodeTextField>
				</>
			)}
			<DropdownContainer zIndex={OPENROUTER_MODEL_PICKER_Z_INDEX - 1} className="dropdown-container">
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
					<VSCodeOption value="us-east-1">us-east-1</VSCodeOption>
					<VSCodeOption value="us-east-2">us-east-2</VSCodeOption>
					{/* <VSCodeOption value="us-west-1">us-west-1</VSCodeOption> */}
					<VSCodeOption value="us-west-2">us-west-2</VSCodeOption>
					{/* <VSCodeOption value="af-south-1">af-south-1</VSCodeOption> */}
					{/* <VSCodeOption value="ap-east-1">ap-east-1</VSCodeOption> */}
					<VSCodeOption value="ap-south-1">ap-south-1</VSCodeOption>
					<VSCodeOption value="ap-northeast-1">ap-northeast-1</VSCodeOption>
					<VSCodeOption value="ap-northeast-2">ap-northeast-2</VSCodeOption>
					<VSCodeOption value="ap-northeast-3">ap-northeast-3</VSCodeOption>
					<VSCodeOption value="ap-southeast-1">ap-southeast-1</VSCodeOption>
					<VSCodeOption value="ap-southeast-2">ap-southeast-2</VSCodeOption>
					<VSCodeOption value="ca-central-1">ca-central-1</VSCodeOption>
					<VSCodeOption value="eu-central-1">eu-central-1</VSCodeOption>
					<VSCodeOption value="eu-central-2">eu-central-2</VSCodeOption>
					<VSCodeOption value="eu-west-1">eu-west-1</VSCodeOption>
					<VSCodeOption value="eu-west-2">eu-west-2</VSCodeOption>
					<VSCodeOption value="eu-west-3">eu-west-3</VSCodeOption>
					<VSCodeOption value="eu-north-1">eu-north-1</VSCodeOption>
					{/* <VSCodeOption value="me-south-1">me-south-1</VSCodeOption> */}
					<VSCodeOption value="sa-east-1">sa-east-1</VSCodeOption>
					<VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption>
					<VSCodeOption value="us-gov-west-1">us-gov-west-1</VSCodeOption>
					{/* <VSCodeOption value="us-gov-east-1">us-gov-east-1</VSCodeOption> */}
				</VSCodeDropdown>
			</DropdownContainer>

			<div style={{ display: "flex", flexDirection: "column" }}>
				<VSCodeCheckbox
					checked={awsEndpointSelected}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setAwsEndpointSelected(isChecked)
						if (!isChecked) {
							setApiConfiguration({
								...apiConfiguration,
								awsBedrockEndpoint: "",
							})
						}
					}}>
					Use custom VPC endpoint
				</VSCodeCheckbox>

				{awsEndpointSelected && (
					<VSCodeTextField
						value={apiConfiguration?.awsBedrockEndpoint || ""}
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
						onInput={handleInputChange("awsBedrockEndpoint")}
						placeholder="Enter VPC Endpoint URL (optional)"
					/>
				)}

				<VSCodeCheckbox
					checked={apiConfiguration?.awsUseCrossRegionInference || false}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setApiConfiguration({
							...apiConfiguration,
							awsUseCrossRegionInference: isChecked,
						})
					}}>
					Use cross-region inference
				</VSCodeCheckbox>

				<VSCodeCheckbox
					checked={apiConfiguration?.awsBedrockUsePromptCache || false}
					onChange={(e: any) => {
						const isChecked = e.target.checked === true
						setApiConfiguration({
							...apiConfiguration,
							awsBedrockUsePromptCache: isChecked,
						})
					}}>
					Use prompt caching
				</VSCodeCheckbox>
			</div>
			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				{apiConfiguration?.awsUseProfile ? (
					<>
						Using AWS Profile credentials from ~/.aws/credentials. Leave profile name empty to use the default
						profile. These credentials are only used locally to make API requests from this extension.
					</>
				) : (
					<>
						Authenticate by either providing the keys above or use the default AWS credential providers, i.e.
						~/.aws/credentials or environment variables. These credentials are only used locally to make API requests
						from this extension.
					</>
				)}
			</p>
		</div>
	)
}

export default BedrockOptions
