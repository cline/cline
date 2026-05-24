import React, { useCallback, useEffect, useRef, useState } from "react"
import { AccordionSection } from "@/components/common/AccordionSection"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { useHtmlPreviewContext } from "../../context/HtmlPreviewContext"
import { CollapseToggleButton } from "./CollapseToggleButton"
import { CommentSidebar } from "./CommentSidebar"
import HtmlPreviewView from "./HtmlPreviewView"
import ModulesMarketplaceView from "./marketplace/ModulesMarketplaceView"
import { usePersistedExpanded } from "./usePersistedExpanded"

export const PANEL_CHROME_EXPANDED_KEY = "aihydro.htmlPreview.panelChromeExpanded"

/**
 * HtmlPreviewPanel — container for the HTML Preview tab.
 *
 * Layout (like MapPanel):
 *   ┌─────────────┬──────────────────────────┐
 *   │ Sidebar     │  Main Content            │
 *   │ (workspace  │  ─ Toolbar              │
 *   │  files +    │  ─ Tab bar (loaded items)│
 *   │  loaded     │  ─ Preview iframe        │
 *   │  items)     │                          │
 *   └─────────────┴──────────────────────────┘
 *
 * Features:
 *  • Workspace file browser sidebar (auto-discovered .html/.htm files)
 *  • Loaded preview items with visibility/remove controls
 *  • Drag-and-drop file loading across the whole panel
 *  • Rich empty state with actionable controls
 */
