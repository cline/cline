import React, { useState } from "react"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "../../utils/vscode"

interface LineChange {
	lineNumber: number
	type: "added" | "removed" | "modified"
	content: string
	timestamp: number
	source: "cline" | "user" | "unknown"
	operation?: "replace_in_file" | "write_to_file" | "manual_edit"
	searchReplaceBlock?: {
		searchContent: string
		replaceContent: string
		blockIndex: number
	}
}

interface FileChangeRecord {
	filePath: string
	absolutePath: string
	changes: LineChange[]
	lastModified: number
	originalContent?: string
	currentContent?: string
	isTracking: boolean
}

interface FileChangesSummary {
	filePath: string
	totalChanges: number
	clineChanges: number
	userChanges: number
	lastModified: number
}

interface FileChangeTrackerProps {
	taskId: string
}

export const FileChangeTracker: React.FC<FileChangeTrackerProps> = ({ taskId }) => {
	const [changesSummary, setChangesSummary] = useState<FileChangesSummary[]>([])
	const [selectedFile, setSelectedFile] = useState<string | null>(null)
	const [fileChanges, setFileChanges] = useState<LineChange[]>([])
	const [isLoading, setIsLoading] = useState(false)

	const loadChangesSummary = async () => {
		setIsLoading(true)
		try {
			// Request changes summary from extension
			vscode.postMessage({
				type: "getFileChangesSummary",
				taskId,
			})
		} catch (error) {
			console.error("Failed to load changes summary:", error)
		} finally {
			setIsLoading(false)
		}
	}

	const loadFileChanges = async (filePath: string) => {
		setIsLoading(true)
		try {
			setSelectedFile(filePath)
			// Request detailed changes for specific file
			vscode.postMessage({
				type: "getFileChangeHistory",
				taskId,
				filePath,
			})
		} catch (error) {
			console.error("Failed to load file changes:", error)
		} finally {
			setIsLoading(false)
		}
	}

	const exportChangeHistory = async () => {
		try {
			vscode.postMessage({
				type: "exportFileChangeHistory",
				taskId,
			})
		} catch (error) {
			console.error("Failed to export change history:", error)
		}
	}

	const formatTimestamp = (timestamp: number) => {
		return new Date(timestamp).toLocaleString()
	}

	const getSourceColor = (source: "cline" | "user" | "unknown") => {
		switch (source) {
			case "cline":
				return "text-blue-400"
			case "user":
				return "text-green-400"
			case "unknown":
				return "text-yellow-400"
		}
	}

	const getChangeTypeIcon = (type: "added" | "removed" | "modified") => {
		switch (type) {
			case "added":
				return "+"
			case "removed":
				return "-"
			case "modified":
				return "~"
		}
	}

	return (
		<div className="file-change-tracker p-4 border rounded-lg bg-vscode-editor-background">
			<div className="flex items-center justify-between mb-4">
				<h3 className="text-lg font-semibold">File Change Tracking</h3>
				<div className="flex gap-2">
					<VSCodeButton onClick={loadChangesSummary} disabled={isLoading}>
						{isLoading ? "Loading..." : "Refresh"}
					</VSCodeButton>
					<VSCodeButton onClick={exportChangeHistory} disabled={isLoading}>
						Export History
					</VSCodeButton>
				</div>
			</div>

			{changesSummary.length === 0 ? (
				<div className="text-center py-8 text-vscode-descriptionForeground">
					<p>No file changes tracked yet.</p>
					<p className="text-sm mt-2">File changes will appear here as Cline modifies files.</p>
				</div>
			) : (
				<div className="space-y-4">
					{/* Summary View */}
					<div className="grid gap-2">
						<h4 className="font-medium">Files Modified</h4>
						{changesSummary.map((summary) => (
							<div
								key={summary.filePath}
								className="flex items-center justify-between p-3 border rounded cursor-pointer hover:bg-vscode-list-hoverBackground"
								onClick={() => loadFileChanges(summary.filePath)}>
								<div className="flex-1">
									<div className="font-mono text-sm">{summary.filePath}</div>
									<div className="text-xs text-vscode-descriptionForeground">
										Last modified: {formatTimestamp(summary.lastModified)}
									</div>
								</div>
								<div className="flex gap-4 text-sm">
									<span className="text-blue-400">Cline: {summary.clineChanges}</span>
									<span className="text-green-400">User: {summary.userChanges}</span>
									<span className="text-vscode-descriptionForeground">Total: {summary.totalChanges}</span>
								</div>
							</div>
						))}
					</div>

					{/* Detailed View */}
					{selectedFile && fileChanges.length > 0 && (
						<div className="border-t pt-4">
							<h4 className="font-medium mb-3">
								Changes in <span className="font-mono">{selectedFile}</span>
							</h4>
							<div className="space-y-2 max-h-96 overflow-y-auto">
								{fileChanges.map((change, index) => (
									<div key={index} className="flex items-start gap-3 p-2 border rounded text-sm font-mono">
										<div className="flex items-center gap-2 min-w-0">
											<span
												className={`w-6 h-6 flex items-center justify-center rounded text-xs font-bold ${
													change.type === "added"
														? "bg-green-600 text-white"
														: change.type === "removed"
															? "bg-red-600 text-white"
															: "bg-yellow-600 text-white"
												}`}>
												{getChangeTypeIcon(change.type)}
											</span>
											<span className="text-vscode-descriptionForeground">L{change.lineNumber}</span>
											<span className={`font-semibold ${getSourceColor(change.source)}`}>
												{change.source}
											</span>
										</div>
										<div className="flex-1 min-w-0">
											<div className="truncate">{change.content}</div>
											{change.operation && (
												<div className="text-xs text-vscode-descriptionForeground mt-1">
													{change.operation}
													{change.searchReplaceBlock && (
														<span className="ml-2">
															(Block {change.searchReplaceBlock.blockIndex})
														</span>
													)}
												</div>
											)}
											<div className="text-xs text-vscode-descriptionForeground">
												{formatTimestamp(change.timestamp)}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}

			{/* Legend */}
			<div className="mt-4 pt-4 border-t">
				<h5 className="text-sm font-medium mb-2">Legend</h5>
				<div className="flex gap-4 text-xs">
					<span className="flex items-center gap-1">
						<span className="w-3 h-3 bg-blue-400 rounded"></span>
						Cline Changes
					</span>
					<span className="flex items-center gap-1">
						<span className="w-3 h-3 bg-green-400 rounded"></span>
						User Changes
					</span>
					<span className="flex items-center gap-1">
						<span className="w-3 h-3 bg-yellow-400 rounded"></span>
						Unknown Source
					</span>
				</div>
			</div>
		</div>
	)
}
