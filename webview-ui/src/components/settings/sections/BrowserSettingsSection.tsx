import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useState } from "react"
import styled from "styled-components"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../../context/ExtensionStateContext"
import { BrowserServiceClient } from "../../../services/grpc-client"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { FeatureGroup } from "../FeatureGroup"
import { FeatureItem } from "../FeatureItem"
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

	// Function to check connection once
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

	// Setup continuous polling for connection status
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

	const getCurrentViewportPreset = () => {
		return Object.entries(BROWSER_VIEWPORT_PRESETS).find(([_, size]) => {
			const typedSize = size as { width: number; height: number }
			return typedSize.width === browserSettings.viewport.width && typedSize.height === browserSettings.viewport.height
		})?.[0]
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

	const shouldShowRelaunchButton = browserSettings.remoteBrowserEnabled && connectionStatus === false

	return (
		<div>
			{renderSectionHeader("browser")}
			<Section>
				<div className="grid grid-cols-1 gap-4">
					{/* BROWSER CONFIGURATION */}
					<FeatureGroup isGridItem={false} title="Browser Configuration">
						{/* Disable Browser Tool Usage */}
						<FeatureItem
							checked={browserSettings.disableToolUse || false}
							description="Prevent Cline from using browser actions (e.g. launch, click, type)."
							label="Disable browser tool usage"
							onChange={(checked) => updateSetting("browserSettings", { disableToolUse: checked })}
						/>

						{/* Viewport Size */}
						{!(browserSettings.disableToolUse || false) && (
							<div className="flex items-center justify-between gap-3 px-2">
								<label className="text-sm font-medium" style={{ color: "var(--vscode-foreground)" }}>
									Viewport size
								</label>
								<div className="pr-2">
									<Select
										onValueChange={(presetName) => {
											const selectedSize =
												BROWSER_VIEWPORT_PRESETS[presetName as keyof typeof BROWSER_VIEWPORT_PRESETS]
											if (selectedSize) {
												updateSetting("browserSettings", {
													viewport: {
														width: selectedSize.width,
														height: selectedSize.height,
													},
												})
											}
										}}
										value={getCurrentViewportPreset()}>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{Object.entries(BROWSER_VIEWPORT_PRESETS).map(([name]) => (
												<SelectItem key={name} value={name}>
													{name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						)}

						{/* Remote Browser Connection */}
						{!(browserSettings.disableToolUse || false) && (
							<FeatureItem
								checked={browserSettings.remoteBrowserEnabled || false}
								description={`Enable Cline to use your Chrome${
									isBundled
										? " (not detected on your machine)"
										: detectedChromePath
											? ` (${detectedChromePath})`
											: ""
								}. Using a remote browser connection requires starting Chrome in debug mode${
									browserSettings.remoteBrowserEnabled
										? " manually (--remote-debugging-port=9222) or using the button below."
										: "."
								}`}
								label="Use remote browser connection"
								onChange={(enabled) => {
									updateSetting("browserSettings", { remoteBrowserEnabled: enabled })
									if (!enabled) {
										updateSetting("browserSettings", { remoteBrowserHost: undefined })
									}
								}}>
								{browserSettings.remoteBrowserEnabled && (
									<div className="space-y-3">
										<div className="flex items-center gap-2">
											<DebouncedTextField
												initialValue={browserSettings.remoteBrowserHost || ""}
												onChange={(value) =>
													updateSetting("browserSettings", { remoteBrowserHost: value || undefined })
												}
												placeholder="http://localhost:9222"
												style={{ flex: 1 }}
											/>
											<ConnectionStatusIndicator
												isChecking={isCheckingConnection}
												isConnected={connectionStatus}
												remoteBrowserEnabled={browserSettings.remoteBrowserEnabled}
											/>
										</div>

										{shouldShowRelaunchButton && (
											<VSCodeButton
												disabled={debugMode}
												onClick={relaunchChromeDebugMode}
												style={{ width: "100%" }}>
												{debugMode ? "Launching Browser..." : "Launch Browser with Debug Mode"}
											</VSCodeButton>
										)}

										{relaunchResult && (
											<div
												style={{
													padding: "8px",
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
									</div>
								)}
							</FeatureItem>
						)}

						{/* Chrome Executable Path */}
						{!(browserSettings.disableToolUse || false) && (
							<div className="px-2">
								<label className="text-xs font-medium block mb-2" style={{ color: "var(--vscode-foreground)" }}>
									Chrome Executable Path (Optional)
								</label>
								<DebouncedTextField
									initialValue={browserSettings.chromeExecutablePath || ""}
									onChange={(value) => updateSetting("browserSettings", { chromeExecutablePath: value })}
									placeholder="e.g., /usr/bin/google-chrome or C:\Program Files\Google\Chrome\Application\chrome.exe"
									style={{ width: "100%" }}
								/>
								<p className="text-[10px] mt-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
									Leave blank to auto-detect.
								</p>
							</div>
						)}

						{/* Custom Browser Arguments */}
						{!(browserSettings.disableToolUse || false) && (
							<div className="px-2">
								<label className="text-xs font-medium block mb-2" style={{ color: "var(--vscode-foreground)" }}>
									Custom Browser Arguments (Optional)
								</label>
								<DebouncedTextField
									initialValue={browserSettings.customArgs || ""}
									onChange={(value) => updateSetting("browserSettings", { customArgs: value })}
									placeholder="e.g., --no-sandbox --disable-setuid-sandbox"
									style={{ width: "100%" }}
								/>
								<p className="text-[10px] mt-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
									Space-separated arguments to pass to the browser executable.
								</p>
							</div>
						)}
					</FeatureGroup>
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
