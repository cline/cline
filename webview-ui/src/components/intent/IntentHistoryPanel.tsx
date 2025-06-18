import React, { useState, useMemo } from "react"
import { VSCodeButton, VSCodeDropdown, VSCodeOption, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

interface ClineIntent {
	readonly id: string
	readonly timestamp: number
	readonly description: string
	readonly scope: IntentScope
	readonly estimatedImpact: ImpactEstimate
	readonly dependencies: readonly string[]
	readonly status: IntentStatus
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

type IntentStatus = "declared" | "approved" | "executing" | "completed" | "reverted" | "failed"

interface IntentHistory {
	readonly intents: readonly ClineIntent[]
	readonly executionOrder: readonly string[]
	readonly revertedIntents: readonly string[]
}

interface IntentHistoryPanelProps {
	history: IntentHistory
	onRevertIntent: (intentId: string) => void
	onRevertMultiple: (intentIds: string[]) => void
	onExportHistory: () => void
}

type SortBy = "timestamp" | "status" | "complexity" | "impact"
type FilterBy = "all" | "completed" | "reverted" | "failed" | "reversible"

export const IntentHistoryPanel: React.FC<IntentHistoryPanelProps> = ({
	history,
	onRevertIntent,
	onRevertMultiple,
	onExportHistory,
}) => {
	const [sortBy, setSortBy] = useState<SortBy>("timestamp")
	const [filterBy, setFilterBy] = useState<FilterBy>("all")
	const [selectedIntents, setSelectedIntents] = useState<Set<string>>(new Set())
	const [expandedIntents, setExpandedIntents] = useState<Set<string>>(new Set())

	const filteredAndSortedIntents = useMemo(() => {
		let filtered = [...history.intents]

		switch (filterBy) {
			case "completed":
				filtered = filtered.filter(
					(intent) => intent.status === "completed" && !history.revertedIntents.includes(intent.id),
				)
				break
			case "reverted":
				filtered = filtered.filter((intent) => history.revertedIntents.includes(intent.id))
				break
			case "failed":
				filtered = filtered.filter((intent) => intent.status === "failed")
				break
			case "reversible":
				filtered = filtered.filter(
					(intent) =>
						intent.status === "completed" &&
						!history.revertedIntents.includes(intent.id) &&
						!hasActiveDependents(intent.id, history),
				)
				break
		}

		switch (sortBy) {
			case "timestamp":
				filtered.sort((a, b) => b.timestamp - a.timestamp)
				break
			case "status":
				const statusOrder = { declared: 1, approved: 2, executing: 3, completed: 4, reverted: 5, failed: 6 }
				filtered.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])
				break
			case "complexity":
				const complexityOrder = { high: 3, medium: 2, low: 1 }
				filtered.sort(
					(a, b) => complexityOrder[b.estimatedImpact.complexity] - complexityOrder[a.estimatedImpact.complexity],
				)
				break
			case "impact":
				filtered.sort((a, b) => getTotalImpact(b.estimatedImpact) - getTotalImpact(a.estimatedImpact))
				break
		}

		return filtered
	}, [history, sortBy, filterBy])

	const getTotalImpact = (impact: ImpactEstimate): number => {
		return impact.linesAdded + impact.linesRemoved + impact.linesModified
	}

	const hasActiveDependents = (intentId: string, history: IntentHistory): boolean => {
		return history.intents.some(
			(intent) =>
				intent.dependencies.includes(intentId) &&
				intent.status === "completed" &&
				!history.revertedIntents.includes(intent.id),
		)
	}

	const getStatusColor = (status: IntentStatus): string => {
		switch (status) {
			case "completed":
				return "#28a745"
			case "executing":
				return "#007bff"
			case "approved":
				return "#17a2b8"
			case "declared":
				return "#6c757d"
			case "reverted":
				return "#ffc107"
			case "failed":
				return "#dc3545"
			default:
				return "#6c757d"
		}
	}

	const getStatusIcon = (status: IntentStatus): string => {
		switch (status) {
			case "completed":
				return "✅"
			case "executing":
				return "⚡"
			case "approved":
				return "👍"
			case "declared":
				return "📝"
			case "reverted":
				return "↩️"
			case "failed":
				return "❌"
			default:
				return "❓"
		}
	}

	const formatTimeAgo = (timestamp: number): string => {
		const now = Date.now()
		const diff = now - timestamp
		const minutes = Math.floor(diff / 60000)
		const hours = Math.floor(minutes / 60)
		const days = Math.floor(hours / 24)

		if (days > 0) return `${days}d ago`
		if (hours > 0) return `${hours}h ago`
		if (minutes > 0) return `${minutes}m ago`
		return "Just now"
	}

	const isReversible = (intent: ClineIntent): boolean => {
		return (
			intent.status === "completed" &&
			!history.revertedIntents.includes(intent.id) &&
			!hasActiveDependents(intent.id, history)
		)
	}

	const toggleIntentSelection = (intentId: string) => {
		const newSelected = new Set(selectedIntents)
		if (newSelected.has(intentId)) {
			newSelected.delete(intentId)
		} else {
			newSelected.add(intentId)
		}
		setSelectedIntents(newSelected)
	}

	const toggleIntentExpansion = (intentId: string) => {
		const newExpanded = new Set(expandedIntents)
		if (newExpanded.has(intentId)) {
			newExpanded.delete(intentId)
		} else {
			newExpanded.add(intentId)
		}
		setExpandedIntents(newExpanded)
	}

	const handleRevertSelected = () => {
		const reversibleSelected = Array.from(selectedIntents).filter((id) => {
			const intent = history.intents.find((i) => i.id === id)
			return intent && isReversible(intent)
		})

		if (reversibleSelected.length > 0) {
			onRevertMultiple(reversibleSelected)
			setSelectedIntents(new Set())
		}
	}

	const selectAllReversible = () => {
		const reversibleIds = filteredAndSortedIntents.filter(isReversible).map((intent) => intent.id)
		setSelectedIntents(new Set(reversibleIds))
	}

	const stats = useMemo(() => {
		const completed = history.intents.filter((i) => i.status === "completed").length
		const reverted = history.revertedIntents.length
		const failed = history.intents.filter((i) => i.status === "failed").length
		const reversible = history.intents.filter(isReversible).length

		return { completed, reverted, failed, reversible }
	}, [history])

	return (
		<div style={{ padding: "1rem", height: "100%", overflow: "auto" }}>
			<div style={{ marginBottom: "1.5rem" }}>
				<h2 style={{ margin: "0 0 1rem 0" }}>Intent History</h2>

				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(4, 1fr)",
						gap: "1rem",
						marginBottom: "1rem",
						padding: "0.75rem",
						backgroundColor: "var(--vscode-editor-background)",
						border: "1px solid var(--vscode-panel-border)",
						borderRadius: "4px",
					}}>
					<div style={{ textAlign: "center" }}>
						<div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#28a745" }}>{stats.completed}</div>
						<div style={{ fontSize: "0.8rem", color: "var(--vscode-descriptionForeground)" }}>Completed</div>
					</div>
					<div style={{ textAlign: "center" }}>
						<div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#ffc107" }}>{stats.reverted}</div>
						<div style={{ fontSize: "0.8rem", color: "var(--vscode-descriptionForeground)" }}>Reverted</div>
					</div>
					<div style={{ textAlign: "center" }}>
						<div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#dc3545" }}>{stats.failed}</div>
						<div style={{ fontSize: "0.8rem", color: "var(--vscode-descriptionForeground)" }}>Failed</div>
					</div>
					<div style={{ textAlign: "center" }}>
						<div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#007bff" }}>{stats.reversible}</div>
						<div style={{ fontSize: "0.8rem", color: "var(--vscode-descriptionForeground)" }}>Reversible</div>
					</div>
				</div>

				<div
					style={{
						display: "flex",
						gap: "1rem",
						alignItems: "center",
						marginBottom: "1rem",
						flexWrap: "wrap",
					}}>
					<div>
						<label style={{ marginRight: "0.5rem" }}>Sort:</label>
						<VSCodeDropdown
							value={sortBy}
							onChange={(e) => setSortBy((e.target as HTMLSelectElement).value as SortBy)}>
							<VSCodeOption value="timestamp">Time</VSCodeOption>
							<VSCodeOption value="status">Status</VSCodeOption>
							<VSCodeOption value="complexity">Complexity</VSCodeOption>
							<VSCodeOption value="impact">Impact</VSCodeOption>
						</VSCodeDropdown>
					</div>

					<div>
						<label style={{ marginRight: "0.5rem" }}>Filter:</label>
						<VSCodeDropdown
							value={filterBy}
							onChange={(e) => setFilterBy((e.target as HTMLSelectElement).value as FilterBy)}>
							<VSCodeOption value="all">All</VSCodeOption>
							<VSCodeOption value="completed">Completed</VSCodeOption>
							<VSCodeOption value="reverted">Reverted</VSCodeOption>
							<VSCodeOption value="failed">Failed</VSCodeOption>
							<VSCodeOption value="reversible">Reversible</VSCodeOption>
						</VSCodeDropdown>
					</div>
				</div>

				<div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
					<VSCodeButton appearance="secondary" onClick={selectAllReversible}>
						Select All Reversible
					</VSCodeButton>
					<VSCodeButton appearance="primary" onClick={handleRevertSelected} disabled={selectedIntents.size === 0}>
						Revert Selected ({selectedIntents.size})
					</VSCodeButton>
					<VSCodeButton appearance="secondary" onClick={onExportHistory}>
						Export History
					</VSCodeButton>
				</div>
			</div>

			<div>
				{filteredAndSortedIntents.length === 0 ? (
					<div
						style={{
							textAlign: "center",
							padding: "2rem",
							color: "var(--vscode-descriptionForeground)",
						}}>
						No intents match the current filter
					</div>
				) : (
					filteredAndSortedIntents.map((intent) => (
						<div
							key={intent.id}
							style={{
								border: "1px solid var(--vscode-panel-border)",
								borderRadius: "4px",
								marginBottom: "0.5rem",
								overflow: "hidden",
								backgroundColor: selectedIntents.has(intent.id)
									? "var(--vscode-list-activeSelectionBackground)"
									: "transparent",
							}}>
							<div
								style={{
									padding: "0.75rem",
									backgroundColor: "var(--vscode-list-hoverBackground)",
									cursor: "pointer",
									display: "flex",
									alignItems: "center",
									gap: "0.75rem",
								}}
								onClick={() => toggleIntentExpansion(intent.id)}>
								<VSCodeCheckbox
									checked={selectedIntents.has(intent.id)}
									onChange={() => toggleIntentSelection(intent.id)}
									disabled={!isReversible(intent)}
									onClick={(e) => e.stopPropagation()}
								/>

								<span style={{ fontSize: "1rem" }}>{expandedIntents.has(intent.id) ? "▼" : "▶"}</span>

								<div style={{ flex: 1 }}>
									<div
										style={{
											fontWeight: "bold",
											marginBottom: "0.25rem",
										}}>
										{intent.description}
									</div>
									<div
										style={{
											fontSize: "0.8rem",
											color: "var(--vscode-descriptionForeground)",
										}}>
										{intent.scope.files.length} files • {intent.scope.operations.join(", ")}
									</div>
								</div>

								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "1rem",
										fontSize: "0.9rem",
									}}>
									<span style={{ color: getStatusColor(intent.status) }}>
										{getStatusIcon(intent.status)} {intent.status}
									</span>
									<span style={{ color: "var(--vscode-descriptionForeground)" }}>
										{formatTimeAgo(intent.timestamp)}
									</span>
								</div>
							</div>

							{expandedIntents.has(intent.id) && (
								<div
									style={{
										padding: "0.75rem",
										borderTop: "1px solid var(--vscode-panel-border)",
										backgroundColor: "var(--vscode-editor-background)",
									}}>
									<div style={{ marginBottom: "0.75rem" }}>
										<strong>Impact:</strong> {getTotalImpact(intent.estimatedImpact)} changes (
										{intent.estimatedImpact.complexity} complexity)
									</div>

									<div style={{ marginBottom: "0.75rem" }}>
										<strong>Files:</strong>
										<div style={{ marginTop: "0.25rem" }}>
											{intent.scope.files.map((file, index) => (
												<div
													key={index}
													style={{
														fontSize: "0.9rem",
														fontFamily: "var(--vscode-editor-font-family)",
														marginLeft: "1rem",
													}}>
													• {file}
												</div>
											))}
										</div>
									</div>

									{intent.dependencies.length > 0 && (
										<div style={{ marginBottom: "0.75rem" }}>
											<strong>Dependencies:</strong> {intent.dependencies.join(", ")}
										</div>
									)}

									<div style={{ display: "flex", gap: "0.5rem" }}>
										{isReversible(intent) && (
											<VSCodeButton appearance="primary" onClick={() => onRevertIntent(intent.id)}>
												Revert This Intent
											</VSCodeButton>
										)}

										{intent.status === "failed" && <VSCodeButton appearance="secondary">Retry</VSCodeButton>}
									</div>
								</div>
							)}
						</div>
					))
				)}
			</div>
		</div>
	)
}
