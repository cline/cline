import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

export const BrowserSettingsSection: React.FC = () => {
	const { browserSettings } = useExtensionState()
	const [testingConnection, setTestingConnection] = useState(false)
	const [debugMode, setDebugMode] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
	const [relaunchResult, setRelaunchResult] = useState<{ success: boolean; message: string } | null>(null)
	const [isBundled, setIsBundled] = useState(false)
	const [detectedChromePath, setDetectedChromePath] = useState<string | null>(null)

	// Listen for browser connection test results and relaunch results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "browserConnectionResult") {
				setTestResult({
					success: message.success,
					message: message.text,
				})
				setTestingConnection(false)
			} else if (message.type === "browserRelaunchResult") {
				setRelaunchResult({
					success: message.success,
					message: message.text,
				})
				setDebugMode(false)
			} else if (message.type === "detectedChromePath") {
				setDetectedChromePath(message.text)
				setIsBundled(message.isBundled)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	// Request detected Chrome path on mount
	useEffect(() => {
		vscode.postMessage({
			type: "getDetectedChromePath",
		})
	}, [])

	const handleViewportChange = (event: Event) => {
		const target = event.target as HTMLSelectElement
		const selectedSize = BROWSER_VIEWPORT_PRESETS[target.value as keyof typeof BROWSER_VIEWPORT_PRESETS]
		if (selectedSize) {
			vscode.postMessage({
				type: "browserSettings",
				browserSettings: {
					...browserSettings,
					viewport: selectedSize,
				},
			})
		}
	}

	const updateHeadless = (headless: boolean) => {
		vscode.postMessage({
			type: "browserSettings",
			browserSettings: {
				...browserSettings,
				headless,
			},
		})
	}

	const updateRemoteBrowserEnabled = (enabled: boolean) => {
		vscode.postMessage({
			type: "remoteBrowserEnabled",
			bool: enabled,
		})

		// If disabling, clear the host
		if (!enabled) {
			vscode.postMessage({
				type: "remoteBrowserHost",
				text: undefined,
			})
		}
	}

	const updateRemoteBrowserHost = (host: string | undefined) => {
		vscode.postMessage({
			type: "remoteBrowserHost",
			text: host,
		})
	}

	const testConnection = () => {
		setTestingConnection(true)
		setTestResult(null)
		setRelaunchResult(null)
		vscode.postMessage({
			type: "testBrowserConnection",
			text: browserSettings.remoteBrowserHost,
		})
	}

	const discoverBrowser = () => {
		setTestingConnection(true)
		setTestResult(null)
		setRelaunchResult(null)
		vscode.postMessage({
			type: "discoverBrowser",
		})
	}

	const relaunchChromeDebugMode = () => {
		setDebugMode(true)
		setRelaunchResult(null)
		setTestResult(null)
		vscode.postMessage({
			type: "relaunchChromeDebugMode",
		})
	}

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

			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Chrome executable path</label>
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder={
							isBundled
								? "(Using bundled Chromium)"
								: detectedChromePath || "Checking for path to Chrome executable..."
						}
						onChange={(e: any) => {
							const value = e.target.value
							// Update VSCode configuration directly
							vscode.postMessage({
								type: "openExtensionSettings",
								text: "chromeExecutablePath",
							})
						}}
					/>
				</div>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						margin: 0,
					}}>
					Detected path shown by default. If not found, Cline will download and use a bundled Chromium instead.
				</p>
			</div>

			<div style={{ marginBottom: 15 }}>
				<VSCodeCheckbox
					style={{ marginBottom: "8px" }}
					checked={browserSettings.headless}
					onChange={(e) => updateHeadless((e.target as HTMLInputElement).checked)}>
					Run in headless mode
				</VSCodeCheckbox>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						margin: "0 0 8px 0px",
					}}>
					When enabled, Chrome will run in the background without a visible window. If disabled, a live Chrome instance
					will pop up with a new tab. A remote Chrome must be restarted in headless mode
				</p>
			</div>

			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<VSCodeCheckbox
						checked={browserSettings.remoteBrowserEnabled}
						onChange={(e) => updateRemoteBrowserEnabled((e.target as HTMLInputElement).checked)}>
						Use remote browser connection
					</VSCodeCheckbox>
				</div>
				<p
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						margin: "0 0 8px 0px",
					}}>
					Enable Cline to use your real Chrome. Start Chrome in debug mode manually (--remote-debugging-port=9222) or
					use the button below. Enter the host address or leave it blank for automatic discovery.
				</p>

				{browserSettings.remoteBrowserEnabled && (
					<div style={{ marginLeft: 0 }}>
						<VSCodeTextField
							value={browserSettings.remoteBrowserHost || ""}
							placeholder="http://localhost:9222"
							style={{ width: "100%", marginBottom: 8 }}
							onChange={(e: any) => updateRemoteBrowserHost(e.target.value || undefined)}
						/>
						<div style={{ display: "flex", gap: "10px", marginBottom: 8, justifyContent: "center" }}>
							<VSCodeButton
								style={{ flex: 1 }}
								disabled={testingConnection}
								onClick={browserSettings.remoteBrowserHost ? testConnection : discoverBrowser}>
								{testingConnection ? "Testing..." : "Test Connection"}
							</VSCodeButton>
							<VSCodeButton style={{ flex: 1 }} disabled={debugMode} onClick={relaunchChromeDebugMode}>
								{debugMode ? "Relaunching Browser..." : "Relaunch Browser with Debug Mode"}
							</VSCodeButton>
						</div>

						{(testResult || relaunchResult) && (
							<div
								style={{
									padding: "8px",
									marginBottom: "8px",
									backgroundColor:
										(relaunchResult?.success ?? testResult?.success)
											? "rgba(0, 128, 0, 0.1)"
											: "rgba(255, 0, 0, 0.1)",
									color:
										testResult?.success || relaunchResult?.success
											? "var(--vscode-terminal-ansiGreen)"
											: "var(--vscode-terminal-ansiRed)",
									borderRadius: "3px",
									fontSize: "11px",
								}}>
								{testResult?.message || relaunchResult?.message}
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

export default BrowserSettingsSection
