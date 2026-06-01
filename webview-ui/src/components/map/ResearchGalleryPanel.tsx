import React, { useEffect, useMemo, useRef, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"
import { ITEM_TYPE_ICONS, ITEM_TYPE_LABELS, type MyGalleryItem, type MyItemType, relativeTime } from "./galleryStorage"

// ── Community catalog types ──────────────────────────────────────────────────

export type ResearchGalleryItemType = "map_scene" | "style_preset" | "dataset_connector" | "case_study" | "map_plate_template"
type TrustLevel = "official" | "reviewed" | "community" | "local"

export interface ResearchGalleryItem {
	id: string
	type: ResearchGalleryItemType
	title: string
	description: string
	version: string
	author: string
	license: string
	trustLevel: TrustLevel
	tags: string[]
	thumbnailUrl?: string
	githubUrl?: string
	artifactUrl?: string
	citation?: string
	citationUrl?: string
	authorUrl?: string
	createdAt?: string
	updatedAt?: string
	isFeatured?: boolean
	isInstalled?: boolean
	downloadCount?: number
	aiHydroStars?: number
	starredByClient?: boolean
	contributors?: Array<{
		github?: string
		name: string
		orcid?: string
		affiliation?: string
		profileUrl?: string
		url?: string
		website?: string
		linkedin?: string
		googleScholar?: string
		citationUrl?: string
		roles?: string[]
	}>
	badges?: string[]
	metrics?: { installs?: number; downloads?: number; aiHydroStars?: number }
	discussionUrl?: string
	source?: "remote" | "built_in" | "local"
	importWarnings?: string[]
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface GalleryImportCallbacks {
	onImportScene: (item: MyGalleryItem) => string
	onImportTransects: (item: MyGalleryItem) => string
	onImportAnnotations: (item: MyGalleryItem) => string
}

interface ResearchGalleryPanelProps {
	mapStyle: "dark" | "light"
	onOpenExport?: () => void
	// My Gallery
	myItems: MyGalleryItem[]
	bookmarkedIds: string[]
	onSaveScene: (title: string, description: string, tags: string[]) => void
	onDeleteMyItem: (id: string) => void
	onUpdateMyItem: (id: string, updates: Partial<Omit<MyGalleryItem, "id" | "createdAt">>) => void
	onToggleBookmark: (communityId: string) => void
	importCallbacks: GalleryImportCallbacks
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type CatalogState =
	| { status: "loading" }
	| { status: "ready"; items: ResearchGalleryItem[]; warning?: string; sourceUrl?: string }
	| { status: "error"; message: string }

const TYPE_LABELS: Record<ResearchGalleryItemType | "all", string> = {
	all: "All",
	map_scene: "Scenes",
	style_preset: "Styles",
	dataset_connector: "Datasets",
	case_study: "Case studies",
	map_plate_template: "Templates",
}
const TRUST_COLORS: Record<TrustLevel, string> = {
	official: "#7dd3fc",
	reviewed: "#86efac",
	community: "#facc15",
	local: "#c4b5fd",
}
const GALLERY_CONTRIBUTION_URL = "https://github.com/AI-Hydro/Gallery/issues/new?template=new_gallery_item.md"

function uiRequestId(p: string) {
	return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
function trustText(v: TrustLevel) {
	return { official: "Official", reviewed: "Reviewed", community: "Community", local: "Local" }[v]
}
function typeText(v: ResearchGalleryItemType) {
	return TYPE_LABELS[v] ?? v
}
function formatCount(v: number | undefined) {
	const n = Number(v ?? 0)
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
	return n.toString()
}
function contributorText(item: ResearchGalleryItem) {
	const names = item.contributors?.map((c) => c.name || c.github).filter(Boolean) ?? []
	return names.length > 0 ? names.join(", ") : item.author
}
function githubProfileUrl(github?: string) {
	const h = String(github ?? "")
		.trim()
		.replace(/^@/, "")
	return h ? `https://github.com/${h}` : ""
}
function orcidProfileUrl(orcid?: string) {
	const v = String(orcid ?? "").trim()
	return v ? (v.startsWith("http") ? v : `https://orcid.org/${v}`) : ""
}
function contributorProfileUrl(c: NonNullable<ResearchGalleryItem["contributors"]>[number]) {
	return (
		c.profileUrl ||
		c.url ||
		c.website ||
		c.linkedin ||
		c.googleScholar ||
		githubProfileUrl(c.github) ||
		orcidProfileUrl(c.orcid)
	)
}

function itemSummary(item: MyGalleryItem): string {
	if (item.type === "map_scene") {
		const p = item.payload as { visibleLayerIds?: string[]; viewState?: { zoom?: number }; basemap?: string }
		const n = p.visibleLayerIds?.length ?? 0
		const zoom = p.viewState?.zoom != null ? `zoom ${p.viewState.zoom.toFixed(1)}` : null
		const basemap = p.basemap ?? null
		return [basemap, `${n} layer${n !== 1 ? "s" : ""}`, zoom].filter(Boolean).join(" · ")
	}
	if (item.type === "transect_collection") {
		const p = item.payload as { transects?: unknown[]; collections?: unknown[] }
		const n = p.transects?.length ?? 0
		const c = p.collections?.length ?? 0
		return `${n} transect${n !== 1 ? "s" : ""}${c > 0 ? ` · ${c} collection${c !== 1 ? "s" : ""}` : ""}`
	}
	if (item.type === "annotation_collection") {
		const p = item.payload as { annotations?: unknown[]; collections?: unknown[] }
		const n = p.annotations?.length ?? 0
		const c = p.collections?.length ?? 0
		return `${n} annotation${n !== 1 ? "s" : ""}${c > 0 ? ` · ${c} collection${c !== 1 ? "s" : ""}` : ""}`
	}
	return ""
}

function importLabel(type: MyItemType): string {
	switch (type) {
		case "map_scene":
			return "↩ Restore scene"
		case "transect_collection":
			return "↩ Add transects"
		case "annotation_collection":
			return "↩ Add annotations"
		default:
			return "↩ Import"
	}
}

// ── Save dialog ──────────────────────────────────────────────────────────────

interface SaveDialogProps {
	defaultTitle: string
	onSave: (title: string, description: string, tags: string[]) => void
	onCancel: () => void
	border: string
	bg: string
}

const SaveDialog: React.FC<SaveDialogProps> = ({ defaultTitle, onSave, onCancel, border, bg }) => {
	const [title, setTitle] = useState(defaultTitle)
	const [desc, setDesc] = useState("")
	const [tagsRaw, setTagsRaw] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	useEffect(() => {
		inputRef.current?.select()
	}, [])
	const inputStyle: React.CSSProperties = {
		width: "100%",
		boxSizing: "border-box",
		fontSize: 11,
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: `1px solid ${border}`,
		borderRadius: 3,
		padding: "5px 7px",
	}
	const parsedTags = tagsRaw
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean)
	return (
		<div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: 12, display: "grid", gap: 8 }}>
			<div style={{ fontWeight: 700, fontSize: 12 }}>Save to My Gallery</div>
			<input
				onChange={(e) => setTitle(e.target.value)}
				placeholder="Title"
				ref={inputRef}
				style={inputStyle}
				value={title}
			/>
			<input
				onChange={(e) => setDesc(e.target.value)}
				placeholder="Description (optional)"
				style={inputStyle}
				value={desc}
			/>
			<input
				onChange={(e) => setTagsRaw(e.target.value)}
				placeholder="Tags: comma-separated (optional)"
				style={inputStyle}
				value={tagsRaw}
			/>
			{parsedTags.length > 0 && (
				<div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
					{parsedTags.map((t) => (
						<span
							key={t}
							style={{
								fontSize: 10,
								padding: "2px 7px",
								borderRadius: 8,
								background: "rgba(99,102,241,0.15)",
								border: "1px solid rgba(99,102,241,0.3)",
								color: "#a5b4fc",
							}}>
							{t}
						</span>
					))}
				</div>
			)}
			<div style={{ display: "flex", gap: 6 }}>
				<button
					disabled={!title.trim()}
					onClick={() => onSave(title.trim(), desc.trim(), parsedTags)}
					style={{
						flex: 1,
						padding: "5px 8px",
						fontSize: 11,
						background: "var(--vscode-button-background)",
						color: "var(--vscode-button-foreground)",
						border: "none",
						borderRadius: 3,
						cursor: title.trim() ? "pointer" : "not-allowed",
					}}
					type="button">
					Save
				</button>
				<button
					onClick={onCancel}
					style={{
						padding: "5px 8px",
						fontSize: 11,
						background: "transparent",
						color: "inherit",
						border: `1px solid ${border}`,
						borderRadius: 3,
						cursor: "pointer",
					}}
					type="button">
					Cancel
				</button>
			</div>
		</div>
	)
}

// ── My Gallery item card ─────────────────────────────────────────────────────

interface MyItemCardProps {
	item: MyGalleryItem
	selected: boolean
	onSelect: () => void
	onDelete: () => void
	onTogglePin: () => void
	onImport: () => void
	onEdit: (title: string, description: string, tags: string[]) => void
	border: string
	bg: string
	subtle: string
}

const MyItemCard: React.FC<MyItemCardProps> = ({
	item,
	selected,
	onSelect,
	onDelete,
	onTogglePin,
	onImport,
	onEdit,
	border,
	bg,
	subtle,
}) => {
	const [editing, setEditing] = useState(false)
	const [editTitle, setEditTitle] = useState(item.title)
	const [editDesc, setEditDesc] = useState(item.description)
	const [editTagsRaw, setEditTagsRaw] = useState(item.tags?.join(", ") ?? "")
	const [confirmDelete, setConfirmDelete] = useState(false)
	const editInputRef = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (editing) editInputRef.current?.focus()
	}, [editing])

	const summary = itemSummary(item)
	const inputStyle: React.CSSProperties = {
		width: "100%",
		boxSizing: "border-box",
		fontSize: 11,
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: `1px solid ${border}`,
		borderRadius: 3,
		padding: "4px 6px",
	}

	return (
		<div
			onClick={() => {
				if (!editing) onSelect()
			}}
			onKeyDown={(e) => {
				if (editing) return
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onSelect()
				}
			}}
			role="button"
			style={{
				padding: "8px 10px",
				borderRadius: 5,
				cursor: editing ? "default" : "pointer",
				background: selected ? "rgba(14,99,156,0.22)" : bg,
				border: `1px solid ${selected ? "var(--vscode-focusBorder, #3794ff)" : border}`,
			}}
			tabIndex={0}>
			{editing ? (
				/* ── Edit mode ── */
				<div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gap: 6 }}>
					<input
						onChange={(e) => setEditTitle(e.target.value)}
						placeholder="Title"
						ref={editInputRef}
						style={inputStyle}
						value={editTitle}
					/>
					<input
						onChange={(e) => setEditDesc(e.target.value)}
						placeholder="Description (optional)"
						style={inputStyle}
						value={editDesc}
					/>
					<input
						onChange={(e) => setEditTagsRaw(e.target.value)}
						placeholder="Tags (comma-separated)"
						style={inputStyle}
						value={editTagsRaw}
					/>
					<div style={{ display: "flex", gap: 6 }}>
						<button
							disabled={!editTitle.trim()}
							onClick={() => {
								const tags = editTagsRaw
									.split(",")
									.map((t) => t.trim())
									.filter(Boolean)
								onEdit(editTitle.trim(), editDesc.trim(), tags)
								setEditing(false)
							}}
							style={{
								flex: 1,
								fontSize: 11,
								padding: "3px 8px",
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
								border: "none",
								borderRadius: 3,
								cursor: editTitle.trim() ? "pointer" : "not-allowed",
							}}
							type="button">
							Save
						</button>
						<button
							onClick={() => {
								setEditTitle(item.title)
								setEditDesc(item.description)
								setEditTagsRaw(item.tags?.join(", ") ?? "")
								setEditing(false)
							}}
							style={{
								fontSize: 11,
								padding: "3px 8px",
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
			) : (
				/* ── Normal view ── */
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
						<span style={{ fontSize: 13 }}>{ITEM_TYPE_ICONS[item.type]}</span>
						<span
							style={{
								fontWeight: 650,
								fontSize: 12,
								flex: 1,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}>
							{item.title}
						</span>
						<span
							onClick={(e) => {
								e.stopPropagation()
								onTogglePin()
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation()
									onTogglePin()
								}
							}}
							role="button"
							style={{
								fontSize: 11,
								cursor: "pointer",
								opacity: item.pinned ? 1 : 0.35,
								color: item.pinned ? "#facc15" : "inherit",
							}}
							tabIndex={0}
							title={item.pinned ? "Unpin" : "Pin to top"}>
							📌
						</span>
					</div>
					{summary && (
						<div
							style={{
								fontSize: 10,
								color: subtle,
								marginBottom: 2,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}>
							{summary}
						</div>
					)}
					<div style={{ display: "flex", gap: 6, fontSize: 10, color: subtle }}>
						<span>{ITEM_TYPE_LABELS[item.type]}</span>
						{item.tags?.length > 0 && (
							<>
								<span>·</span>
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{item.tags.join(", ")}
								</span>
							</>
						)}
						<span style={{ marginLeft: "auto", flexShrink: 0 }}>{relativeTime(item.updatedAt)}</span>
					</div>

					{selected && (
						<div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
							<button
								onClick={(e) => {
									e.stopPropagation()
									onImport()
								}}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.stopPropagation()
										onImport()
									}
								}}
								style={{
									fontSize: 11,
									padding: "3px 9px",
									background: "var(--vscode-button-background)",
									color: "var(--vscode-button-foreground)",
									border: "none",
									borderRadius: 3,
									cursor: "pointer",
								}}
								type="button">
								{importLabel(item.type)}
							</button>
							<button
								onClick={(e) => {
									e.stopPropagation()
									setEditing(true)
								}}
								style={{
									fontSize: 11,
									padding: "3px 9px",
									background: "transparent",
									border: `1px solid ${border}`,
									borderRadius: 3,
									cursor: "pointer",
									color: "inherit",
								}}
								type="button">
								✎ Edit
							</button>
							{confirmDelete ? (
								<>
									<button
										onClick={(e) => {
											e.stopPropagation()
											onDelete()
										}}
										style={{
											fontSize: 11,
											padding: "3px 9px",
											background: "rgba(239,68,68,0.15)",
											color: "#f87171",
											border: "1px solid rgba(239,68,68,0.4)",
											borderRadius: 3,
											cursor: "pointer",
										}}
										type="button">
										Confirm delete
									</button>
									<button
										onClick={(e) => {
											e.stopPropagation()
											setConfirmDelete(false)
										}}
										style={{
											fontSize: 11,
											padding: "3px 9px",
											background: "transparent",
											border: `1px solid ${border}`,
											borderRadius: 3,
											cursor: "pointer",
											color: "inherit",
										}}
										type="button">
										Cancel
									</button>
								</>
							) : (
								<button
									onClick={(e) => {
										e.stopPropagation()
										setConfirmDelete(true)
									}}
									style={{
										fontSize: 11,
										padding: "3px 9px",
										background: "transparent",
										color: subtle,
										border: `1px solid ${border}`,
										borderRadius: 3,
										cursor: "pointer",
									}}
									type="button">
									✕ Delete
								</button>
							)}
						</div>
					)}
				</>
			)}
		</div>
	)
}

