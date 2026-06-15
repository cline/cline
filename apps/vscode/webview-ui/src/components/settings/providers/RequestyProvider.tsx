import { toRequestyServiceUrl } from "@shared/clients/requesty"
import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { AccountServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import RequestyModelPicker from "../RequestyModelPicker"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the RequestyProvider component
 */
interface RequestyProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Requesty provider configuration component
 */
export const RequestyProvider = ({ showModelOptions, isPopup, currentMode }: RequestyProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { config, write } = useProviderConfig("requesty")
	const [requestyApiKey, setRequestyApiKey] = useState(apiConfiguration?.requestyApiKey || "")

	const baseUrl = config === undefined ? apiConfiguration?.requestyBaseUrl : config.baseUrl
	const apiKeyLength = config === undefined ? apiConfiguration?.requestyApiKey?.length : config.apiKeyLength
	const hasRequestyApiKey = requestyApiKey.length > 0 || (apiKeyLength ?? 0) > 0
	const resolvedUrl = toRequestyServiceUrl(baseUrl, "app")
	const apiKeyUrl = resolvedUrl != null ? new URL("api-keys", resolvedUrl).toString() : undefined
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength,
		onApiKeyChange: setRequestyApiKey,
		providerName: "Requesty",
		write,
	})

	useEffect(() => {
		setRequestyApiKey(apiConfiguration?.requestyApiKey || "")
	}, [apiConfiguration?.requestyApiKey])

	const handleBaseUrlChange = (value: string) => {
		void write({ baseUrl: value }).catch((err) => console.error("Failed to update Requesty base URL:", err))
	}

	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			<ApiKeyField
				initialValue={savedApiKeyMask}
				onChange={handleApiKeyChange}
				providerName="Requesty"
				signupUrl={apiKeyUrl}
			/>
			{!hasRequestyApiKey && (
				<VSCodeButton
					appearance="secondary"
					onClick={async () => {
						try {
							await AccountServiceClient.requestyAuthClicked(
								StringRequest.create({
									value: baseUrl || "",
								}),
							)
						} catch (error) {
							console.error("Failed to open Requesty auth:", error)
						}
					}}
					style={{ margin: "5px 0 0 0" }}>
					Get Requesty API Key
				</VSCodeButton>
			)}
			<BaseUrlField initialValue={baseUrl} onChange={handleBaseUrlChange} placeholder="Custom base URL" />
			{showModelOptions && <RequestyModelPicker baseUrl={baseUrl} currentMode={currentMode} isPopup={isPopup} />}
		</div>
	)
}
