import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useMount } from "react-use"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAvalaiCreditInfo } from "../../ui/hooks/useAvalaiCreditInfo"
import AvalaiModelPicker from "../AvalaiModelPicker"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Component to display AvalAI credit balance information
 */
const AvalaiCreditDisplay = ({ apiKey }: { apiKey: string }) => {
	const { data: creditInfo, isLoading, error } = useAvalaiCreditInfo(apiKey)

	if (isLoading) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>Verifying API key...</span>
	}

	if (error || !creditInfo) {
		return <span style={{ fontSize: "12px", color: "var(--vscode-errorForeground)" }}>⚠️ Invalid API key</span>
	}

	// Format the credit balance
	const formattedCredit = `$${creditInfo.remaining_unit.toFixed(2)}`

	return (
		<VSCodeLink
			href="https://chat.avalai.ir/platform/billing/credit"
			style={{
				fontSize: "12px",
				color: "var(--vscode-foreground)",
				textDecoration: "none",
				fontWeight: 500,
				paddingLeft: 4,
				cursor: "pointer",
			}}
			title={`Total Credit: $${creditInfo.total_unit.toFixed(2)}\nRemaining: ${formattedCredit}\nExchange Rate: ${creditInfo.exchange_rate.toLocaleString()} IRT/$`}>
			✓ Balance: {formattedCredit}
		</VSCodeLink>
	)
}

/**
 * Props for the AvalaiProvider component
 */
interface AvalaiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The AvalAI provider configuration component
 */
export const AvalaiProvider = ({ showModelOptions, isPopup, currentMode }: AvalaiProviderProps) => {
	const { apiConfiguration, refreshAvalaiModels } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	// Load models on mount since the public API doesn't require authentication
	useMount(() => {
		refreshAvalaiModels()
	})

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.avalaiApiKey || ""}
					onChange={(value) => {
						handleFieldChange("avalaiApiKey", value)
					}}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
						<span style={{ fontWeight: 500 }}>AvalAI API Key</span>
						{apiConfiguration?.avalaiApiKey && <AvalaiCreditDisplay apiKey={apiConfiguration.avalaiApiKey} />}
					</div>
				</DebouncedTextField>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					This key is stored locally and only used to make API requests from this extension. Get your API key from{" "}
					<VSCodeLink href="https://docs.avalai.ir/en/quickstart" style={{ display: "inline", fontSize: "inherit" }}>
						AvalAI
					</VSCodeLink>
					{apiConfiguration?.avalaiApiKey && (
						<>
							{" • "}
							<VSCodeLink
								href="https://chat.avalai.ir/platform/billing/credit"
								style={{ display: "inline", fontSize: "inherit" }}>
								Top up credit
							</VSCodeLink>
						</>
					)}
				</p>
			</div>

			{showModelOptions && (
				<div style={{ margin: "10px 0 0 0" }}>
					<AvalaiModelPicker currentMode={currentMode} isPopup={isPopup} />
				</div>
			)}
		</div>
	)
}
