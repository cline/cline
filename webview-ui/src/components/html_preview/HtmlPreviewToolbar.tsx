import type { ArtifactKernelInfoResponse, HtmlPreviewItem, PythonEnvironment } from "@shared/proto/cline/html_preview"
import React, { useState } from "react"
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

// ─── Shared design tokens ────────────────────────────────────────────────────
const FG = "var(--vscode-foreground, #ddd)"
const BORDER = "var(--vscode-panel-border, rgba(255,255,255,0.12))"
const HOVER_BG = "rgba(255,255,255,0.06)"
const ACTIVE_BG = "rgba(0,163,255,0.10)"
const ACTIVE_BORDER = "rgba(0,163,255,0.35)"
const DISABLED_FG = "var(--vscode-disabledForeground, #555)"

// ─── IconBtn primitive ───────────────────────────────────────────────────────
interface IconBtnProps {
	onClick: () => void
	title: string
	disabled?: boolean
	danger?: boolean
	active?: boolean
	children: React.ReactNode
}

const IconBtn: React.FC<IconBtnProps> = ({ onClick, title, disabled, danger, active, children }) => {
	const [hovered, setHovered] = useState(false)

	const fg = disabled ? DISABLED_FG : danger ? "var(--vscode-errorForeground, #f14c4c)" : FG
	const bg = active ? ACTIVE_BG : hovered && !disabled ? HOVER_BG : "transparent"
	const border = active
		? `1px solid ${ACTIVE_BORDER}`
		: `1px solid ${hovered && !disabled ? "rgba(255,255,255,0.22)" : "transparent"}`

	return (
		<button
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				width: 26,
				height: 26,
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 0,
				background: bg,
				border,
				borderRadius: 4,
				color: fg,
				cursor: disabled ? "not-allowed" : "pointer",
				opacity: disabled ? 0.4 : 1,
				transition: "background 0.12s, border-color 0.12s",
				flexShrink: 0,
			}}
			title={title}
			type="button">
			{children}
		</button>
	)
}

// ─── Vertical divider between groups ────────────────────────────────────────
const GroupDivider = () => (
	<span
		style={{
			width: 1,
			height: 16,
			background: BORDER,
			flexShrink: 0,
			margin: "0 3px",
		}}
	/>
)

// ─── Run controls pill wrapper ───────────────────────────────────────────────
const RunGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<div
		style={{
			display: "inline-flex",
			alignItems: "center",
			gap: 1,
			padding: "0 2px",
			background: "rgba(255,255,255,0.03)",
			border: `1px solid ${BORDER}`,
			borderRadius: 5,
		}}>
		{children}
	</div>
)

