import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import { openAiModelInfoSaneDefaults } from "@shared/api"
import type { OpenAIUserInfo } from "@shared/proto/index.cline"
import { EmptyRequest, OpenAiModelsRequest } from "@shared/proto/index.cline"
import { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient, OpenAIAuthServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_BUTTON_BACKGROUND, VSC_BUTTON_FOREGROUND, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { parsePrice } from "../utils/pricingUtils"
import { getModeSpecificFields, normalizeApiConfiguration } from "../utils/providerUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

/**
 * Props for the OpenAIOAuthProvider component
 */
interface OpenAIOAuthProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}
function InfoCard({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<div
			className="mt-2 mb-2 flex items-start gap-3 rounded-none px-5 py-4 pb-8 border shadow-sm min-w-[40%] max-w-[90%] w-full box-border
                 bg-input-background border-input-border">
			<div className="min-w-[22px] h-[22px] flex items-center justify-center shrink-0 mt-2">{icon}</div>
			<div className="flex-1">{children}</div>
		</div>
	)
}

/**
 * Auth hook for OpenAI OAuth
 * Note: This hook assumes that OpenAIAuthService gRPC methods will be implemented
 * For now, it provides a structure for authentication UI
 */
function useOpenAIOAuth() {
	const [user, setUser] = useState<OpenAIUserInfo | null>(null)
	const [ready, setReady] = useState(false)

	const initialReceivedRef = useRef(false)
	const unmountedRef = useRef(false)

	const isAuthenticated = !!user?.uid

	const login = useCallback(async () => {
		try {
			await OpenAIAuthServiceClient.CreateAuthRequest(EmptyRequest.create())
			console.log("OpenAI OAuth login initiated")
		} catch (error) {
			console.error("OpenAI OAuth login failed:", error)
		}
	}, [])

	const logout = useCallback(async () => {
		try {
			await OpenAIAuthServiceClient.HandleDeauth(EmptyRequest.create())
			console.log("OpenAI OAuth logout initiated")
		} catch (error) {
			console.error("OpenAI OAuth logout failed:", error)
		}
	}, [])

	useEffect(() => {
		unmountedRef.current = false

		const cancel = OpenAIAuthServiceClient.SubscribeToAuthStatusUpdate(EmptyRequest.create(), {
			onResponse: (response) => {
				if (unmountedRef.current) {
					return
				}
				const nextUser = response?.user?.uid ? (response.user as OpenAIUserInfo) : null
				setUser(nextUser)
				if (!initialReceivedRef.current) {
					initialReceivedRef.current = true
					setReady(true)
				}
			},
			onError: (err: Error) => {
				if (!unmountedRef.current) {
					console.error("OpenAI OAuth subscription error:", err)
					if (!initialReceivedRef.current) {
						initialReceivedRef.current = true
						setReady(true)
					}
				}
			},
			onComplete: () => {},
		})

		return () => {
			unmountedRef.current = true
			cancel()
		}
	}, [])

	return { user, isAuthenticated, ready, login, logout }
}

/**
 * OpenAI OAuth Provider Component
 */
