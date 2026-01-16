import { useState } from "react"
import { gitHubCopilotModels } from "@shared/api"
import { GitHubCopilotLoginStatus } from "@shared/proto/cline/github_copilot"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { GitHubCopilotServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface GitHubCopilotProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

export const GitHubCopilotProvider = ({ showModelOptions, isPopup, currentMode }: GitHubCopilotProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const [loginState, setLoginState] = useState<{
		isLoading: boolean
		userCode?: string
		verificationUrl?: string
		error?: string
	}>({ isLoading: false })

	// Get model info based on selected model
	const getModelInfo = () => {
		const modelId =
			currentMode === "plan"
				? apiConfiguration?.planModeGitHubCopilotModelId
				: apiConfiguration?.actModeGitHubCopilotModelId

		if (modelId && modelId in gitHubCopilotModels) {
			return {
				selectedModelId: modelId,
				selectedModelInfo: gitHubCopilotModels[modelId as keyof typeof gitHubCopilotModels],
			}
		}
		return {
			selectedModelId: "claude-sonnet-4",
			selectedModelInfo: gitHubCopilotModels["claude-sonnet-4"],
		}
	}

	const { selectedModelId, selectedModelInfo } = getModelInfo()
	const hasToken = Boolean(apiConfiguration?.gitHubCopilotAccessToken)

	const handleLogin = () => {
		setLoginState({ isLoading: true })

		const unsubscribe = GitHubCopilotServiceClient.loginWithGitHubCopilot(
			{ enterpriseUrl: apiConfiguration?.gitHubCopilotEnterpriseUrl },
			{
				onResponse: (response) => {
					if (response.status === GitHubCopilotLoginStatus.WAITING_FOR_CODE) {
						setLoginState({
							isLoading: true,
							userCode: response.userCode,
							verificationUrl: response.verificationUrl,
						})
					} else if (response.status === GitHubCopilotLoginStatus.SUCCESS) {
						setLoginState({ isLoading: false })
						unsubscribe()
					} else if (response.status === GitHubCopilotLoginStatus.FAILED) {
						setLoginState({ isLoading: false, error: response.error })
						unsubscribe()
					}
				},
				onError: (error) => {
					setLoginState({ isLoading: false, error: error.message || "Login failed" })
				},
				onComplete: () => {
					if (loginState.isLoading) {
						setLoginState((prev) => ({ ...prev, isLoading: false }))
					}
				},
			},
		)
	}

	const handleLogout = async () => {
		await GitHubCopilotServiceClient.logoutGitHubCopilot({})
		setLoginState({ isLoading: false })
	}

	return (
		<div>
			{/* Description */}
			<p
				style={{
					fontSize: "12px",
					marginBottom: "12px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Use your GitHub Copilot subscription to access AI models. Requires an active GitHub Copilot
				subscription.
			</p>

			{/* Enterprise URL (optional) - show before login */}
			{!hasToken && (
				<div style={{ marginBottom: "12px" }}>
					<label
						htmlFor="github-copilot-enterprise-url"
						style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
						GitHub Enterprise URL (Optional)
					</label>
					<VSCodeTextField
						id="github-copilot-enterprise-url"
						value={apiConfiguration?.gitHubCopilotEnterpriseUrl || ""}
						onInput={(e: any) => handleFieldChange("gitHubCopilotEnterpriseUrl", e.target.value)}
						placeholder="company.ghe.com"
						style={{ width: "100%" }}
					/>
					<p
						style={{
							fontSize: "11px",
							marginTop: "4px",
							color: "var(--vscode-descriptionForeground)",
						}}>
						Leave blank for GitHub.com. For GitHub Enterprise, enter your domain.
					</p>
				</div>
			)}

			{/* Login/Logout Button */}
			{!hasToken ? (
				<div style={{ marginBottom: "12px" }}>
					<VSCodeButton onClick={handleLogin} disabled={loginState.isLoading} style={{ width: "100%" }}>
						{loginState.isLoading ? "Authenticating..." : "Login with GitHub"}
					</VSCodeButton>

					{/* Show user code during login */}
					{loginState.userCode && (
						<div
							style={{
								marginTop: "12px",
								padding: "12px",
								backgroundColor: "var(--vscode-inputValidation-infoBackground)",
								border: "1px solid var(--vscode-inputValidation-infoBorder)",
								borderRadius: "4px",
							}}>
							<p style={{ margin: 0, marginBottom: "8px" }}>
								Enter this code at{" "}
								<a
									href={loginState.verificationUrl}
									style={{ color: "var(--vscode-textLink-foreground)" }}>
									{loginState.verificationUrl}
								</a>
								:
							</p>
							<p
								style={{
									margin: 0,
									fontSize: "24px",
									fontWeight: "bold",
									fontFamily: "monospace",
									textAlign: "center",
									letterSpacing: "4px",
								}}>
								{loginState.userCode}
							</p>
						</div>
					)}

					{/* Show error */}
					{loginState.error && (
						<div
							style={{
								marginTop: "12px",
								padding: "8px",
								backgroundColor: "var(--vscode-inputValidation-errorBackground)",
								border: "1px solid var(--vscode-inputValidation-errorBorder)",
								borderRadius: "4px",
								color: "var(--vscode-inputValidation-errorForeground)",
							}}>
							{loginState.error}
						</div>
					)}
				</div>
			) : (
				<div style={{ marginBottom: "12px" }}>
					{/* Authenticated status */}
					<div
						style={{
							marginBottom: "12px",
							padding: "8px",
							backgroundColor: "var(--vscode-inputValidation-infoBackground)",
							border: "1px solid var(--vscode-inputValidation-infoBorder)",
							borderRadius: "4px",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}>
						<span style={{ color: "var(--vscode-inputValidation-infoForeground)" }}>
							Authenticated with GitHub Copilot
						</span>
						<VSCodeButton appearance="secondary" onClick={handleLogout}>
							Logout
						</VSCodeButton>
					</div>
				</div>
			)}

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={gitHubCopilotModels}
						onChange={(e: any) =>
							handleModeFieldChange(
								{ plan: "planModeGitHubCopilotModelId", act: "actModeGitHubCopilotModelId" },
								e.target.value,
								currentMode,
							)
						}
						selectedModelId={selectedModelId}
					/>

					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
