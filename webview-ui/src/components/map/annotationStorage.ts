/**
 * annotationStorage.ts  (v2)
 * Persistent storage for Smart Map Annotations + named Collections (localStorage).
 *
 * v2 changes vs v1:
 *  - `comment`  → split into `notes` (personal) and `aiPrompt` (agent instruction)
 *  - `tags`     → `string[]` (was comma-string)
 *  - Added: `status`, `priority`, `collectionIds`, `updatedAt`
 *  - Added: `AnnotationCollection` type + CRUD helpers
 */

// ─── Storage keys ────────────────────────────────────────────────────────────
const ANNOTATIONS_KEY = "aihydro.map.annotations.v2"
const ANNOTATIONS_V1_KEY = "aihydro.map.annotations.v1"
const COLLECTIONS_KEY = "aihydro.map.annotation.collections.v1"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnnotationStatus = "open" | "in-progress" | "reviewed" | "done"
export type AnnotationPriority = "low" | "medium" | "high"

export interface MapAnnotation {
	id: string
	name: string

	/** Personal field notes — context for the researcher, included as background for the agent */
	notes: string

	/** Optional explicit agent instruction. If empty the agent gets a smart default. */
	aiPrompt: string

	/** CSS hex colour */
	color: string

	type: "point" | "polygon" | "line"

	/** GeoJSON geometry */
	geometry: {
		type: "Point" | "Polygon" | "LineString"
		coordinates: number[] | number[][] | number[][][]
	}

	/** Tags for filtering/search */
	tags: string[]

	/** IDs of AnnotationCollections this annotation belongs to */
	collectionIds: string[]

	status: AnnotationStatus
	priority: AnnotationPriority | null

	createdAt: string
	updatedAt: string
}

export interface AnnotationCollection {
	id: string
	name: string
	description: string
	/** CSS hex colour chip */
	color: string
	createdAt: string
	updatedAt: string
}

// ─── Colours ─────────────────────────────────────────────────────────────────

export const PRESET_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#ec4899", "#ffffff"]

export const COLLECTION_COLORS = ["#6366f1", "#06b6d4", "#22c55e", "#f97316", "#ec4899", "#eab308", "#ef4444", "#8b5cf6"]

// ─── Migration helpers ────────────────────────────────────────────────────────

interface V1Annotation {
	id: string
	name: string
	comment: string
	color: string
	type: "point" | "polygon" | "line"
	geometry: MapAnnotation["geometry"]
	tags: string
	createdAt: string
}

function migrateV1toV2(v1: V1Annotation): MapAnnotation {
	return {
		id: v1.id,
		name: v1.name,
		notes: v1.comment ?? "", // comment → notes
		aiPrompt: "",
		color: v1.color ?? PRESET_COLORS[0],
		type: v1.type,
		geometry: v1.geometry,
		tags: v1.tags
			? v1.tags
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: v1.createdAt,
		updatedAt: v1.createdAt,
	}
}

// ─── Annotation CRUD ─────────────────────────────────────────────────────────

export function loadAnnotations(): MapAnnotation[] {
	try {
		// Try v2 store first
		const raw = localStorage.getItem(ANNOTATIONS_KEY)
		if (raw) {
			return JSON.parse(raw) as MapAnnotation[]
		}
		// Fall back to v1 and migrate
		const rawV1 = localStorage.getItem(ANNOTATIONS_V1_KEY)
		if (rawV1) {
			const v1List = JSON.parse(rawV1) as V1Annotation[]
			const migrated = v1List.map(migrateV1toV2)
			saveAnnotations(migrated)
			return migrated
		}
		return []
	} catch {
		return []
	}
}

export function saveAnnotations(annotations: MapAnnotation[]): void {
	try {
		localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations))
	} catch {
		/* ignore */
	}
}

/** Produce a new blank annotation at a given geometry */
export function newAnnotation(
	type: MapAnnotation["type"],
	geometry: MapAnnotation["geometry"],
	existingCount: number,
): MapAnnotation {
	const now = new Date().toISOString()
	return {
		id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		name: `Annotation ${existingCount + 1}`,
		notes: "",
		aiPrompt: "",
		color: PRESET_COLORS[existingCount % PRESET_COLORS.length],
		type,
		geometry,
		tags: [],
		collectionIds: [],
		status: "open",
		priority: null,
		createdAt: now,
		updatedAt: now,
	}
}

// ─── Collection CRUD ──────────────────────────────────────────────────────────

export function loadCollections(): AnnotationCollection[] {
	try {
		const raw = localStorage.getItem(COLLECTIONS_KEY)
		return raw ? (JSON.parse(raw) as AnnotationCollection[]) : []
	} catch {
		return []
	}
}

export function saveCollections(collections: AnnotationCollection[]): void {
	try {
		localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
	} catch {
		/* ignore */
	}
}

