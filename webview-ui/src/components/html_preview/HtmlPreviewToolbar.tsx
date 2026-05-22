import type { ArtifactKernelInfoResponse, HtmlPreviewItem, PythonEnvironment } from "@shared/proto/cline/html_preview"
import React from "react"
import { CollapseToggleButton } from "./CollapseToggleButton"
import { KernelStatusChip } from "./KernelStatusChip"
import { usePersistedExpanded } from "./usePersistedExpanded"

export const ARTIFACT_TOOLBAR_EXPANDED_KEY = "aihydro.htmlPreview.artifactToolbarExpanded"

export interface HtmlPreviewToolbarProps {
	item: HtmlPreviewItem
	diagnosticsOpen: boolean
	pathCopied: boolean
	pythonEnvironments: PythonEnvironment[]
	activeProfileId: string
	kernelInfo: ArtifactKernelInfoResponse | null
	workspaceTrusted: boolean
	pythonCellCount: number
	isRunning: boolean
	runAllCurrent: number
	runAllTotal: number
	onRunCell: () => void
	onRunAll: () => void
	onRestartAndRunAll: () => void
	onStop: () => void
	onClearOutputs: () => void
	onToggleDiagnostics: () => void
	onRefresh: () => void
	onCopyPath: () => void
	onOpenInEditor: () => void
	onOpenInBrowser: () => void
	onRestartKernel: () => void
	onProfileChange: (profileId: string) => void
	onProbeEnvironment: () => void
	onRefreshEnvironments: () => void
	onClear: () => void
}

const ToolbarButton: React.FC<{
	onClick: () => void
	title: string
	disabled?: boolean
	children: React.ReactNode
}> = ({ onClick, title, disabled, children }) => (
	<button
		disabled={disabled}
		onClick={onClick}
		style={{
			padding: "3px 7px",
			fontSize: 11,
			fontWeight: 500,
			color: disabled ? "var(--vscode-disabledForeground, #888)" : "var(--vscode-foreground, #ddd)",
			background: "transparent",
			border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.18))",
			borderRadius: 3,
			cursor: disabled ? "not-allowed" : "pointer",
			opacity: disabled ? 0.5 : 1,
			lineHeight: 1.2,
		}}
		title={title}
		type="button">
		{children}
	</button>
)

const Divider = () => (
	<span
		style={{
			width: 1,
			height: 18,
			background: "var(--vscode-panel-border, rgba(255,255,255,0.18))",
			margin: "0 2px",
		}}
	/>
)

