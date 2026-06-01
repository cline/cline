/**
 * Map workspace persistence — localStorage-backed.
 *
 * Stores per-user UI state (basemap, view, layer visibility, panel layout)
 * so the map opens in the same configuration it was last left in.
 *
 * Schema is versioned so we can evolve it without breaking older saves.
 */

import type { MapViewState } from "@deck.gl/core"

const STORAGE_KEY = "aihydro.map.workspace.v1"

/** @deprecated Kept for old localStorage payloads only — the ribbon is fixed-position. */
export type DockSide = "left" | "right" | "floating" | "collapsed"

/** Session ROI until MCP pushes authoritative ROIContract geometry. */
export interface ActiveRoi {
	id?: string
	name?: string
	source?: string
	/** Hectares when known */
	areaHa?: number
}

/** A named saved view bookmark. */
export interface MapBookmark {
	id: string
	name: string
	longitude: number
	latitude: number
	zoom: number
	pitch?: number
	bearing?: number
	createdAt: string // ISO timestamp
}

export interface MapWorkspace {
	version: 1
	basemap?: string
	viewState?: MapViewState
	visibleLayerIds?: string[]
	layerOpacities?: Record<string, number>
	clusterLayerIds?: string[]
	activeRoi?: ActiveRoi
	layerPanel?: {
		showDetails: boolean
	}
	/** User-facing display names keyed by layer id (does not change server layer name). */
	layerAliases?: Record<string, string>
	ribbonPanel?: {
		width?: number
		height?: number
	}
	/** Named saved view bookmarks. */
	bookmarks?: MapBookmark[]
}

const DEFAULT_WORKSPACE: MapWorkspace = {
	version: 1,
	layerPanel: {
		showDetails: false,
	},
}

export function loadMapWorkspace(): MapWorkspace {
	try {
		const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null
		if (!raw) {
			return DEFAULT_WORKSPACE
		}
		const parsed = JSON.parse(raw) as MapWorkspace
		if (parsed.version !== 1) {
			return DEFAULT_WORKSPACE
		}
		return { ...DEFAULT_WORKSPACE, ...parsed, layerPanel: { ...DEFAULT_WORKSPACE.layerPanel!, ...parsed.layerPanel } }
	} catch {
		return DEFAULT_WORKSPACE
	}
}

export function saveMapWorkspace(patch: Partial<Omit<MapWorkspace, "version">>): void {
	try {
		if (typeof localStorage === "undefined") {
			return
		}
		const current = loadMapWorkspace()
		const next: MapWorkspace = {
			...current,
			...patch,
			version: 1,
			layerPanel: { ...current.layerPanel!, ...(patch.layerPanel ?? {}) },
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
	} catch {
		// localStorage may be disabled or full — fail silently
	}
}