export function newCollection(existingCount: number): AnnotationCollection {
	const now = new Date().toISOString()
	return {
		id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
		name: `Collection ${existingCount + 1}`,
		description: "",
		color: COLLECTION_COLORS[existingCount % COLLECTION_COLORS.length],
		createdAt: now,
		updatedAt: now,
	}
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/** Get the representative [lon, lat] centre of an annotation */
export function annotationCenter(ann: MapAnnotation): [number, number] {
	if (ann.type === "point") {
		const c = ann.geometry.coordinates as number[]
		return [c[0], c[1]]
	}
	if (ann.type === "line") {
		const coords = ann.geometry.coordinates as number[][]
		const mid = Math.floor(coords.length / 2)
		return [coords[mid][0], coords[mid][1]]
	}
	// polygon centroid
	const ring = (ann.geometry.coordinates as number[][][])[0] ?? []
	if (ring.length === 0) {
		return [0, 0]
	}
	const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length
	const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
	return [lon, lat]
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
	const s = String(v ?? "")
	return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s
}

export function formatAnnotationsAsCsv(annotations: MapAnnotation[]): string {
	const headers = [
		"name",
		"type",
		"lon",
		"lat",
		"notes",
		"ai_prompt",
		"tags",
		"status",
		"priority",
		"color",
		"collection_ids",
		"created_at",
		"updated_at",
	]
	const rows = annotations.map((ann) => {
		const [lon, lat] = annotationCenter(ann)
		return [
			ann.name,
			ann.type,
			lon.toFixed(6),
			lat.toFixed(6),
			ann.notes,
			ann.aiPrompt,
			ann.tags.join(";"),
			ann.status,
			ann.priority ?? "",
			ann.color,
			ann.collectionIds.join(";"),
			ann.createdAt,
			ann.updatedAt,
		]
			.map(csvEscape)
			.join(",")
	})
	return [headers.join(","), ...rows].join("\n")
}

export function exportAnnotationsCsv(annotations: MapAnnotation[], filename = "aihydro_annotations.csv"): void {
	const csv = formatAnnotationsAsCsv(annotations)
	triggerDownload(new Blob([csv], { type: "text/csv" }), filename)
}

/** Parse a CSV file into MapAnnotation stubs. Required cols: name, lat, lon. */
export async function importAnnotationsCsv(file: File, existingCount = 0): Promise<Partial<MapAnnotation>[]> {
	return new Promise((resolve) => {
		const reader = new FileReader()
		reader.onload = (e) => {
			try {
				const text = e.target?.result as string
				const lines = text.split(/\r?\n/).filter(Boolean)
				if (lines.length < 2) {
					return resolve([])
				}
				const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""))
				const idxOf = (name: string) => headers.indexOf(name)
				const iLon = idxOf("lon") >= 0 ? idxOf("lon") : idxOf("longitude")
				const iLat = idxOf("lat") >= 0 ? idxOf("lat") : idxOf("latitude")
				const iName = idxOf("name")
				const iNotes = idxOf("notes") >= 0 ? idxOf("notes") : idxOf("comment")
				const iAiPrompt = idxOf("ai_prompt")
				const iTags = idxOf("tags")
				const iStatus = idxOf("status")
				const iPriority = idxOf("priority")
				if (iLon < 0 || iLat < 0 || iName < 0) {
					return resolve([])
				}
				const results: Partial<MapAnnotation>[] = []
				const now = new Date().toISOString()
				for (let i = 1; i < lines.length; i++) {
					const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""))
					const lon = parseFloat(cols[iLon] ?? "")
					const lat = parseFloat(cols[iLat] ?? "")
					const name = cols[iName] ?? `Site ${i}`
					if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
						continue
					}
					const rawTags = iTags >= 0 ? (cols[iTags] ?? "") : ""
					const status = (iStatus >= 0 ? cols[iStatus] : "open") as AnnotationStatus
					const priority = (iPriority >= 0 ? cols[iPriority] || null : null) as AnnotationPriority | null
					results.push({
						id: `ann_import_${Date.now()}_${i}`,
						name,
						notes: iNotes >= 0 ? (cols[iNotes] ?? "") : "",
						aiPrompt: iAiPrompt >= 0 ? (cols[iAiPrompt] ?? "") : "",
						tags: rawTags
							? rawTags
									.split(";")
									.map((t) => t.trim())
									.filter(Boolean)
							: [],
						color: PRESET_COLORS[(existingCount + i) % PRESET_COLORS.length],
						type: "point",
						geometry: { type: "Point", coordinates: [lon, lat] },
						collectionIds: [],
						status: ["open", "in-progress", "reviewed", "done"].includes(status) ? status : "open",
						priority: ["low", "medium", "high"].includes(priority as string) ? priority : null,
						createdAt: now,
						updatedAt: now,
					})
				}
				resolve(results)
			} catch {
				resolve([])
			}
		}
		reader.readAsText(file)
	})
}

// ─── Download helper ─────────────────────────────────────────────────────────

export function triggerDownload(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = filename
	a.click()
	URL.revokeObjectURL(url)
}
