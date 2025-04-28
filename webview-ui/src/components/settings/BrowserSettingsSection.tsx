import React, { useState, useEffect, useCallback } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import styled from "styled-components"
import { BrowserServiceClient } from "../../services/grpc-client"

const ConnectionStatusIndicator = ({
	isChecking,
	isConnected,
	remoteBrowserEnabled,
}: {
	isChecking: boolean
	isConnected: boolean | null
	remoteBrowserEnabled?: boolean
}) => {
	if (!remoteBrowserEnabled) return null

	return (
		<StatusContainer>
			{isChecking ? (
				<>
					<Spinner />
					<StatusText>Checking connection...</StatusText>
				</>
			) : isConnected === true ? (
				<>
					<CheckIcon className="codicon codicon-check" />
					<StatusText style={{ color: "var(--vscode-terminal-ansiGreen)" }}>Connected</StatusText>
				</>
			) : isConnected === false ? (
				<StatusText style={{ color: "var(--vscode-errorForeground)" }}>Not connected</StatusText>
			) : null}
		</StatusContainer>
	)
}

export const BrowserSettingsSection: React.FC = () => {
	const { browserSettings } = useExtensionState()
	const [isCheckingConnection, setIsCheckingConnection] = useState(false)
	const [connectionStatus, setConnectionStatus] = useState<boolean | null>(null)
	const [relaunchResult, setRelaunchResult] = useState<{ success: boolean; message: string } | null>(null)
	const [debugMode, setDebugMode] = useState(false)
	const [isBundled, setIsBundled] = useState(false)
	const [detectedChromePath, setDetectedChromePath] = useState<string | null>(null)

	// Listen for browser connection test results and relaunch results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "browserConnectionResult") {
				setConnectionStatus(message.success)
				setIsCheckingConnection(false)
			} else if (message.type === "browserRelaunchResult") {
				setRelaunchResult({
					success: message.success,
					message: message.text,
				})
				setDebugMode(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Auto-clear relaunch result message after 15 seconds
	useEffect(() => {
		if (relaunchResult) {
			const timer = setTimeout(() => {
				setRelaunchResult(null)
			}, 15000)

			// Clear timeout if component unmounts or relaunchResult changes
			return () => clearTimeout(timer)
		}
	}, [relaunchResult])

	// Request detected Chrome path on mount
	useEffect(() => {
		// Use gRPC for getDetectedChromePath
		BrowserServiceClient.getDetectedChromePath({})
			.then((result) => {
				setDetectedChromePath(result.path)
				setIsBundled(result.isBundled)
			})
			.catch((error) => {
				console.error("Error getting detected Chrome path:", error)
			})
	}, [])

	// Debounced connection check function
	const debouncedCheckConnection = useCallback(
		debounce(() => {
			if (browserSettings.remoteBrowserEnabled) {
				setIsCheckingConnection(true)
				setConnectionStatus(null)
				if (browserSettings.remoteBrowserHost) {
					// Use gRPC for testBrowserConnection
					BrowserServiceClient.testBrowserConnection({ value: browserSettings.remoteBrowserHost })
						.then((result) => {
							setConnectionStatus(result.success)
							setIsCheckingConnection(false)
						})
						.catch((error) => {
							console.error("Error testing browser connection:", error)
							setConnectionStatus(false)
							setIsCheckingConnection(false)
						})
				} else {
					BrowserServiceClient.discoverBrowser({})
						.then((result) => {
							setConnectionStatus(result.success)
							setIsCheckingConnection(false)
						})
						.catch((error) => {
							console.error("Error discovering browser:", error)
							setConnectionStatus(false)
							setIsCheckingConnection(false)
						})
				}
			}
		}, 1000),
		[browserSettings.remoteBrowserEnabled, browserSettings.remoteBrowserHost],
	)

	// Check connection when component mounts or when remote settings change
	useEffect(() => {
		if (browserSettings.remoteBrowserEnabled) {
			debouncedCheckConnection()
		} else {
			setConnectionStatus(null)
		}
	}, [browserSettings.remoteBrowserEnabled, browserSettings.remoteBrowserHost, debouncedCheckConnection])

	const handleViewportChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const selectedSize = BROWSER_VIEWPORT_PRESETS[target.value as keyof typeof BROWSER_VIEWPORT_PRESETS]
		if (selectedSize) {
			BrowserServiceClient.updateBrowserSettings({
				metadata: {},
				viewport: {
					width: selectedSize.width,
					height: selectedSize.height,
				},
				remoteBrowserEnabled: browserSettings.remoteBrowserEnabled,
				remoteBrowserHost: browserSettings.remoteBrowserHost,
			})
				.then((response) => {
					if (!response.value) {
						console.error("Failed to update browser settings")
					}
				})
				.catch((error) => {
					console.error("Error updating browser settings:", error)
				})
		}
	}

	const updateRemoteBrowserEnabled = (enabled: boolean) => {
		BrowserServiceClient.updateBrowserSettings({
			metadata: {},
			viewport: {
				width: browserSettings.viewport.width,
				height: browserSettings.viewport.height,
			},
			remoteBrowserEnabled: enabled,
			// If disabling, also clear the host
			remoteBrowserHost: enabled ? browserSettings.remoteBrowserHost : undefined,
		})
			.then((response) => {
				if (!response.value) {
					console.error("Failed to update browser settings")
				}
			})
			.catch((error) => {
				console.error("Error updating browser settings:", error)
			})
	}

	const updateRemoteBrowserHost = (host: string | undefined) => {
		BrowserServiceClient.updateBrowserSettings({
			metadata: {},
			viewport: {
				width: browserSettings.viewport.width,
				height: browserSettings.viewport.height,
			},
			remoteBrowserEnabled: browserSettings.remoteBrowserEnabled,
			remoteBrowserHost: host,
		})
			.then((response) => {
				if (!response.value) {
					console.error("Failed to update browser settings")
				}
			})
			.catch((error) => {
				console.error("Error updating browser settings:", error)
			})
	}

	// Function to check connection once without changing UI state immediately
	const checkConnectionOnce = useCallback(() => {
		// Don't show the spinner for every check to avoid UI flicker
		// We'll rely on the response to update the connectionStatus
		if (browserSettings.remoteBrowserHost) {
			// Use gRPC for testBrowserConnection
			BrowserServiceClient.testBrowserConnection({ value: browserSettings.remoteBrowserHost })
				.then((result) => {
					setConnectionStatus(result.success)
				})
				.catch((error) => {
					console.error("Error testing browser connection:", error)
					setConnectionStatus(false)
				})
		} else {
			BrowserServiceClient.discoverBrowser({})
				.then((result) => {
					setConnectionStatus(result.success)
				})
				.catch((error) => {
					console.error("Error discovering browser:", error)
					setConnectionStatus(false)
				})
		}
	}, [browserSettings.remoteBrowserHost])

	// Setup continuous polling for connection status when remote browser is enabled
	useEffect(() => {
		// Only poll if remote browser mode is enabled
		if (!browserSettings.remoteBrowserEnabled) {
			// Make sure we're not showing checking state when disabled
			setIsCheckingConnection(false)
			return
		}

		// Check immediately when enabled
		checkConnectionOnce()

		// Then check every second
		const pollInterval = setInterval(() => {
			checkConnectionOnce()
		}, 1000)

		// Cleanup the interval if the component unmounts or remote browser is disabled
		return () => clearInterval(pollInterval)
	}, [browserSettings.remoteBrowserEnabled, checkConnectionOnce])

	const relaunchChromeDebugMode = () => {
		setDebugMode(true)
		setRelaunchResult(null)
		// The connection status will be automatically updated by our polling

		vscode.postMessage({
			type: "relaunchChromeDebugMode",
		})
	}

	// Determine if we should show the relaunch button
	const isRemoteEnabled = Boolean(browserSettings.remoteBrowserEnabled)
	const shouldShowRelaunchButton = isRemoteEnabled && connectionStatus === false

	return (
		<div
			id="browser-settings-section"
			style={{ marginBottom: 20, borderTop: "1px solid var(--vscode-panel-border)", paddingTop: 15 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 10px 0", fontSize: "14px" }}>Browser Settings</h3>
			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Viewport size</label>
					<VSCodeDropdown
						style={{ width: "100%" }}
						value={
							Object.entries(BROWSER_VIEWPORT_PRESETS).find(([_, size]) => {
								const typedSize = size as { width: number; height: number }
								return (
									typedSize.width === browserSettings.viewport.width &&
									typedSize.height === browserSettings.viewport.height
								)
							})?.[0]
						}
						onChange={(event) => handleViewportChange(event as Event)}>
						{Object.entries(BROWSER_VIEWPORT_PRESETS).map(([name]) => (
							<VSCodeOption key={name} value={name}>
								{name}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</div>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						margin: 0,
					}}>
					Set the size of the browser viewport for screenshots and interactions.
				</p>
			</div>

			<div style={{ marginBottom: 0 }}>
				<div style={{ marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<VSCodeCheckbox
						checked={browserSettings.remoteBrowserEnabled}
						onChange={(e) => updateRemoteBrowserEnabled((e.target as HTMLInputElement).checked)}>
						Use remote browser connection
					</VSCodeCheckbox>
					<ConnectionStatusIndicator
						isChecking={isCheckingConnection}
						isConnected={connectionStatus}
						remoteBrowserEnabled={browserSettings.remoteBrowserEnabled}
					/>
				</div>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						margin: "0 0 6px 0px",
					}}>
					Enable Cline to use your Chrome
					{isBundled ? "(not detected on your machine)" : detectedChromePath ? ` (${detectedChromePath})` : ""}. This
					requires starting Chrome in debug mode
					{browserSettings.remoteBrowserEnabled ? (
						<>
							{" "}
							manually (<code>--remote-debugging-port=9222</code>) or using the button below. Enter the host address
							or leave it blank for automatic discovery.
						</>
					) : (
						"."
					)}
				</p>

				{browserSettings.remoteBrowserEnabled && (
					<div style={{ marginLeft: 0 }}>
						<VSCodeTextField
							value={browserSettings.remoteBrowserHost || ""}
							placeholder="http://localhost:9222"
							style={{ width: "100%", marginBottom: 8 }}
							onChange={(e: any) => updateRemoteBrowserHost(e.target.value || undefined)}
						/>

						{shouldShowRelaunchButton && (
							<div style={{ display: "flex", gap: "10px", marginBottom: 8, justifyContent: "center" }}>
								<VSCodeButton style={{ flex: 1 }} disabled={debugMode} onClick={relaunchChromeDebugMode}>
									{debugMode ? "Relaunching Browser..." : "Relaunch Browser with Debug Mode"}
								</VSCodeButton>
							</div>
						)}

						{relaunchResult && (
							<div
								style={{
									padding: "8px",
									marginBottom: "8px",
									backgroundColor: relaunchResult.success ? "rgba(0, 128, 0, 0.1)" : "rgba(255, 0, 0, 0.1)",
									color: relaunchResult.success
										? "var(--vscode-terminal-ansiGreen)"
										: "var(--vscode-terminal-ansiRed)",
									borderRadius: "3px",
									fontSize: "11px",
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
								}}>
								{relaunchResult.message}
							</div>
						)}

						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								margin: 0,
							}}></p>
					</div>
				)}
			</div>
		</div>
	)
}

const StatusContainer = styled.div`
	display: flex;
	align-items: center;
	margin-left: 12px;
	height: 20px;
`

const StatusText = styled.span`
	font-size: 12px;
	margin-left: 4px;
`

const CheckIcon = styled.i`
	color: var(--vscode-terminal-ansiGreen);
	font-size: 14px;
`

const Spinner = styled.div`
	width: 14px;
	height: 14px;
	border: 2px solid rgba(255, 255, 255, 0.3);
	border-radius: 50%;
	border-top-color: var(--vscode-progressBar-background);
	animation: spin 1s ease-in-out infinite;

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
`

export default BrowserSettingsSection