export function OpenAIOAuthProvider({ currentMode, isPopup, showModelOptions }: OpenAIOAuthProviderProps): JSX.Element {
	const { apiConfiguration, remoteConfigSettings } = useExtensionState()
	const { handleFieldChange, handleModeFieldChange } = useApiConfigurationHandlers()
	const { user, isAuthenticated, ready, login, logout } = useOpenAIOAuth()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	// Get the normalized configuration
	const { selectedModelId, selectedModelInfo } = normalizeApiConfiguration(apiConfiguration, currentMode)

	// Get mode-specific fields
	const { openAiOAuthModelInfo } = getModeSpecificFields(apiConfiguration, currentMode)

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const debouncedRefreshOpenAiModels = useCallback((baseUrl?: string) => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current)
		}

		if (baseUrl) {
			debounceTimerRef.current = setTimeout(() => {
				ModelsServiceClient.refreshOpenAiModels(
					OpenAiModelsRequest.create({
						baseUrl,
						apiKey: undefined,
					}),
				).catch((error) => {
					console.error("Failed to refresh OpenAI models:", error)
				})
			}, 500)
		}
	}, [])

	// Show loading state while auth status is being determined
	if (!ready) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "20px" }}>
				<VSCodeProgressRing />
			</div>
		)
	}

	const disabled = false

	return (
		<div>
			<Tooltip>
				<TooltipTrigger>
					<div className="mb-2.5">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Base URL</span>
							{remoteConfigSettings?.openAiOAuthBaseUrl !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
						<DebouncedTextField
							disabled={remoteConfigSettings?.openAiOAuthBaseUrl !== undefined}
							initialValue={apiConfiguration?.openAiOAuthBaseUrl || ""}
							onChange={(value) => {
								handleFieldChange("openAiOAuthBaseUrl", value)
								debouncedRefreshOpenAiModels(value)
							}}
							placeholder={"Enter base URL..."}
							style={{ width: "100%", marginBottom: 10 }}
							type="text"
						/>
					</div>
				</TooltipTrigger>
				<TooltipContent hidden={remoteConfigSettings?.openAiBaseUrl === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
			</Tooltip>

			{/* OAuth Configuration Fields - Where API Key used to be */}
			{isAuthenticated && user && (
				<InfoCard
					icon={
						<span
							className="codicon codicon-check"
							style={{ fontSize: "16px", color: "var(--vscode-notificationsSuccessIcon-foreground)" }}
						/>
					}>
					<p style={{ marginBottom: "4px", fontWeight: "500", fontSize: "13px" }}>
						Authenticated as {user.displayName || user.email || user.uid}
					</p>
					{user.email && (
						<p style={{ marginBottom: "12px", fontSize: "12px", color: VSC_DESCRIPTION_FOREGROUND }}>
							Email: {user.email}
						</p>
					)}
					{user.uid && (
						<p style={{ marginBottom: "12px", fontSize: "12px", color: VSC_DESCRIPTION_FOREGROUND }}>
							UID: {user.uid}
						</p>
					)}
					<VSCodeButton appearance="secondary" onClick={logout} style={{ marginTop: "8px" }}>
						<span className="codicon codicon-sign-out" style={{ marginRight: "6px" }} />
						Sign out
					</VSCodeButton>
				</InfoCard>
			)}
			{!isAuthenticated && (
				<>
					<div style={{ marginTop: "10px" }}>
						<p style={{ fontWeight: "500", marginBottom: "12px" }}>OAuth 2.0 Authentication</p>

						<div style={{ marginBottom: "12px" }}>
							<label
								htmlFor="oauth-client-id"
								style={{ fontSize: "12px", fontWeight: "500", display: "block", marginBottom: "4px" }}>
								Client ID
							</label>
							<DebouncedTextField
								disabled={disabled}
								initialValue={apiConfiguration?.openAiOAuthClientId || ""}
								onChange={(value) => handleFieldChange("openAiOAuthClientId", value)}
								placeholder="OAuth 2.0 Client ID"
								style={{ width: "100%" }}
								type="text"
							/>
							<p style={{ fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND, marginTop: "2px" }}>
								The Client ID from your OAuth provider
							</p>
						</div>

						<div style={{ marginBottom: "12px" }}>
							<label
								htmlFor="oauth-client-secret"
								style={{ fontSize: "12px", fontWeight: "500", display: "block", marginBottom: "4px" }}>
								Client Secret (Optional)
							</label>
							<DebouncedTextField
								disabled={disabled}
								initialValue={apiConfiguration?.openAiOAuthClientSecret || ""}
								onChange={(value) => handleFieldChange("openAiOAuthClientSecret", value)}
								placeholder="OAuth 2.0 Client Secret"
								style={{ width: "100%" }}
								type="text"
							/>
							<p style={{ fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND, marginTop: "2px" }}>
								The Client Secret from your OAuth provider (if required)
							</p>
						</div>

						<div style={{ marginBottom: "12px" }}>
							<label
								htmlFor="oauth-auth-url"
								style={{ fontSize: "12px", fontWeight: "500", display: "block", marginBottom: "4px" }}>
								Authorization URL
							</label>
							<DebouncedTextField
								disabled={disabled}
								initialValue={apiConfiguration?.openAiOAuthAuthUrl || ""}
								onChange={(value) => handleFieldChange("openAiOAuthAuthUrl", value)}
								placeholder="https://..."
								style={{ width: "100%" }}
								type="text"
							/>
							<p style={{ fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND, marginTop: "2px" }}>
								The authorization endpoint URL of your OAuth provider
							</p>
						</div>

						<div style={{ marginBottom: "12px" }}>
							<label
								htmlFor="oauth-token-url"
								style={{ fontSize: "12px", fontWeight: "500", display: "block", marginBottom: "4px" }}>
								Token URL
							</label>
							<DebouncedTextField
								disabled={disabled}
								initialValue={apiConfiguration?.openAiOAuthTokenUrl || ""}
								onChange={(value) => handleFieldChange("openAiOAuthTokenUrl", value)}
								placeholder="https://..."
								style={{ width: "100%" }}
								type="text"
							/>
							<p style={{ fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND, marginTop: "2px" }}>
								The token endpoint URL of your OAuth provider
							</p>
						</div>

						<div style={{ marginBottom: "12px" }}>
							<label
								htmlFor="oauth-scopes"
								style={{ fontSize: "12px", fontWeight: "500", display: "block", marginBottom: "4px" }}>
								Scopes (space-separated)
							</label>
							<DebouncedTextField
								disabled={disabled}
								initialValue={apiConfiguration?.openAiOAuthScopes || ""}
								onChange={(value) => handleFieldChange("openAiOAuthScopes", value)}
								placeholder="e.g., openid profile email"
								style={{ width: "100%" }}
								type="text"
							/>
							<p style={{ fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND, marginTop: "2px" }}>
								Space-separated list of OAuth scopes to request
							</p>
						</div>
					</div>
					<InfoCard
						icon={
							<span
								className="codicon codicon-info"
								style={{ fontSize: "16px", color: "var(--vscode-notificationsInfoIcon-foreground)" }}
							/>
						}>
						<p style={{ marginBottom: "8px", fontWeight: "500", fontSize: "13px" }}>OpenAI OAuth Authentication</p>
						<p style={{ marginBottom: "12px", fontSize: "12px", color: VSC_DESCRIPTION_FOREGROUND }}>
							Connect your OpenAI account using OAuth 2.0 for secure, token-based authentication. This provider
							requires a custom OAuth wrapper service since OpenAI doesn't currently offer native OAuth support.
						</p>
						<VSCodeButton
							onClick={login}
							style={{
								marginTop: "8px",
								backgroundColor: VSC_BUTTON_BACKGROUND,
								color: VSC_BUTTON_FOREGROUND,
							}}>
							<span className="codicon codicon-sign-in" style={{ marginRight: "6px" }} />
							Sign in with OpenAI OAuth
						</VSCodeButton>
						<div style={{ marginTop: "12px", fontSize: "11px", color: VSC_DESCRIPTION_FOREGROUND }}>
							<p style={{ marginBottom: "4px" }}>
								<strong>Note:</strong> OpenAI doesn't currently provide OAuth for API access. This provider
								requires:
							</p>
							<ul style={{ paddingLeft: "20px", marginTop: "4px" }}>
								<li>A custom OAuth wrapper service, or</li>
								<li>Waiting for official OpenAI OAuth support</li>
							</ul>
							<p style={{ marginTop: "8px" }}>
								For API key authentication, use the <VSCodeLink href="#">OpenAI Native</VSCodeLink> or{" "}
								<VSCodeLink href="#">OpenAI Compatible</VSCodeLink> provider instead.
							</p>
						</div>
					</InfoCard>
				</>
			)}

			<DebouncedTextField
				initialValue={selectedModelId || ""}
				onChange={(value) =>
					handleModeFieldChange(
						{ plan: "planModeOpenAiOAuthModelId", act: "actModeOpenAiOAuthModelId" },
						value,
						currentMode,
					)
				}
				placeholder={"Enter Model ID..."}
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headerEntries = Object.entries(apiConfiguration?.openAiHeaders ?? {})

				return (
					<div style={{ marginBottom: 10 }}>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<Tooltip>
								<TooltipTrigger>
									<div className="flex items-center gap-2">
										<span style={{ fontWeight: 500 }}>Custom Headers</span>
										{remoteConfigSettings?.openAiHeaders !== undefined && (
											<i className="codicon codicon-lock text-description text-sm" />
										)}
									</div>
								</TooltipTrigger>
								<TooltipContent hidden={remoteConfigSettings?.openAiHeaders === undefined}>
									This setting is managed by your organization's remote configuration
								</TooltipContent>
							</Tooltip>
							<VSCodeButton
								disabled={remoteConfigSettings?.openAiHeaders !== undefined}
								onClick={() => {
									const currentHeaders = { ...(apiConfiguration?.openAiHeaders || {}) }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									handleFieldChange("openAiHeaders", currentHeaders)
								}}>
								Add Header
							</VSCodeButton>
						</div>

						<div>
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={key}
										onChange={(newValue) => {
											const currentHeaders = apiConfiguration?.openAiHeaders ?? {}
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												handleFieldChange("openAiHeaders", {
													...rest,
													[newValue]: value,
												})
											}
										}}
										placeholder="Header name"
										style={{ width: "40%" }}
									/>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={value}
										onChange={(newValue) => {
											handleFieldChange("openAiHeaders", {
												...(apiConfiguration?.openAiHeaders ?? {}),
												[key]: newValue,
											})
										}}
										placeholder="Header value"
										style={{ width: "40%" }}
									/>
									<VSCodeButton
										appearance="secondary"
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										onClick={() => {
											const { [key]: _, ...rest } = apiConfiguration?.openAiHeaders ?? {}
											handleFieldChange("openAiHeaders", rest)
										}}>
										Remove
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
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
						checked={!!openAiOAuthModelInfo?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
							modelInfo.supportsImages = isChecked
							handleModeFieldChange(
								{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!openAiOAuthModelInfo?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							handleModeFieldChange(
								{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
								modelInfo,
								currentMode,
							)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiOAuthModelInfo?.contextWindow
									? openAiOAuthModelInfo.contextWindow.toString()
									: (openAiModelInfoSaneDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.contextWindow = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiOAuthModelInfo?.maxTokens
									? openAiOAuthModelInfo.maxTokens.toString()
									: (openAiModelInfoSaneDefaults.maxTokens?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.maxTokens = Number(value)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiOAuthModelInfo?.inputPrice
									? openAiOAuthModelInfo.inputPrice.toString()
									: (openAiModelInfoSaneDefaults.inputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.inputPrice = parsePrice(value, openAiModelInfoSaneDefaults.inputPrice ?? 0)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								openAiOAuthModelInfo?.outputPrice
									? openAiOAuthModelInfo.outputPrice.toString()
									: (openAiModelInfoSaneDefaults.outputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.outputPrice = parsePrice(value, openAiModelInfoSaneDefaults.outputPrice ?? 0)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								openAiOAuthModelInfo?.temperature
									? openAiOAuthModelInfo.temperature.toString()
									: (openAiModelInfoSaneDefaults.temperature?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = openAiOAuthModelInfo ? openAiOAuthModelInfo : { ...openAiModelInfoSaneDefaults }
								modelInfo.temperature = parsePrice(value, openAiModelInfoSaneDefaults.temperature ?? 0)
								handleModeFieldChange(
									{ plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
									modelInfo,
									currentMode,
								)
							}}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
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
				<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
			)}
		</div>
	)
}
