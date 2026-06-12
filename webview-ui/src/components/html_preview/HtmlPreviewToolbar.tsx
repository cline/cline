import type { ArtifactKernelInfoResponse, HtmlPreviewItem, PythonEnvironment } from "@shared/proto/cline/html_preview"
import React, { useState } from "react"
import { KebabMenu, type KebabMenuItem } from "@/components/common/KebabMenu"
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
	// — Side panel & edit mode (Phase: UI refinement) —
	sidePanelOpen: boolean
	onToggleSidePanel: () => void
	editModeActive: boolean
	onToggleEditMode: () => void
	pendingChangeCount?: number
	// — Existing handlers —
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
	// — Module-state persistence (Phase 1c) —
	onResetModuleState: () => void
	onCopyModuleState: () => void
}

// ─── Shared design tokens ────────────────────────────────────────────────────
const FG = "var(--vscode-foreground, #ddd)"
const BORDER = "var(--vscode-panel-border, rgba(255,255,255,0.12))"
const HOVER_BG = "rgba(255,255,255,0.06)"
const ACTIVE_BG = "rgba(0,163,255,0.10)"
const ACTIVE_BORDER = "rgba(0,163,255,0.35)"
const EDIT_ACTIVE_BG = "linear-gradient(135deg, rgba(0,163,255,0.22), rgba(0,221,255,0.18))"
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
			aria-label={title}
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
const GroupDivider = () => <span style={{ width: 1, height: 16, background: BORDER, flexShrink: 0, margin: "0 3px" }} />

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

// ─── Edit Mode pill button ───────────────────────────────────────────────────
const EditModeButton: React.FC<{
	active: boolean
	onClick: () => void
	pendingCount?: number
}> = ({ active, onClick, pendingCount = 0 }) => {
	const [hovered, setHovered] = useState(false)
	return (
		<button
			aria-label={active ? "Exit Edit Mode" : "Enter Edit Mode"}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				height: 24,
				padding: "0 10px",
				background: active ? EDIT_ACTIVE_BG : hovered ? HOVER_BG : "transparent",
				border: `1px solid ${active ? "rgba(0,221,255,0.55)" : BORDER}`,
				borderRadius: 12,
				color: active ? "#00DDFF" : FG,
				fontFamily: "var(--vscode-font-family, system-ui)",
				fontSize: 11,
				fontWeight: active ? 600 : 500,
				cursor: "pointer",
				transition: "all 0.15s",
				flexShrink: 0,
			}}
			title={active ? "Exit Edit Mode" : "Enter Edit Mode — edit prose, comment on any component"}
			type="button">
			<span className="codicon codicon-edit" style={{ fontSize: 12 }} />
			{active ? "Editing" : "Edit"}
			{active && pendingCount > 0 && (
				<span
					style={{
						background: "rgba(0,221,255,0.25)",
						color: "#00DDFF",
						borderRadius: 8,
						padding: "0 5px",
						fontSize: 10,
						fontWeight: 700,
					}}>
					{pendingCount}
				</span>
			)}
		</button>
	)
}

// ─── Side panel toggle (hamburger) ───────────────────────────────────────────
const SidePanelToggle: React.FC<{ open: boolean; onClick: () => void }> = ({ open, onClick }) => {
	const [hovered, setHovered] = useState(false)
	return (
		<button
			aria-label={open ? "Close side panel" : "Open side panel (Files, Modules, Skills, Comments)"}
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
				background: open ? ACTIVE_BG : hovered ? HOVER_BG : "transparent",
				border: `1px solid ${open ? ACTIVE_BORDER : hovered ? "rgba(255,255,255,0.22)" : "transparent"}`,
				borderRadius: 4,
				color: FG,
				cursor: "pointer",
				flexShrink: 0,
			}}
			title={open ? "Close side panel" : "Open side panel"}
			type="button">
			<span
				className={`codicon codicon-${open ? "layout-sidebar-left" : "layout-sidebar-left-off"}`}
				style={{ fontSize: 14 }}
			/>
		</button>
	)
}

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
		sidePanelOpen,
		onToggleSidePanel,
		editModeActive,
		onToggleEditMode,
		pendingChangeCount,
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
		onResetModuleState,
		onCopyModuleState,
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

	// ── Build kebab menu items (low-frequency utilities) ─────────────────────
	const kebabItems: KebabMenuItem[] = [
		{
			label: diagnosticsOpen ? "Hide diagnostics" : "Show diagnostics",
			icon: "info",
			onClick: onToggleDiagnostics,
			active: diagnosticsOpen,
		},
		{
			label: "Reset controls to defaults",
			icon: "discard",
			onClick: onResetModuleState,
			divider: true,
		},
		{ label: "Copy control state", icon: "clippy", onClick: onCopyModuleState },
		{ label: "Probe Python environment", icon: "beaker", onClick: onProbeEnvironment, divider: true },
		{ label: "Refresh Python environments", icon: "refresh", onClick: onRefreshEnvironments },
		{ label: "Restart kernel", icon: "debug-restart", onClick: onRestartKernel },
		{
			label: pathCopied ? "Path copied!" : "Copy file path",
			icon: pathCopied ? "check" : "copy",
			onClick: onCopyPath,
			disabled: !hasFilePath,
			divider: true,
		},
		{ label: "Open source in editor", icon: "file-code", onClick: onOpenInEditor, disabled: !hasFilePath },
		{ label: "Reload preview iframe", icon: "refresh", onClick: onRefresh },
		{ label: "Open in external browser", icon: "link-external", onClick: onOpenInBrowser, disabled: !hasFilePath },
		{ label: "Remove this preview", icon: "close", onClick: onClear, danger: true, divider: true },
	]

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

	// ── Expanded state: single row, three groups + kebab ─────────────────────
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
					<SidePanelToggle onClick={onToggleSidePanel} open={sidePanelOpen} />
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

				{/* ── Group 3: Kernel status + env + Edit Mode ─────── */}
				<GroupDivider />
				<KernelStatusChip
					isRunning={isRunning}
					kernelInfo={kernelInfo}
					runAllCurrent={runAllCurrent}
					runAllTotal={runAllTotal}
				/>
				<select
					aria-label="Python kernel environment"
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
				<EditModeButton active={editModeActive} onClick={onToggleEditMode} pendingCount={pendingChangeCount} />

				{/* ── Group 4: Kebab overflow ─────────────────────── */}
				<KebabMenu items={kebabItems} title="More actions" />
			</div>
		</div>
	)
}
