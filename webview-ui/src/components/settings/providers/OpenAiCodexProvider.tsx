import { openAiCodexModels } from "@shared/api"
import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAiCodexProvider component
 */
interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI Codex provider configuration component.
 * Uses OAuth with ChatGPT subscription instead of API keys.
 */
export const OpenAiCodexProvider = ({ showModelOptions, isPopup, currentMode }: OpenAiCodexProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleModeFieldChange } = useApiConfigurationHandlers()
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Check if authenticated
	const isAuthenticated = !!(
		apiConfiguration?.openAiCodexAccessToken &&
		apiConfiguration?.openAiCodexRefreshToken &&
		apiConfiguration?.openAiCodexAccountId
	)

	const handleSignIn = async () => {
		setIsLoading(true)
		setError(null)
		try {
			const result = await AccountServiceClient.codexSignIn(EmptyRequest.create())
			if (!result.success && result.error) {
				setError(result.error)
			}
		} catch (err) {
			console.error("Codex sign in failed:", err)
			setError("Failed to sign in. Please try again.")
		} finally {
			setIsLoading(false)
		}
	}

	const handleSignOut = async () => {
		setIsLoading(true)
		try {
			await AccountServiceClient.codexSignOut(EmptyRequest.create())
		} catch (err) {
			console.error("Codex sign out failed:", err)
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<div>
			<div style={{ marginBottom: "15px" }}>
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "0 0 10px" }}>
					Use your ChatGPT Plus, Pro, or Team subscription for inference. No API credits required.
				</p>

				{error && (
					<p style={{ color: "var(--vscode-errorForeground)", fontSize: "12px", margin: "0 0 10px" }}>{error}</p>
				)}

				{isAuthenticated ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "10px",
							padding: "10px",
							backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
							borderRadius: "4px",
						}}>
						<span
							style={{
								width: "8px",
								height: "8px",
								borderRadius: "50%",
								backgroundColor: "#10b981",
								flexShrink: 0,
							}}
						/>
						<span style={{ flex: 1, fontSize: "13px" }}>Connected to ChatGPT</span>
						<VSCodeButton appearance="secondary" onClick={handleSignOut} disabled={isLoading}>
							{isLoading ? "..." : "Sign Out"}
						</VSCodeButton>
					</div>
				) : (
					<VSCodeButton onClick={handleSignIn} style={{ width: "100%" }} disabled={isLoading}>
						{isLoading ? "Signing in..." : "Sign in with ChatGPT"}
					</VSCodeButton>
				)}
			</div>

			{showModelOptions && isAuthenticated && (
				<>
					<ModelSelector
						label="Model"
						models={openAiCodexModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeApiModelId", act: "actModeApiModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />

					<p
						style={{
							fontSize: "11px",
							color: "var(--vscode-descriptionForeground)",
							margin: "10px 0 0",
							fontStyle: "italic",
						}}>
						Cost: $0 (included in your ChatGPT subscription)
					</p>
				</>
			)}

			{showModelOptions && !isAuthenticated && (
				<p style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)", margin: "10px 0 0" }}>
					Sign in to select a model and start using Codex.
				</p>
			)}
		</div>
	)
}
