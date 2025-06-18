import React, { useState } from "react"
import { VSCodeButton, VSCodeTextArea, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ClineIntent {
	readonly id: string
	readonly timestamp: number
	readonly description: string
	readonly scope: IntentScope
	readonly estimatedImpact: ImpactEstimate
	readonly dependencies: readonly string[]
}

interface IntentScope {
	readonly files: readonly string[]
	readonly operations: readonly string[]
}

interface ImpactEstimate {
	readonly filesModified: number
	readonly linesAdded: number
	readonly linesRemoved: number
	readonly linesModified: number
	readonly complexity: "low" | "medium" | "high"
}

interface IntentApprovalDialogProps {
	intent: ClineIntent
	isOpen: boolean
	onApprove: (intent: ClineIntent) => void
	onModify: (intent: ClineIntent, newDescription: string) => void
	onReject: () => void
	onClose: () => void
}

export const IntentApprovalDialog: React.FC<IntentApprovalDialogProps> = ({
	intent,
	isOpen,
	onApprove,
	onModify,
	onReject,
	onClose,
}) => {
	const [isModifying, setIsModifying] = useState(false)
	const [modifiedDescription, setModifiedDescription] = useState(intent.description)
	const [showDetails, setShowDetails] = useState(false)

	if (!isOpen) return null

	const formatTimeAgo = (timestamp: number): string => {
		const minutes = Math.floor((Date.now() - timestamp) / 60000)
		return minutes < 1 ? "Just now" : `${minutes}m ago`
	}

	const getComplexityColor = (complexity: string): string => {
		switch (complexity) {
			case "low":
				return "#28a745"
			case "medium":
				return "#ffc107"
			case "high":
				return "#dc3545"
			default:
				return "#6c757d"
		}
	}

	const getTotalChanges = (impact: ImpactEstimate): number => {
		return impact.linesAdded + impact.linesRemoved + impact.linesModified
	}

	const handleApprove = () => {
		if (isModifying) {
			onModify(intent, modifiedDescription)
		} else {
			onApprove(intent)
		}
		setIsModifying(false)
	}

	const handleModify = () => {
		setIsModifying(true)
	}

	const handleCancel = () => {
		if (isModifying) {
			setIsModifying(false)
			setModifiedDescription(intent.description)
		} else {
			onClose()
		}
	}

	const dialogStyle: React.CSSProperties = {
		position: "fixed",
		top: "50%",
		left: "50%",
		transform: "translate(-50%, -50%)",
		backgroundColor: "var(--vscode-editor-background)",
		border: "1px solid var(--vscode-panel-border)",
		borderRadius: "8px",
		padding: "1.5rem",
		minWidth: "500px",
		maxWidth: "80vw",
		maxHeight: "80vh",
		overflow: "auto",
		zIndex: 1000,
		boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
	}

	const overlayStyle: React.CSSProperties = {
		position: "fixed",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		zIndex: 999,
	}

	return (
		<>
			<div style={overlayStyle} onClick={onClose} />
			<div style={dialogStyle}>
				<div style={{ marginBottom: "1.5rem" }}>
					<h2 style={{ margin: "0 0 0.5rem 0", color: "var(--vscode-foreground)" }}>🤖 Cline Intent Approval</h2>
					<div
						style={{
							fontSize: "0.9rem",
							color: "var(--vscode-descriptionForeground)",
							display: "flex",
							justifyContent: "space-between",
						}}>
						<span>Intent ID: {intent.id.slice(-8)}</span>
						<span>{formatTimeAgo(intent.timestamp)}</span>
					</div>
				</div>

				<div style={{ marginBottom: "1.5rem" }}>
					<h3 style={{ margin: "0 0 0.75rem 0" }}>What Cline wants to do:</h3>
					{isModifying ? (
						<VSCodeTextArea
							value={modifiedDescription}
							onChange={(e) => setModifiedDescription((e.target as HTMLTextAreaElement).value)}
							rows={3}
							style={{ width: "100%" }}
							placeholder="Modify the intent description..."
						/>
					) : (
						<div
							style={{
								padding: "0.75rem",
								backgroundColor: "var(--vscode-textCodeBlock-background)",
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "4px",
								fontFamily: "var(--vscode-font-family)",
								fontSize: "1rem",
								lineHeight: "1.4",
							}}>
							{intent.description}
						</div>
					)}
				</div>

				<div style={{ marginBottom: "1.5rem" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: "0.75rem",
						}}>
						<h3 style={{ margin: 0 }}>Estimated Impact:</h3>
						<div
							style={{
								padding: "0.25rem 0.5rem",
								borderRadius: "12px",
								backgroundColor: getComplexityColor(intent.estimatedImpact.complexity),
								color: "white",
								fontSize: "0.8rem",
								fontWeight: "bold",
							}}>
							{intent.estimatedImpact.complexity.toUpperCase()}
						</div>
					</div>

					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(2, 1fr)",
							gap: "1rem",
							padding: "0.75rem",
							backgroundColor: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: "4px",
						}}>
						<div>
							<strong>Files:</strong> {intent.estimatedImpact.filesModified}
						</div>
						<div>
							<strong>Total Changes:</strong> {getTotalChanges(intent.estimatedImpact)}
						</div>
						<div style={{ color: "#28a745" }}>
							<strong>+{intent.estimatedImpact.linesAdded}</strong> lines
						</div>
						<div style={{ color: "#dc3545" }}>
							<strong>-{intent.estimatedImpact.linesRemoved}</strong> lines
						</div>
					</div>
				</div>

				<div style={{ marginBottom: "1.5rem" }}>
					<div style={{ display: "flex", alignItems: "center", marginBottom: "0.75rem" }}>
						<h3 style={{ margin: 0 }}>Scope & Dependencies:</h3>
						<VSCodeCheckbox
							checked={showDetails}
							onChange={(e) => setShowDetails((e.target as HTMLInputElement).checked)}
							style={{ marginLeft: "1rem" }}>
							Show Details
						</VSCodeCheckbox>
					</div>

					{showDetails && (
						<div
							style={{
								padding: "0.75rem",
								backgroundColor: "var(--vscode-textCodeBlock-background)",
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "4px",
								fontSize: "0.9rem",
							}}>
							<div style={{ marginBottom: "0.5rem" }}>
								<strong>Files:</strong>
								<ul style={{ margin: "0.25rem 0", paddingLeft: "1.5rem" }}>
									{intent.scope.files.map((file, index) => (
										<li key={index}>{file}</li>
									))}
								</ul>
							</div>

							<div style={{ marginBottom: "0.5rem" }}>
								<strong>Operations:</strong>
								<div style={{ marginTop: "0.25rem" }}>
									{intent.scope.operations.map((op, index) => (
										<span
											key={index}
											style={{
												display: "inline-block",
												margin: "0.25rem 0.25rem 0 0",
												padding: "0.25rem 0.5rem",
												backgroundColor: "var(--vscode-button-background)",
												color: "var(--vscode-button-foreground)",
												borderRadius: "12px",
												fontSize: "0.8rem",
											}}>
											{op}
										</span>
									))}
								</div>
							</div>

							{intent.dependencies.length > 0 && (
								<div>
									<strong>Dependencies:</strong>
									<ul style={{ margin: "0.25rem 0", paddingLeft: "1.5rem" }}>
										{intent.dependencies.map((dep, index) => (
											<li key={index}>{dep}</li>
										))}
									</ul>
								</div>
							)}
						</div>
					)}
				</div>

				<div
					style={{
						display: "flex",
						gap: "0.75rem",
						justifyContent: "flex-end",
						borderTop: "1px solid var(--vscode-panel-border)",
						paddingTop: "1rem",
					}}>
					<VSCodeButton appearance="secondary" onClick={handleCancel}>
						{isModifying ? "Cancel Edit" : "Close"}
					</VSCodeButton>

					{!isModifying && (
						<>
							<VSCodeButton appearance="secondary" onClick={onReject}>
								Reject
							</VSCodeButton>
							<VSCodeButton appearance="secondary" onClick={handleModify}>
								Modify
							</VSCodeButton>
						</>
					)}

					<VSCodeButton appearance="primary" onClick={handleApprove}>
						{isModifying ? "Save & Approve" : "Approve"}
					</VSCodeButton>
				</div>

				{intent.estimatedImpact.complexity === "high" && (
					<div
						style={{
							marginTop: "1rem",
							padding: "0.75rem",
							backgroundColor: "var(--vscode-inputValidation-warningBackground)",
							border: "1px solid var(--vscode-inputValidation-warningBorder)",
							borderRadius: "4px",
							color: "var(--vscode-inputValidation-warningForeground)",
						}}>
						⚠️ <strong>High Complexity Operation:</strong> This intent will make significant changes. Please review
						carefully before approving.
					</div>
				)}
			</div>
		</>
	)
}
