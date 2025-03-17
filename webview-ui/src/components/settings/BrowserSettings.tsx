import React, { HTMLAttributes, useState, useEffect } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
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
	const { t } = useAppTranslation()
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
					<div>{t("settings:sections.browser")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={browserToolEnabled}
						onChange={(e: any) => setCachedStateField("browserToolEnabled", e.target.checked)}>
						<span className="font-medium">{t("settings:browser.enable.label")}</span>
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:browser.enable.description")}
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
									{t("settings:browser.viewport.label")}
								</label>
								<div className="dropdown-container">
									<Dropdown
										value={browserViewportSize}
										onChange={(value: unknown) => {
											setCachedStateField("browserViewportSize", (value as DropdownOption).value)
										}}
										style={{ width: "100%" }}
										options={[
											{
												value: "1280x800",
												label: t("settings:browser.viewport.options.largeDesktop"),
											},
											{
												value: "900x600",
												label: t("settings:browser.viewport.options.smallDesktop"),
											},
											{ value: "768x1024", label: t("settings:browser.viewport.options.tablet") },
											{ value: "360x640", label: t("settings:browser.viewport.options.mobile") },
										]}
									/>
								</div>
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									{t("settings:browser.viewport.description")}
								</p>
							</div>
							<div>
								<div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
									<span className="font-medium">{t("settings:browser.screenshotQuality.label")}</span>
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
									{t("settings:browser.screenshotQuality.description")}
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
										<span className="font-medium">{t("settings:browser.remote.label")}</span>
									</VSCodeCheckbox>
									<p className="text-vscode-descriptionForeground text-sm mt-0 ml-6">
										{t("settings:browser.remote.description")}
									</p>
								</div>
								{remoteBrowserEnabled && (
									<>
										<div style={{ display: "flex", gap: "5px", marginTop: "10px" }}>
											<VSCodeTextField
												value={remoteBrowserHost ?? ""}
												onChange={(e: any) =>
													setCachedStateField(
														"remoteBrowserHost",
														e.target.value || undefined,
													)
												}
												placeholder={t("settings:browser.remote.urlPlaceholder")}
												style={{ flexGrow: 1 }}
											/>
											<VSCodeButton
												disabled={testingConnection}
												onClick={remoteBrowserHost ? testConnection : discoverBrowser}>
												{testingConnection || discovering
													? t("settings:browser.remote.testingButton")
													: t("settings:browser.remote.testButton")}
											</VSCodeButton>
										</div>
										{testResult && (
											<div
												className={`p-2 mt-2 mb-2 rounded text-sm ${
													testResult.success
														? "bg-green-800/20 text-green-400"
														: "bg-red-800/20 text-red-400"
												}`}>
												{testResult.message}
											</div>
										)}
										<p className="text-vscode-descriptionForeground text-sm mt-2">
											{t("settings:browser.remote.instructions")}
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
