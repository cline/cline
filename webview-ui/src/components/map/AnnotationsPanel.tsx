import React, { useCallback, useRef, useState } from "react"
import { type ExportFormat, exportAnnotations } from "./annotationExport"
import {
	type AnnotationCollection,
	type AnnotationPriority,
	type AnnotationStatus,
	annotationCenter,
	formatAnnotationsAsCsv,
	importAnnotationsCsv,
	loadCollections,
	type MapAnnotation,
	newCollection,
	PRESET_COLORS,
	saveAnnotations,
	saveCollections,
} from "./annotationStorage"
import { addToMyGallery } from "./galleryStorage"
import { askAgentAboutAnnotation, askAgentAboutBatchAnnotations } from "./mapAgentBridge"

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnnotationsPanelProps {
	annotations: MapAnnotation[]
	setAnnotations: React.Dispatch<React.SetStateAction<MapAnnotation[]>>
	onFlyTo: (lon: number, lat: number) => void
	onStartDrawing: (type: "point" | "polygon" | "line") => void
	mapStyle?: "dark" | "light"
	visibleLayerNames?: string[]
	/** Called after saving to My Gallery so the parent can sync React state. */
	onSaveToGallery?: (item: import("./galleryStorage").MyGalleryItem) => void
}

// ─── Status / Priority labels ─────────────────────────────────────────────────

const STATUS_OPTS: { value: AnnotationStatus; label: string; color: string }[] = [
	{ value: "open", label: "● Open", color: "#6b7280" },
	{ value: "in-progress", label: "◑ In Progress", color: "#f59e0b" },
	{ value: "reviewed", label: "◉ Reviewed", color: "#06b6d4" },
	{ value: "done", label: "✓ Done", color: "#22c55e" },
]

const PRIORITY_OPTS: { value: AnnotationPriority; label: string; color: string }[] = [
	{ value: "low", label: "▽ Low", color: "#6b7280" },
	{ value: "medium", label: "◈ Medium", color: "#f59e0b" },
	{ value: "high", label: "⚡ High", color: "#ef4444" },
]

const TYPE_ICONS: Record<string, string> = { point: "📍", polygon: "⬠", line: "〰" }

// ─── Small sub-components ────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: AnnotationStatus }> = ({ status }) => {
	const opt = STATUS_OPTS.find((s) => s.value === status) ?? STATUS_OPTS[0]
	return <span style={{ fontSize: 9, color: opt.color, whiteSpace: "nowrap", fontWeight: 600, opacity: 0.9 }}>{opt.label}</span>
}

