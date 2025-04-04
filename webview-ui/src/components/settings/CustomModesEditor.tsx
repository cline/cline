import React, { useState, useEffect, useRef } from "react" // Added useEffect, useRef
import {
	VSCodeButton,
	VSCodeDivider,
	VSCodeTextField,
	VSCodeTextArea,
	// Removed VSCodePanels, VSCodePanelTab, VSCodePanelView
} from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { CustomInstructionMode } from "../../../../src/shared/CustomInstructionMode"
import { vscode } from "../../utils/vscode" // Added vscode import

const CustomModesEditor: React.FC = () => {
	// Destructure all settings needed for the updateSettings message
	const {
		customInstructionModes,
		addCustomInstructionMode,
		updateCustomInstructionMode,
		removeCustomInstructionMode,
		customInstructions,
		setCustomInstructions,
		// Get other settings needed for the message
		apiConfiguration,
		selectedModeIds,
		telemetrySetting,
		planActSeparateModelsSetting,
	} = useExtensionState()

	const [showAddMode, setShowAddMode] = useState(false)
	const [newModeTitle, setNewModeTitle] = useState("")
	const [newModeContent, setNewModeContent] = useState("")
	const [expandedModeId, setExpandedModeId] = useState<string | null>(null) // State for expanded mode
	// Removed debounceTimeoutRef

	// Convert existing custom instructions to a mode if needed
	useEffect(() => {
		if (customInstructions && customInstructionModes.length === 0) {
			// Only do this if we have custom instructions but no modes yet
			addCustomInstructionMode({
				title: "Default Mode",
				content: customInstructions,
				isEnabled: true,
			})
			// Clear the old custom instructions since they're now in a mode
			setCustomInstructions("")
		}
		// Intentionally not including addCustomInstructionMode/setCustomInstructions in deps
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [customInstructions, customInstructionModes.length])

	// Removed debounced useEffect hook

	const handleAddMode = () => {
		if (newModeTitle.trim() === "") return

		addCustomInstructionMode({
			title: newModeTitle,
			content: newModeContent,
			isEnabled: false,
		})

		// Reset form
		setNewModeTitle("")
		setNewModeContent("")
		setShowAddMode(false)
	}

	const handleCancelAdd = () => {
		setNewModeTitle("")
		setNewModeContent("")
		setShowAddMode(false)
	}

	return (
		<div style={{ marginBottom: 20 }}>
			<div style={{ marginBottom: 8 }}>
				<span style={{ fontWeight: "500" }}>Custom Instruction Modes</span>
			</div>

			{/* List of existing modes - Collapsible List */}
			{customInstructionModes.length > 0 ? (
				<div style={{ marginBottom: 12 }}>
					{customInstructionModes.map((mode) => {
						const isExpanded = expandedModeId === mode.id
						return (
							<div
								key={mode.id}
								style={{
									border: "1px solid var(--vscode-panel-border)",
									borderRadius: 4,
									marginBottom: 8,
									overflow: "hidden", // Ensures content doesn't overflow when collapsed
								}}>
								{/* Header */}
								<div
									style={{
										display: "flex",
										alignItems: "center",
										padding: "8px 12px",
										cursor: "pointer",
										backgroundColor: "var(--vscode-sideBar-background)", // Subtle background
									}}
									onClick={() => setExpandedModeId(isExpanded ? null : mode.id)}>
									<span
										className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
										style={{ marginRight: 8 }}></span>
									<span style={{ flexGrow: 1, fontWeight: "500" }}>{mode.title || "Untitled Mode"}</span>
								</div>

								{/* Collapsible Content */}
								{isExpanded && (
									<div
										style={{
											padding: "8px 12px 12px 12px",
											borderTop: "1px solid var(--vscode-panel-border)",
										}}>
										<VSCodeTextField
											value={mode.title}
											style={{ width: "100%", marginBottom: 8 }}
											placeholder="Mode Title"
											onInput={(e: any) =>
												updateCustomInstructionMode(mode.id, { title: e.target?.value })
											}>
											<span>Title</span>
										</VSCodeTextField>

										<VSCodeTextArea
											value={mode.content}
											style={{ width: "100%" }}
											resize="vertical"
											rows={4}
											placeholder={'e.g. "Run unit tests at the end", "Use TypeScript with async/await"'}
											onInput={(e: any) =>
												updateCustomInstructionMode(mode.id, { content: e.target?.value })
											}>
											<span>Instructions</span>
										</VSCodeTextArea>

										<div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
											<VSCodeButton
												appearance="secondary"
												onClick={() => removeCustomInstructionMode(mode.id)}
												style={{ marginRight: 8 }}>
												Delete Mode
											</VSCodeButton>
										</div>
									</div>
								)}
							</div>
						)
					})}
				</div>
			) : (
				<div
					style={{
						padding: 12,
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: 4,
						marginBottom: 12,
						fontStyle: "italic",
						color: "var(--vscode-descriptionForeground)",
					}}>
					No custom instruction modes. Add one to get started.
				</div>
			)}

			{/* Add new mode form */}
			{showAddMode ? (
				<div
					style={{
						padding: 12,
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: 4,
						marginBottom: 12,
					}}>
					<VSCodeTextField
						value={newModeTitle}
						style={{ width: "100%", marginBottom: 8 }}
						placeholder="e.g. Python Expert, Document Writer"
						onInput={(e: any) => setNewModeTitle(e.target?.value ?? "")}>
						<span>Mode Title</span>
					</VSCodeTextField>

					<VSCodeTextArea
						value={newModeContent}
						style={{ width: "100%" }}
						resize="vertical"
						rows={4}
						placeholder={'e.g. "Use Python with type hints", "Format output as markdown"'}
						onInput={(e: any) => setNewModeContent(e.target?.value ?? "")}>
						<span>Instructions</span>
					</VSCodeTextArea>

					<div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
						<VSCodeButton appearance="secondary" onClick={handleCancelAdd} style={{ marginRight: 8 }}>
							Cancel
						</VSCodeButton>
						<VSCodeButton onClick={handleAddMode} disabled={newModeTitle.trim() === ""}>
							Add Mode
						</VSCodeButton>
					</div>
				</div>
			) : (
				<VSCodeButton appearance="secondary" onClick={() => setShowAddMode(true)}>
					<span slot="start" className="codicon codicon-add"></span>
					Add a Mode
				</VSCodeButton>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Create multiple instruction modes that can be toggled on/off using the selector next to the Plan/Act toggle.
				Selected modes will be added to the system prompt.
			</p>
		</div>
	)
}

export default CustomModesEditor