// ── Main panel ───────────────────────────────────────────────────────────────

export const ResearchGalleryPanel: React.FC<ResearchGalleryPanelProps> = ({
	mapStyle,
	onOpenExport,
	myItems,
	bookmarkedIds,
	onSaveScene,
	onDeleteMyItem,
	onUpdateMyItem,
	onToggleBookmark,
	importCallbacks,
}) => {
	const [tab, setTab] = useState<"mine" | "starred" | "community">("mine")
	const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" })
	const [query, setQuery] = useState("")
	const [typeFilter, setTypeFilter] = useState<ResearchGalleryItemType | "all">("all")
	const [myTypeFilter, setMyTypeFilter] = useState<MyItemType | "all">("all")
	const [trustFilter, setTrustFilter] = useState<TrustLevel | "all">("all")
	const [sortBy, setSortBy] = useState<"recommended" | "imports" | "stars" | "newest" | "name">("recommended")
	const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null)
	const [selectedMyId, setSelectedMyId] = useState<string | null>(null)
	const [importingId, setImportingId] = useState<string | null>(null)
	const [starringId, setStarringId] = useState<string | null>(null)
	const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null)
	const [showSaveScene, setShowSaveScene] = useState(false)

	const bg = mapStyle === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
	const border = mapStyle === "dark" ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"
	const subtle = "var(--vscode-descriptionForeground, #9ca3af)"

	const openUrl = (url?: string) => {
		if (url) PLATFORM_CONFIG.postMessage({ type: "openExternal", url })
	}
	const linkedText = (label: string, url?: string) =>
		url ? (
			<button
				onClick={() => openUrl(url)}
				style={{
					background: "transparent",
					border: "none",
					color: "var(--vscode-textLink-foreground, #4fc1ff)",
					cursor: "pointer",
					font: "inherit",
					padding: 0,
				}}
				type="button">
				{label}
			</button>
		) : (
			<span>{label}</span>
		)

	const flash = (text: string, isError = false) => {
		setMessage({ text, isError })
		window.setTimeout(() => setMessage(null), 5000)
	}

	// ── Catalog load ─────────────────────────────────────────────────────────

	const requestCatalog = () => {
		const requestId = uiRequestId("gallery")
		setCatalog({ status: "loading" })
		setMessage(null)
		const onMsg = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-catalog-result" || data.requestId !== requestId) return
			window.removeEventListener("message", onMsg)
			if (data.ok) {
				setCatalog({
					status: "ready",
					items: Array.isArray(data.items) ? data.items : [],
					warning: data.warning,
					sourceUrl: data.sourceUrl,
				})
			} else {
				setCatalog({ status: "error", message: data.error ?? "Could not load catalog." })
			}
		}
		window.addEventListener("message", onMsg)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-research-gallery-catalog", requestId })
	}

	useEffect(() => {
		requestCatalog()
	}, [])

	useEffect(() => {
		const onMsg = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-import-result") return
			setImportingId(null)
			if (data.openExport) onOpenExport?.()
			flash(data.ok ? (data.message ?? "Imported.") : (data.error ?? "Import failed."), !data.ok)
		}
		window.addEventListener("message", onMsg)
		return () => window.removeEventListener("message", onMsg)
	}, [onOpenExport])

	useEffect(() => {
		const onMsg = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-star-result") return
			setStarringId(null)
			if (!data.ok) {
				flash(data.error ?? "Star update failed.", true)
				return
			}
			setCatalog((cur) => {
				if (cur.status !== "ready") return cur
				return {
					...cur,
					items: cur.items.map((item) => {
						if (item.id !== data.itemId) return item
						const aiHydroStars = Number(data.aiHydroStars ?? 0)
						return {
							...item,
							aiHydroStars,
							starredByClient: Boolean(data.starred),
							metrics: { ...(item.metrics ?? {}), aiHydroStars },
						}
					}),
				}
			})
		}
		window.addEventListener("message", onMsg)
		return () => window.removeEventListener("message", onMsg)
	}, [])

	// ── Community filtering ──────────────────────────────────────────────────

	const communityItems = catalog.status === "ready" ? catalog.items : []

	const filteredCommunity = useMemo(() => {
		const q = query.trim().toLowerCase()
		return communityItems
			.filter((item) => {
				if (typeFilter !== "all" && item.type !== typeFilter) return false
				if (trustFilter !== "all" && item.trustLevel !== trustFilter) return false
				if (!q) return true
				return (
					item.title.toLowerCase().includes(q) ||
					item.description.toLowerCase().includes(q) ||
					item.author.toLowerCase().includes(q) ||
					item.tags.some((t) => t.toLowerCase().includes(q))
				)
			})
			.sort((a, b) => {
				const iA = Number(a.metrics?.installs ?? a.downloadCount ?? 0)
				const iB = Number(b.metrics?.installs ?? b.downloadCount ?? 0)
				const sA = Number(a.metrics?.aiHydroStars ?? a.aiHydroStars ?? 0)
				const sB = Number(b.metrics?.aiHydroStars ?? b.aiHydroStars ?? 0)
				if (sortBy === "imports") return iB - iA || a.title.localeCompare(b.title)
				if (sortBy === "stars") return sB - sA || a.title.localeCompare(b.title)
				if (sortBy === "newest") return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
				if (sortBy === "name") return a.title.localeCompare(b.title)
				if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1
				if (a.trustLevel !== b.trustLevel) {
					const order: Record<TrustLevel, number> = { official: 0, reviewed: 1, community: 2, local: 3 }
					return order[a.trustLevel] - order[b.trustLevel]
				}
				return sB - sA || iB - iA || a.title.localeCompare(b.title)
			})
	}, [communityItems, query, typeFilter, trustFilter, sortBy])

	const starredItems = useMemo(
		() => filteredCommunity.filter((i) => bookmarkedIds.includes(i.id)),
		[filteredCommunity, bookmarkedIds],
	)

	// ── My Gallery filtering ─────────────────────────────────────────────────

	const filteredMine = useMemo(() => {
		const q = query.trim().toLowerCase()
		const base = myItems.filter((i) => {
			if (myTypeFilter !== "all" && i.type !== myTypeFilter) return false
			if (!q) return true
			return (
				i.title.toLowerCase().includes(q) ||
				i.description.toLowerCase().includes(q) ||
				i.tags.some((t) => t.toLowerCase().includes(q))
			)
		})
		const pinned = base.filter((i) => i.pinned)
		const rest = base.filter((i) => !i.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		return [...pinned, ...rest]
	}, [myItems, query, myTypeFilter])

	// ── Actions ──────────────────────────────────────────────────────────────

	const importCommunityItem = (item: ResearchGalleryItem) => {
		setImportingId(item.id)
		setMessage(null)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-research-gallery-import", requestId: uiRequestId("gallery-import"), item })
	}

	const toggleStar = (item: ResearchGalleryItem) => {
		setStarringId(item.id)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-research-gallery-star",
			requestId: uiRequestId("gallery-star"),
			itemId: item.id,
			starred: !item.starredByClient,
		})
	}

	const importMyItem = (item: MyGalleryItem) => {
		let msg: string
		if (item.type === "map_scene") msg = importCallbacks.onImportScene(item)
		else if (item.type === "transect_collection") msg = importCallbacks.onImportTransects(item)
		else if (item.type === "annotation_collection") msg = importCallbacks.onImportAnnotations(item)
		else msg = `Imported "${item.title}"`
		flash(msg, msg.toLowerCase().includes("not yet loaded") || msg.toLowerCase().includes("already"))
	}

	// ── Tab bar ──────────────────────────────────────────────────────────────

	const tabStyle = (active: boolean): React.CSSProperties => ({
		flex: 1,
		padding: "6px 4px",
		fontSize: 11,
		fontWeight: active ? 700 : 400,
		background: active ? "var(--vscode-button-background, #0e639c)" : "transparent",
		color: active ? "var(--vscode-button-foreground, #fff)" : "inherit",
		border: `1px solid ${active ? "var(--vscode-button-background, #0e639c)" : border}`,
		borderRadius: 4,
		cursor: "pointer",
		textAlign: "center",
	})

	const starredCount = bookmarkedIds.length
	const mineCount = myItems.length

	// ── Render ───────────────────────────────────────────────────────────────

	return (
		<div style={{ padding: 12, display: "grid", gap: 10, fontSize: 12 }}>
			{/* Tab bar */}
			<div style={{ display: "flex", gap: 4 }}>
				<button onClick={() => setTab("mine")} style={tabStyle(tab === "mine")} type="button">
					Mine {mineCount > 0 && `(${mineCount})`}
				</button>
				<button onClick={() => setTab("starred")} style={tabStyle(tab === "starred")} type="button">
					Starred {starredCount > 0 && `(${starredCount})`}
				</button>
				<button onClick={() => setTab("community")} style={tabStyle(tab === "community")} type="button">
					Community
				</button>
			</div>

			{/* ── MY GALLERY TAB ─────────────────────────────────────────────── */}
			{tab === "mine" && (
				<div style={{ display: "grid", gap: 8 }}>
					{/* Toolbar */}
					<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
						<button
							onClick={() => setShowSaveScene((v) => !v)}
							style={{
								fontSize: 11,
								padding: "4px 10px",
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
								border: "none",
								borderRadius: 4,
								cursor: "pointer",
								flexShrink: 0,
							}}
							title="Save current map view and layer stack to My Gallery"
							type="button">
							+ Save scene
						</button>
						<select
							onChange={(e) => setMyTypeFilter(e.target.value as MyItemType | "all")}
							style={{
								flex: 1,
								fontSize: 11,
								padding: "3px 5px",
								background: "var(--vscode-input-background)",
								color: "var(--vscode-input-foreground)",
								border: `1px solid ${border}`,
								borderRadius: 3,
							}}
							value={myTypeFilter}>
							<option value="all">All types</option>
							{(Object.keys(ITEM_TYPE_LABELS) as MyItemType[]).map((t) => (
								<option key={t} value={t}>
									{ITEM_TYPE_LABELS[t]}
								</option>
							))}
						</select>
					</div>

					{/* Search */}
					<input
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search my gallery…"
						style={{
							width: "100%",
							boxSizing: "border-box",
							fontSize: 11,
							background: "var(--vscode-input-background)",
							color: "var(--vscode-input-foreground)",
							border: `1px solid ${border}`,
							borderRadius: 4,
							padding: "6px 8px",
						}}
						value={query}
					/>

					{/* Save scene dialog */}
					{showSaveScene && (
						<SaveDialog
							bg={bg}
							border={border}
							defaultTitle={`Map scene ${new Date().toLocaleDateString()}`}
							onCancel={() => setShowSaveScene(false)}
							onSave={(title, desc, tags) => {
								onSaveScene(title, desc, tags)
								setShowSaveScene(false)
								flash(`Saved "${title}" to My Gallery`)
							}}
						/>
					)}

					{/* Item list */}
					{filteredMine.length === 0 && (
						<div style={{ color: subtle, fontSize: 11, lineHeight: 1.6, padding: "8px 0" }}>
							{myItems.length === 0
								? 'Nothing saved yet. Click "+ Save scene" above, or use the 📌 Save to My Gallery button in the Transect and Annotation panels.'
								: "No items match the current filter."}
						</div>
					)}
					{filteredMine.map((item) => (
						<MyItemCard
							bg={bg}
							border={border}
							item={item}
							key={item.id}
							onDelete={() => {
								onDeleteMyItem(item.id)
								if (selectedMyId === item.id) setSelectedMyId(null)
								flash(`Deleted "${item.title}"`)
							}}
							onEdit={(title, description, tags) => onUpdateMyItem(item.id, { title, description, tags })}
							onImport={() => importMyItem(item)}
							onSelect={() => setSelectedMyId(selectedMyId === item.id ? null : item.id)}
							onTogglePin={() => onUpdateMyItem(item.id, { pinned: !item.pinned })}
							selected={selectedMyId === item.id}
							subtle={subtle}
						/>
					))}
				</div>
			)}

			{/* ── STARRED / BOOKMARKED TAB ───────────────────────────────────── */}
			{tab === "starred" && (
				<div style={{ display: "grid", gap: 8 }}>
					<div style={{ color: subtle, fontSize: 11, lineHeight: 1.5 }}>
						Community artifacts you have bookmarked. Click ☆ on any community item to add it here.
					</div>
					{catalog.status === "loading" && <div style={{ color: subtle }}>Loading catalog…</div>}
					{catalog.status === "error" && (
						<div style={{ display: "grid", gap: 6 }}>
							<div style={{ color: "var(--vscode-errorForeground, #f87171)", fontSize: 11 }}>{catalog.message}</div>
							<button onClick={requestCatalog} style={{ justifySelf: "start", fontSize: 11 }} type="button">
								Retry
							</button>
						</div>
					)}
					{starredItems.length === 0 && catalog.status === "ready" && (
						<div style={{ color: subtle, fontSize: 11, lineHeight: 1.6 }}>
							No bookmarks yet. Switch to the Community tab and click ☆ on any item to save it here for quick
							access.
						</div>
					)}
					{starredItems.map((item) => (
						<CommunityCard
							bg={bg}
							bookmarked={bookmarkedIds.includes(item.id)}
							border={border}
							importing={importingId === item.id}
							item={item}
							key={item.id}
							linkedText={linkedText}
							onBookmark={() => onToggleBookmark(item.id)}
							onImport={() => importCommunityItem(item)}
							onSelect={() => setSelectedCommunityId(selectedCommunityId === item.id ? null : item.id)}
							onStar={() => toggleStar(item)}
							openUrl={openUrl}
							selected={selectedCommunityId === item.id}
							starring={starringId === item.id}
							subtle={subtle}
						/>
					))}
				</div>
			)}

			{/* ── COMMUNITY TAB ─────────────────────────────────────────────── */}
			{tab === "community" && (
				<CommunityTab
					bg={bg}
					bookmarkedIds={bookmarkedIds}
					border={border}
					catalog={catalog}
					filtered={filteredCommunity}
					importingId={importingId}
					linkedText={linkedText}
					onBookmark={onToggleBookmark}
					onImport={importCommunityItem}
					onOpenExport={onOpenExport}
					onRetry={requestCatalog}
					onStar={toggleStar}
					openUrl={openUrl}
					query={query}
					selectedId={selectedCommunityId}
					setQuery={setQuery}
					setSelectedId={setSelectedCommunityId}
					setSortBy={setSortBy}
					setTrustFilter={setTrustFilter}
					setTypeFilter={setTypeFilter}
					sortBy={sortBy}
					starringId={starringId}
					subtle={subtle}
					trustFilter={trustFilter}
					typeFilter={typeFilter}
				/>
			)}

			{message && (
				<div
					style={{
						fontSize: 11,
						color: message.isError ? "#f87171" : "#86efac",
						background: message.isError ? "rgba(239,68,68,0.08)" : "rgba(134,239,172,0.08)",
						border: `1px solid ${message.isError ? "rgba(239,68,68,0.2)" : "rgba(134,239,172,0.2)"}`,
						borderRadius: 4,
						padding: "5px 8px",
						marginTop: 2,
						lineHeight: 1.4,
					}}>
					{message.text}
				</div>
			)}
		</div>
	)
}