export const HtmlPreviewPanel: React.FC = () => {
	const {
		items,
		activeItemId,
		setActiveItemId,
		removeItem,
		clearAllItems,
		addItemFromContent,
		loadWorkspaceFile,
		manifestsById,
	} = useHtmlPreviewContext()
	const { workspaceHtmlFiles } = useExtensionState()
	const activeItem = items.find((i) => i.id === activeItemId) || items[items.length - 1]

	const fileInputRef = useRef<HTMLInputElement>(null)
	const [isDragOver, setIsDragOver] = useState(false)
	const [loadStatus, setLoadStatus] = useState<{ kind: "idle" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [confirmingClear, setConfirmingClear] = useState(false)
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
	const [panelChromeExpanded, togglePanelChrome] = usePersistedExpanded(PANEL_CHROME_EXPANDED_KEY, true)
	const [activeSection, setActiveSection] = useState<"preview" | "modules">("preview")

	// ── File picker ─────────────────────────────────────────────────────────
	const onPickFiles = () => fileInputRef.current?.click()

	const loadFile = async (file: File): Promise<void> => {
		const text = await file.text()
		await addItemFromContent(file.name, text, file.name)
	}

	const onFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files
		if (!files || files.length === 0) {
			return
		}
		setLoadStatus({ kind: "idle", msg: "Loading…" })
		let loaded = 0
		const errors: string[] = []

		for (const file of Array.from(files)) {
			if (!/\.html?$/i.test(file.name)) {
				errors.push(`${file.name}: not an HTML file`)
				continue
			}
			try {
				await loadFile(file)
				loaded++
			} catch (err) {
				errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
			}
		}

		if (loaded > 0 && errors.length === 0) {
			setLoadStatus({ kind: "ok", msg: `Loaded ${loaded} file${loaded > 1 ? "s" : ""}.` })
		} else if (loaded > 0) {
			setLoadStatus({ kind: "ok", msg: `Loaded ${loaded}, ${errors.length} error${errors.length > 1 ? "s" : ""}.` })
		} else {
			setLoadStatus({ kind: "err", msg: errors[0] ?? "No files loaded." })
		}

		if (fileInputRef.current) {
			fileInputRef.current.value = ""
		}
		window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 5000)
	}

	// ── Drag-and-drop ───────────────────────────────────────────────────────
	const onDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = "copy"
		setIsDragOver(true)
	}, [])

	const onDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault()
		setIsDragOver(false)
	}, [])

	const onDrop = useCallback(
		async (e: React.DragEvent) => {
			e.preventDefault()
			setIsDragOver(false)
			const files = Array.from(e.dataTransfer.files).filter((f) => /\.html?$/i.test(f.name))
			if (files.length === 0) {
				return
			}
			setLoadStatus({ kind: "idle", msg: "Loading…" })
			let loaded = 0
			const errors: string[] = []
			for (const file of files) {
				try {
					await loadFile(file)
					loaded++
				} catch (err) {
					errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`)
				}
			}
			if (loaded > 0 && errors.length === 0) {
				setLoadStatus({ kind: "ok", msg: `Loaded ${loaded} file${loaded > 1 ? "s" : ""}.` })
			} else if (loaded > 0) {
				setLoadStatus({ kind: "ok", msg: `Loaded ${loaded}, ${errors.length} error${errors.length > 1 ? "s" : ""}.` })
			} else {
				setLoadStatus({ kind: "err", msg: errors[0] ?? "No files loaded." })
			}
			window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 5000)
		},
		[addItemFromContent],
	)

	// ── Clear all ───────────────────────────────────────────────────────────
	const handleClearAll = async () => {
		try {
			await clearAllItems()
		} catch (err) {
			console.error("Failed to clear all previews:", err)
		} finally {
			setConfirmingClear(false)
		}
	}

	// ── Activate a workspace file (load it if not already present) ─────────
	const activateWorkspaceFile = useCallback(
		async (filePath: string, name: string) => {
			const existing = items.find((i) => i.filePath === filePath)
			if (existing) {
				setActiveItemId(existing.id)
				return
			}
			// Not loaded yet — ask the extension to read and preview it
			setLoadStatus({ kind: "idle", msg: `Loading ${name}…` })
			try {
				await loadWorkspaceFile(filePath, name)
				setLoadStatus({ kind: "ok", msg: `Loaded ${name}.` })
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				setLoadStatus({ kind: "err", msg: `Failed to load ${name}: ${msg}` })
			}
			window.setTimeout(() => setLoadStatus({ kind: "idle", msg: "" }), 5000)
		},
		[items, setActiveItemId, loadWorkspaceFile],
	)

	const fg = "var(--vscode-foreground, #ddd)"
	const border = "var(--vscode-panel-border, rgba(255,255,255,0.12))"
	const _subtle = "var(--vscode-panel-background, rgba(255,255,255,0.06))"
	const danger = "var(--vscode-errorForeground, #dc3545)"
	const sidebarWidth = sidebarCollapsed ? 36 : 220

	// (No debug-banner hiding needed — the new VscodeHtmlPreviewProvider does
	// not inject a pre-React banner.)
	useEffect(() => undefined, [])

	return (
		<div
			className="html-preview-panel"
			onDragLeave={onDragLeave}
			onDragOver={onDragOver}
			onDrop={onDrop}
			style={{
				display: "flex",
				flexDirection: "row",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				position: "relative",
				background: "var(--vscode-editor-background, #1e1e1e)",
			}}>
			<input
				accept=".html,.htm"
				multiple
				onChange={onFilesPicked}
				ref={fileInputRef}
				style={{ display: "none" }}
				type="file"
			/>

			{/* Drag overlay */}
			{isDragOver && (
				<div
					style={{
						position: "absolute",
						inset: 0,
						zIndex: 50,
						background: "rgba(14,99,156,0.15)",
						border: "2px dashed var(--vscode-focusBorder, #0e639c)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						pointerEvents: "none",
					}}>
					<div
						style={{
							padding: "24px 32px",
							background: "var(--vscode-editor-background)",
							borderRadius: 8,
							boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
							textAlign: "center",
						}}>
						<div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
						<div style={{ fontSize: 14, fontWeight: 600, color: fg }}>Drop HTML files here</div>
						<div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, color: fg }}>.html · .htm</div>
					</div>
				</div>
			)}

			{/* ── Sidebar ───────────────────────────────────────────────────────── */}
			<div
				style={{
					width: sidebarWidth,
					minWidth: sidebarWidth,
					height: "100%",
					borderRight: `1px solid ${border}`,
					background: "var(--vscode-sideBar-background, var(--vscode-editor-background))",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					transition: "width 0.2s ease",
				}}>
				{/* Sidebar header */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "6px 8px",
						borderBottom: `1px solid ${border}`,
						minHeight: 32,
					}}>
					{!sidebarCollapsed && (
						<span
							style={{
								fontSize: 11,
								fontWeight: 700,
								color: fg,
								textTransform: "uppercase",
								letterSpacing: "0.4px",
							}}>
							Files
						</span>
					)}
					<button
						onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
						style={{
							padding: 2,
							background: "transparent",
							border: "none",
							color: fg,
							cursor: "pointer",
							opacity: 0.7,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
						title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
						type="button">
						{sidebarCollapsed ? (
							<svg
								fill="none"
								height="14"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
								width="14">
								<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" />
							</svg>
						) : (
							<svg
								fill="none"
								height="14"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
								width="14">
								<path d="M13 17l5-5-5-5M6 17l5-5-5-5" />
							</svg>
						)}
					</button>
				</div>

				{!sidebarCollapsed && (
					<div style={{ flex: 1, overflow: "auto" }}>
						{/* ─── Files accordion ──────────────────────────────────── */}
						<AccordionSection
							badge={workspaceHtmlFiles.length + items.length || undefined}
							defaultOpen={true}
							icon="files"
							persistKey="files"
							title="Files">
							{workspaceHtmlFiles.length > 0 && (
								<div style={{ marginBottom: 10 }}>
									<div
										style={{
											fontSize: 10,
											color: "var(--vscode-descriptionForeground, #999)",
											padding: "2px 12px 4px",
											fontWeight: 600,
										}}>
										Workspace ({workspaceHtmlFiles.length})
									</div>
									{workspaceHtmlFiles.map((file) => {
										const isLoaded = items.some((i) => i.filePath === file.path)
										return (
											<div
												key={file.path}
												onClick={() => activateWorkspaceFile(file.path, file.name)}
												style={{
													display: "flex",
													alignItems: "center",
													gap: 6,
													padding: "4px 12px",
													fontSize: 11,
													color: isLoaded ? "var(--vscode-list-activeSelectionForeground, #fff)" : fg,
													cursor: "pointer",
													background: isLoaded
														? "var(--vscode-list-activeSelectionBackground, #0e639c)"
														: "transparent",
													borderRadius: 3,
													margin: "0 4px 2px",
												}}
												title={file.path}>
												<span className="codicon codicon-globe" style={{ fontSize: 11, opacity: 0.7 }} />
												<span className="truncate" style={{ flex: 1, minWidth: 0 }}>
													{file.name}
												</span>
												{isLoaded && <span style={{ fontSize: 9, opacity: 0.5 }}>✓</span>}
											</div>
										)
									})}
								</div>
							)}
							{items.length > 0 && (
								<div>
									<div
										style={{
											fontSize: 10,
											color: "var(--vscode-descriptionForeground, #999)",
											padding: "2px 12px 4px",
											fontWeight: 600,
										}}>
										Loaded ({items.length})
									</div>
									{items.map((item) => {
										const isActive = item.id === activeItemId
										const manifest = manifestsById[item.id]
										const displayTitle = manifest?.title || item.title || "Preview"
										const authorLine = manifest?.authors
											?.map((a) => a?.name)
											.filter(Boolean)
											.join(", ")
										const subParts: string[] = []
										if (manifest?.level) subParts.push(String(manifest.level))
										if (manifest?.estimated_minutes) subParts.push(`${manifest.estimated_minutes} min`)
										if (manifest?.license) subParts.push(String(manifest.license))
										const subline = subParts.join(" · ")
										return (
											<SidebarItemCard
												authorLine={authorLine}
												displayTitle={displayTitle}
												fg={fg}
												isActive={isActive}
												isModule={Boolean(manifest)}
												key={item.id}
												onRemove={() => removeItem(item.id)}
												onSelect={() => setActiveItemId(item.id)}
												subline={subline}
											/>
										)
									})}
								</div>
							)}
							{workspaceHtmlFiles.length === 0 && items.length === 0 && (
								<div
									style={{
										padding: "12px 12px 8px",
										fontSize: 11,
										color: "var(--vscode-descriptionForeground, #888)",
									}}>
									No HTML files in this workspace.
								</div>
							)}
						</AccordionSection>

						{/* ─── Modules accordion ────────────────────────────────── */}
						<AccordionSection icon="library" persistKey="modules" title="Modules">
							<div style={{ padding: "6px 8px" }}>
								<button
									onClick={() => setActiveSection(activeSection === "modules" ? "preview" : "modules")}
									style={{
										width: "100%",
										padding: "6px 10px",
										borderRadius: 6,
										border: "1px solid var(--vscode-button-border, transparent)",
										background:
											activeSection === "modules"
												? "var(--vscode-button-background, #0e639c)"
												: "var(--vscode-button-secondaryBackground, rgba(125,211,252,0.1))",
										color:
											activeSection === "modules"
												? "var(--vscode-button-foreground, #fff)"
												: "var(--vscode-foreground, #cccccc)",
										fontFamily: "Poppins, system-ui, sans-serif",
										fontSize: 11,
										fontWeight: 600,
										cursor: "pointer",
									}}
									type="button">
									{activeSection === "modules" ? "Close Marketplace" : "Open Module Marketplace"}
								</button>
								<div
									style={{
										marginTop: 8,
										fontSize: 10,
										color: "var(--vscode-descriptionForeground, #888)",
										lineHeight: 1.4,
									}}>
									Browse and install community modules from the AI-Hydro marketplace.
								</div>
							</div>
						</AccordionSection>

						{/* ─── Skills accordion ─────────────────────────────────── */}
						<AccordionSection icon="symbol-class" persistKey="skills" title="Skills">
							<div
								style={{
									padding: "8px 10px",
									fontSize: 11,
									color: "var(--vscode-descriptionForeground, #888)",
									lineHeight: 1.5,
								}}>
								Skill management is in the main AI-Hydro chat panel sidebar. Use{" "}
								<code style={{ background: "rgba(0,221,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
									list_skills
								</code>{" "}
								and{" "}
								<code style={{ background: "rgba(0,221,255,0.1)", padding: "1px 4px", borderRadius: 3 }}>
									load_skill
								</code>{" "}
								MCP tools from the agent.
							</div>
						</AccordionSection>

						{/* ─── Comments accordion ───────────────────────────────── */}
						<AccordionSection icon="comment-discussion" persistKey="comments" title="Comments">
							{activeItem ? (
								<CommentSidebar
									iframeWindow={null /* future: pass actual iframe contentWindow */}
									moduleId={activeItem.id}
								/>
							) : (
								<div
									style={{
										padding: "12px",
										fontSize: 11,
										color: "var(--vscode-descriptionForeground, #888)",
									}}>
									Open a module to see and manage comments.
								</div>
							)}
						</AccordionSection>
					</div>
				)}

				{/* Sidebar footer — Add File + Clear All */}
				{!sidebarCollapsed && (
					<div
						style={{
							padding: "6px 8px",
							borderTop: `1px solid ${border}`,
							display: "flex",
							flexDirection: "column",
							gap: 4,
						}}>
						<button
							onClick={onPickFiles}
							style={{
								width: "100%",
								padding: "5px 0",
								fontSize: 11,
								fontWeight: 500,
								background: "var(--vscode-button-background, #0e639c)",
								color: "var(--vscode-button-foreground, #fff)",
								border: "none",
								borderRadius: 3,
								cursor: "pointer",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 4,
							}}
							type="button">
							<span className="codicon codicon-add" style={{ fontSize: 11 }} />
							Add File
						</button>
						{items.length > 0 &&
							(confirmingClear ? (
								<div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "center" }}>
									<span style={{ fontSize: 10, color: danger }}>Remove all {items.length}?</span>
									<button
										onClick={handleClearAll}
										style={{
											padding: "2px 7px",
											fontSize: 10,
											background: danger,
											color: "#fff",
											border: "none",
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										Yes
									</button>
									<button
										onClick={() => setConfirmingClear(false)}
										style={{
											padding: "2px 7px",
											fontSize: 10,
											background: "transparent",
											color: fg,
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										No
									</button>
								</div>
							) : (
								<button
									onClick={() => setConfirmingClear(true)}
									style={{
										width: "100%",
										padding: "3px 0",
										fontSize: 10,
										background: "transparent",
										color: danger,
										border: "none",
										cursor: "pointer",
										opacity: 0.7,
									}}
									title="Remove all loaded previews"
									type="button">
									Clear all previews
								</button>
							))}
					</div>
				)}
			</div>

			{/* ── Main Content ──────────────────────────────────────────────────── */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: "1 1 auto",
					minWidth: 0,
					minHeight: 0,
					overflow: "hidden",
				}}>
				{/* Panel chrome: header + tabs (collapsible) */}
				<div
					style={{
						borderBottom: `1px solid ${border}`,
						background: "var(--vscode-editor-background)",
						flex: "0 0 auto",
					}}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							padding: "0 8px 0 4px",
							gap: 6,
							height: 28,
						}}>
						{/* Left: collapse toggle + title + load status */}
						<div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0 }}>
							<CollapseToggleButton
								expanded={panelChromeExpanded}
								onToggle={togglePanelChrome}
								title={panelChromeExpanded ? "Collapse panel header" : "Expand panel header"}
							/>
							<span style={{ fontSize: 12, fontWeight: 600, color: fg, whiteSpace: "nowrap" }}>HTML Preview</span>
							{loadStatus.msg && (
								<span
									style={{
										fontSize: 10,
										color: loadStatus.kind === "err" ? danger : "var(--vscode-descriptionForeground, #888)",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}>
									· {loadStatus.msg}
								</span>
							)}
						</div>
						{/* Right: icon-only Modules toggle */}
						<button
							onClick={() => setActiveSection((s) => (s === "modules" ? "preview" : "modules"))}
							style={{
								width: 26,
								height: 26,
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								padding: 0,
								background: activeSection === "modules" ? "rgba(0,163,255,0.12)" : "transparent",
								border: activeSection === "modules" ? "1px solid rgba(0,163,255,0.35)" : "1px solid transparent",
								borderRadius: 4,
								color: activeSection === "modules" ? "var(--vscode-textLink-foreground, #00A3FF)" : fg,
								cursor: "pointer",
								flexShrink: 0,
							}}
							title={activeSection === "modules" ? "Back to preview" : "Learning Modules Marketplace"}
							type="button">
							<span className="codicon codicon-extensions" style={{ fontSize: 14 }} />
						</button>
					</div>

					{/* Tab bar for multiple previews */}
					{panelChromeExpanded && items.length > 1 && (
						<div
							className="flex items-center border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] overflow-x-auto"
							style={{ minHeight: 32 }}>
							{items.map((item) => {
								const isActive = item.id === activeItemId
								return (
									<div
										aria-selected={isActive}
										className={`group
													flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap
													transition-colors border-r border-[var(--vscode-panel-border)] cursor-pointer
													${
														isActive
															? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
															: "text-[var(--vscode-foreground)] hover:bg-[var(--vscode-list-hoverBackground)]"
													}
												`}
										key={item.id}
										onClick={() => setActiveItemId(item.id)}
										role="tab"
										title={item.title || "HTML Preview"}>
										<span className="truncate max-w-[120px]">{item.title || "Preview"}</span>
										<span
											aria-label={`Close ${item.title || "preview"}`}
											className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--vscode-button-secondaryHoverBackground)] transition-opacity cursor-pointer"
											onClick={(e) => {
												e.stopPropagation()
												removeItem(item.id)
											}}
											onKeyDown={(e) => {
												if (e.key === "Enter" || e.key === " ") {
													e.preventDefault()
													e.stopPropagation()
													removeItem(item.id)
												}
											}}
											role="button"
											tabIndex={0}
											title="Close preview">
											<svg
												fill="none"
												height="10"
												stroke="currentColor"
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth="2"
												viewBox="0 0 24 24"
												width="10">
												<line x1="18" x2="6" y1="6" y2="18" />
												<line x1="6" x2="18" y1="6" y2="18" />
											</svg>
										</span>
									</div>
								)
							})}
						</div>
					)}
				</div>

				{/* Main content area */}
				<div
					style={{
						flex: "1 1 auto",
						minHeight: 0,
						minWidth: 0,
						position: "relative",
						overflow: "hidden",
						display: "flex",
						flexDirection: "column",
					}}>
					{activeSection === "modules" ? (
						<div style={{ flex: "1 1 auto", overflowY: "auto", minHeight: 0 }}>
							<ModulesMarketplaceView />
						</div>
					) : items.length === 0 ? (
						<EmptyState isDragOver={isDragOver} onAddFile={onPickFiles} workspaceCount={workspaceHtmlFiles.length} />
					) : (
						<HtmlPreviewView
							item={activeItem}
							onToggleSidePanel={() => setSidebarCollapsed((v) => !v)}
							sidePanelOpen={!sidebarCollapsed}
						/>
					)}
				</div>
			</div>
		</div>
	)
}

// ─── Empty State ───────────────────────────────────────────────────────────

const EmptyState: React.FC<{ onAddFile: () => void; isDragOver: boolean; workspaceCount: number }> = ({
	onAddFile,
	isDragOver,
	workspaceCount,
}) => {
	const fg = "var(--vscode-foreground, #ddd)"
	const border = "var(--vscode-panel-border, rgba(255,255,255,0.12))"

	return (
		<div
			className="flex h-full w-full items-center justify-center"
			style={{
				background: "var(--vscode-editor-background)",
				opacity: isDragOver ? 0.3 : 1,
				transition: "opacity 0.2s",
			}}>
			<div
				className="flex flex-col items-center gap-4"
				style={{
					maxWidth: 420,
					padding: 32,
					textAlign: "center",
					color: fg,
				}}>
				{/* Icon */}
				<div
					style={{
						width: 64,
						height: 64,
						borderRadius: 12,
						background: "var(--vscode-button-background, #0e639c)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 28,
						marginBottom: 4,
					}}>
					📄
				</div>

				{/* Title */}
				<h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: fg }}>No HTML previews yet</h3>

				{/* Description */}
				<p style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.75, margin: 0, color: fg }}>
					{workspaceCount > 0
						? `${workspaceCount} HTML file${workspaceCount === 1 ? "" : "s"} discovered in workspace. Click one in the sidebar to load it.`
						: "Workspace HTML files are auto-discovered when you open this panel."}
					<br />
					You can also add files manually or drag-and-drop them here.
				</p>

				{/* Actions */}
				<div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
					<button
						onClick={onAddFile}
						style={{
							padding: "8px 16px",
							fontSize: 12,
							fontWeight: 500,
							background: "var(--vscode-button-background, #0e639c)",
							color: "var(--vscode-button-foreground, #fff)",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
						type="button">
						<span>＋</span>
						<span>Add HTML File</span>
					</button>
				</div>

				{/* Tips */}
				<div
					style={{
						marginTop: 12,
						padding: "10px 14px",
						background: "var(--vscode-textBlockQuote-background, rgba(255,255,255,0.04))",
						borderLeft: `3px solid var(--vscode-textBlockQuote-border, ${border})`,
						borderRadius: "0 4px 4px 0",
						textAlign: "left",
					}}>
					<div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: fg }}>How to add files:</div>
					<ul
						style={{
							fontSize: 11,
							lineHeight: 1.7,
							opacity: 0.7,
							margin: 0,
							paddingLeft: 16,
							color: fg,
						}}>
						<li>Open this panel — workspace .html files auto-load</li>
						<li>
							Click <strong>＋ Add File</strong> to browse your disk
						</li>
						<li>Drag-and-drop HTML files directly onto this panel</li>
						<li>
							Right-click an .html file in VS Code Explorer → <strong>Add to AI-Hydro HTML Preview</strong>
						</li>
						<li>
							Use the AI <strong>preview_html</strong> tool to render generated HTML
						</li>
					</ul>
				</div>
			</div>
		</div>
	)
}

// ─── SidebarItemCard ────────────────────────────────────────────────────────
// Rich 3-line card for loaded items: icon + title + author + metadata pill.
// Uses onMouseEnter/Leave for hover-fade close button (no CSS modules needed).

const SidebarItemCard: React.FC<{
	isActive: boolean
	isModule: boolean
	displayTitle: string
	authorLine: string | undefined
	subline: string
	fg: string
	onSelect: () => void
	onRemove: () => void
}> = ({ isActive, isModule, displayTitle, authorLine, subline, fg, onSelect, onRemove }) => {
	const [hovered, setHovered] = useState(false)

	const bg = isActive
		? "var(--vscode-list-activeSelectionBackground, #0e639c)"
		: hovered
			? "rgba(255,255,255,0.05)"
			: "transparent"

	const textColor = isActive ? "var(--vscode-list-activeSelectionForeground, #fff)" : fg
	const metaColor = isActive ? "rgba(255,255,255,0.7)" : "var(--vscode-descriptionForeground, #888)"

	return (
		<div
			onClick={onSelect}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: "flex",
				alignItems: "flex-start",
				gap: 6,
				padding: "6px 10px",
				cursor: "pointer",
				background: bg,
				borderLeft: isActive ? "2px solid var(--vscode-textLink-foreground, #00A3FF)" : "2px solid transparent",
				borderRadius: "0 3px 3px 0",
				margin: "0 4px 2px 2px",
				transition: "background 0.12s",
			}}>
			{/* Icon */}
			<span
				style={{
					fontSize: 14,
					flexShrink: 0,
					marginTop: 1,
					lineHeight: 1,
				}}>
				{isModule ? "🎓" : "📄"}
			</span>

			{/* Text column */}
			<span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
				<span
					style={{
						fontSize: 11,
						fontWeight: 600,
						color: textColor,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
					title={displayTitle}>
					{displayTitle}
				</span>
				{authorLine && (
					<span
						style={{
							fontSize: 10,
							color: metaColor,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
						title={authorLine}>
						{authorLine}
					</span>
				)}
				{subline && (
					<span
						style={{
							fontSize: 10,
							color: metaColor,
							opacity: 0.8,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}>
						{subline}
					</span>
				)}
			</span>

			{/* Close button — fades in on hover */}
			<button
				onClick={(e) => {
					e.stopPropagation()
					onRemove()
				}}
				style={{
					width: 18,
					height: 18,
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					padding: 0,
					background: "transparent",
					border: "none",
					color: textColor,
					cursor: "pointer",
					opacity: hovered || isActive ? 0.6 : 0,
					transition: "opacity 0.15s",
					flexShrink: 0,
					fontSize: 13,
					borderRadius: 3,
				}}
				title="Remove preview"
				type="button">
				×
			</button>
		</div>
	)
}

export default HtmlPreviewPanel
