import { v4 as uuidv4 } from "uuid"

export type TransectStatus = "open" | "in-progress" | "reviewed" | "done"
export type TransectPriority = "low" | "medium" | "high" | null

export interface MapTransect {
	id: string
	name: string
	notes: string
	aiPrompt: string
	geometry: {
		type: "LineString"
		coordinates: [number, number][]
	}
	color: string
	tags: string[]
	collectionIds: string[]
	status: TransectStatus
	priority: TransectPriority
	targetRasterId?: string
	createdAt: string
	updatedAt: string
}

export interface TransectCollection {
	id: string
	name: string
	description: string
	color: string
	createdAt: string
}

export const PRESET_TRANSECT_COLORS = [
	"#f97316", // orange
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#06b6d4", // cyan
	"#10b981", // emerald
]

export const COLLECTION_COLORS = [
	"#64748b", // slate
	"#ef4444", // red
	"#f59e0b", // amber
	"#84cc16", // lime
	"#3b82f6", // blue
]

const STORAGE_KEY = "aihydro.map.transects.v1"
const COLLECTIONS_KEY = "aihydro.map.transect.collections.v1"

export function loadTransects(): MapTransect[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (raw) {
			return JSON.parse(raw) as MapTransect[]
		}
	} catch (e) {
		console.warn("Failed to load transects", e)
	}
	return []
}

export function saveTransects(transects: MapTransect[]) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(transects))
}

export function loadCollections(): TransectCollection[] {
	try {
		const raw = localStorage.getItem(COLLECTIONS_KEY)
		if (raw) {
			return JSON.parse(raw) as TransectCollection[]
		}
	} catch (e) {
		console.warn("Failed to load transect collections", e)
	}
	return []
}

export function saveCollections(collections: TransectCollection[]) {
	localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections))
}

export function newCollection(existingCount: number): TransectCollection {
	return {
		id: `col_${uuidv4()}`,
		name: `Collection ${existingCount + 1}`,
		description: "",
		color: COLLECTION_COLORS[existingCount % COLLECTION_COLORS.length],
		createdAt: new Date().toISOString(),
	}
}

export function newTransect(
	geometry: { type: "LineString"; coordinates: [number, number][] },
	count: number,
	targetRasterId?: string,
): MapTransect {
	return {
		id: `transect_${Date.now()}`,
		name: `Profile ${count + 1}`,
		notes: "",
		aiPrompt: "",
		geometry,
		color: PRESET_TRANSECT_COLORS[count % PRESET_TRANSECT_COLORS.length],
		tags: [],
		collectionIds: [],
		status: "open",
		priority: null,
		targetRasterId,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	}
}