export const HtmlPreviewToolbar: React.FC<HtmlPreviewToolbarProps> = (props) => {
	const {
		item,
		diagnosticsOpen,
		pathCopied,
		pythonEnvironments,
		activeProfileId,
		kernelInfo,
		workspaceTrusted,
		pythonCellCount,
		isRunning,
		runAllCurrent,
		runAllTotal,
		onRunCell,
		onRunAll,
		onRestartAndRunAll,
		onStop,
		onClearOutputs,
		onToggleDiagnostics,
		onRefresh,
		onCopyPath,
		onOpenInEditor,
		onOpenInBrowser,
		onRestartKernel,
		onProfileChange,
		onProbeEnvironment,
		onRefreshEnvironments,
		onClear,
	} = props

	const [toolbarExpanded, toggleToolbar] = usePersistedExpanded(ARTIFACT_TOOLBAR_EXPANDED_KEY, true)

	const hasFilePath = Boolean(item.filePath)
	const fg = "var(--vscode-foreground, #ddd)"
	const border = "var(--vscode-panel-border, rgba(255,255,255,0.12))"
	const shortPath = item.filePath ? item.filePath.split(/[/\\]/).slice(-2).join("/") : null

	const runCellTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected in this artifact"
			: isRunning
				? "Wait for the current cell to finish"
				: "Run focused Python cell (or first cell)"

	const runAllTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected in this artifact"
			: isRunning
				? "Run All already in progress"
				: "Run all Python cells in order (continues current session)"

	const restartAllTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected in this artifact"
			: isRunning
				? "Wait for execution to finish"
				: "Restart kernel and run all cells (reproducible clean run)"

	const stopTitle = isRunning ? "Stop current cell execution" : "Kernel idle — nothing to stop"

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				borderBottom: `1px solid ${border}`,
				background: "var(--vscode-editor-background, #1e1e1e)",
				flex: "0 0 auto",
			}}>
			{!workspaceTrusted && (
				<div
					style={{
						padding: toolbarExpanded ? "6px 10px" : "4px 10px",
						fontSize: 11,
						background: "rgba(220, 160, 0, 0.12)",
						borderBottom: `1px solid ${border}`,
						color: "var(--vscode-editorWarning-foreground, #cca700)",
					}}>
					{toolbarExpanded
						? "Workspace is not trusted. Trust this workspace to run Python in HTML Preview."
						: "Workspace not trusted — expand toolbar for details."}
				</div>
			)}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: toolbarExpanded ? "6px 10px" : "4px 10px",
					gap: 8,
					minHeight: toolbarExpanded ? 36 : 28,
					flexWrap: "wrap",
				}}>
				<div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: 1 }}>
					<CollapseToggleButton
						expanded={toolbarExpanded}
						onToggle={toggleToolbar}
						title={toolbarExpanded ? "Collapse artifact toolbar" : "Expand artifact toolbar"}
					/>
					<span style={{ fontSize: 12, fontWeight: 600, color: fg, whiteSpace: "nowrap" }}>
						{item.title || "HTML Preview"}
					</span>
					{shortPath && (
						<span
							style={{
								fontSize: 10,
								color: "var(--vscode-descriptionForeground, #999)",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								maxWidth: toolbarExpanded ? 180 : 120,
							}}
							title={item.filePath}>
							{shortPath}
						</span>
					)}
				</div>
				{toolbarExpanded ? (
					<div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
						<ToolbarButton
							disabled={!workspaceTrusted || isRunning || pythonCellCount === 0}
							onClick={onRunCell}
							title={runCellTitle}>
							<span className="codicon codicon-play" style={{ fontSize: 13 }} />
						</ToolbarButton>
						<ToolbarButton
							disabled={!workspaceTrusted || isRunning || pythonCellCount === 0}
							onClick={onRunAll}
							title={runAllTitle}>
							<span className="codicon codicon-run-all" style={{ fontSize: 13 }} />
						</ToolbarButton>
						<ToolbarButton
							disabled={!workspaceTrusted || isRunning || pythonCellCount === 0}
							onClick={onRestartAndRunAll}
							title={restartAllTitle}>
							<span className="codicon codicon-debug-restart" style={{ fontSize: 13 }} />▶
						</ToolbarButton>
						<ToolbarButton disabled={!isRunning} onClick={onStop} title={stopTitle}>
							<span className="codicon codicon-debug-stop" style={{ fontSize: 13 }} />
						</ToolbarButton>
						<ToolbarButton onClick={onClearOutputs} title="Clear all cell outputs (kernel memory unchanged)">
							<span className="codicon codicon-clear-all" style={{ fontSize: 13 }} />
						</ToolbarButton>
						<Divider />
						<select
							onChange={(e) => onProfileChange(e.target.value)}
							style={{
								maxWidth: 160,
								fontSize: 11,
								padding: "2px 6px",
								background: "var(--vscode-input-background, #3c3c3c)",
								color: fg,
								border: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.18))",
								borderRadius: 3,
							}}
							title="Python kernel environment"
							value={activeProfileId}>
							{pythonEnvironments.length === 0 ? (
								<option value="">No Python found</option>
							) : (
								pythonEnvironments.map((env) => (
									<option key={env.profileId} value={env.profileId}>
										{env.label}
									</option>
								))
							)}
						</select>
						<KernelStatusChip
							isRunning={isRunning}
							kernelInfo={kernelInfo}
							runAllCurrent={runAllCurrent}
							runAllTotal={runAllTotal}
						/>
						<ToolbarButton onClick={onRefreshEnvironments} title="Refresh discovered Python environments">
							↻
						</ToolbarButton>
						<ToolbarButton onClick={onProbeEnvironment} title="Probe numpy, pandas, rasterio, matplotlib">
							env
						</ToolbarButton>
						<ToolbarButton onClick={onRestartKernel} title="Restart kernel (clears variables for this artifact)">
							↻ kernel
						</ToolbarButton>
					</div>
				) : (
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
						<KernelStatusChip
							isRunning={isRunning}
							kernelInfo={kernelInfo}
							runAllCurrent={runAllCurrent}
							runAllTotal={runAllTotal}
						/>
						{isRunning && (
							<ToolbarButton disabled={false} onClick={onStop} title={stopTitle}>
								<span className="codicon codicon-debug-stop" style={{ fontSize: 13 }} />
							</ToolbarButton>
						)}
					</div>
				)}
			</div>
			{toolbarExpanded && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "4px 10px 6px",
						gap: 8,
						borderTop: `1px solid ${border}`,
					}}>
					<div style={{ display: "flex", gap: 4 }}>
						<ToolbarButton
							onClick={onToggleDiagnostics}
							title={diagnosticsOpen ? "Hide technical diagnostics" : "Show technical diagnostics"}>
							{diagnosticsOpen ? "Hide details" : "Details"}
						</ToolbarButton>
						<ToolbarButton onClick={onRefresh} title="Refresh preview">
							↻ preview
						</ToolbarButton>
					</div>
					<div style={{ display: "flex", gap: 4 }}>
						<ToolbarButton
							disabled={!hasFilePath}
							onClick={onCopyPath}
							title={hasFilePath ? "Copy file path" : "No file path"}>
							{pathCopied ? "Copied" : "Copy path"}
						</ToolbarButton>
						<ToolbarButton disabled={!hasFilePath} onClick={onOpenInEditor} title="Open source file">
							Open
						</ToolbarButton>
						<ToolbarButton disabled={!hasFilePath} onClick={onOpenInBrowser} title="Open in browser">
							<span className="codicon codicon-link-external" style={{ fontSize: 13 }} />
						</ToolbarButton>
						<ToolbarButton onClick={onClear} title="Remove this preview">
							×
						</ToolbarButton>
					</div>
				</div>
			)}
		</div>
	)
}
