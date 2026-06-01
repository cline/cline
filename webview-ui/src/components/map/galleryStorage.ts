import type { AnnotationCollection, MapAnnotation } from "./annotationStorage"
import type { MapTransect, TransectCollection } from "./transectStorage"

// ── Artifact types ──────────────────────────────────────────────────────────

export type MyItemType = "map_scene" | "style_preset" | "transect_collection" | "annotation_collection" | "map_plate_template"

export interface MapScenePayload {
	basemap: string
	viewState: { longitude: number; latitude: number; zoom: number; bearing: number; pitch: number }
	visibleLayerIds: string[]
	layerOpacities: Record<string, number>
	layerDisplayNames: Record<string, string>
}

export interface TransectCollectionPayload {
	collectionName: string
	transects: MapTransect[]
	collections: TransectCollection[]
}

export interface AnnotationCollectionPayload {
	collectionName: string
	annotations: MapAnnotation[]
	collections: AnnotationCollection[]
}

export interface StylePresetPayload {
	layerType: "raster" | "vector"
	colormap?: string
	fillColor?: string
	strokeColor?: string
	strokeWidth?: number
	opacity?: number
}

export type ArtifactPayload =
	| MapScenePayload
	| TransectCollectionPayload
	| AnnotationCollectionPayload
	| StylePresetPayload
	| Record<string, unknown>

export interface MyGalleryItem {
	id: string
	type: MyItemType
	title: string
	description: string
	tags: string[]
	pinned: boolean
	createdAt: string
	updatedAt: string
	payload: ArtifactPayload
}

// ── Storage keys ────────────────────────────────────────────────────────────

const MY_GALLERY_KEY = "aihydro.gallery.mine.v1"
const BOOKMARKS_KEY = "aihydro.gallery.bookmarks.v1"

// ── My Gallery CRUD ─────────────────────────────────────────────────────────

export function loadMyGallery(): MyGalleryItem[] {
	try {
		const raw = localStorage.getItem(MY_GALLERY_KEY)
		return raw ? (JSON.parse(raw) as MyGalleryItem[]) : []
	} catch {
		return []
	}
}

export function saveMyGallery(items: MyGalleryItem[]): void {
	localStorage.setItem(MY_GALLERY_KEY, JSON.stringify(items))
}

export function addToMyGallery(draft: Omit<MyGalleryItem, "id" | "createdAt" | "updatedAt">): MyGalleryItem {
	const now = new Date().toISOString()
	const item: MyGalleryItem = {
		...draft,
		id: `gallery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		createdAt: now,
		updatedAt: now,
	}
	const existing = loadMyGallery()
	saveMyGallery([item, ...existing])
	return item
}

export function removeFromMyGallery(id: string): void {
	saveMyGallery(loadMyGallery().filter((i) => i.id !== id))
}

export function updateMyGalleryItem(id: string, updates: Partial<Omit<MyGalleryItem, "id" | "createdAt">>): void {
	saveMyGallery(
		loadMyGallery().map((item) => (item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item)),
	)
}

// ── Bookmarks (community item IDs) ──────────────────────────────────────────

export function loadBookmarks(): string[] {
	try {
		const raw = localStorage.getItem(BOOKMARKS_KEY)
		return raw ? (JSON.parse(raw) as string[]) : []
	} catch {
		return []
	}
}

export function saveBookmarks(ids: string[]): void {
	localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(ids))
}

export function toggleBookmark(communityId: string): boolean {
	const current = loadBookmarks()
	const isNowBookmarked = !current.includes(communityId)
	saveBookmarks(isNowBookmarked ? [communityId, ...current] : current.filter((id) => id !== communityId))
	return isNowBookmarked
}

export function isBookmarked(communityId: string): boolean {
	return loadBookmarks().includes(communityId)
}

// ── Type display helpers ─────────────────────────────────────────────────────

export const ITEM_TYPE_LABELS: Record<MyItemType, string> = {
	map_scene: "Map scene",
	style_preset: "Style preset",
	transect_collection: "Transect collection",
	annotation_collection: "Annotation collection",
	map_plate_template: "Plate template",
}

export const ITEM_TYPE_ICONS: Record<MyItemType, string> = {
	map_scene: "🗺",
	style_preset: "🎨",
	transect_collection: "📈",
	annotation_collection: "💬",
	map_plate_template: "🖼",
}

export function relativeTime(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime()
	const m = Math.floor(diff / 60_000)
	if (m < 1) return "just now"
	if (m < 60) return `${m}m ago`
	const h = Math.floor(m / 60)
	if (h < 24) return `${h}h ago`
	const d = Math.floor(h / 24)
	if (d < 30) return `${d}d ago`
	return new Date(iso).toLocaleDateString()
}