// ── Community card (shared by Starred and Community tabs) ────────────────────

interface CommunityCardProps {
	item: ResearchGalleryItem
	bookmarked: boolean
	importing: boolean
	starring: boolean
	selected: boolean
	bg: string
	border: string
	subtle: string
	onSelect: () => void
	onImport: () => void
	onStar: () => void
	onBookmark: () => void
	openUrl: (url?: string) => void
	linkedText: (label: string, url?: string) => React.ReactNode
}

const CommunityCard: React.FC<CommunityCardProps> = ({
	item,
	bookmarked,
	importing,
	starring,
	selected,
	bg,
	border,
	subtle,
	onSelect,
	onImport,
	onStar,
	onBookmark,
	openUrl,
	linkedText,
}) => {
	const contributorLinks = () => {
		const contributors = item.contributors?.length ? item.contributors : [{ name: item.author, profileUrl: item.authorUrl }]
		return contributors.map((c, i) => (
			<React.Fragment key={`${c.name || c.github || i}`}>
				{i > 0 ? ", " : ""}
				{linkedText(c.name || c.github || "Unknown", contributorProfileUrl(c))}
			</React.Fragment>
		))
	}
	return (
		<div
			onClick={onSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault()
					onSelect()
				}
			}}
			role="button"
			style={{
				padding: 9,
				background: selected ? "rgba(14,99,156,0.24)" : bg,
				border: `1px solid ${selected ? "var(--vscode-focusBorder, #3794ff)" : border}`,
				borderRadius: 5,
				cursor: "pointer",
			}}
			tabIndex={0}>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
				<span style={{ fontWeight: 650, fontSize: 12, flex: 1 }}>{item.title}</span>
				{/* Local bookmark */}
				<span
					onClick={(e) => {
						e.stopPropagation()
						onBookmark()
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.stopPropagation()
							onBookmark()
						}
					}}
					role="button"
					style={{
						fontSize: 12,
						cursor: "pointer",
						color: bookmarked ? "#f59e0b" : subtle,
						opacity: bookmarked ? 1 : 0.5,
					}}
					tabIndex={0}
					title={bookmarked ? "Remove from Starred" : "Add to Starred"}>
					{bookmarked ? "★" : "☆"}
				</span>
				{/* AI-Hydro star */}
				<span
					onClick={(e) => {
						e.stopPropagation()
						onStar()
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.stopPropagation()
							onStar()
						}
					}}
					role="button"
					style={{
						fontSize: 11,
						cursor: starring ? "wait" : "pointer",
						color: item.starredByClient ? "#facc15" : subtle,
						opacity: item.starredByClient ? 1 : 0.5,
					}}
					tabIndex={0}
					title={item.starredByClient ? "Remove AI-Hydro star" : "Star on AI-Hydro"}>
					{item.starredByClient ? "⭐" : "✩"}
				</span>
			</div>
			<div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: subtle }}>
				<span>{typeText(item.type)}</span>
				<span style={{ color: TRUST_COLORS[item.trustLevel] }}>{trustText(item.trustLevel)}</span>
				<span>by {contributorText(item)}</span>
			</div>
			<div style={{ display: "flex", gap: 8, fontSize: 10, color: subtle, marginTop: 4 }}>
				<span title="Imports">⬇ {formatCount(item.metrics?.installs ?? item.downloadCount)}</span>
				<span title="AI-Hydro stars">⭐ {formatCount(item.metrics?.aiHydroStars ?? item.aiHydroStars)}</span>
			</div>
			{selected && (
				<div style={{ marginTop: 10, display: "grid", gap: 6 }}>
					<div style={{ fontSize: 11, color: subtle, lineHeight: 1.4 }}>{item.description}</div>
					<div style={{ display: "grid", gap: 3, fontSize: 11 }}>
						<div>
							<strong>Trust:</strong>{" "}
							<span style={{ color: TRUST_COLORS[item.trustLevel] }}>{trustText(item.trustLevel)}</span>
						</div>
						<div>
							<strong>Author:</strong> {linkedText(item.author, item.authorUrl)}
						</div>
						<div>
							<strong>Contributors:</strong> {contributorLinks()}
						</div>
						<div>
							<strong>License:</strong> {item.license}
						</div>
						{item.citation && (
							<div>
								<strong>Citation:</strong> {item.citation}
							</div>
						)}
					</div>
					{item.importWarnings?.length ? (
						<div style={{ color: "#facc15", fontSize: 11 }}>{item.importWarnings.join(" ")}</div>
					) : null}
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
						<button
							disabled={importing}
							onClick={(e) => {
								e.stopPropagation()
								onImport()
							}}
							style={{
								fontSize: 11,
								padding: "4px 10px",
								background: "var(--vscode-button-background)",
								color: "var(--vscode-button-foreground)",
								border: "none",
								borderRadius: 3,
								cursor: importing ? "wait" : "pointer",
							}}
							type="button">
							{importing ? "Importing…" : "↩ Import to map"}
						</button>
						{item.githubUrl && (
							<button
								onClick={(e) => {
									e.stopPropagation()
									openUrl(item.githubUrl)
								}}
								style={{ fontSize: 11, padding: "4px 8px" }}
								type="button">
								View source ↗
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

// ── Community tab ────────────────────────────────────────────────────────────

interface CommunityTabProps {
	catalog: CatalogState
	bg: string
	border: string
	subtle: string
	query: string
	setQuery: (v: string) => void
	typeFilter: ResearchGalleryItemType | "all"
	setTypeFilter: (v: ResearchGalleryItemType | "all") => void
	trustFilter: TrustLevel | "all"
	setTrustFilter: (v: TrustLevel | "all") => void
	sortBy: string
	setSortBy: (v: any) => void
	filtered: ResearchGalleryItem[]
	selectedId: string | null
	setSelectedId: (v: string | null) => void
	importingId: string | null
	starringId: string | null
	bookmarkedIds: string[]
	onImport: (item: ResearchGalleryItem) => void
	onStar: (item: ResearchGalleryItem) => void
	onBookmark: (id: string) => void
	onRetry: () => void
	onOpenExport?: () => void
	openUrl: (url?: string) => void
	linkedText: (label: string, url?: string) => React.ReactNode
}

const CommunityTab: React.FC<CommunityTabProps> = ({
	catalog,
	bg,
	border,
	subtle,
	query,
	setQuery,
	typeFilter,
	setTypeFilter,
	trustFilter,
	setTrustFilter,
	sortBy,
	setSortBy,
	filtered,
	selectedId,
	setSelectedId,
	importingId,
	starringId,
	bookmarkedIds,
	onImport,
	onStar,
	onBookmark,
	onRetry,
	openUrl,
	linkedText,
}) => {
	const selectStyle: React.CSSProperties = {
		fontSize: 11,
		padding: "3px 4px",
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: `1px solid ${border}`,
		borderRadius: 3,
	}
	if (catalog.status === "loading") {
		return <div style={{ color: subtle, fontSize: 11 }}>Loading community catalog…</div>
	}
	if (catalog.status === "error") {
		return (
			<div style={{ display: "grid", gap: 8 }}>
				<div style={{ color: "var(--vscode-errorForeground, #f87171)", fontSize: 11 }}>{catalog.message}</div>
				<button onClick={onRetry} style={{ justifySelf: "start", fontSize: 11 }} type="button">
					Refresh catalog
				</button>
			</div>
		)
	}
	return (
		<div style={{ display: "grid", gap: 8 }}>
			<div style={{ fontSize: 11, color: subtle, lineHeight: 1.4 }}>
				Reusable hydrologic scenes, styles, datasets, templates, and case studies.
			</div>
			{catalog.status === "ready" && catalog.warning && (
				<div
					style={{
						padding: 7,
						border: "1px solid rgba(250,204,21,0.35)",
						background: "rgba(250,204,21,0.1)",
						color: "#facc15",
						borderRadius: 4,
						fontSize: 11,
					}}>
					{catalog.warning}
				</div>
			)}
			<input
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search gallery…"
				style={{
					width: "100%",
					boxSizing: "border-box",
					fontSize: 11,
					background: "var(--vscode-input-background)",
					color: "var(--vscode-input-foreground)",
					border: `1px solid ${border}`,
					borderRadius: 4,
					padding: "6px 8px",
				}}
				value={query}
			/>
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
				<select onChange={(e) => setTypeFilter(e.target.value as any)} style={selectStyle} value={typeFilter}>
					{Object.entries(TYPE_LABELS).map(([v, l]) => (
						<option key={v} value={v}>
							{l}
						</option>
					))}
				</select>
				<select onChange={(e) => setTrustFilter(e.target.value as any)} style={selectStyle} value={trustFilter}>
					<option value="all">All trust</option>
					<option value="official">Official</option>
					<option value="reviewed">Reviewed</option>
					<option value="community">Community</option>
				</select>
				<select onChange={(e) => setSortBy(e.target.value)} style={selectStyle} value={sortBy}>
					<option value="recommended">Recommended</option>
					<option value="imports">Most imports</option>
					<option value="stars">Most starred</option>
					<option value="newest">Newest</option>
					<option value="name">Name</option>
				</select>
			</div>
			{filtered.length === 0 && <div style={{ color: subtle, fontSize: 11 }}>No matching items.</div>}
			{filtered.map((item) => (
				<CommunityCard
					bg={bg}
					bookmarked={bookmarkedIds.includes(item.id)}
					border={border}
					importing={importingId === item.id}
					item={item}
					key={item.id}
					linkedText={linkedText}
					onBookmark={() => onBookmark(item.id)}
					onImport={() => onImport(item)}
					onSelect={() => setSelectedId(selectedId === item.id ? null : item.id)}
					onStar={() => onStar(item)}
					openUrl={openUrl}
					selected={selectedId === item.id}
					starring={starringId === item.id}
					subtle={subtle}
				/>
			))}
			<div style={{ borderTop: `1px solid ${border}`, paddingTop: 8, fontSize: 10, color: subtle }}>
				{catalog.status === "ready" && (catalog.sourceUrl ?? "built-in fallback")} · AI-Hydro/Gallery
			</div>
			<div
				style={{ border: `1px dashed ${border}`, borderRadius: 6, padding: 10, background: bg, display: "grid", gap: 5 }}>
				<div style={{ fontWeight: 700, fontSize: 12 }}>Contribute a Gallery item?</div>
				<div style={{ color: subtle, fontSize: 11, lineHeight: 1.4 }}>
					Share scenes, styles, datasets, case studies, or plate templates with the community.
				</div>
				<button
					onClick={() => openUrl(GALLERY_CONTRIBUTION_URL)}
					style={{ justifySelf: "start", fontSize: 11 }}
					type="button">
					Open contribution template ↗
				</button>
			</div>
		</div>
	)
}

export default ResearchGalleryPanel
