import React, { HTMLAttributes, useState, useEffect } from "react"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Dropdown, type DropdownOption } from "vscrui"
import { SquareMousePointer } from "lucide-react"

import { SetCachedStateField } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { vscode } from "../../utils/vscode"

type BrowserSettingsProps = HTMLAttributes<HTMLDivElement> & {
	browserToolEnabled?: boolean
	browserViewportSize?: string
	screenshotQuality?: number
	remoteBrowserHost?: string
	remoteBrowserEnabled?: boolean
	setCachedStateField: SetCachedStateField<
		| "browserToolEnabled"
		| "browserViewportSize"
		| "screenshotQuality"
		| "remoteBrowserHost"
		| "remoteBrowserEnabled"
	>
}

export const BrowserSettings = ({
	browserToolEnabled,
	browserViewportSize,
	screenshotQuality,
	remoteBrowserHost,
	remoteBrowserEnabled,
	setCachedStateField,
	...props
}: BrowserSettingsProps) => {
	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
	const [discovering, setDiscovering] = useState(false)
	// We don't need a local state for useRemoteBrowser since we're using the enableRemoteBrowser prop directly
	// This ensures the checkbox always reflects the current global state

	// Set up message listener for browser connection results
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "browserConnectionResult") {
				setTestResult({
					success: message.success,
					message: message.text,
				})
				setTestingConnection(false)
				setDiscovering(false)
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const testConnection = async () => {
		setTestingConnection(true)
		setTestResult(null)

		try {
			// Send a message to the extension to test the connection
			vscode.postMessage({
				type: "testBrowserConnection",
				text: remoteBrowserHost,
			})
		} catch (error) {
			setTestResult({
				success: false,
				message: `Error: ${error instanceof Error ? error.message : String(error)}`,
			})
			setTestingConnection(false)
		}
	}

	const discoverBrowser = async () => {
		setDiscovering(true)
		setTestResult(null)

		try {
			// Send a message to the extension to discover Chrome instances
			vscode.postMessage({
				type: "discoverBrowser",
			})
		} catch (error) {
			setTestResult({
				success: false,
				message: `Error: ${error instanceof Error ? error.message : String(error)}`,
			})
			setDiscovering(false)
		}
	}
	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<SquareMousePointer className="w-4" />
					<div>Browser / Computer Use</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={browserToolEnabled}
						onChange={(e: any) => setCachedStateField("browserToolEnabled", e.target.checked)}>
						<span className="font-medium">Enable browser tool</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						When enabled, Roo can use a browser to interact with websites when using models that support
						computer use.
					</p>
					{browserToolEnabled && (
						<div
							style={{
								marginLeft: 0,
								paddingLeft: 10,
								borderLeft: "2px solid var(--vscode-button-background)",
							}}>
							<div>
								<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
									Viewport size
								</label>
								<div className="dropdown-container">
									<Dropdown
										value={browserViewportSize}
										onChange={(value: unknown) => {
											setCachedStateField("browserViewportSize", (value as DropdownOption).value)
										}}
										style={{ width: "100%" }}
										options={[
											{ value: "1280x800", label: "Large Desktop (1280x800)" },
											{ value: "900x600", label: "Small Desktop (900x600)" },
											{ value: "768x1024", label: "Tablet (768x1024)" },
											{ value: "360x640", label: "Mobile (360x640)" },
										]}
									/>
								</div>
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									Select the viewport size for browser interactions. This affects how websites are
									displayed and interacted with.
								</p>
							</div>
							<div>
								<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
									<span className="font-medium">Screenshot quality</span>
									<div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
										<input
											type="range"
											min="1"
											max="100"
											step="1"
											value={screenshotQuality ?? 75}
											className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
											onChange={(e) =>
												setCachedStateField("screenshotQuality", parseInt(e.target.value))
											}
										/>
										<span style={{ ...sliderLabelStyle }}>{screenshotQuality ?? 75}%</span>
									</div>
								</div>
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									Adjust the WebP quality of browser screenshots. Higher values provide clearer
									screenshots but increase token usage.
								</p>
							</div>
							<div className="mt-4">
								<div className="mb-2">
									<VSCodeCheckbox
										checked={remoteBrowserEnabled}
										onChange={(e: any) => {
											// Update the global state - remoteBrowserEnabled now means "enable remote browser connection"
											setCachedStateField("remoteBrowserEnabled", e.target.checked)
											if (!e.target.checked) {
												// If disabling remote browser, clear the custom URL
												setCachedStateField("remoteBrowserHost", undefined)
											}
										}}>
										<span className="font-medium">Use remote browser connection</span>
									</VSCodeCheckbox>
									<p className="text-vscode-descriptionForeground text-sm mt-0 ml-6">
										Connect to a Chrome browser running with remote debugging enabled
										(--remote-debugging-port=9222).
									</p>
								</div>
								{remoteBrowserEnabled && (
									<>
										<div className="flex gap-2 mb-2 ml-6">
											<input
												type="text"
												value={remoteBrowserHost ?? ""}
												placeholder="http://localhost:9222 (leave empty for auto-discovery)"
												style={{
													width: "100%",
													padding: "4px 8px",
													backgroundColor: "var(--vscode-input-background)",
													color: "var(--vscode-input-foreground)",
													border: "1px solid var(--vscode-input-border)",
													borderRadius: "2px",
												}}
												onChange={(e) =>
													setCachedStateField(
														"remoteBrowserHost",
														e.target.value || undefined,
													)
												}
											/>
											<VSCodeButton
												appearance="secondary"
												disabled={testingConnection}
												onClick={remoteBrowserHost ? testConnection : discoverBrowser}>
												{testingConnection || discovering ? "Testing..." : "Test Connection"}
											</VSCodeButton>
										</div>
										{testResult && (
											<div
												className={`p-2 mb-2 rounded text-sm ml-6 ${
													testResult.success
														? "bg-green-800/20 text-green-400"
														: "bg-red-800/20 text-red-400"
												}`}>
												{testResult.message}
											</div>
										)}
										<p className="text-vscode-descriptionForeground text-sm mt-0 ml-6">
											Enter the DevTools Protocol host address or leave empty to auto-discover
											Chrome instances on your network. The Test Connection button will try the
											custom URL if provided, or auto-discover if the field is empty.
										</p>
									</>
								)}
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
