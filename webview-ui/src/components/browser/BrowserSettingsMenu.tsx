import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useRef, useState } from "react"
import { useClickAway } from "react-use"
import styled from "styled-components"
import { BROWSER_VIEWPORT_PRESETS } from "../../../../src/shared/BrowserSettings"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"

interface BrowserSettingsMenuProps {
	disabled?: boolean
	maxWidth?: number
}

export const BrowserSettingsMenu: React.FC<BrowserSettingsMenuProps> = ({ disabled = false, maxWidth }) => {
	const { browserSettings } = useExtensionState()
	const [showMenu, setShowMenu] = useState(false)
	const [hasMouseEntered, setHasMouseEntered] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)

	useClickAway(containerRef, () => {
		if (showMenu) {
			setShowMenu(false)
			setHasMouseEntered(false)
		}
	})

	const handleMouseEnter = () => {
		setHasMouseEntered(true)
	}

	const handleMouseLeave = () => {
		if (hasMouseEntered) {
			setShowMenu(false)
			setHasMouseEntered(false)
		}
	}

	const handleControlsMouseLeave = (e: React.MouseEvent) => {
		const menuElement = menuRef.current

		if (menuElement && showMenu) {
			const menuRect = menuElement.getBoundingClientRect()

			// If mouse is moving towards the menu, don't close it
			if (
				e.clientY >= menuRect.top &&
				e.clientY <= menuRect.bottom &&
				e.clientX >= menuRect.left &&
				e.clientX <= menuRect.right
			) {
				return
			}
		}

		setShowMenu(false)
		setHasMouseEntered(false)
	}

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

	// const updateChromeType = (chromeType: BrowserSettings["chromeType"]) => {
	// 	vscode.postMessage({
	// 		type: "browserSettings",
	// 		browserSettings: {
	// 			...browserSettings,
	// 			chromeType,
	// 		},
	// 	})
	// }

	// const relaunchChromeDebugMode = () => {
	// 	vscode.postMessage({
	// 		type: "relaunchChromeDebugMode",
	// 	})
	// }

	return (
		<div ref={containerRef} style={{ position: "relative", marginTop: "-1px" }} onMouseLeave={handleControlsMouseLeave}>
			<VSCodeButton appearance="icon" onClick={() => setShowMenu(!showMenu)} disabled={disabled}>
				<i className="codicon codicon-settings-gear" style={{ fontSize: "14.5px" }} />
			</VSCodeButton>
			{showMenu && (
				<SettingsMenu ref={menuRef} maxWidth={maxWidth} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
					<SettingsGroup>
						{/* <SettingsHeader>Headless Mode</SettingsHeader> */}
						<VSCodeCheckbox
							style={{ marginBottom: "8px", marginTop: -1 }}
							checked={browserSettings.headless}
							onChange={(e) => updateHeadless((e.target as HTMLInputElement).checked)}>
							Run in headless mode
						</VSCodeCheckbox>
						<SettingsDescription>When enabled, Chrome will run in the background.</SettingsDescription>
					</SettingsGroup>

					{/* <SettingsGroup>
						<SettingsHeader>Chrome Executable</SettingsHeader>
						<VSCodeDropdown
							style={{ width: "100%", marginBottom: "8px" }}
							value={browserSettings.chromeType}
							onChange={(e) =>
								updateChromeType((e.target as HTMLSelectElement).value as BrowserSettings["chromeType"])
							}>
							<VSCodeOption value="chromium">Chromium (Auto-downloaded)</VSCodeOption>
							<VSCodeOption value="system">System Chrome</VSCodeOption>
						</VSCodeDropdown>
						<SettingsDescription>
							{browserSettings.chromeType === "system" ? (
								<>
									Cline will use your personal browser. You must{" "}
									<VSCodeLink
										href="#"
										style={{ fontSize: "inherit" }}
										onClick={(e: React.MouseEvent) => {
											e.preventDefault()
											relaunchChromeDebugMode()
										}}>
										relaunch Chrome in debug mode
									</VSCodeLink>{" "}
									to use this setting.
								</>
							) : (
								"Cline will use a Chromium browser bundled with the extension."
							)}
						</SettingsDescription>
					</SettingsGroup> */}

					<SettingsGroup>
						<SettingsHeader>Viewport Size</SettingsHeader>
						<VSCodeDropdown
							style={{ width: "100%" }}
							value={
								Object.entries(BROWSER_VIEWPORT_PRESETS).find(
									([_, size]) =>
										size.width === browserSettings.viewport.width &&
										size.height === browserSettings.viewport.height,
								)?.[0]
							}
							onChange={(event) => handleViewportChange(event as Event)}>
							{Object.entries(BROWSER_VIEWPORT_PRESETS).map(([name]) => (
								<VSCodeOption key={name} value={name}>
									{name}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</SettingsGroup>
				</SettingsMenu>
			)}
		</div>
	)
}

const SettingsMenu = styled.div<{ maxWidth?: number }>`
	position: absolute;
	top: calc(100% + 8px);
	right: -2px;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 8px;
	border-radius: 3px;
	z-index: 1000;
	width: calc(100vw - 57px);
	min-width: 0px;
	max-width: ${(props) => (props.maxWidth ? `${props.maxWidth - 23}px` : "100vw")};

	// Add invisible padding to create a safe hover zone
	&::before {
		content: "";
		position: absolute;
		top: -14px; // Same as margin-top in the parent's top property
		left: 0;
		right: -6px;
		height: 14px;
	}

	&::after {
		content: "";
		position: absolute;
		top: -6px;
		right: 6px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-left: 1px solid var(--vscode-editorGroup-border);
		border-top: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: 1; // Ensure arrow stays above the padding
	}
`

const SettingsGroup = styled.div`
	&:not(:last-child) {
		margin-bottom: 8px;
		// padding-bottom: 8px;
		border-bottom: 1px solid var(--vscode-editorGroup-border);
	}
`

const SettingsHeader = styled.div`
	font-size: 11px;
	font-weight: 600;
	margin-bottom: 6px;
	color: var(--vscode-foreground);
`

const SettingsDescription = styled.div<{ isLast?: boolean }>`
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
	margin-bottom: ${(props) => (props.isLast ? "0" : "8px")};
`

export default BrowserSettingsMenu
