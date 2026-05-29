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
	metrics?: {
		installs?: number
		downloads?: number
		aiHydroStars?: number
	}
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

const GALLERY_CONTRIBUTION_URL = "https://github.com/AI-Hydro/Gallery/issues/new?template=new_gallery_item.md"

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

function formatCount(value: number | undefined): string {
	const count = Number(value ?? 0)
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
	return count.toString()
}

function contributorText(item: ResearchGalleryItem): string {
	const names = item.contributors?.map((contributor) => contributor.name || contributor.github).filter(Boolean) ?? []
	return names.length > 0 ? names.join(", ") : item.author
}

function githubProfileUrl(github?: string): string {
	const handle = String(github ?? "")
		.trim()
		.replace(/^@/, "")
	return handle ? `https://github.com/${handle}` : ""
}

function orcidProfileUrl(orcid?: string): string {
	const value = String(orcid ?? "").trim()
	if (!value) return ""
	return value.startsWith("http") ? value : `https://orcid.org/${value}`
}

function contributorProfileUrl(contributor: NonNullable<ResearchGalleryItem["contributors"]>[number]): string {
	return (
		contributor.profileUrl ||
		contributor.url ||
		contributor.website ||
		contributor.linkedin ||
		contributor.googleScholar ||
		githubProfileUrl(contributor.github) ||
		orcidProfileUrl(contributor.orcid)
	)
}

