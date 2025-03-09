import { HTMLAttributes } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { Dropdown, type DropdownOption } from "vscrui"
import { SquareMousePointer } from "lucide-react"

import { SetCachedStateField } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type BrowserSettingsProps = HTMLAttributes<HTMLDivElement> & {
	browserToolEnabled?: boolean
	browserViewportSize?: string
	screenshotQuality?: number
	remoteBrowserHost?: string
	setCachedStateField: SetCachedStateField<
		"browserToolEnabled" | "browserViewportSize" | "screenshotQuality" | "remoteBrowserHost"
	>
}

export const BrowserSettings = ({
	browserToolEnabled,
	browserViewportSize,
	screenshotQuality,
	remoteBrowserHost,
	setCachedStateField,
	...props
}: BrowserSettingsProps) => {
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
								<label style={{ fontWeight: "500", display: "block", marginBottom: 5 }}>
									Remote Chrome DevTools Host (optional)
								</label>
								<input
									type="text"
									value={remoteBrowserHost ?? ""}
									placeholder="http://localhost:9222"
									style={{
										width: "100%",
										padding: "4px 8px",
										backgroundColor: "var(--vscode-input-background)",
										color: "var(--vscode-input-foreground)",
										border: "1px solid var(--vscode-input-border)",
										borderRadius: "2px",
									}}
									onChange={(e) =>
										setCachedStateField("remoteBrowserHost", e.target.value || undefined)
									}
								/>
								<p className="text-vscode-descriptionForeground text-sm mt-0">
									Connect to a remote Chrome browser by providing the DevTools Protocol host address.
									Roo will automatically fetch the WebSocket endpoint from this address. If provided,
									Roo will use this browser instead of launching a local one. Leave empty to use the
									built-in browser.
								</p>
							</div>
						</div>
					)}
				</div>
			</Section>
		</div>
	)
}
