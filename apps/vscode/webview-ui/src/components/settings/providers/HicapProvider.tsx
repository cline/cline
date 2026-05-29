import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import HicapModelPicker from "../HicapModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the HicapProvider component
 */
interface HicapProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Hicap provider configuration component
 */
export const HicapProvider = ({ showModelOptions, isPopup, currentMode }: HicapProviderProps) => {
	const { apiConfiguration, refreshHicapModels } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	useEffect(() => {
		if (apiConfiguration?.hicapApiKey && apiConfiguration?.hicapApiKey.length === 32) {
			refreshHicapModels()
		}
	}, [apiConfiguration?.hicapApiKey])

	return (
		<div>
			<div>
				<DebouncedTextField
					initialValue={apiConfiguration?.hicapApiKey || ""}
					onChange={(value) => {
						handleFieldChange("hicapApiKey", value)
						if (value.length === 32) {
							refreshHicapModels()
						}
					}}
					placeholder="Enter API Key..."
					style={{ width: "100%" }}
					type="password">
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							width: "100%",
							margin: "10px 0 0 0",
						}}>
						<span style={{ fontWeight: 500 }}>Hicap API Key</span>
					</div>
				</DebouncedTextField>

				{!apiConfiguration?.hicapApiKey && (
					<VSCodeButton
						appearance="secondary"
						onClick={async () => {
							try {
								await AccountServiceClient.hicapAuthClicked(EmptyRequest.create())
							} catch (error) {
								console.error("Failed to open Hicap auth:", error)
							}
						}}
						style={{ margin: "5px 0 0 0" }}>
						Generate API Key
					</VSCodeButton>
				)}
			</div>

			{showModelOptions && (
				<div style={{ margin: "10px 0 0 0" }}>
					<HicapModelPicker currentMode={currentMode} isPopup={isPopup} />
				</div>
			)}
		</div>
	)
}