// ─── Main toolbar ────────────────────────────────────────────────────────────
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
	const shortPath = item.filePath ? item.filePath.split(/[/\\]/).slice(-2).join("/") : null

	const canRun = workspaceTrusted && !isRunning && pythonCellCount > 0

	const runCellTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected"
			: isRunning
				? "Wait for current execution to finish"
				: "Run focused cell (or first cell)"

	const runAllTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected"
			: isRunning
				? "Run All already in progress"
				: "Run all Python cells in order"

	const restartAllTitle = !workspaceTrusted
		? "Trust workspace to run Python"
		: pythonCellCount === 0
			? "No Python cells detected"
			: isRunning
				? "Wait for execution to finish"
				: "Restart kernel and run all cells (clean run)"

	const stopTitle = isRunning ? "Interrupt execution" : "Nothing running"

	// ── Workspace-not-trusted banner ─────────────────────────────────────────
	const trustBanner = !workspaceTrusted ? (
		<div
			style={{
				padding: "5px 10px",
				fontSize: 11,
				background: "rgba(204,160,0,0.10)",
				borderBottom: `1px solid ${BORDER}`,
				color: "var(--vscode-editorWarning-foreground, #cca700)",
			}}>
			Workspace is not trusted — Python execution is disabled.
		</div>
	) : null

	// ── Collapsed state: minimal strip ───────────────────────────────────────
	if (!toolbarExpanded) {
		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					borderBottom: `1px solid ${BORDER}`,
					background: "var(--vscode-editor-background, #1e1e1e)",
					flex: "0 0 auto",
				}}>
				{trustBanner}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "0 6px 0 4px",
						height: 28,
						gap: 6,
					}}>
					{/* Left: toggle + title */}
					<div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: 1 }}>
						<CollapseToggleButton expanded={false} onToggle={toggleToolbar} title="Expand artifact toolbar" />
						<span
							style={{
								fontSize: 12,
								fontWeight: 600,
								color: FG,
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
							}}>
							{item.title || "HTML Preview"}
						</span>
					</div>
					{/* Right: status chip + stop if running */}
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
						<KernelStatusChip
							isRunning={isRunning}
							kernelInfo={kernelInfo}
							runAllCurrent={runAllCurrent}
							runAllTotal={runAllTotal}
						/>
						{isRunning && (
							<IconBtn danger onClick={onStop} title="Interrupt execution">
								<span className="codicon codicon-debug-stop" style={{ fontSize: 12 }} />
							</IconBtn>
						)}
					</div>
				</div>
			</div>
		)
	}

	// ── Expanded state: single-row, 4 groups ─────────────────────────────────
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				borderBottom: `1px solid ${BORDER}`,
				background: "var(--vscode-editor-background, #1e1e1e)",
				flex: "0 0 auto",
			}}>
			{trustBanner}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					padding: "0 6px 0 4px",
					height: 36,
					gap: 4,
					overflow: "hidden",
				}}>
				{/* ── Group 1: Identity ───────────────────────────── */}
				<div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
					<CollapseToggleButton expanded={true} onToggle={toggleToolbar} title="Collapse artifact toolbar" />
					<span
						style={{
							fontSize: 12,
							fontWeight: 600,
							color: FG,
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							maxWidth: 200,
						}}>
						{item.title || "HTML Preview"}
					</span>
					{shortPath && (
						<span
							style={{
								fontSize: 10,
								color: "var(--vscode-descriptionForeground, #888)",
								whiteSpace: "nowrap",
								overflow: "hidden",
								textOverflow: "ellipsis",
								maxWidth: 140,
								flexShrink: 1,
							}}
							title={item.filePath}>
							{shortPath}
						</span>
					)}
				</div>

				{/* ── Group 2: Run controls ───────────────────────── */}
				<GroupDivider />
				<RunGroup>
					<IconBtn disabled={!canRun} onClick={onRunCell} title={runCellTitle}>
						<span className="codicon codicon-play" style={{ fontSize: 13 }} />
					</IconBtn>
					<IconBtn disabled={!canRun} onClick={onRunAll} title={runAllTitle}>
						<span className="codicon codicon-run-all" style={{ fontSize: 13 }} />
					</IconBtn>
					<IconBtn disabled={!canRun} onClick={onRestartAndRunAll} title={restartAllTitle}>
						<span className="codicon codicon-debug-restart" style={{ fontSize: 12 }} />
						<span style={{ fontSize: 9, marginLeft: 1 }}>▶</span>
					</IconBtn>
					<IconBtn danger={isRunning} disabled={!isRunning} onClick={onStop} title={stopTitle}>
						<span className="codicon codicon-debug-stop" style={{ fontSize: 13 }} />
					</IconBtn>
					<IconBtn onClick={onClearOutputs} title="Clear all cell outputs (kernel memory unchanged)">
						<span className="codicon codicon-clear-all" style={{ fontSize: 13 }} />
					</IconBtn>
				</RunGroup>

				{/* ── Group 3: Kernel ─────────────────────────────── */}
				<GroupDivider />
				<KernelStatusChip
					isRunning={isRunning}
					kernelInfo={kernelInfo}
					runAllCurrent={runAllCurrent}
					runAllTotal={runAllTotal}
				/>
				<select
					onChange={(e) => onProfileChange(e.target.value)}
					style={{
						maxWidth: 130,
						fontSize: 11,
						padding: "2px 4px",
						height: 22,
						background: "var(--vscode-input-background, #3c3c3c)",
						color: FG,
						border: `1px solid ${BORDER}`,
						borderRadius: 3,
						flexShrink: 0,
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
				<IconBtn onClick={onRefreshEnvironments} title="Refresh Python environments">
					<span className="codicon codicon-refresh" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn onClick={onRestartKernel} title="Restart kernel (clears variables)">
					<span className="codicon codicon-debug-restart" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn onClick={onProbeEnvironment} title="Probe environment (numpy, pandas, rasterio, matplotlib)">
					<span className="codicon codicon-beaker" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn
					active={diagnosticsOpen}
					onClick={onToggleDiagnostics}
					title={diagnosticsOpen ? "Hide diagnostics" : "Show technical diagnostics"}>
					<span className="codicon codicon-settings-gear" style={{ fontSize: 13 }} />
				</IconBtn>

				{/* ── Group 4: File ops ───────────────────────────── */}
				<GroupDivider />
				<IconBtn
					disabled={!hasFilePath}
					onClick={onCopyPath}
					title={hasFilePath ? (pathCopied ? "Copied!" : "Copy file path") : "No file path"}>
					<span
						className={`codicon ${pathCopied ? "codicon-check" : "codicon-copy"}`}
						style={{ fontSize: 13, color: pathCopied ? "#89d185" : undefined }}
					/>
				</IconBtn>
				<IconBtn disabled={!hasFilePath} onClick={onOpenInEditor} title="Open source file in editor">
					<span className="codicon codicon-file-code" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn onClick={onRefresh} title="Reload preview iframe">
					<span className="codicon codicon-refresh" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn disabled={!hasFilePath} onClick={onOpenInBrowser} title="Open in external browser">
					<span className="codicon codicon-link-external" style={{ fontSize: 13 }} />
				</IconBtn>
				<IconBtn onClick={onClear} title="Remove this preview">
					<span className="codicon codicon-close" style={{ fontSize: 13 }} />
				</IconBtn>
			</div>
		</div>
	)
}
