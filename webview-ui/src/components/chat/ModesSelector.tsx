import React, { useState, useRef, useEffect } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { CustomInstructionMode } from "../../../../src/shared/CustomInstructionMode"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"

const ModesSelector: React.FC = () => {
	const { customInstructionModes, selectedModeIds, toggleModeSelection } = useExtensionState()
	const [isOpen, setIsOpen] = useState(false)
	const [showTooltip, setShowTooltip] = useState(false) // State for custom tooltip
	const dropdownRef = useRef<HTMLDivElement>(null)
	const buttonRef = useRef<HTMLDivElement>(null) // Ref for button positioning

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			// Close dropdown if clicking outside
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				// Also ensure click wasn't on the button itself
				if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
					setIsOpen(false)
				}
			}
		}
		document.addEventListener("mousedown", handleClickOutside)
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [])

	const selectedCount = selectedModeIds.length
	const totalCount = customInstructionModes.length

	// If there are no modes defined at all, don't render the selector
	if (totalCount === 0) {
		return null
	}

	// Determine tooltip content based on selection
	let tooltipContent = "Select Modes" // Default tooltip text
	if (selectedCount > 0) {
		const selectedModes = customInstructionModes.filter((m) => selectedModeIds.includes(m.id)).map((m) => m.title)

		// Just list the mode names, truncated if necessary
		const maxListed = 5
		tooltipContent =
			selectedModes.length > maxListed ? selectedModes.slice(0, maxListed).join(", ") + ", ..." : selectedModes.join(", ")
	}

	// Handler to open dropdown and hide tooltip
	const handleButtonClick = () => {
		setShowTooltip(false) // Hide tooltip immediately on click
		setIsOpen(!isOpen) // Toggle dropdown
	}

	return (
		// Icon-only button container
		<div style={{ position: "relative", display: "inline-block" }} ref={dropdownRef}>
			{/* Custom Tooltip - Hide if dropdown is open */}
			{showTooltip && !isOpen && (
				<div
					style={{
						position: "absolute",
						bottom: "calc(100% + 6px)", // Position above the button
						left: "50%", // Center horizontally relative to the button container
						transform: "translateX(-50%)", // Adjust centering
						zIndex: 1010, // Above dropdown
						padding: "4px 8px",
						backgroundColor: "var(--vscode-editorWidget-background)",
						border: "1px solid var(--vscode-editorWidget-border, var(--vscode-contrastBorder))",
						borderRadius: "4px",
						fontSize: "0.9em",
						color: "var(--vscode-editor-foreground)",
						whiteSpace: "nowrap",
						boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
					}}>
					{tooltipContent}
				</div>
			)}

			{/* Button */}
			<div ref={buttonRef}>
				{" "}
				{/* Added ref wrapper for positioning */}
				<VSCodeButton
					appearance="icon" // Minimal appearance
					onClick={handleButtonClick} // Use handler to hide tooltip on click
					// Remove native title attribute
					onMouseEnter={() => {
						if (!isOpen) setShowTooltip(true)
					}} // Show tooltip only if dropdown is closed
					onMouseLeave={() => setShowTooltip(false)} // Hide custom tooltip
					style={{
						marginLeft: "4px",
						position: "relative", // Needed for positioning the dot
					}}>
					{/* Always show the icon */}
					<span className="codicon codicon-layers"></span>
					{/* Blue bubble indicator when modes are active */}
					{selectedCount > 0 && (
						<span
							style={{
								position: "absolute",
								top: "1px",
								right: "1px",
								width: "7px",
								height: "7px",
								borderRadius: "50%",
								backgroundColor: "var(--vscode-notifications-infoBackground, var(--vscode-focusBorder))",
								border: "1px solid var(--vscode-contrastBorder, var(--vscode-editorWidget-background))",
							}}></span>
					)}
				</VSCodeButton>
			</div>

			{/* Minimal Dropdown */}
			{isOpen && (
				<div
					style={{
						position: "absolute",
						bottom: "calc(100% + 4px)", // Open upwards
						right: 0, // Align to the right edge of the container div
						zIndex: 1000,
						minWidth: "150px",
						backgroundColor: "var(--vscode-editorWidget-background)",
						border: "1px solid var(--vscode-editorWidget-border)",
						borderRadius: "4px",
						boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
						padding: "4px 0",
					}}>
					{/* Items Container - No Header/Footer */}
					<div style={{ maxHeight: "200px", overflowY: "auto" }}>
						{customInstructionModes.map((mode) => (
							<div
								key={mode.id}
								style={{
									padding: "4px 10px",
									display: "flex",
									alignItems: "center",
									cursor: "pointer",
									borderBottom: "none",
								}}
								onClick={() => {
									toggleModeSelection(mode.id)
									const nextSelectedIds = selectedModeIds.includes(mode.id)
										? selectedModeIds.filter((id) => id !== mode.id)
										: [...selectedModeIds, mode.id]
									vscode.postMessage({
										type: "updateSelectedModeIds",
										selectedModeIds: nextSelectedIds,
									})
									// Optionally close dropdown after selection
									// setIsOpen(false);
								}}>
								<VSCodeCheckbox
									checked={selectedModeIds.includes(mode.id)}
									style={{ marginRight: "8px", pointerEvents: "none" }}
									readOnly
								/>
								<div>
									<div>{mode.title}</div>
								</div>
							</div>
						))}
					</div>
					{customInstructionModes.length === 0 && (
						<div style={{ padding: "4px 10px", fontStyle: "italic", color: "var(--vscode-disabledForeground)" }}>
							No modes defined
						</div>
					)}
				</div>
			)}
		</div>
	)
}

export default ModesSelector
