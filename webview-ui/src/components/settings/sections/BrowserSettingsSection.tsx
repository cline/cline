import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useState } from "react"
import styled from "styled-components"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { BrowserServiceClient } from "../../../services/grpc-client"
import CollapsibleContent from "../CollapsibleContent"
import { DebouncedTextField } from "../common/DebouncedTextField"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface BrowserSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const ConnectionStatusIndicator = ({
	isChecking,
	isConnected,
	remoteBrowserEnabled,
}: {
	isChecking: boolean
	isConnected: boolean | null
	remoteBrowserEnabled?: boolean
}) => {
	if (!remoteBrowserEnabled) {
		return null
	}

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

export const BrowserSettingsSection: React.FC<BrowserSettingsSectionProps> = ({ renderSectionHeader }) => {
	const { browserSettings } = useExtensionState()
	const [isCheckingConnection, setIsCheckingConnection] = useState(false)
	const [connectionStatus, setConnectionStatus] = useState<boolean | null>(null)
	const [relaunchResult, setRelaunchResult] = useState<{ success: boolean; message: string } | null>(null)
	const [debugMode, setDebugMode] = useState(false)
	const [isBundled, setIsBundled] = useState(false)
	const [detectedChromePath, setDetectedChromePath] = useState<string | null>(null)

	// Auto-clear relaunch result message after 15 seconds
	useEffect(() => {
		if (relaunchResult) {
			const timer = setTimeout(() => {
				setRelaunchResult(null)
			}, 15000)
			return () => clearTimeout(timer)
		}
	}, [relaunchResult])

	// Request detected Chrome path on mount
	useEffect(() => {
		BrowserServiceClient.getDetectedChromePath(EmptyRequest.create({}))
			.then((result) => {
				setDetectedChromePath(result.path)
				setIsBundled(result.isBundled)
			})
			.catch((error) => {
				console.error("Error getting detected Chrome path:", error)
			})
	}, [])

	// Function to check connection once without changing UI state immediately
	const checkConnectionOnce = useCallback(() => {
		if (browserSettings.remoteBrowserHost) {
			BrowserServiceClient.testBrowserConnection(StringRequest.create({ value: browserSettings.remoteBrowserHost }))
				.then((result) => {
					setConnectionStatus(result.success)
				})
				.catch((error) => {
					console.error("Error testing browser connection:", error)
					setConnectionStatus(false)
				})
		} else {
			BrowserServiceClient.discoverBrowser(EmptyRequest.create({}))
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
		if (!browserSettings.remoteBrowserEnabled) {
			setIsCheckingConnection(false)
			return
		}

		checkConnectionOnce()
		const pollInterval = setInterval(() => {
			checkConnectionOnce()
		}, 1000)

		return () => clearInterval(pollInterval)
	}, [browserSettings.remoteBrowserEnabled, checkConnectionOnce])

	const handleViewportChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const selectedSize = BROWSER_VIEWPORT_PRESETS[target.value as keyof typeof BROWSER_VIEWPORT_PRESETS]
		if (selectedSize) {
			updateSetting("browserSettings", {
				viewport: {
					width: selectedSize.width,
					height: selectedSize.height,
				},
			})
		}
	}

	const relaunchChromeDebugMode = () => {
		setDebugMode(true)
		setRelaunchResult(null)

		BrowserServiceClient.relaunchChromeDebugMode(EmptyRequest.create({}))
			.then((result) => {
				setRelaunchResult({
					success: true,
					message: result.value,
				})
				setDebugMode(false)
			})
			.catch((error) => {
				console.error("Error relaunching Chrome:", error)
				setRelaunchResult({
					success: false,
					message: `Error relaunching Chrome: ${error.message}`,
				})
				setDebugMode(false)
			})
	}

	// Determine if we should show the relaunch button
	const isRemoteEnabled = Boolean(browserSettings.remoteBrowserEnabled)
	const shouldShowRelaunchButton = isRemoteEnabled && connectionStatus === false
	const isSubSettingsOpen = !(browserSettings.disableToolUse || false)

	return (
		<div>
			{renderSectionHeader("browser")}
			<Section>
				<div id="browser-settings-section" style={{ marginBottom: 20 }}>
					{/* Master Toggle */}
					<div style={{ marginBottom: isSubSettingsOpen ? 0 : 10 }}>
						<VSCodeCheckbox
							checked={browserSettings.disableToolUse || false}
							onChange={(e) =>
								updateSetting("browserSettings", { disableToolUse: (e.target as HTMLInputElement).checked })
							}>
							Disable browser tool usage
						</VSCodeCheckbox>
						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								margin: "4px 0 0 0px",
							}}>
							Prevent Cline from using browser actions (e.g. launch, click, type).
						</p>
					</div>

					<CollapsibleContent isOpen={isSubSettingsOpen}>
						<div style={{ marginBottom: 15 }}>
							<div style={{ marginBottom: 8 }}>
								<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Viewport size</label>
								<VSCodeDropdown
									onChange={(event) => handleViewportChange(event as Event)}
									style={{ width: "100%" }}
									value={
										Object.entries(BROWSER_VIEWPORT_PRESETS).find(([_, size]) => {
											const typedSize = size as { width: number; height: number }
											return (
												typedSize.width === browserSettings.viewport.width &&
												typedSize.height === browserSettings.viewport.height
											)
										})?.[0]
									}>
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
							{" "}
							{/* This div now contains Remote Connection & Chrome Path */}
							<div
								style={{
									marginBottom: 4,
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
								}}>
								<VSCodeCheckbox
									checked={browserSettings.remoteBrowserEnabled}
									onChange={(e) => {
										const enabled = (e.target as HTMLInputElement).checked
										updateSetting("browserSettings", { remoteBrowserEnabled: enabled })
										// If disabling, also clear the host
										if (!enabled) {
											updateSetting("browserSettings", { remoteBrowserHost: undefined })
										}
									}}>
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
								{isBundled
									? "(not detected on your machine)"
									: detectedChromePath
										? ` (${detectedChromePath})`
										: ""}
								. You can specify a custom path below. Using a remote browser connection requires starting Chrome
								in debug mode
								{browserSettings.remoteBrowserEnabled ? (
									<>
										{" "}
										manually (<code>--remote-debugging-port=9222</code>) or using the button below. Enter the
										host address or leave it blank for automatic discovery.
									</>
								) : (
									"."
								)}
							</p>
							{/* Moved remote-specific settings to appear directly after enabling remote connection */}
							{browserSettings.remoteBrowserEnabled && (
								<div style={{ marginLeft: 0, marginTop: 8 }}>
									<DebouncedTextField
										initialValue={browserSettings.remoteBrowserHost || ""}
										onChange={(value) =>
											updateSetting("browserSettings", { remoteBrowserHost: value || undefined })
										}
										placeholder="http://localhost:9222"
										style={{ width: "100%", marginBottom: 8 }}
									/>

									{shouldShowRelaunchButton && (
										<div style={{ display: "flex", gap: "10px", marginBottom: 8, justifyContent: "center" }}>
											<VSCodeButton
												disabled={debugMode}
												onClick={relaunchChromeDebugMode}
												style={{ flex: 1 }}>
												{debugMode ? "Launching Browser..." : "Launch Browser with Debug Mode"}
											</VSCodeButton>
										</div>
									)}

									{relaunchResult && (
										<div
											style={{
												padding: "8px",
												marginBottom: "8px",
												backgroundColor: relaunchResult.success
													? "rgba(0, 128, 0, 0.1)"
													: "rgba(255, 0, 0, 0.1)",
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
							{/* Chrome Executable Path section now follows remote-specific settings */}
							<div style={{ marginBottom: 8, marginTop: 8 }}>
								<label
									htmlFor="chrome-executable-path"
									style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
									Chrome Executable Path (Optional)
								</label>
								<DebouncedTextField
									id="chrome-executable-path"
									initialValue={browserSettings.chromeExecutablePath || ""}
									onChange={(value) => updateSetting("browserSettings", { chromeExecutablePath: value })}
									placeholder="e.g., /usr/bin/google-chrome or C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
									style={{ width: "100%" }}
								/>
								<p
									style={{
										fontSize: "12px",
										color: "var(--vscode-descriptionForeground)",
										margin: "4px 0 0 0",
									}}>
									Leave blank to auto-detect.
								</p>
							</div>
							{/* Custom Browser Arguments section */}
							<div style={{ marginBottom: 8, marginTop: 8 }}>
								<label
									htmlFor="custom-browser-args"
									style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
									Custom Browser Arguments (Optional)
								</label>
								<DebouncedTextField
									id="custom-browser-args"
									initialValue={browserSettings.customArgs || ""}
									onChange={(value) => updateSetting("browserSettings", { customArgs: value })}
									placeholder="e.g., --no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu --no-first-run --no-zygote"
									style={{ width: "100%" }}
								/>
								<p
									style={{
										fontSize: "12px",
										color: "var(--vscode-descriptionForeground)",
										margin: "4px 0 0 0",
									}}>
									Space-separated arguments to pass to the browser executable.
								</p>
							</div>
						</div>
					</CollapsibleContent>
				</div>
			</Section>
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