const PriorityBadge: React.FC<{ priority: AnnotationPriority | null }> = ({ priority }) => {
	if (!priority) return null
	const opt = PRIORITY_OPTS.find((p) => p.value === priority)
	if (!opt) return null
	return (
		<span
			style={{
				fontSize: 9,
				color: opt.color,
				whiteSpace: "nowrap",
				fontWeight: 600,
				padding: "1px 5px",
				background: `${opt.color}22`,
				borderRadius: 8,
			}}>
			{opt.label}
		</span>
	)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export const AnnotationsPanel: React.FC<AnnotationsPanelProps> = ({
	annotations,
	setAnnotations,
	onFlyTo,
	onStartDrawing,
	mapStyle = "dark",
	visibleLayerNames = [],
	onSaveToGallery,
}) => {
	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const border = isDark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"
	const subtle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
	const subtleBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
	const accent = "#6366f1"
	const inputStyle: React.CSSProperties = {
		fontSize: 11,
		padding: "4px 7px",
		background: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
		color: fg,
		border: `1px solid ${border}`,
		borderRadius: 4,
		fontFamily: "inherit",
		width: "100%",
		boxSizing: "border-box",
	}

	// ── State ───────────────────────────────────────────────────────────────
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [agentBusy, setAgentBusy] = useState<string | false>(false)
	const [agentError, setAgentError] = useState<string | null>(null)
	const [batchOpen, setBatchOpen] = useState(false)
	const [batchInstruction, setBatchInstruction] = useState("")
	const [gallerySaveOpen, setGallerySaveOpen] = useState(false)
	const [galleryTitle, setGalleryTitle] = useState("")
	const [galleryDesc, setGalleryDesc] = useState("")
	const [galleryTagsRaw, setGalleryTagsRaw] = useState("")
	const [search, setSearch] = useState("")
	const [filterStatus, setFilterStatus] = useState<AnnotationStatus | "all">("all")
	const [activeCollectionId, setActiveCollectionId] = useState<string | "all">("all")
	const [collections, setCollections] = useState<AnnotationCollection[]>(() => loadCollections())
	const [showExportMenu, setShowExportMenu] = useState(false)
	const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
	const exportBtnRef = useRef<HTMLDivElement>(null)

	// ── Helpers ─────────────────────────────────────────────────────────────

	const saveAnns = useCallback(
		(next: MapAnnotation[]) => {
			setAnnotations(next)
			saveAnnotations(next)
		},
		[setAnnotations],
	)

	const saveCols = useCallback((next: AnnotationCollection[]) => {
		setCollections(next)
		saveCollections(next)
	}, [])

	const updateAnnotation = useCallback(
		(id: string, patch: Partial<MapAnnotation>) => {
			setAnnotations((prev) => {
				const next = prev.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a))
				saveAnnotations(next)
				return next
			})
		},
		[setAnnotations],
	)

	const deleteAnn = useCallback(
		(id: string) => {
			setAnnotations((prev) => {
				const next = prev.filter((a) => a.id !== id)
				saveAnnotations(next)
				return next
			})
		},
		[setAnnotations],
	)

	const duplicateAnn = useCallback(
		(ann: MapAnnotation) => {
			const now = new Date().toISOString()
			const copy: MapAnnotation = {
				...ann,
				id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
				name: `${ann.name} (copy)`,
				createdAt: now,
				updatedAt: now,
			}
			setAnnotations((prev) => {
				const next = [...prev, copy]
				saveAnnotations(next)
				return next
			})
		},
		[setAnnotations],
	)

	// ── Filter ──────────────────────────────────────────────────────────────

	const filteredAnnotations = annotations.filter((ann) => {
		if (filterStatus !== "all" && ann.status !== filterStatus) return false
		if (activeCollectionId !== "all" && !ann.collectionIds.includes(activeCollectionId)) return false
		if (search) {
			const q = search.toLowerCase()
			return (
				ann.name.toLowerCase().includes(q) ||
				ann.notes.toLowerCase().includes(q) ||
				ann.tags.some((t) => t.toLowerCase().includes(q))
			)
		}
		return true
	})

	// ── Collections ─────────────────────────────────────────────────────────

	const handleNewCollection = () => {
		const col = newCollection(collections.length)
		const next = [...collections, col]
		saveCols(next)
		setEditingCollectionId(col.id)
		setActiveCollectionId(col.id)
	}

	const handleDeleteCollection = (id: string) => {
		const next = collections.filter((c) => c.id !== id)
		saveCols(next)
		if (activeCollectionId === id) setActiveCollectionId("all")
	}

	// ── Import ──────────────────────────────────────────────────────────────

	const handleImport = async () => {
		const input = document.createElement("input")
		input.type = "file"
		input.accept = ".csv"
		input.onchange = async (e) => {
			const file = (e.target as HTMLInputElement).files?.[0]
			if (!file) return
			const imported = await importAnnotationsCsv(file, annotations.length)
			if (imported.length > 0) {
				const next = [...annotations, ...(imported as MapAnnotation[])]
				saveAnns(next)
			}
		}
		input.click()
	}

	// ── Agent ────────────────────────────────────────────────────────────────

	const handleAskAgent = async (ann: MapAnnotation) => {
		if (agentBusy) return
		setAgentBusy(ann.id)
		setAgentError(null)
		try {
			const result = await askAgentAboutAnnotation({
				annotation: {
					name: ann.name,
					notes: ann.notes,
					aiPrompt: ann.aiPrompt,
					tags: ann.tags,
					type: ann.type,
					geometry: ann.geometry,
					createdAt: ann.createdAt,
					status: ann.status,
					priority: ann.priority,
				},
				visibleLayerNames,
			})
			if (!result.ok) {
				setAgentError(result.error || "Agent task failed. Is the AI-Hydro chat panel open?")
			}
		} catch (e) {
			setAgentError(e instanceof Error ? e.message : "Unknown error")
		} finally {
			setAgentBusy(false)
		}
	}

	const handleBatchAskAgent = async () => {
		const target = activeCollectionId !== "all" ? filteredAnnotations : annotations
		if (target.length === 0 || agentBusy) return
		setAgentBusy("batch")
		setAgentError(null)
		try {
			const csvTable = formatAnnotationsAsCsv(target)
			const col = collections.find((c) => c.id === activeCollectionId)
			const result = await askAgentAboutBatchAnnotations({
				csvTable,
				userInstruction:
					batchInstruction ||
					(col ? `Analyze the annotations in the "${col.name}" collection. ${col.description}` : undefined),
				visibleLayerNames,
			})
			if (result.ok) {
				setBatchOpen(false)
				setBatchInstruction("")
			} else {
				setAgentError(result.error || "Batch agent task failed. Is the AI-Hydro chat panel open?")
			}
		} catch (e) {
			setAgentError(e instanceof Error ? e.message : "Unknown error")
		} finally {
			setAgentBusy(false)
		}
	}

	// ── Export ───────────────────────────────────────────────────────────────

	const handleExport = async (format: ExportFormat) => {
		setShowExportMenu(false)
		const target = filteredAnnotations.length > 0 ? filteredAnnotations : annotations
		const col = collections.find((c) => c.id === activeCollectionId)
		await exportAnnotations(format, target, col)
	}

	// ─── Render ───────────────────────────────────────────────────────────────

	const sectionBorder = `1px solid ${border}`

	return (
		<div style={{ marginTop: 12, paddingTop: 12, borderTop: sectionBorder }}>
			{/* ── Toolbar ── */}
			<div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 4, flexWrap: "wrap" }}>
				<span
					style={{
						fontSize: 11,
						fontWeight: 700,
						flex: 1,
						opacity: 0.9,
						whiteSpace: "nowrap",
						letterSpacing: "0.01em",
					}}>
					🏷️ Smart Annotations
				</span>
				<button
					onClick={() => {
						setAgentError(null)
						onStartDrawing("point")
					}}
					style={{
						fontSize: 10,
						padding: "2px 7px",
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						cursor: "pointer",
					}}
					title="Drop a pin marker"
					type="button">
					📍 Pin
				</button>
				<button
					onClick={() => {
						setAgentError(null)
						onStartDrawing("polygon")
					}}
					style={{
						fontSize: 10,
						padding: "2px 7px",
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						cursor: "pointer",
					}}
					title="Draw a polygon"
					type="button">
					⬠ Poly
				</button>
				<button
					onClick={() => {
						setAgentError(null)
						onStartDrawing("line")
					}}
					style={{
						fontSize: 10,
						padding: "2px 7px",
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						cursor: "pointer",
					}}
					title="Draw a line"
					type="button">
					〰 Line
				</button>
				<button
					onClick={handleImport}
					style={{
						fontSize: 10,
						padding: "2px 7px",
						background: "transparent",
						color: fg,
						border: `1px solid ${border}`,
						borderRadius: 4,
						cursor: "pointer",
					}}
					title="Import from CSV"
					type="button">
					⬆ Import
				</button>

				{/* Export dropdown */}
				<div ref={exportBtnRef} style={{ position: "relative" }}>
					<button
						disabled={annotations.length === 0}
						onClick={() => setShowExportMenu((v) => !v)}
						style={{
							fontSize: 10,
							padding: "2px 7px",
							background: "transparent",
							color: fg,
							border: `1px solid ${border}`,
							borderRadius: 4,
							cursor: annotations.length > 0 ? "pointer" : "default",
							opacity: annotations.length > 0 ? 1 : 0.4,
						}}
						title="Export annotations"
						type="button">
						⬇ Export ▾
					</button>
					{showExportMenu && (
						<div
							style={{
								position: "absolute",
								right: 0,
								top: "calc(100% + 4px)",
								zIndex: 200,
								background: isDark ? "#1e1e2e" : "#fff",
								border: sectionBorder,
								borderRadius: 6,
								padding: "4px 0",
								minWidth: 140,
								boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
							}}>
							{(["csv", "geojson", "kml", "kmz", "shapefile", "markdown"] as ExportFormat[]).map((fmt) => (
								<button
									key={fmt}
									onClick={() => handleExport(fmt)}
									style={{
										display: "block",
										width: "100%",
										padding: "5px 12px",
										fontSize: 10,
										background: "none",
										color: fg,
										border: "none",
										textAlign: "left",
										cursor: "pointer",
										whiteSpace: "nowrap",
									}}
									type="button">
									{fmt === "csv"
										? "📊 CSV"
										: fmt === "geojson"
											? "🌐 GeoJSON"
											: fmt === "kml"
												? "🌍 KML"
												: fmt === "kmz"
													? "🌍 KMZ (zipped)"
													: fmt === "shapefile"
														? "📦 Shapefile (.zip)"
														: "📝 Markdown Report"}
								</button>
							))}
						</div>
					)}
				</div>
			</div>

			{/* ── Collections tabs ── */}
			<div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
				<button
					onClick={() => setActiveCollectionId("all")}
					style={{
						fontSize: 9,
						padding: "2px 8px",
						borderRadius: 12,
						border: `1px solid ${activeCollectionId === "all" ? accent : border}`,
						background: activeCollectionId === "all" ? `${accent}22` : "transparent",
						color: activeCollectionId === "all" ? "#a5b4fc" : fg,
						cursor: "pointer",
						fontWeight: activeCollectionId === "all" ? 700 : 400,
					}}
					type="button">
					All ({annotations.length})
				</button>
				{collections.map((col) => {
					const count = annotations.filter((a) => a.collectionIds.includes(col.id)).length
					const isActive = activeCollectionId === col.id
					return editingCollectionId === col.id ? (
						<input
							autoFocus
							key={col.id}
							onBlur={() => setEditingCollectionId(null)}
							onChange={(e) => {
								const next = collections.map((c) => (c.id === col.id ? { ...c, name: e.target.value } : c))
								saveCols(next)
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") setEditingCollectionId(null)
							}}
							style={{ ...inputStyle, width: 90, padding: "1px 6px", fontSize: 9 }}
							value={col.name}
						/>
					) : (
						<div key={col.id} style={{ display: "flex", alignItems: "center", gap: 1 }}>
							<button
								onClick={() => setActiveCollectionId(col.id)}
								style={{
									fontSize: 9,
									padding: "2px 8px",
									borderRadius: "12px 0 0 12px",
									border: `1px solid ${isActive ? col.color : border}`,
									background: isActive ? `${col.color}22` : "transparent",
									color: isActive ? col.color : fg,
									cursor: "pointer",
									fontWeight: isActive ? 700 : 400,
								}}
								type="button">
								<span
									style={{
										display: "inline-block",
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: col.color,
										marginRight: 4,
										verticalAlign: "middle",
									}}
								/>
								{col.name} ({count})
							</button>
							<button
								onClick={() => setEditingCollectionId(col.id)}
								style={{
									fontSize: 8,
									padding: "2px 4px",
									borderRadius: 0,
									border: `1px solid ${isActive ? col.color : border}`,
									borderLeft: "none",
									background: "transparent",
									color: fg,
									cursor: "pointer",
									opacity: 0.5,
								}}
								title="Rename collection"
								type="button">
								✏
							</button>
							<button
								onClick={() => handleDeleteCollection(col.id)}
								style={{
									fontSize: 8,
									padding: "2px 4px",
									borderRadius: "0 12px 12px 0",
									border: `1px solid ${isActive ? col.color : border}`,
									borderLeft: "none",
									background: "transparent",
									color: "#ef4444",
									cursor: "pointer",
									opacity: 0.6,
								}}
								title="Delete collection"
								type="button">
								✕
							</button>
						</div>
					)
				})}
				<button
					onClick={handleNewCollection}
					style={{
						fontSize: 9,
						padding: "2px 7px",
						borderRadius: 12,
						border: `1px dashed ${border}`,
						background: "transparent",
						color: fg,
						cursor: "pointer",
						opacity: 0.6,
					}}
					type="button">
					+ Collection
				</button>
			</div>

			{/* ── Search + Filter ── */}
			<div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
				<input
					onChange={(e) => setSearch(e.target.value)}
					placeholder="Search name, notes, tags…"
					style={{ ...inputStyle, flex: 1 }}
					value={search}
				/>
				<select
					onChange={(e) => setFilterStatus(e.target.value as AnnotationStatus | "all")}
					style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
					value={filterStatus}>
					<option value="all">All status</option>
					{STATUS_OPTS.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>
			</div>

			{/* ── Error banner ── */}
			{agentError && (
				<div
					style={{
						marginBottom: 8,
						padding: "5px 8px",
						background: "rgba(239,68,68,0.1)",
						border: "1px solid rgba(239,68,68,0.3)",
						borderRadius: 4,
						fontSize: 10,
						color: "#f87171",
						display: "flex",
						alignItems: "center",
						gap: 6,
					}}>
					<span style={{ flex: 1 }}>⚠ {agentError}</span>
					<button
						onClick={() => setAgentError(null)}
						style={{
							background: "none",
							border: "none",
							color: "#f87171",
							cursor: "pointer",
							fontSize: 12,
							padding: 0,
						}}
						type="button">
						✕
					</button>
				</div>
			)}

			{/* ── Batch Agent Composer ── */}
			{batchOpen && (
				<div
					style={{
						marginBottom: 10,
						padding: 10,
						background: isDark ? "rgba(99,102,241,0.07)" : "rgba(99,102,241,0.04)",
						border: "1px solid rgba(99,102,241,0.3)",
						borderRadius: 6,
					}}>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
						<span style={{ fontSize: 11, fontWeight: 700, color: "#a5b4fc", flex: 1 }}>✨ Batch Agent Analysis</span>
						<span style={{ fontSize: 9, opacity: 0.6 }}>
							{filteredAnnotations.length} annotation{filteredAnnotations.length !== 1 ? "s" : ""}
						</span>
					</div>
					<div style={{ fontSize: 10, opacity: 0.65, lineHeight: 1.5, marginBottom: 6 }}>
						All annotation coordinates, geometry, notes, and tags will be sent as a CSV table. Add batch-level
						instructions below (optional).
					</div>
					<textarea
						onChange={(e) => setBatchInstruction(e.target.value)}
						placeholder="E.g. Delineate basins for all these outlets and compare their TWI values…"
						rows={3}
						style={{ ...inputStyle, resize: "vertical" }}
						value={batchInstruction}
					/>
					<div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
						<button
							onClick={() => {
								setBatchOpen(false)
								setAgentError(null)
							}}
							style={{
								fontSize: 10,
								padding: "4px 10px",
								background: "transparent",
								color: fg,
								border: `1px solid ${border}`,
								borderRadius: 4,
								cursor: "pointer",
							}}
							type="button">
							Cancel
						</button>
						<button
							disabled={Boolean(agentBusy)}
							onClick={handleBatchAskAgent}
							style={{
								fontSize: 10,
								padding: "4px 14px",
								background: agentBusy ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.85)",
								color: "#fff",
								border: "none",
								borderRadius: 4,
								cursor: agentBusy ? "wait" : "pointer",
								fontWeight: 600,
							}}
							type="button">
							{agentBusy === "batch" ? "⏳ Sending…" : "✨ Send to Agent"}
						</button>
					</div>
				</div>
			)}

			{/* ── Annotation cards ── */}
			{filteredAnnotations.length === 0 ? (
				<div style={{ fontSize: 10, opacity: 0.5, fontStyle: "italic", padding: "8px 0" }}>
					{annotations.length === 0
						? "No annotations yet — click 📍 Pin, ⬠ Poly, or 〰 Line to add one."
						: "No annotations match your filter."}
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					{filteredAnnotations.map((ann) => {
						const [lon, lat] = annotationCenter(ann)
						const isExpanded = expandedId === ann.id
						const isBusy = agentBusy === ann.id

						return (
							<div
								key={ann.id}
								style={{
									borderRadius: 5,
									border: `1px solid ${border}`,
									borderLeft: `3px solid ${ann.color}`,
									overflow: "hidden",
								}}>
								{/* ── Compact header (always visible) ── */}
								<div
									onClick={() => setExpandedId(isExpanded ? null : ann.id)}
									style={{
										padding: "7px 9px",
										background: subtle,
										cursor: "pointer",
										display: "flex",
										alignItems: "center",
										gap: 6,
									}}>
									<span style={{ fontSize: 12 }}>{TYPE_ICONS[ann.type] ?? "📌"}</span>
									<span
										style={{
											fontSize: 11,
											fontWeight: 600,
											flex: 1,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}>
										{ann.name}
									</span>
									<PriorityBadge priority={ann.priority} />
									<StatusBadge status={ann.status} />
									<span style={{ fontSize: 10, opacity: 0.5, marginLeft: 2 }}>{isExpanded ? "▲" : "▼"}</span>
								</div>

								{/* ── Compact footer (notes preview) ── */}
								{!isExpanded && (ann.notes || ann.tags.length > 0) && (
									<div
										style={{
											padding: "4px 9px 5px",
											background: subtle,
											borderTop: `1px solid ${subtleBorder}`,
										}}>
										{ann.notes && (
											<div
												style={{
													fontSize: 10,
													opacity: 0.65,
													display: "-webkit-box",
													WebkitLineClamp: 2,
													WebkitBoxOrient: "vertical",
													overflow: "hidden",
													lineHeight: 1.4,
												}}>
												{ann.notes}
											</div>
										)}
										{ann.tags.length > 0 && (
											<div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 3 }}>
												{ann.tags.map((t) => (
													<span
														key={t}
														style={{
															fontSize: 8,
															padding: "1px 5px",
															borderRadius: 8,
															background: "rgba(99,102,241,0.15)",
															color: "#a5b4fc",
														}}>
														#{t}
													</span>
												))}
											</div>
										)}
									</div>
								)}

								{/* ── Expanded content ── */}
								{isExpanded && (
									<div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
										{/* Name */}
										<div>
											<label
												style={{
													fontSize: 9,
													opacity: 0.55,
													display: "block",
													marginBottom: 3,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}>
												Name
											</label>
											<input
												onChange={(e) => updateAnnotation(ann.id, { name: e.target.value })}
												style={inputStyle}
												type="text"
												value={ann.name}
											/>
										</div>

										{/* Coordinates */}
										<div style={{ fontSize: 9, opacity: 0.5, fontFamily: "monospace" }}>
											{TYPE_ICONS[ann.type]} {Math.abs(lat).toFixed(5)}°{lat >= 0 ? "N" : "S"},{" "}
											{Math.abs(lon).toFixed(5)}°{lon >= 0 ? "E" : "W"}
										</div>

										{/* Notes */}
										<div>
											<label
												style={{
													fontSize: 9,
													opacity: 0.55,
													display: "block",
													marginBottom: 3,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}>
												📓 My Notes
											</label>
											<textarea
												onChange={(e) => updateAnnotation(ann.id, { notes: e.target.value })}
												placeholder="Personal observations, field data, context… (not sent to agent unless no AI Prompt is set)"
												rows={3}
												style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
												value={ann.notes}
											/>
										</div>

										{/* AI Prompt */}
										<div>
											<label
												style={{
													fontSize: 9,
													opacity: 0.55,
													display: "block",
													marginBottom: 3,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}>
												🤖 AI Prompt{" "}
												<span
													style={{ fontWeight: 400, textTransform: "none", fontSize: 9, opacity: 0.7 }}>
													(optional — overrides smart default)
												</span>
											</label>
											<textarea
												onChange={(e) => updateAnnotation(ann.id, { aiPrompt: e.target.value })}
												placeholder="Specific instruction for the agent, e.g. 'Delineate the watershed at this point and compute TWI'"
												rows={2}
												style={{
													...inputStyle,
													resize: "vertical",
													lineHeight: 1.5,
													borderColor: ann.aiPrompt ? "rgba(99,102,241,0.5)" : undefined,
												}}
												value={ann.aiPrompt}
											/>
										</div>

										{/* Tags */}
										<div>
											<label
												style={{
													fontSize: 9,
													opacity: 0.55,
													display: "block",
													marginBottom: 4,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}>
												Tags
											</label>
											<div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
												{ann.tags.map((tag) => (
													<span
														key={tag}
														style={{
															fontSize: 9,
															padding: "2px 7px",
															borderRadius: 10,
															background: "rgba(99,102,241,0.15)",
															color: "#a5b4fc",
															display: "flex",
															alignItems: "center",
															gap: 3,
														}}>
														#{tag}
														<button
															onClick={() =>
																updateAnnotation(ann.id, {
																	tags: ann.tags.filter((t) => t !== tag),
																})
															}
															style={{
																background: "none",
																border: "none",
																color: "#a5b4fc",
																cursor: "pointer",
																fontSize: 9,
																padding: 0,
																lineHeight: 1,
															}}
															type="button">
															×
														</button>
													</span>
												))}
												<input
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === ",") {
															const v = (e.target as HTMLInputElement).value
																.trim()
																.replace(/,/g, "")
															if (v && !ann.tags.includes(v)) {
																updateAnnotation(ann.id, { tags: [...ann.tags, v] })
															}
															;(e.target as HTMLInputElement).value = ""
															e.preventDefault()
														}
													}}
													placeholder="+ tag"
													style={{ ...inputStyle, width: 60, padding: "2px 6px", fontSize: 9 }}
												/>
											</div>
										</div>

										{/* Status + Priority */}
										<div style={{ display: "flex", gap: 8 }}>
											<div style={{ flex: 1 }}>
												<label
													style={{
														fontSize: 9,
														opacity: 0.55,
														display: "block",
														marginBottom: 3,
														fontWeight: 600,
														textTransform: "uppercase",
														letterSpacing: "0.05em",
													}}>
													Status
												</label>
												<select
													onChange={(e) =>
														updateAnnotation(ann.id, { status: e.target.value as AnnotationStatus })
													}
													style={{ ...inputStyle }}
													value={ann.status}>
													{STATUS_OPTS.map((s) => (
														<option key={s.value} value={s.value}>
															{s.label}
														</option>
													))}
												</select>
											</div>
											<div style={{ flex: 1 }}>
												<label
													style={{
														fontSize: 9,
														opacity: 0.55,
														display: "block",
														marginBottom: 3,
														fontWeight: 600,
														textTransform: "uppercase",
														letterSpacing: "0.05em",
													}}>
													Priority
												</label>
												<select
													onChange={(e) =>
														updateAnnotation(ann.id, {
															priority: (e.target.value || null) as AnnotationPriority | null,
														})
													}
													style={{ ...inputStyle }}
													value={ann.priority ?? ""}>
													<option value="">— None —</option>
													{PRIORITY_OPTS.map((p) => (
														<option key={p.value} value={p.value}>
															{p.label}
														</option>
													))}
												</select>
											</div>
										</div>

										{/* Collections assignment */}
										{collections.length > 0 && (
											<div>
												<label
													style={{
														fontSize: 9,
														opacity: 0.55,
														display: "block",
														marginBottom: 4,
														fontWeight: 600,
														textTransform: "uppercase",
														letterSpacing: "0.05em",
													}}>
													Collections
												</label>
												<div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
													{collections.map((col) => {
														const inCol = ann.collectionIds.includes(col.id)
														return (
															<button
																key={col.id}
																onClick={() =>
																	updateAnnotation(ann.id, {
																		collectionIds: inCol
																			? ann.collectionIds.filter((id) => id !== col.id)
																			: [...ann.collectionIds, col.id],
																	})
																}
																style={{
																	fontSize: 9,
																	padding: "2px 8px",
																	borderRadius: 10,
																	border: `1px solid ${inCol ? col.color : border}`,
																	background: inCol ? `${col.color}22` : "transparent",
																	color: inCol ? col.color : fg,
																	cursor: "pointer",
																	fontWeight: inCol ? 700 : 400,
																}}
																type="button">
																<span
																	style={{
																		display: "inline-block",
																		width: 6,
																		height: 6,
																		borderRadius: "50%",
																		background: col.color,
																		marginRight: 4,
																		verticalAlign: "middle",
																	}}
																/>
																{col.name}
															</button>
														)
													})}
												</div>
											</div>
										)}

										{/* Colour */}
										<div>
											<label
												style={{
													fontSize: 9,
													opacity: 0.55,
													display: "block",
													marginBottom: 4,
													fontWeight: 600,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}>
												Colour
											</label>
											<div style={{ display: "flex", gap: 5 }}>
												{PRESET_COLORS.map((c) => (
													<button
														key={c}
														onClick={() => updateAnnotation(ann.id, { color: c })}
														style={{
															width: 16,
															height: 16,
															borderRadius: "50%",
															background: c,
															border:
																ann.color === c
																	? `2px solid ${fg}`
																	: "1px solid rgba(0,0,0,0.25)",
															cursor: "pointer",
															padding: 0,
															flexShrink: 0,
														}}
														type="button"
													/>
												))}
											</div>
										</div>

										{/* Actions footer */}
										<div
											style={{
												display: "flex",
												gap: 6,
												flexWrap: "wrap",
												paddingTop: 6,
												borderTop: `1px solid ${subtleBorder}`,
												alignItems: "center",
											}}>
											<button
												onClick={() => onFlyTo(lon, lat)}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: fg,
													border: `1px solid ${border}`,
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												📍 Fly to
											</button>
											<button
												onClick={() => duplicateAnn(ann)}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: fg,
													border: `1px solid ${border}`,
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												📋 Duplicate
											</button>
											<button
												onClick={() => deleteAnn(ann.id)}
												style={{
													fontSize: 10,
													padding: "3px 8px",
													background: "transparent",
													color: "#ef4444",
													border: "1px solid rgba(239,68,68,0.35)",
													borderRadius: 4,
													cursor: "pointer",
												}}
												type="button">
												🗑 Delete
											</button>
											<div style={{ flex: 1 }} />
											<button
												disabled={Boolean(agentBusy)}
												onClick={() => {
													setAgentError(null)
													handleAskAgent(ann)
												}}
												style={{
													fontSize: 10,
													padding: "4px 12px",
													background: isBusy ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.85)",
													color: "#fff",
													border: "none",
													borderRadius: 4,
													cursor: isBusy ? "wait" : "pointer",
													fontWeight: 600,
												}}
												type="button">
												{isBusy ? "⏳ Sending…" : "✨ Ask Agent"}
											</button>
										</div>
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			{/* Gallery save dialog */}
			{gallerySaveOpen && annotations.length > 0 && (
				<div
					style={{
						marginTop: 4,
						background: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
						border: `1px solid ${border}`,
						borderRadius: 6,
						padding: 12,
						display: "grid",
						gap: 8,
					}}>
					<div style={{ fontWeight: 700, fontSize: 12 }}>Save to My Gallery</div>
					<input
						autoFocus
						onChange={(e) => setGalleryTitle(e.target.value)}
						placeholder="Title"
						style={inputStyle}
						value={galleryTitle}
					/>
					<input
						onChange={(e) => setGalleryDesc(e.target.value)}
						placeholder="Description (optional)"
						style={inputStyle}
						value={galleryDesc}
					/>
					<input
						onChange={(e) => setGalleryTagsRaw(e.target.value)}
						placeholder="Tags: comma-separated (optional)"
						style={inputStyle}
						value={galleryTagsRaw}
					/>
					<div style={{ display: "flex", gap: 6 }}>
						<button
							disabled={!galleryTitle.trim()}
							onClick={() => {
								const target = activeCollectionId !== "all" ? filteredAnnotations : annotations
								const col = collections.find((c) => c.id === activeCollectionId)
								const tags = galleryTagsRaw
									.split(",")
									.map((t) => t.trim())
									.filter(Boolean)
								const saved = addToMyGallery({
									type: "annotation_collection",
									title: galleryTitle.trim(),
									description: galleryDesc.trim(),
									tags,
									pinned: false,
									payload: {
										collectionName: col?.name ?? "All Annotations",
										annotations: target,
										collections: col ? [col] : collections,
									},
								})
								onSaveToGallery?.(saved)
								setGallerySaveOpen(false)
								setGalleryTitle("")
								setGalleryDesc("")
								setGalleryTagsRaw("")
							}}
							style={{
								flex: 1,
								fontSize: 11,
								padding: "5px 8px",
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
								border: "none",
								borderRadius: 3,
								cursor: galleryTitle.trim() ? "pointer" : "not-allowed",
							}}
							type="button">
							Save
						</button>
						<button
							onClick={() => setGallerySaveOpen(false)}
							style={{
								fontSize: 11,
								padding: "5px 8px",
								background: "transparent",
								border: `1px solid ${border}`,
								borderRadius: 3,
								cursor: "pointer",
								color: "inherit",
							}}
							type="button">
							Cancel
						</button>
					</div>
				</div>
			)}

			{/* ── Footer actions ── */}
			{annotations.length > 0 && (
				<div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 6 }}>
					<button
						onClick={() => {
							const target = activeCollectionId !== "all" ? filteredAnnotations : annotations
							const col = collections.find((c) => c.id === activeCollectionId)
							const defaultTitle = col ? col.name : `Annotations – ${new Date().toLocaleDateString()}`
							setGalleryTitle(defaultTitle)
							setGalleryDesc(col?.description ?? "")
							setGalleryTagsRaw("annotation")
							setGallerySaveOpen((v) => !v)
						}}
						style={{
							fontSize: 10,
							padding: "4px 10px",
							background: gallerySaveOpen ? "rgba(16,185,129,0.2)" : "rgba(16,185,129,0.1)",
							color: "#6ee7b7",
							border: `1px solid ${gallerySaveOpen ? "rgba(16,185,129,0.5)" : "rgba(16,185,129,0.3)"}`,
							borderRadius: 4,
							cursor: "pointer",
							fontWeight: 600,
						}}
						type="button">
						📌 Save to My Gallery
					</button>
					<button
						disabled={Boolean(agentBusy)}
						onClick={() => {
							setAgentError(null)
							setBatchOpen(!batchOpen)
						}}
						style={{
							fontSize: 10,
							padding: "4px 12px",
							background: batchOpen ? "rgba(99,102,241,0.25)" : "rgba(99,102,241,0.1)",
							color: batchOpen ? "#a5b4fc" : fg,
							border: `1px solid ${batchOpen ? "rgba(99,102,241,0.5)" : border}`,
							borderRadius: 4,
							cursor: agentBusy ? "wait" : "pointer",
							fontWeight: 600,
						}}
						type="button">
						{agentBusy === "batch" ? "⏳ Sending…" : `✨ Batch Ask Agent (${filteredAnnotations.length})`}
					</button>
				</div>
			)}
		</div>
	)
}

export default AnnotationsPanel
