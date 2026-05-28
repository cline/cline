import React, { useEffect, useMemo, useState } from "react"
import { PLATFORM_CONFIG } from "../../config/platform.config"

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
	createdAt?: string
	updatedAt?: string
	isFeatured?: boolean
	isInstalled?: boolean
	downloadCount?: number
	githubReactions?: number
	discussionUrl?: string
	source?: "remote" | "built_in" | "local"
	importWarnings?: string[]
}

interface ResearchGalleryPanelProps {
	mapStyle: "dark" | "light"
	onOpenExport?: () => void
}

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

function uiRequestId(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function trustText(value: TrustLevel): string {
	switch (value) {
		case "official":
			return "Official"
		case "reviewed":
			return "Reviewed"
		case "community":
			return "Community"
		case "local":
			return "Local"
	}
}

function typeText(value: ResearchGalleryItemType): string {
	return TYPE_LABELS[value] ?? value
}

export const ResearchGalleryPanel: React.FC<ResearchGalleryPanelProps> = ({ mapStyle, onOpenExport }) => {
	const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" })
	const [query, setQuery] = useState("")
	const [typeFilter, setTypeFilter] = useState<ResearchGalleryItemType | "all">("all")
	const [trustFilter, setTrustFilter] = useState<TrustLevel | "all">("all")
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [importingId, setImportingId] = useState<string | null>(null)
	const [message, setMessage] = useState<string | null>(null)

	const requestCatalog = () => {
		const requestId = uiRequestId("gallery")
		setCatalog({ status: "loading" })
		setMessage(null)

		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-catalog-result" || data.requestId !== requestId) {
				return
			}
			window.removeEventListener("message", onMessage)
			if (data.ok) {
				setCatalog({
					status: "ready",
					items: Array.isArray(data.items) ? data.items : [],
					warning: data.warning,
					sourceUrl: data.sourceUrl,
				})
			} else {
				setCatalog({ status: "error", message: data.error ?? "Could not load Research Gallery." })
			}
		}

		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-research-gallery-catalog", requestId })
	}

	useEffect(() => {
		requestCatalog()
	}, [])

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-import-result") {
				return
			}
			setImportingId(null)
			if (data.openExport) {
				onOpenExport?.()
			}
			setMessage(data.ok ? (data.message ?? "Imported from Research Gallery.") : (data.error ?? "Import failed."))
			window.setTimeout(() => setMessage(null), 6000)
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [onOpenExport])

	const items = catalog.status === "ready" ? catalog.items : []
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		return items
			.filter((item) => {
				if (typeFilter !== "all" && item.type !== typeFilter) return false
				if (trustFilter !== "all" && item.trustLevel !== trustFilter) return false
				if (!q) return true
				return (
					item.title.toLowerCase().includes(q) ||
					item.description.toLowerCase().includes(q) ||
					item.author.toLowerCase().includes(q) ||
					item.tags.some((tag) => tag.toLowerCase().includes(q))
				)
			})
			.sort((a, b) => {
				if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1
				if (a.trustLevel !== b.trustLevel) {
					const order: Record<TrustLevel, number> = { official: 0, reviewed: 1, community: 2, local: 3 }
					return order[a.trustLevel] - order[b.trustLevel]
				}
				return a.title.localeCompare(b.title)
			})
	}, [items, query, typeFilter, trustFilter])

	const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]

	const importItem = (item: ResearchGalleryItem) => {
		setImportingId(item.id)
		setMessage(null)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-research-gallery-import", requestId: uiRequestId("gallery-import"), item })
	}

	const bg = mapStyle === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
	const border = mapStyle === "dark" ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"
	const subtle = "var(--vscode-descriptionForeground, #9ca3af)"

	if (catalog.status === "loading") {
		return (
			<div style={{ padding: 14, display: "grid", gap: 10 }}>
				<div style={{ fontWeight: 700 }}>AI-Hydro Research Gallery</div>
				<div style={{ color: subtle }}>Loading reusable research map artifacts...</div>
			</div>
		)
	}

	if (catalog.status === "error") {
		return (
			<div style={{ padding: 14, display: "grid", gap: 10 }}>
				<div style={{ fontWeight: 700 }}>AI-Hydro Research Gallery</div>
				<div style={{ color: "var(--vscode-errorForeground, #f87171)" }}>{catalog.message}</div>
				<button onClick={requestCatalog} type="button">
					Refresh catalog
				</button>
			</div>
		)
	}

	return (
		<div style={{ padding: 12, display: "grid", gap: 10 }}>
			<div>
				<div style={{ fontWeight: 700, fontSize: 14 }}>AI-Hydro Research Gallery</div>
				<div style={{ color: subtle, fontSize: 11, lineHeight: 1.45 }}>
					Reusable hydrologic scenes, styles, datasets, templates, and case studies.
				</div>
			</div>
			{catalog.warning && (
				<div
					style={{
						padding: 8,
						border: `1px solid rgba(250, 204, 21, 0.35)`,
						background: "rgba(250, 204, 21, 0.1)",
						color: "#facc15",
						borderRadius: 5,
						fontSize: 11,
						lineHeight: 1.4,
					}}>
					{catalog.warning}
				</div>
			)}
			<div style={{ display: "grid", gap: 8 }}>
				<input
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search TWI styles, MERIT scenes, basin case studies..."
					style={{
						width: "100%",
						boxSizing: "border-box",
						background: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						border: `1px solid ${border}`,
						borderRadius: 4,
						padding: "7px 8px",
					}}
					value={query}
				/>
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
					<select onChange={(e) => setTypeFilter(e.target.value as any)} value={typeFilter}>
						{Object.entries(TYPE_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
					<select onChange={(e) => setTrustFilter(e.target.value as any)} value={trustFilter}>
						<option value="all">All trust levels</option>
						<option value="official">Official</option>
						<option value="reviewed">Reviewed</option>
						<option value="community">Community</option>
						<option value="local">Local</option>
					</select>
				</div>
			</div>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: selected ? "minmax(180px, 1fr) minmax(190px, 0.9fr)" : "1fr",
					gap: 10,
				}}>
				<div style={{ display: "grid", gap: 8, alignContent: "start" }}>
					{filtered.length === 0 && <div style={{ color: subtle, fontSize: 12 }}>No matching gallery items.</div>}
					{filtered.map((item) => (
						<button
							key={item.id}
							onClick={() => setSelectedId(item.id)}
							style={{
								textAlign: "left",
								padding: 9,
								background: selected?.id === item.id ? "rgba(14, 99, 156, 0.24)" : bg,
								color: "inherit",
								border: `1px solid ${selected?.id === item.id ? "var(--vscode-focusBorder, #3794ff)" : border}`,
								borderRadius: 5,
								cursor: "pointer",
							}}
							type="button">
							<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
								<span style={{ fontWeight: 650, fontSize: 12 }}>{item.title}</span>
								{item.isFeatured && <span style={{ color: "#facc15", fontSize: 10 }}>Featured</span>}
							</div>
							<div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: subtle }}>
								<span>{typeText(item.type)}</span>
								<span style={{ color: TRUST_COLORS[item.trustLevel] }}>{trustText(item.trustLevel)}</span>
								<span>{item.license}</span>
							</div>
						</button>
					))}
				</div>
				{selected && (
					<div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 10, background: bg }}>
						<div style={{ fontWeight: 700, marginBottom: 4 }}>{selected.title}</div>
						<div style={{ color: subtle, fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
							{selected.description}
						</div>
						<div style={{ display: "grid", gap: 4, fontSize: 11, marginBottom: 10 }}>
							<div>
								<strong>Type:</strong> {typeText(selected.type)}
							</div>
							<div>
								<strong>Trust:</strong>{" "}
								<span style={{ color: TRUST_COLORS[selected.trustLevel] }}>{trustText(selected.trustLevel)}</span>
							</div>
							<div>
								<strong>Author:</strong> {selected.author}
							</div>
							<div>
								<strong>License:</strong> {selected.license}
							</div>
							{selected.citation && (
								<div>
									<strong>Citation:</strong> {selected.citation}
								</div>
							)}
						</div>
						{selected.importWarnings?.length ? (
							<div style={{ color: "#facc15", fontSize: 11, lineHeight: 1.4, marginBottom: 8 }}>
								{selected.importWarnings.join(" ")}
							</div>
						) : null}
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<button
								disabled={importingId === selected.id}
								onClick={() => importItem(selected)}
								style={{
									background: "var(--vscode-button-background, #0e639c)",
									color: "var(--vscode-button-foreground, white)",
									border: "none",
									borderRadius: 4,
									padding: "7px 10px",
									cursor: importingId === selected.id ? "wait" : "pointer",
								}}
								type="button">
								{importingId === selected.id
									? "Importing..."
									: selected.type === "style_preset"
										? "Import style"
										: selected.type === "map_plate_template"
											? "Open template"
											: "Import to map"}
							</button>
							{selected.githubUrl && (
								<button
									onClick={() => PLATFORM_CONFIG.postMessage({ type: "openExternal", url: selected.githubUrl })}
									type="button">
									View source
								</button>
							)}
						</div>
					</div>
				)}
			</div>
			<div style={{ borderTop: `1px solid ${border}`, paddingTop: 8, fontSize: 10, color: subtle, lineHeight: 1.35 }}>
				Catalog: {catalog.sourceUrl ?? "built-in fallback"} · Community repo: AI-Hydro/Gallery
			</div>
			{message && (
				<div style={{ fontSize: 11, color: message.toLowerCase().includes("fail") ? "#f87171" : "#86efac" }}>
					{message}
				</div>
			)}
		</div>
	)
}

export default ResearchGalleryPanel
