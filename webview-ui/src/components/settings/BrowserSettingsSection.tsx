import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"

export const BrowserSettingsSection: React.FC = () => {
	const { browserSettings } = useExtensionState()
	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

	// Listen for browser connection test results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "browserConnectionResult") {
				setTestResult({
					success: message.success,
					message: message.text,
				})
				setTestingConnection(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
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
		vscode.postMessage({
			type: "testBrowserConnection",
			text: browserSettings.remoteBrowserHost,
		})
	}

	const discoverBrowser = () => {
		setTestingConnection(true)
		setTestResult(null)
		vscode.postMessage({
			type: "discoverBrowser",
		})
	}

	return (
		<div
			id="browser-settings-section"
			style={{ marginBottom: 20, borderTop: "1px solid var(--vscode-panel-border)", paddingTop: 15 }}>
			<h3 style={{ color: "var(--vscode-foreground)", margin: "0 0 10px 0", fontSize: "14px" }}>Browser Settings</h3>

			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Viewport Size</label>
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
						margin: "0 0 0 20px",
					}}>
					When enabled, Chrome will run in the background without a visible window.
				</p>
			</div>

			<div style={{ marginBottom: 15 }}>
				<div style={{ marginBottom: 8 }}>
					<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>Chrome Executable Path</label>
					<VSCodeTextField
						style={{ width: "100%" }}
						placeholder="Path to Chrome executable"
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
					Path to Chrome executable for browser use functionality. If not set, the extension will attempt to find it
					automatically.
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
						margin: "0 0 8px 20px",
					}}>
					Connect to a Chrome browser running with remote debugging enabled (--remote-debugging-port=9222). This allows
					Cline to use your existing browser session with all authentication cookies.
				</p>

				{browserSettings.remoteBrowserEnabled && (
					<div style={{ marginLeft: 20 }}>
						<div style={{ display: "flex", gap: "5px", marginBottom: 8 }}>
							<VSCodeTextField
								value={browserSettings.remoteBrowserHost || ""}
								placeholder="http://localhost:9222"
								style={{ flexGrow: 1 }}
								onChange={(e: any) => updateRemoteBrowserHost(e.target.value || undefined)}
							/>
							<VSCodeButton
								disabled={testingConnection}
								onClick={browserSettings.remoteBrowserHost ? testConnection : discoverBrowser}>
								{testingConnection ? "Testing..." : "Test Connection"}
							</VSCodeButton>
						</div>

						{testResult && (
							<div
								style={{
									padding: "8px",
									marginBottom: "8px",
									backgroundColor: testResult.success ? "rgba(0, 128, 0, 0.1)" : "rgba(255, 0, 0, 0.1)",
									color: testResult.success
										? "var(--vscode-terminal-ansiGreen)"
										: "var(--vscode-terminal-ansiRed)",
									borderRadius: "3px",
									fontSize: "11px",
								}}>
								{testResult.message}
							</div>
						)}

						<p
							style={{
								fontSize: "12px",
								color: "var(--vscode-descriptionForeground)",
								margin: 0,
							}}>
							Enter the DevTools Protocol host address or leave empty to auto-discover Chrome instances.
						</p>
					</div>
				)}
			</div>
		</div>
	)
}

export default BrowserSettingsSection