export const ResearchGalleryPanel: React.FC<ResearchGalleryPanelProps> = ({ mapStyle, onOpenExport }) => {
	const [catalog, setCatalog] = useState<CatalogState>({ status: "loading" })
	const [query, setQuery] = useState("")
	const [typeFilter, setTypeFilter] = useState<ResearchGalleryItemType | "all">("all")
	const [trustFilter, setTrustFilter] = useState<TrustLevel | "all">("all")
	const [sortBy, setSortBy] = useState<"recommended" | "imports" | "stars" | "newest" | "name">("recommended")
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [importingId, setImportingId] = useState<string | null>(null)
	const [starringId, setStarringId] = useState<string | null>(null)
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

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-research-gallery-star-result") {
				return
			}
			setStarringId(null)
			if (!data.ok) {
				setMessage(data.error ?? "Star update failed.")
				window.setTimeout(() => setMessage(null), 6000)
				return
			}
			setCatalog((current) => {
				if (current.status !== "ready") return current
				return {
					...current,
					items: current.items.map((item) => {
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
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [])

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
				const importsA = Number(a.metrics?.installs ?? a.downloadCount ?? 0)
				const importsB = Number(b.metrics?.installs ?? b.downloadCount ?? 0)
				const starsA = Number(a.metrics?.aiHydroStars ?? a.aiHydroStars ?? 0)
				const starsB = Number(b.metrics?.aiHydroStars ?? b.aiHydroStars ?? 0)
				if (sortBy === "imports") return importsB - importsA || a.title.localeCompare(b.title)
				if (sortBy === "stars") return starsB - starsA || a.title.localeCompare(b.title)
				if (sortBy === "newest") return String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))
				if (sortBy === "name") return a.title.localeCompare(b.title)
				if (!!a.isFeatured !== !!b.isFeatured) return a.isFeatured ? -1 : 1
				if (a.trustLevel !== b.trustLevel) {
					const order: Record<TrustLevel, number> = { official: 0, reviewed: 1, community: 2, local: 3 }
					return order[a.trustLevel] - order[b.trustLevel]
				}
				return starsB - starsA || importsB - importsA || a.title.localeCompare(b.title)
			})
	}, [items, query, typeFilter, trustFilter, sortBy])

	const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0]

	const importItem = (item: ResearchGalleryItem) => {
		setImportingId(item.id)
		setMessage(null)
		PLATFORM_CONFIG.postMessage({ type: "aihydro-research-gallery-import", requestId: uiRequestId("gallery-import"), item })
	}

	const toggleStar = (item: ResearchGalleryItem) => {
		setStarringId(item.id)
		setMessage(null)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-research-gallery-star",
			requestId: uiRequestId("gallery-star"),
			itemId: item.id,
			starred: !item.starredByClient,
		})
	}

	const bg = mapStyle === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"
	const border = mapStyle === "dark" ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.13)"
	const subtle = "var(--vscode-descriptionForeground, #9ca3af)"
	const openUrl = (url?: string) => {
		if (url) {
			PLATFORM_CONFIG.postMessage({ type: "openExternal", url })
		}
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
					textAlign: "left",
				}}
				type="button">
				{label}
			</button>
		) : (
			<span>{label}</span>
		)
	const contributorLinks = (item: ResearchGalleryItem) => {
		const contributors = item.contributors?.length ? item.contributors : [{ name: item.author, profileUrl: item.authorUrl }]
		return contributors.map((contributor, index) => (
			<React.Fragment key={`${contributor.name || contributor.github || "contributor"}-${index}`}>
				{index > 0 ? ", " : ""}
				{linkedText(contributor.name || contributor.github || "Unknown contributor", contributorProfileUrl(contributor))}
			</React.Fragment>
		))
	}

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
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
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
					<select onChange={(e) => setSortBy(e.target.value as any)} value={sortBy}>
						<option value="recommended">Recommended</option>
						<option value="imports">Most imports</option>
						<option value="stars">Most AI-Hydro stars</option>
						<option value="newest">Newest</option>
						<option value="name">Name</option>
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
						<div
							key={item.id}
							onClick={() => setSelectedId(item.id)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault()
									setSelectedId(item.id)
								}
							}}
							role="button"
							style={{
								textAlign: "left",
								padding: 9,
								background: selected?.id === item.id ? "rgba(14, 99, 156, 0.24)" : bg,
								color: "inherit",
								border: `1px solid ${selected?.id === item.id ? "var(--vscode-focusBorder, #3794ff)" : border}`,
								borderRadius: 5,
								cursor: "pointer",
							}}
							tabIndex={0}>
							<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
								<span style={{ fontWeight: 650, fontSize: 12, flex: 1 }}>{item.title}</span>
								<span
									aria-label={item.starredByClient ? "Unstar Gallery item" : "Star Gallery item"}
									onClick={(event) => {
										event.stopPropagation()
										toggleStar(item)
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault()
											event.stopPropagation()
											toggleStar(item)
										}
									}}
									role="button"
									style={{
										color: item.starredByClient ? "#facc15" : subtle,
										cursor: starringId === item.id ? "wait" : "pointer",
										fontSize: 13,
										lineHeight: 1,
									}}
									tabIndex={0}
									title={item.starredByClient ? "Remove your AI-Hydro star" : "Star this item in AI-Hydro"}>
									{item.starredByClient ? "★" : "☆"}
								</span>
							</div>
							<div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10, color: subtle }}>
								<span>{typeText(item.type)}</span>
								<span style={{ color: TRUST_COLORS[item.trustLevel] }}>{trustText(item.trustLevel)}</span>
								<span>by {contributorText(item)}</span>
							</div>
							<div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10, color: subtle, marginTop: 5 }}>
								<span title="AI-Hydro imports/installs">
									⬇ {formatCount(item.metrics?.installs ?? item.downloadCount)}
								</span>
								<span title="AI-Hydro user stars">
									★ {formatCount(item.metrics?.aiHydroStars ?? item.aiHydroStars)}
								</span>
							</div>
						</div>
					))}
				</div>
				{selected && (
					<div style={{ border: `1px solid ${border}`, borderRadius: 6, padding: 10, background: bg }}>
						<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
							<div style={{ fontWeight: 700, flex: 1 }}>{selected.title}</div>
							<button
								disabled={starringId === selected.id}
								onClick={() => toggleStar(selected)}
								style={{
									border: `1px solid ${border}`,
									borderRadius: 4,
									background: selected.starredByClient ? "rgba(250, 204, 21, 0.16)" : "transparent",
									color: selected.starredByClient ? "#facc15" : "inherit",
									cursor: starringId === selected.id ? "wait" : "pointer",
									padding: "4px 7px",
								}}
								title={selected.starredByClient ? "Remove your AI-Hydro star" : "Star this item in AI-Hydro"}
								type="button">
								{selected.starredByClient ? "★ Starred" : "☆ Star"}
							</button>
						</div>
						{selected.badges?.length ? (
							<div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 7 }}>
								{selected.badges.map((badge) => (
									<span
										key={badge}
										style={{
											border: `1px solid ${border}`,
											borderRadius: 999,
											color: "#bae6fd",
											fontSize: 9,
											padding: "2px 6px",
										}}>
										{badge}
									</span>
								))}
							</div>
						) : null}
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
								<strong>Author:</strong> {linkedText(selected.author, selected.authorUrl)}
							</div>
							<div>
								<strong>Contributors:</strong> {contributorLinks(selected)}
							</div>
							<div>
								<strong>License:</strong> {selected.license}
							</div>
							<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
								<span title="AI-Hydro imports/installs">
									<strong>Imports:</strong> {formatCount(selected.metrics?.installs ?? selected.downloadCount)}
								</span>
								<span title="AI-Hydro user stars">
									<strong>AI-Hydro stars:</strong>{" "}
									{formatCount(selected.metrics?.aiHydroStars ?? selected.aiHydroStars)}
								</span>
							</div>
							{selected.citation && (
								<div>
									<strong>Citation:</strong> {selected.citation}{" "}
									{selected.citationUrl ? linkedText("Citation link ↗", selected.citationUrl) : null}
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
								<button onClick={() => openUrl(selected.githubUrl)} type="button">
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
			<div
				style={{
					border: `1px dashed ${border}`,
					borderRadius: 6,
					padding: 10,
					background: bg,
					display: "grid",
					gap: 6,
				}}>
				<div style={{ fontWeight: 700, fontSize: 12 }}>Contribute a Gallery item?</div>
				<div style={{ color: subtle, fontSize: 11, lineHeight: 1.45 }}>
					Share a reusable map scene, style, dataset connector, case study, or plate template with the AI-Hydro
					community.
				</div>
				<button onClick={() => openUrl(GALLERY_CONTRIBUTION_URL)} style={{ justifySelf: "start" }} type="button">
					Open contribution template on GitHub ↗
				</button>
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
