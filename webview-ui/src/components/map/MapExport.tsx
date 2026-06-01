import type { MapViewState } from "@deck.gl/core"
import type { MapLayer } from "@shared/proto/cline/map"
import { MapExportArtifact, PrepareMapExportRequest, SaveMapExportRequest } from "@shared/proto/cline/map"
import { jsPDF } from "jspdf"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { MapServiceClient } from "../../services/grpc-client"
import { BASE_MAP_STYLES } from "./BaseMapSelector"
import { rasterCache } from "./formats/rasterCache"
import { reportMapEvent } from "./mapSessionBridge"

type ExportTemplate =
	| "manuscript"
	| "single-column"
	| "thesis"
	| "report"
	| "report-a4"
	| "report-portrait"
	| "presentation"
	| "presentation-43"
	| "poster"
	| "social-square"
	| "clean"
type ExportFormat = "png" | "pdf"
type ExportDpi = 150 | 300 | 600
type ExtentStrategy = "preserve-visible-extent" | "preserve-center-scale"
type ExportQuality = "verified" | "with-warnings" | "blocked"
/** Coordinate graticule rendering mode. */
type GraticuleMode = "none" | "grid" | "ticks"

interface MapExportProps {
	mapStyle?: "dark" | "light"
	onClose?: () => void
	layers?: MapLayer[]
	visibleLayerIds?: Set<string>
	viewState?: MapViewState
	currentBasemap?: string
}

type TextAlign = "left" | "center" | "right"

const FONT_OPTIONS: Array<{ label: string; value: string }> = [
	{ label: "System default", value: "system-ui, sans-serif" },
	{ label: "Arial / Helvetica", value: "Arial, Helvetica, sans-serif" },
	{ label: "Times New Roman", value: "'Times New Roman', Times, serif" },
	{ label: "Georgia", value: "Georgia, serif" },
	{ label: "Palatino", value: "'Palatino Linotype', Palatino, serif" },
	{ label: "Courier New", value: "'Courier New', Courier, monospace" },
]

interface MapPlateSpec {
	template: ExportTemplate
	formats: ExportFormat[]
	dpi: ExportDpi
	extentStrategy: ExtentStrategy
	graticule: GraticuleMode
	fontFamily: string
	text: {
		title: string
		subtitle: string
		caption: string
		authorProject: string
		notes: string
	}
	textAlign: {
		title: TextAlign
		subtitle: TextAlign
		caption: TextAlign
		author: TextAlign
		notes: TextAlign
		footer: TextAlign
	}
	elements: {
		legend: boolean
		scaleBar: boolean
		northArrow: boolean
		attribution: boolean
		bounds: boolean
		provenanceFooter: boolean
		colorRampLegend: boolean
		watermark: boolean
	}
}

interface ExportWarning {
	code: string
	message: string
	severity: "info" | "warning" | "blocking"
}

interface MapSceneSnapshot {
	snapshotId: string
	capturedAtUtc: string
	view: {
		longitude: number
		latitude: number
		zoom: number
		bearing: number
		pitch: number
		extentStrategy: ExtentStrategy
	}
	basemap: {
		id: string
		label: string
		attribution: string[]
		requiresVisibleAttribution: boolean
	}
	layers: Array<{
		id: string
		label: string
		kind: string
		geom: "polygon" | "line" | "point" | "raster"
		color?: string
		visible: boolean
		opacity?: number
		exportSupport: "verified" | "capture-only" | "unsupported"
		sourceRef?: string
		/** Raw layer.metadata forwarded from the proto for ramp/legend extraction. */
		metadata?: Record<string, string>
	}>
	citations: Array<{ id: string; label: string; text: string }>
	renderWarnings: ExportWarning[]
}

interface ExportReadinessReport {
	qualityStatus: ExportQuality
	supportedLayers: string[]
	captureOnlyLayers: string[]
	unsupportedLayers: string[]
	warnings: ExportWarning[]
	blockingReasons: string[]
	canQuickExport: boolean
	canResearchExport: boolean
}

interface MapExportRenderState {
	requestedPixelDimensions: { width: number; height: number }
	actualPixelDimensions: { width: number; height: number }
	renderCompleted: boolean
	basemapReady: boolean
	layerStates: Array<{ layerId: string; state: "ready" | "warning" | "failed" | "excluded"; message?: string }>
	resolutionDowngraded: boolean
	warnings: ExportWarning[]
}

interface PageSpec {
	label: string
	widthIn: number
	heightIn: number
}

type TemplateCategory = "Publication" | "Report" | "Presentation" | "Poster" | "Web" | "Minimal"
type TitleStyle = "banner" | "plain" | "none"
type LegendPlacement = "side" | "inset-tl" | "inset-tr" | "inset-bl" | "none"

interface TemplateConfig {
	label: string
	category: TemplateCategory
	description: string
	page: PageSpec
	/** Layout fractions (of page width/height) — drive all chrome positioning. */
	marginFrac: number
	titleBandFrac: number
	footerBandFrac: number
	/** Width of the dedicated side legend column (0 = no side column). */
	legendWidthFrac: number
	legendPlacement: LegendPlacement
	titleStyle: TitleStyle
	titleWeight: number
	titleSizeFrac: number
	/** Banner overlays the top of the map (true) vs. sits in its own band above it (false). */
	mapAtTop: boolean
	showCaption: boolean
	/** When true the export forces a north-up, zero-pitch view (research/print fidelity). */
	normalizeOrientation: boolean
	frame: boolean
	accent: string
}

// Single source of truth for every export template. Adding a new plate is now
// purely declarative — no branching inside composePlate().
const TEMPLATE_CONFIGS: Record<ExportTemplate, TemplateConfig> = {
	// ── Publication grade ────────────────────────────────────────────────────
	manuscript: {
		label: "Manuscript Figure — double column",
		category: "Publication",
		description: "Two-column journal figure (7.2 × 4.8 in). Inset legend top-left, long caption band.",
		page: { label: "Double-column figure", widthIn: 7.2, heightIn: 4.8 },
		marginFrac: 0.035,
		titleBandFrac: 0.055,
		footerBandFrac: 0.14,
		legendWidthFrac: 0,
		legendPlacement: "inset-tl",
		titleStyle: "plain",
		titleWeight: 600,
		titleSizeFrac: 0.012,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	"single-column": {
		label: "Manuscript Figure — single column",
		category: "Publication",
		description: "Narrow single-column journal figure (3.5 × 3.4 in). Compact, larger relative type.",
		page: { label: "Single-column figure", widthIn: 3.5, heightIn: 3.4 },
		marginFrac: 0.04,
		titleBandFrac: 0.075,
		footerBandFrac: 0.17,
		legendWidthFrac: 0,
		legendPlacement: "inset-tl",
		titleStyle: "plain",
		titleWeight: 600,
		titleSizeFrac: 0.026,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	thesis: {
		label: "Thesis Plate — full page portrait",
		category: "Publication",
		description: "Full-page portrait plate (6.5 × 9 in). Map over caption, inset legend top-left.",
		page: { label: "Full-page portrait plate", widthIn: 6.5, heightIn: 9 },
		marginFrac: 0.045,
		titleBandFrac: 0.07,
		footerBandFrac: 0.1,
		legendWidthFrac: 0,
		legendPlacement: "inset-tl",
		titleStyle: "plain",
		titleWeight: 700,
		titleSizeFrac: 0.026,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	// ── Report / production ──────────────────────────────────────────────────
	report: {
		label: "Report Plate — Letter landscape",
		category: "Report",
		description: "US Letter landscape (11 × 8.5 in). Side legend column, full provenance footer.",
		page: { label: "Letter landscape", widthIn: 11, heightIn: 8.5 },
		marginFrac: 0.045,
		titleBandFrac: 0.1,
		footerBandFrac: 0.075,
		legendWidthFrac: 0.24,
		legendPlacement: "side",
		titleStyle: "plain",
		titleWeight: 700,
		titleSizeFrac: 0.016,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	"report-a4": {
		label: "Report Plate — A4 landscape",
		category: "Report",
		description: "ISO A4 landscape (11.69 × 8.27 in). Side legend column — international standard.",
		page: { label: "A4 landscape", widthIn: 11.69, heightIn: 8.27 },
		marginFrac: 0.045,
		titleBandFrac: 0.1,
		footerBandFrac: 0.075,
		legendWidthFrac: 0.24,
		legendPlacement: "side",
		titleStyle: "plain",
		titleWeight: 700,
		titleSizeFrac: 0.016,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	"report-portrait": {
		label: "Report Plate — Letter portrait",
		category: "Report",
		description: "US Letter portrait (8.5 × 11 in). Inset legend top-left, tall map area.",
		page: { label: "Letter portrait", widthIn: 8.5, heightIn: 11 },
		marginFrac: 0.05,
		titleBandFrac: 0.085,
		footerBandFrac: 0.07,
		legendWidthFrac: 0,
		legendPlacement: "inset-tl",
		titleStyle: "plain",
		titleWeight: 700,
		titleSizeFrac: 0.02,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#111827",
	},
	// ── Presentation ─────────────────────────────────────────────────────────
	presentation: {
		label: "Presentation Slide — 16:9",
		category: "Presentation",
		description: "Widescreen 16:9 slide (13.33 × 7.5 in). Dark title banner, inset legend.",
		page: { label: "16:9 slide", widthIn: 13.333, heightIn: 7.5 },
		marginFrac: 0.022,
		titleBandFrac: 0.15,
		footerBandFrac: 0.035,
		legendWidthFrac: 0,
		legendPlacement: "inset-bl",
		titleStyle: "banner",
		titleWeight: 800,
		titleSizeFrac: 0.024,
		mapAtTop: true,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#0f172a",
	},
	"presentation-43": {
		label: "Presentation Slide — 4:3",
		category: "Presentation",
		description: "Classic 4:3 slide (10 × 7.5 in). Dark title banner, inset legend.",
		page: { label: "4:3 slide", widthIn: 10, heightIn: 7.5 },
		marginFrac: 0.025,
		titleBandFrac: 0.15,
		footerBandFrac: 0.035,
		legendWidthFrac: 0,
		legendPlacement: "inset-bl",
		titleStyle: "banner",
		titleWeight: 800,
		titleSizeFrac: 0.026,
		mapAtTop: true,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#0f172a",
	},
	// ── Poster ───────────────────────────────────────────────────────────────
	poster: {
		label: "Poster Panel — large format",
		category: "Poster",
		description: "Large-format poster panel (20 × 16 in). Banner title, wide side legend.",
		page: { label: "Poster panel", widthIn: 20, heightIn: 16 },
		marginFrac: 0.03,
		titleBandFrac: 0.11,
		footerBandFrac: 0.05,
		legendWidthFrac: 0.22,
		legendPlacement: "side",
		titleStyle: "banner",
		titleWeight: 800,
		titleSizeFrac: 0.02,
		mapAtTop: false,
		showCaption: true,
		normalizeOrientation: true,
		frame: true,
		accent: "#0f172a",
	},
	// ── Web / social ─────────────────────────────────────────────────────────
	"social-square": {
		label: "Social / Web — square",
		category: "Web",
		description: "Square 1:1 tile (8 × 8 in) for web and social. Banner title, inset legend top-left.",
		page: { label: "Square tile", widthIn: 8, heightIn: 8 },
		marginFrac: 0.035,
		titleBandFrac: 0.1,
		footerBandFrac: 0.05,
		legendWidthFrac: 0,
		legendPlacement: "inset-tl",
		titleStyle: "banner",
		titleWeight: 800,
		titleSizeFrac: 0.028,
		mapAtTop: true,
		showCaption: false,
		normalizeOrientation: false,
		frame: true,
		accent: "#0f172a",
	},
	// ── Minimal ──────────────────────────────────────────────────────────────
	clean: {
		label: "Clean Map — no chrome",
		category: "Minimal",
		description: "Bare map (10 × 7 in). No title, no legend; preserves bearing/pitch.",
		page: { label: "Clean map", widthIn: 10, heightIn: 7 },
		marginFrac: 0.02,
		titleBandFrac: 0,
		footerBandFrac: 0.035,
		legendWidthFrac: 0,
		legendPlacement: "none",
		titleStyle: "none",
		titleWeight: 400,
		titleSizeFrac: 0.012,
		mapAtTop: true,
		showCaption: false,
		normalizeOrientation: false,
		frame: true,
		accent: "#111827",
	},
}

const TEMPLATE_PAGES: Record<ExportTemplate, PageSpec> = Object.fromEntries(
	Object.entries(TEMPLATE_CONFIGS).map(([key, cfg]) => [key, cfg.page]),
) as Record<ExportTemplate, PageSpec>

const TEMPLATE_LABELS: Record<ExportTemplate, string> = Object.fromEntries(
	Object.entries(TEMPLATE_CONFIGS).map(([key, cfg]) => [key, cfg.label]),
) as Record<ExportTemplate, string>

// Templates grouped by category, preserving declaration order — drives the
// grouped <optgroup> dropdown.
const TEMPLATE_GROUPS: Array<{ category: TemplateCategory; templates: ExportTemplate[] }> = (() => {
	const order: TemplateCategory[] = ["Publication", "Report", "Presentation", "Poster", "Web", "Minimal"]
	return order.map((category) => ({
		category,
		templates: (Object.keys(TEMPLATE_CONFIGS) as ExportTemplate[]).filter(
			(key) => TEMPLATE_CONFIGS[key].category === category,
		),
	}))
})()

const MAX_EXPORT_PIXELS = 36_000_000
const WARN_EXPORT_PIXELS = 20_000_000

function exportId(): string {
	return `mapexp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => reject(new Error("Canvas encoding timed out")), 25_000)
		try {
			canvas.toBlob(
				(blob) => {
					window.clearTimeout(timeout)
					blob ? resolve(blob) : reject(new Error("Canvas export returned an empty blob"))
				},
				type,
				quality,
			)
		} catch (error) {
			window.clearTimeout(timeout)
			reject(error instanceof Error ? error : new Error(String(error)))
		}
	})
}

async function blobToBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer())
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ""
	const chunkSize = 0x8000
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
	}
	return btoa(binary)
}

function pagePixels(template: ExportTemplate, dpi: ExportDpi): { width: number; height: number; page: PageSpec; pixels: number } {
	const page = TEMPLATE_PAGES[template]
	const width = Math.round(page.widthIn * dpi)
	const height = Math.round(page.heightIn * dpi)
	return { width, height, page, pixels: width * height }
}

function layerKind(layer: MapLayer): string {
	const type = (layer.layerType || "").toLowerCase()
	const source = String(layer.metadata?.source || "").toLowerCase()
	if (type.includes("gee") || source.includes("gee")) {
		return "gee"
	}
	if (type.includes("raster")) {
		return "raster"
	}
	if (source.includes("merit") || layer.name.toLowerCase().includes("merit")) {
		return "hydrography"
	}
	return type || "vector"
}

/** Infer the geometry class of a layer for legend swatch rendering. */
function layerGeom(layer: MapLayer): "polygon" | "line" | "point" | "raster" {
	const kind = layerKind(layer)
	if (kind === "raster" || kind === "gee") {
		return "raster"
	}
	const name = layer.name.toLowerCase()
	const type = (layer.layerType || "").toLowerCase()
	// Area features win first — basin/watershed names also contain "pour point" etc.
	if (
		name.includes("watershed") ||
		name.includes("basin") ||
		name.includes("catchment") ||
		name.includes("subbasin") ||
		name.includes("boundary") ||
		name.includes("polygon") ||
		type.includes("polygon") ||
		type.includes("fill")
	) {
		return "polygon"
	}
	if (
		name.includes("river") ||
		name.includes("stream") ||
		name.includes("flowline") ||
		name.includes("reach") ||
		name.includes("network") ||
		kind === "hydrography" ||
		type.includes("line") ||
		type.includes("path")
	) {
		return "line"
	}
	if (
		name.includes("gauge") ||
		name.includes("station") ||
		name.includes("outlet") ||
		name.includes("pour point") ||
		type.includes("point") ||
		type.includes("circle") ||
		type.includes("marker")
	) {
		return "point"
	}
	return "polygon"
}

/** Pull the real styled colour off a layer so the legend matches the rendered map. */
function layerColor(layer: MapLayer): string | undefined {
	const style = layer.style
	if (!style) {
		return undefined
	}
	return style.fillColor || style.color || style.strokeColor || undefined
}

function layerSupport(layer: MapLayer): "verified" | "capture-only" | "unsupported" {
	const kind = layerKind(layer)
	if (kind === "gee" || kind === "raster") {
		return "capture-only"
	}
	if (
		layer.geojson ||
		kind === "hydrography" ||
		kind === "vector" ||
		kind === "polygon" ||
		kind === "line" ||
		kind === "point"
	) {
		return "verified"
	}
	return "capture-only"
}

function visibleLayers(layers: MapLayer[], visibleLayerIds?: Set<string>): MapLayer[] {
	return layers.filter((layer) => layer.visible !== false && (!visibleLayerIds || visibleLayerIds.has(layer.id)))
}

function buildSnapshot(spec: MapPlateSpec, props: MapExportProps): MapSceneSnapshot {
	const basemap = BASE_MAP_STYLES.find((style) => style.id === props.currentBasemap) ?? BASE_MAP_STYLES[0]
	const visible = visibleLayers(props.layers ?? [], props.visibleLayerIds)
	const citations = [
		{
			id: "ai-hydro-map",
			label: "AI-Hydro",
			text: "AI-Hydro Map Plate Composer; generated with visible map layers and saved provenance sidecar.",
		},
	]
	if (
		visible.some(
			(layer) =>
				layer.name.toLowerCase().includes("merit") ||
				String(layer.metadata?.source || "")
					.toLowerCase()
					.includes("merit"),
		)
	) {
		citations.push({
			id: "merit",
			label: "MERIT Hydro / MERIT-Basins",
			text: "MERIT Hydro and MERIT-Basins derived layers require source citation and license compliance.",
		})
	}
	return {
		snapshotId: exportId(),
		capturedAtUtc: new Date().toISOString(),
		view: {
			longitude: Number(props.viewState?.longitude ?? 0),
			latitude: Number(props.viewState?.latitude ?? 0),
			zoom: Number(props.viewState?.zoom ?? 0),
			bearing: Number(props.viewState?.bearing ?? 0),
			pitch: Number(props.viewState?.pitch ?? 0),
			extentStrategy: spec.extentStrategy,
		},
		basemap: {
			id: basemap?.id ?? "unknown",
			label: basemap?.name ?? "Unknown basemap",
			attribution: basemap?.attribution ? [basemap.attribution] : [],
			requiresVisibleAttribution: Boolean(basemap?.attribution),
		},
		layers: visible.map((layer) => ({
			id: layer.id,
			label: layer.name || layer.id,
			kind: layerKind(layer),
			geom: layerGeom(layer),
			color: layerColor(layer),
			visible: true,
			opacity: layer.style?.opacity ?? layer.style?.fillOpacity,
			exportSupport: layerSupport(layer),
			sourceRef: typeof layer.metadata?.source === "string" ? layer.metadata.source : undefined,
		})),
		citations,
		renderWarnings: [],
	}
}

function evaluateReadiness(
	spec: MapPlateSpec,
	snapshot: MapSceneSnapshot,
	canvas: HTMLCanvasElement | null,
): ExportReadinessReport {
	const warnings: ExportWarning[] = []
	const blockingReasons: string[] = []
	const supportedLayers = snapshot.layers.filter((layer) => layer.exportSupport === "verified").map((layer) => layer.id)
	const captureOnlyLayers = snapshot.layers.filter((layer) => layer.exportSupport === "capture-only").map((layer) => layer.id)
	const unsupportedLayers = snapshot.layers.filter((layer) => layer.exportSupport === "unsupported").map((layer) => layer.id)
	const dims = pagePixels(spec.template, spec.dpi)

	if (!canvas) {
		blockingReasons.push("No readable map canvas is available.")
	}
	if (dims.pixels > MAX_EXPORT_PIXELS) {
		blockingReasons.push(`Requested export is ${Math.round(dims.pixels / 1_000_000)} MP, above the V1 guardrail.`)
	}
	if (dims.pixels > WARN_EXPORT_PIXELS) {
		warnings.push({
			code: "HIGH_PIXEL_COUNT",
			message: "Large exports can use substantial temporary memory.",
			severity: "warning",
		})
	}
	if (captureOnlyLayers.length) {
		warnings.push({
			code: "CAPTURE_ONLY_LAYERS",
			message: "Some raster/GEE layers are captured from the rendered scene and cannot yet be tile-completeness verified.",
			severity: "warning",
		})
	}
	if (unsupportedLayers.length) {
		blockingReasons.push("One or more visible layers are unsupported for research export.")
	}
	if (snapshot.basemap.requiresVisibleAttribution && !spec.elements.attribution) {
		blockingReasons.push("Mandatory basemap attribution cannot be disabled.")
	}
	if (
		(Math.abs(snapshot.view.bearing) > 0.1 || Math.abs(snapshot.view.pitch) > 0.1) &&
		TEMPLATE_CONFIGS[spec.template].normalizeOrientation
	) {
		blockingReasons.push("Research plate export requires north-up, zero-pitch map view in V1.")
	}
	if (canvas && dims.width > canvas.width * 1.25) {
		warnings.push({
			code: "MAP_FRAME_CAPTURE_FROM_SCREEN_RESOLUTION",
			message: "The exported plate is larger than the current rendered map canvas; V1 records this as capture-limited.",
			severity: "warning",
		})
	}

	return {
		qualityStatus: blockingReasons.length ? "blocked" : warnings.length ? "with-warnings" : "verified",
		supportedLayers,
		captureOnlyLayers,
		unsupportedLayers,
		warnings,
		blockingReasons,
		canQuickExport: Boolean(canvas),
		canResearchExport: blockingReasons.length === 0,
	}
}

function niceScaleKm(rawKm: number): number {
	const powers = [1, 2, 5]
	const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawKm, 0.001)))
	for (const p of powers) {
		if (p * magnitude >= rawKm) {
			return p * magnitude
		}
	}
	return 10 * magnitude
}

function drawText(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	maxWidth: number,
	lineHeight: number,
	align: TextAlign = "left",
): number {
	const words = text.split(/\s+/).filter(Boolean)
	let line = ""
	let cursorY = y
	const anchorX = align === "center" ? x + maxWidth / 2 : align === "right" ? x + maxWidth : x
	ctx.save()
	ctx.textAlign = align === "center" ? "center" : align === "right" ? "right" : "left"
	for (const word of words) {
		const next = line ? `${line} ${word}` : word
		if (ctx.measureText(next).width > maxWidth && line) {
			ctx.fillText(line, anchorX, cursorY)
			cursorY += lineHeight
			line = word
		} else {
			line = next
		}
	}
	if (line) {
		ctx.fillText(line, anchorX, cursorY)
		cursorY += lineHeight
	}
	ctx.restore()
	return cursorY
}

/** Truncate text to fit within maxPx pixels, appending "…" if needed. */
function truncateLabel(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
	if (ctx.measureText(text).width <= maxPx) {
		return text
	}
	let lo = 0
	let hi = text.length
	while (lo < hi - 1) {
		const mid = Math.floor((lo + hi) / 2)
		ctx.measureText(text.slice(0, mid) + "…").width <= maxPx ? (lo = mid) : (hi = mid)
	}
	return text.slice(0, lo) + "…"
}

/** Derive a semantically appropriate legend swatch colour from layer metadata (fallback only). */
function legendSwatchColor(layer: { label: string; kind: string }): string {
	const lbl = layer.label.toLowerCase()
	const knd = layer.kind.toLowerCase()
	if (lbl.includes("river") || lbl.includes("stream") || lbl.includes("flow")) {
		return "#0ea5e9"
	}
	if (lbl.includes("watershed") || lbl.includes("catchment") || lbl.includes("basin") || lbl.includes("boundary")) {
		return "#0d9488"
	}
	if (lbl.includes("ndwi") || lbl.includes("ndvi") || lbl.includes("ndbi") || lbl.includes("nbr")) {
		return "#16a34a"
	}
	if (lbl.includes("dem") || lbl.includes("elevation") || lbl.includes("terrain")) {
		return "#b45309"
	}
	if (lbl.includes("flood")) {
		return "#2563eb"
	}
	if (lbl.includes("urban") || lbl.includes("built") || lbl.includes("impervious")) {
		return "#6b21a8"
	}
	if (knd === "raster" || knd === "gee") {
		return "#7c3aed"
	}
	if (knd === "hydrography") {
		return "#0ea5e9"
	}
	return "#64748b" // neutral slate for unrecognised layers
}

/** Trace a rounded-rect path (with a manual fallback for runtimes lacking roundRect). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath()
	if (typeof ctx.roundRect === "function") {
		ctx.roundRect(x, y, w, h, r)
		return
	}
	ctx.moveTo(x + r, y)
	ctx.lineTo(x + w - r, y)
	ctx.quadraticCurveTo(x + w, y, x + w, y + r)
	ctx.lineTo(x + w, y + h - r)
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
	ctx.lineTo(x + r, y + h)
	ctx.quadraticCurveTo(x, y + h, x, y + h - r)
	ctx.lineTo(x, y + r)
	ctx.quadraticCurveTo(x, y, x + r, y)
	ctx.closePath()
}

/**
 * Draw `img` into the destination rect preserving the source aspect ratio
 * (object-fit: cover, centre-cropped). This is the single most important fix
 * for plate fidelity — the map is never horizontally/vertically stretched to
 * match a template's frame shape; instead it is scaled uniformly and cropped.
 */
function drawImageCover(
	ctx: CanvasRenderingContext2D,
	img: HTMLCanvasElement,
	dx: number,
	dy: number,
	dw: number,
	dh: number,
): void {
	const sw = img.width
	const sh = img.height
	if (!sw || !sh || dw <= 0 || dh <= 0) {
		return
	}
	const scale = Math.max(dw / sw, dh / sh)
	const cw = dw / scale
	const ch = dh / scale
	const sx = (sw - cw) / 2
	const sy = (sh - ch) / 2
	ctx.save()
	ctx.beginPath()
	ctx.rect(dx, dy, dw, dh)
	ctx.clip()
	ctx.drawImage(img, sx, sy, cw, ch, dx, dy, dw, dh)
	ctx.restore()
}

type LegendAnchor = "tl" | "tr" | "bl" | "br"

/**
 * Draw an auto-sized legend card anchored at one corner of (ax, ay). Every
 * dimension scales from `fs` (base font px) so the card looks identical across
 * DPIs and template sizes, and the box is sized to its content so labels never
 * overflow. Swatches use the layer's *real* styled colour and geometry class.
 */
/** Infer a color ramp for a raster/GEE layer. Returns null if no ramp can be determined. */
/** Strip common file extensions and underscores to get a clean display label. */
function _cleanLabel(raw: string): string {
	return raw
		.replace(/\.(geojson|json|tif|tiff|nc|csv|shp)$/i, "")
		.replace(/[_-]+/g, " ")
		.trim()
}

/** Colour stops keyed by the colormap name used in layer.metadata.raster_colormap */
const COLORMAP_STOPS: Record<string, string[]> = {
	viridis: ["#440154", "#31688e", "#35b779", "#fde725"],
	viridis_r: ["#fde725", "#35b779", "#31688e", "#440154"],
	plasma: ["#0d0887", "#cc4778", "#f0f921"],
	magma: ["#000004", "#b73779", "#fcfdbf"],
	cividis: ["#00224e", "#7c7b78", "#fde737"],
	YlOrRd: ["#ffffb2", "#fecc5c", "#fd8d3c", "#e31a1c"],
	Blues: ["#f7fbff", "#6baed6", "#2171b5", "#084594"],
	RdYlGn: ["#d73027", "#fee08b", "#1a9850"],
	chirps: ["#081d58", "#225ea8", "#41b6c4", "#a1dab4", "#ffffcc"],
	inferno: ["#000004", "#bc3754", "#f98e09", "#fcffa4"],
	coolwarm: ["#3b4cc0", "#dddddd", "#b40426"],
	BrBG: ["#543005", "#f5f5f5", "#003c30"],
	PiYG: ["#8e0152", "#f7f7f7", "#276419"],
	spectral: ["#9e0142", "#fee08b", "#3288bd"],
	jet: ["#00007f", "#0000ff", "#00ffff", "#ffff00", "#ff0000", "#7f0000"],
	gray: ["#000000", "#ffffff"],
	gray_r: ["#ffffff", "#000000"],
	terrain: ["#3d6b35", "#8fbc6b", "#f5deb3", "#c8a46e", "#ffffff"],
	RdBu: ["#67001f", "#f7f7f7", "#053061"],
}

function inferColorRamp(layer: MapSceneSnapshot["layers"][number]): {
	stops: string[]
	label: string
	min?: number
	max?: number
	units?: string
} | null {
	const meta = layer.metadata ?? {}
	const lbl = layer.label.toLowerCase()
	// Use the layer name exactly as the user named it in the map panel
	const displayLabel = layer.label

	// ── 0. rasterCache (module singleton) — highest fidelity ─────────────────
	//    This is exactly what the live map legend reads, so the plate always
	//    matches what the user sees on screen.
	const cached = rasterCache.get(layer.id)
	if (cached) {
		const colormapKey = cached.colormap ?? meta.raster_colormap ?? "viridis"
		const stops = COLORMAP_STOPS[colormapKey] ?? COLORMAP_STOPS.viridis
		const minV = cached.rawPixels?.min
		const maxV = cached.rawPixels?.max
		// Fall back to metadata.min/max if rawPixels not available (pre-rendered PNGs from Python)
		const metaMin = meta.min ? parseFloat(meta.min) : undefined
		const metaMax = meta.max ? parseFloat(meta.max) : undefined
		const units = meta.units
		return {
			stops,
			label: units ? `${displayLabel} (${units})` : displayLabel,
			min: minV ?? (Number.isFinite(metaMin) ? metaMin : undefined),
			max: maxV ?? (Number.isFinite(metaMax) ? metaMax : undefined),
			units,
		}
	}

	// ── 1. Try metadata.legend (JSON LegendSpec) ─────────────────────────────
	if (meta.legend) {
		try {
			const spec = JSON.parse(meta.legend) as {
				type?: string
				min?: number
				max?: number
				units?: string
				colormap?: string
				stops?: Array<[number, string]>
			}
			if (spec.type === "continuous") {
				const colormapStops = spec.colormap ? COLORMAP_STOPS[spec.colormap] : undefined
				const gradStops = spec.stops?.map(([, c]) => c) ?? colormapStops ?? ["#f7f7f7", "#7c3aed", "#4c1d95"]
				return {
					stops: gradStops,
					label: spec.units ? `${displayLabel} (${spec.units})` : displayLabel,
					min: spec.min,
					max: spec.max,
					units: spec.units,
				}
			}
		} catch {
			/* fall through */
		}
	}

	// ── 2. metadata.raster_colormap + metadata.min/max ───────────────────────
	if (meta.raster_colormap || meta.min || meta.max) {
		const colormapKey = meta.raster_colormap ?? ""
		const stops = COLORMAP_STOPS[colormapKey] ?? ["#f7f7f7", "#7c3aed", "#4c1d95"]
		const minV = meta.min ? parseFloat(meta.min) : undefined
		const maxV = meta.max ? parseFloat(meta.max) : undefined
		const units = meta.units
		return {
			stops,
			label: units ? `${displayLabel} (${units})` : displayLabel,
			min: Number.isFinite(minV) ? minV : undefined,
			max: Number.isFinite(maxV) ? maxV : undefined,
			units,
		}
	}

	// ── 3. Name-based palette heuristics ───────────────────────────────────
	if (lbl.includes("ndvi")) {
		return {
			stops: ["#a50026", "#d73027", "#f46d43", "#fdae61", "#fee08b", "#a6d96a", "#1a9850"],
			label: displayLabel,
			min: -1,
			max: 1,
		}
	}
	if (lbl.includes("ndwi") || (lbl.includes("water") && !lbl.includes("watershed"))) {
		return { stops: ["#fff7fb", "#ece7f2", "#9ecae1", "#4292c6", "#08519c", "#08306b"], label: displayLabel, min: -1, max: 1 }
	}
	if (lbl.includes("ndbi") || lbl.includes("built") || lbl.includes("urban")) {
		return { stops: ["#f7fbff", "#c6dbef", "#9ecae1", "#6baed6", "#2171b5", "#08306b"], label: displayLabel }
	}
	if (lbl.includes("nbr") || lbl.includes("burn")) {
		return { stops: ["#1a9850", "#fee08b", "#a50026"], label: displayLabel, min: -1, max: 1 }
	}
	if (lbl.includes("dem") || lbl.includes("elevation") || lbl.includes("terrain") || lbl.includes("srtm")) {
		return { stops: ["#3d6b35", "#8fbc6b", "#f5deb3", "#c8a46e", "#9b6e3d", "#ffffff"], label: displayLabel }
	}
	if (lbl.includes("flood") || lbl.includes("inundation")) {
		return { stops: ["#ffffff", "#c6e2ff", "#4292c6", "#08306b"], label: displayLabel }
	}
	if (lbl.includes("twi") || lbl.includes("wetness")) {
		return { stops: ["#d73027", "#fee090", "#4575b4"], label: displayLabel }
	}
	if (lbl.includes("slope")) {
		return { stops: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"], label: displayLabel }
	}
	if (lbl.includes("rainfall") || lbl.includes("precip") || lbl.includes("chirps")) {
		return { stops: ["#ffffff", "#c6e9f7", "#41b6c4", "#1d91c0", "#225ea8", "#0c2c84"], label: displayLabel }
	}
	if (lbl.includes("temperature") || lbl.includes("lst") || lbl.includes("heat")) {
		return { stops: ["#313695", "#74add1", "#fee090", "#f46d43", "#a50026"], label: displayLabel }
	}
	// Generic raster — purple ramp
	if (layer.kind === "raster" || layer.kind === "gee") {
		return { stops: ["#f7f7f7", "#d9d9d9", "#bababa", "#7c3aed", "#4c1d95"], label: displayLabel }
	}
	return null
}

/**
 * Draw a horizontal graduated color ramp card anchored at the bottom-right of
 * the map frame. Each raster layer with a detectable palette gets one card,
 * stacked upward. Returns the topmost Y used.
 */
function drawColorRampLegend(
	ctx: CanvasRenderingContext2D,
	snapshot: MapSceneSnapshot,
	mapX: number,
	mapY: number,
	mapW: number,
	mapH: number,
	fs: number,
	fontFamily: string,
): number {
	const rasterLayers = snapshot.layers.filter((l) => l.geom === "raster").slice(0, 4)
	if (!rasterLayers.length) {
		return mapY + mapH
	}

	const ramps = rasterLayers.map((l) => ({ layer: l, ramp: inferColorRamp(l) })).filter((r) => r.ramp !== null)
	if (!ramps.length) {
		return mapY + mapH
	}

	const barW = Math.min(Math.round(mapW * 0.28), 200)
	const barH = Math.max(10, Math.round(fs * 0.9))
	const pad = Math.round(fs * 0.7)
	const labelH = Math.round(fs * 1.25)
	const cardH = pad + labelH + barH + labelH + pad
	const cardW = barW + pad * 2
	const inset = Math.round(fs * 1.1)

	let bottomY = mapY + mapH - inset

	for (const { layer, ramp } of ramps.reverse()) {
		if (!ramp) {
			continue
		}

		// Auto-read min/max from metadata (set by Python when raster is loaded)
		const minLabel = ramp.min != null ? fmtRampValue(ramp.min) : "Min"
		const maxLabel = ramp.max != null ? fmtRampValue(ramp.max) : "Max"

		const cardX = mapX + mapW - inset - cardW
		const cardY = bottomY - cardH
		// Card background
		ctx.save()
		ctx.shadowColor = "rgba(0,0,0,0.18)"
		ctx.shadowBlur = Math.round(fs * 0.55)
		ctx.shadowOffsetY = 2
		ctx.fillStyle = "rgba(255,255,255,0.97)"
		roundRectPath(ctx, cardX, cardY, cardW, cardH, Math.round(fs * 0.4))
		ctx.fill()
		ctx.shadowColor = "transparent"
		ctx.shadowBlur = 0
		ctx.shadowOffsetY = 0
		ctx.strokeStyle = "rgba(30,41,59,0.18)"
		ctx.lineWidth = Math.max(1, Math.round(fs * 0.06))
		roundRectPath(ctx, cardX, cardY, cardW, cardH, Math.round(fs * 0.4))
		ctx.stroke()

		// Layer name label (cleaned & truncated)
		const nameLabelFont = `600 ${Math.max(8, Math.round(fs * 0.82))}px ${fontFamily}`
		ctx.font = nameLabelFont
		ctx.fillStyle = "#0f172a"
		ctx.textBaseline = "alphabetic"
		ctx.textAlign = "left"
		const truncName = truncateLabel(ctx, ramp.label, barW)
		ctx.fillText(truncName, cardX + pad, cardY + pad + Math.round(fs * 0.85))

		// Gradient bar
		const barX = cardX + pad
		const barY = cardY + pad + labelH
		const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0)
		const stops = ramp.stops
		stops.forEach((color, i) => grad.addColorStop(i / (stops.length - 1), color))
		ctx.fillStyle = grad
		const barRadius = Math.round(barH * 0.3)
		roundRectPath(ctx, barX, barY, barW, barH, barRadius)
		ctx.fill()
		// Bar border
		ctx.strokeStyle = "rgba(30,41,59,0.15)"
		ctx.lineWidth = 1
		roundRectPath(ctx, barX, barY, barW, barH, barRadius)
		ctx.stroke()

		// Min / Max value labels — auto-populated from layer metadata
		const minMaxFont = `500 ${Math.max(7, Math.round(fs * 0.75))}px ${fontFamily}`
		ctx.font = minMaxFont
		const minMaxY = barY + barH + Math.round(fs * 0.88)
		ctx.fillStyle = "#1e293b"
		ctx.textAlign = "left"
		ctx.fillText(minLabel, barX, minMaxY)
		ctx.textAlign = "right"
		ctx.fillText(maxLabel, barX + barW, minMaxY)
		ctx.textAlign = "left"

		ctx.restore()
		bottomY = cardY - Math.round(fs * 0.5)
	}
	return bottomY
}

/** Format a ramp value compactly: integers as integers, floats to 3 sig figs. */
function fmtRampValue(v: number): string {
	if (!Number.isFinite(v)) {
		return ""
	}
	if (Number.isInteger(v) || Math.abs(v) >= 1000) {
		return v.toFixed(0)
	}
	if (Math.abs(v) >= 10) {
		return v.toFixed(2)
	}
	if (Math.abs(v) >= 1) {
		return v.toFixed(3)
	}
	return v.toPrecision(3)
}

/**
 * Draw a clean white frosted-glass AI-Hydro attribution badge on the map frame.
 * Styled like professional map attribution (Mapbox / Esri style) — light, subtle,
 * sits at the bottom-left above the scale bar.
 */
function drawWatermark(
	ctx: CanvasRenderingContext2D,
	mapX: number,
	mapY: number,
	mapH: number,
	fs: number,
	fontFamily: string,
): void {
	const text = "AI-Hydro"
	const mainFs = Math.max(8, Math.round(fs * 0.85))
	const pad = Math.round(fs * 0.55)
	const inset = Math.round(fs * 1.1)

	ctx.save()

	// ── Measure: icon + text ─────────────────────────────────────────────────
	const iconSize = Math.round(mainFs * 1.35)
	const iconGap = Math.round(pad * 0.7)
	ctx.font = `700 ${mainFs}px ${fontFamily}`
	const textW = ctx.measureText(text).width
	const badgeH = Math.round(iconSize + pad)
	const badgeW = Math.round(pad * 0.8 + iconSize + iconGap + textW + pad * 0.8)
	const cornerR = Math.round(badgeH * 0.35)

	// Position: bottom-left of map frame, above scale bar
	const bx = mapX + inset
	const by = mapY + mapH - inset - badgeH - Math.round(fs * 2.2)

	// ── White frosted-glass pill ──────────────────────────────────────────────
	ctx.shadowColor = "rgba(0,0,0,0.14)"
	ctx.shadowBlur = Math.round(fs * 0.7)
	ctx.shadowOffsetY = Math.round(fs * 0.15)
	ctx.fillStyle = "rgba(255,255,255,0.93)"
	roundRectPath(ctx, bx, by, badgeW, badgeH, cornerR)
	ctx.fill()
	ctx.shadowColor = "transparent"
	ctx.shadowBlur = 0
	ctx.shadowOffsetY = 0
	ctx.strokeStyle = "rgba(30,41,59,0.12)"
	ctx.lineWidth = Math.max(1, Math.round(fs * 0.05))
	roundRectPath(ctx, bx, by, badgeW, badgeH, cornerR)
	ctx.stroke()

	// ── Icon (water-droplet face from icon.svg) ───────────────────────────────
	const ix = bx + Math.round(pad * 0.8)
	const iy = by + (badgeH - iconSize) / 2
	const sc = iconSize / 100

	ctx.save()
	ctx.translate(ix, iy)
	ctx.scale(sc, sc)

	const g = ctx.createLinearGradient(50, 10, 50, 90)
	g.addColorStop(0, "#00A3FF")
	g.addColorStop(1, "#00DDFF")

	// Droplet body
	ctx.beginPath()
	ctx.moveTo(50, 10)
	ctx.bezierCurveTo(50, 10, 25, 35, 25, 55)
	ctx.bezierCurveTo(25, 70, 35, 85, 50, 85)
	ctx.bezierCurveTo(65, 85, 75, 70, 75, 55)
	ctx.bezierCurveTo(75, 35, 50, 10, 50, 10)
	ctx.closePath()
	ctx.fillStyle = g
	ctx.fill()

	// Wing ellipses
	ctx.fillStyle = g
	ctx.beginPath()
	ctx.ellipse(20, 52, 5, 7, 0, 0, Math.PI * 2)
	ctx.fill()
	ctx.beginPath()
	ctx.ellipse(80, 52, 5, 7, 0, 0, Math.PI * 2)
	ctx.fill()
	ctx.beginPath()
	ctx.arc(50, 14, 4, 0, Math.PI * 2)
	ctx.fill()

	// Eyes
	ctx.fillStyle = "#1a1a2e"
	ctx.beginPath()
	ctx.ellipse(40, 48, 6, 9, 0, 0, Math.PI * 2)
	ctx.fill()
	ctx.beginPath()
	ctx.ellipse(60, 48, 6, 9, 0, 0, Math.PI * 2)
	ctx.fill()

	// Smile
	ctx.beginPath()
	ctx.moveTo(38, 62)
	ctx.quadraticCurveTo(50, 68, 62, 62)
	ctx.strokeStyle = "#1a1a2e"
	ctx.lineWidth = 3
	ctx.lineCap = "round"
	ctx.stroke()

	ctx.restore() // end icon transform

	// ── "AI-Hydro" text ───────────────────────────────────────────────────────
	const tx = ix + iconSize + iconGap
	const ty = by + badgeH / 2
	ctx.font = `700 ${mainFs}px ${fontFamily}`
	ctx.fillStyle = "#0f172a" // dark slate — readable on white pill
	ctx.textBaseline = "middle"
	ctx.textAlign = "left"
	ctx.fillText(text, tx, ty)

	ctx.restore()
}

function drawLegend(
	ctx: CanvasRenderingContext2D,
	snapshot: MapSceneSnapshot,
	ax: number,
	ay: number,
	maxWidth: number,
	fs: number,
	anchor: LegendAnchor = "tl",
	fontFamily = "system-ui, sans-serif",
): number {
	const layers = snapshot.layers.slice(0, 8)
	if (!layers.length) {
		return ay
	}

	const pad = Math.round(fs * 0.85)
	const gap = Math.round(fs * 0.6)
	const lineH = Math.round(fs * 1.7)
	const swatchW = Math.round(fs * 1.5)
	const swatchH = Math.round(fs * 1.0)
	const headFs = Math.max(11, Math.round(fs * 1.08))
	const headFont = `700 ${headFs}px ${fontFamily}`
	const labelFont = `${fs}px ${fontFamily}`

	// ── Measure pass: truncate labels and size the card to its content. ──
	const labelMaxPx = Math.max(fs * 4, maxWidth - pad * 2 - swatchW - gap)
	ctx.font = labelFont
	const items = layers.map((layer) => {
		const text = truncateLabel(ctx, layer.label, labelMaxPx)
		return { layer, text, w: ctx.measureText(text).width }
	})
	ctx.font = headFont
	const headW = ctx.measureText("Legend").width
	const widestRow = items.reduce((m, it) => Math.max(m, swatchW + gap + it.w), 0)
	const contentW = Math.max(headW, widestRow)
	const boxW = Math.min(maxWidth, Math.ceil(contentW + pad * 2))
	const headH = Math.round(headFs * 1.7)
	const boxH = headH + items.length * lineH + pad

	// Resolve top-left origin from the requested anchor corner.
	const x = anchor === "tr" || anchor === "br" ? ax - boxW : ax
	const y = anchor === "bl" || anchor === "br" ? ay - boxH : ay

	ctx.save()
	// Card background with soft shadow.
	ctx.shadowColor = "rgba(0,0,0,0.20)"
	ctx.shadowBlur = Math.round(fs * 0.6)
	ctx.shadowOffsetX = 1
	ctx.shadowOffsetY = 2
	ctx.fillStyle = "rgba(255,255,255,0.96)"
	roundRectPath(ctx, x, y, boxW, boxH, Math.round(fs * 0.45))
	ctx.fill()
	// Border (shadow off so it stays crisp).
	ctx.shadowColor = "transparent"
	ctx.shadowBlur = 0
	ctx.shadowOffsetX = 0
	ctx.shadowOffsetY = 0
	ctx.strokeStyle = "rgba(30,41,59,0.22)"
	ctx.lineWidth = Math.max(1, Math.round(fs * 0.07))
	roundRectPath(ctx, x, y, boxW, boxH, Math.round(fs * 0.45))
	ctx.stroke()

	// Heading.
	ctx.fillStyle = "#0f172a"
	ctx.font = headFont
	ctx.textBaseline = "alphabetic"
	ctx.fillText("Legend", x + pad, y + headFs + Math.round(pad * 0.4))

	// Rows.
	ctx.font = labelFont
	let rowTop = y + headH
	for (const { layer, text } of items) {
		const swX = x + pad
		const swY = rowTop + Math.round((lineH - swatchH) / 2)
		const midY = swY + swatchH / 2
		const color = layer.color || legendSwatchColor(layer)

		if (layer.geom === "line") {
			ctx.strokeStyle = color
			ctx.lineWidth = Math.max(2, Math.round(fs * 0.22))
			ctx.beginPath()
			ctx.moveTo(swX, midY)
			ctx.lineTo(swX + swatchW, midY)
			ctx.stroke()
		} else if (layer.geom === "point") {
			ctx.fillStyle = color
			ctx.beginPath()
			ctx.arc(swX + swatchW / 2, midY, swatchH / 2, 0, Math.PI * 2)
			ctx.fill()
			ctx.strokeStyle = "#ffffff"
			ctx.lineWidth = Math.max(1, Math.round(fs * 0.1))
			ctx.stroke()
		} else if (layer.geom === "raster") {
			ctx.globalAlpha = 0.85
			ctx.fillStyle = color
			ctx.fillRect(swX, swY, swatchW, swatchH)
			ctx.globalAlpha = 1
		} else {
			// Polygon — translucent fill + solid outline (matches map rendering).
			ctx.globalAlpha = 0.3
			ctx.fillStyle = color
			ctx.fillRect(swX, swY, swatchW, swatchH)
			ctx.globalAlpha = 1
			ctx.strokeStyle = color
			ctx.lineWidth = Math.max(1, Math.round(fs * 0.13))
			ctx.strokeRect(swX, swY, swatchW, swatchH)
		}

		ctx.fillStyle = "#1e293b"
		ctx.fillText(text, swX + swatchW + gap, rowTop + Math.round(lineH * 0.5) + Math.round(fs * 0.34))
		rowTop += lineH
	}

	ctx.restore()
	return y + boxH
}

function drawScaleBar(
	ctx: CanvasRenderingContext2D,
	view: MapSceneSnapshot["view"],
	x: number,
	y: number,
	mapFrameWidthPx: number,
	fs: number,
	fontFamily = "system-ui, sans-serif",
): void {
	const kmPerScreenPx = (156543.03392 * Math.cos((view.latitude * Math.PI) / 180)) / 1000 / 2 ** view.zoom
	const targetPx = mapFrameWidthPx * 0.24
	const km = niceScaleKm(targetPx * kmPerScreenPx)
	const px = Math.max(fs * 3, km / kmPerScreenPx)
	const label = `${km >= 1 ? km.toLocaleString(undefined, { maximumFractionDigits: 0 }) : km.toFixed(1)} km`
	const tick = Math.round(fs * 0.5)
	ctx.save()
	ctx.font = `600 ${Math.round(fs * 0.92)}px ${fontFamily}`
	const labelW = ctx.measureText(label).width
	// Legibility backing pill.
	ctx.fillStyle = "rgba(255,255,255,0.82)"
	roundRectPath(ctx, x - fs * 0.5, y - tick - fs * 0.45, px + labelW + fs * 1.6, tick * 2 + fs * 0.9, Math.round(fs * 0.3))
	ctx.fill()
	// Bar + end ticks.
	ctx.strokeStyle = "#1f2933"
	ctx.fillStyle = "#1f2933"
	ctx.lineWidth = Math.max(2, Math.round(fs * 0.18))
	ctx.beginPath()
	ctx.moveTo(x, y)
	ctx.lineTo(x + px, y)
	ctx.moveTo(x, y - tick)
	ctx.lineTo(x, y + tick)
	ctx.moveTo(x + px, y - tick)
	ctx.lineTo(x + px, y + tick)
	ctx.stroke()
	ctx.fillText(label, x + px + Math.round(fs * 0.6), y + Math.round(fs * 0.34))
	ctx.restore()
}

// ── Web-Mercator projection helpers (512-px tile convention, matches deck.gl) ──
const MERCATOR_TILE = 512

function lonToWorldX(lon: number, worldSize: number): number {
	return ((lon + 180) / 360) * worldSize
}
function latToWorldY(lat: number, worldSize: number): number {
	const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
	const s = Math.sin((clamped * Math.PI) / 180)
	return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize
}
function worldXToLon(x: number, worldSize: number): number {
	return (x / worldSize) * 360 - 180
}
function worldYToLat(y: number, worldSize: number): number {
	const n = Math.PI - (2 * Math.PI * y) / worldSize
	return (180 / Math.PI) * Math.atan(Math.sinh(n))
}

/** Pick a clean graticule interval (degrees) giving ~targetLines divisions. */
function niceDegreeStep(spanDeg: number, targetLines: number): number {
	const raw = spanDeg / Math.max(1, targetLines)
	const steps = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30, 45]
	for (const s of steps) {
		if (s >= raw) {
			return s
		}
	}
	return 60
}

function decimalsForStep(step: number): number {
	if (step < 0.02) {
		return 3
	}
	if (step < 0.2) {
		return 2
	}
	if (step < 2) {
		return 1
	}
	return 0
}

function formatCoord(value: number, isLat: boolean, decimals: number): string {
	const hemisphere = isLat ? (value >= 0 ? "N" : "S") : value >= 0 ? "E" : "W"
	return `${Math.abs(value).toFixed(decimals)}°${hemisphere}`
}

/** Draw a coordinate label with a white halo so it reads on any basemap. */
function drawHaloLabel(
	ctx: CanvasRenderingContext2D,
	text: string,
	x: number,
	y: number,
	align: CanvasTextAlign,
	fs: number,
): void {
	ctx.save()
	ctx.textAlign = align
	ctx.textBaseline = "middle"
	ctx.lineJoin = "round"
	ctx.strokeStyle = "rgba(255,255,255,0.92)"
	ctx.lineWidth = Math.max(2, Math.round(fs * 0.3))
	ctx.strokeText(text, x, y)
	ctx.fillStyle = "#0f172a"
	ctx.fillText(text, x, y)
	ctx.restore()
}

/**
 * Render a latitude/longitude graticule over the composited map frame.
 *  - "grid"  → full hairlines across the map + edge coordinate labels
 *  - "ticks" → neat-line edge ticks only + coordinate labels (no lines over data)
 *
 * Geography is derived from the view (centre lon/lat + zoom) and the cover-crop
 * scale used by drawImageCover, so labels are projection-accurate. Skipped when
 * the map is rotated/tilted (a graticule would be misleading there).
 */
function drawGraticule(
	ctx: CanvasRenderingContext2D,
	view: MapSceneSnapshot["view"],
	mapX: number,
	mapY: number,
	mapW: number,
	mapH: number,
	sourceW: number,
	sourceH: number,
	mode: GraticuleMode,
	fs: number,
): void {
	if (mode === "none" || !sourceW || !sourceH || mapW <= 0 || mapH <= 0) {
		return
	}
	if (Math.abs(view.bearing) > 0.1 || Math.abs(view.pitch) > 0.1) {
		return
	}

	const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1
	const worldSize = MERCATOR_TILE * 2 ** view.zoom
	const coverScale = Math.max(mapW / sourceW, mapH / sourceH)
	const f = dpr * coverScale // destination px per CSS world-pixel
	if (!Number.isFinite(f) || f <= 0) {
		return
	}

	const cwx = lonToWorldX(view.longitude, worldSize)
	const cwy = latToWorldY(view.latitude, worldSize)
	const cx = mapX + mapW / 2
	const cy = mapY + mapH / 2

	const lonToX = (lon: number) => cx + (lonToWorldX(lon, worldSize) - cwx) * f
	const latToY = (lat: number) => cy + (latToWorldY(lat, worldSize) - cwy) * f
	const xToLon = (px: number) => worldXToLon(cwx + (px - cx) / f, worldSize)
	const yToLat = (px: number) => worldYToLat(cwy + (px - cy) / f, worldSize)

	const lonWest = xToLon(mapX)
	const lonEast = xToLon(mapX + mapW)
	const latNorth = yToLat(mapY)
	const latSouth = yToLat(mapY + mapH)
	const lonSpan = Math.abs(lonEast - lonWest)
	const latSpan = Math.abs(latNorth - latSouth)
	if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan) || lonSpan <= 0 || latSpan <= 0) {
		return
	}

	const stepLon = niceDegreeStep(lonSpan, 5)
	const stepLat = niceDegreeStep(latSpan, 5)
	const decLon = decimalsForStep(stepLon)
	const decLat = decimalsForStep(stepLat)
	const tick = Math.round(fs * 0.65)

	ctx.save()
	ctx.beginPath()
	ctx.rect(mapX, mapY, mapW, mapH)
	ctx.clip()
	ctx.font = `600 ${Math.round(fs * 0.82)}px system-ui, sans-serif` // graticule labels always system-ui for sharpness
	ctx.lineWidth = Math.max(1, Math.round(fs * 0.07))

	// Corner keep-out: don't print a label so close to a perpendicular edge that
	// it collides with that edge's labels (cartographic neat-line convention).
	const cornerPad = Math.round(fs * 1.6)
	const lonLabelTopY = mapY + Math.round(fs * 0.9)
	const lonLabelBottomY = mapY + mapH - Math.round(fs * 0.9)
	const latLabelInsetX = Math.round(fs * 0.6)

	// Longitudes (vertical lines / ticks), labelled along the top AND bottom edges.
	const lonStart = Math.ceil(Math.min(lonWest, lonEast) / stepLon) * stepLon
	for (let lon = lonStart; lon <= Math.max(lonWest, lonEast) + 1e-9; lon += stepLon) {
		const x = lonToX(lon)
		if (x < mapX - 1 || x > mapX + mapW + 1) {
			continue
		}
		if (mode === "grid") {
			ctx.strokeStyle = "rgba(15,23,42,0.26)"
			ctx.beginPath()
			ctx.moveTo(x, mapY)
			ctx.lineTo(x, mapY + mapH)
			ctx.stroke()
		} else {
			ctx.strokeStyle = "rgba(15,23,42,0.85)"
			ctx.beginPath()
			ctx.moveTo(x, mapY)
			ctx.lineTo(x, mapY + tick)
			ctx.moveTo(x, mapY + mapH)
			ctx.lineTo(x, mapY + mapH - tick)
			ctx.stroke()
		}
		if (x > mapX + cornerPad && x < mapX + mapW - cornerPad) {
			const label = formatCoord(lon, false, decLon)
			drawHaloLabel(ctx, label, x, lonLabelTopY, "center", fs)
			drawHaloLabel(ctx, label, x, lonLabelBottomY, "center", fs)
		}
	}

	// Latitudes (horizontal lines / ticks), labelled along the left AND right edges.
	const latStart = Math.ceil(Math.min(latNorth, latSouth) / stepLat) * stepLat
	for (let lat = latStart; lat <= Math.max(latNorth, latSouth) + 1e-9; lat += stepLat) {
		const y = latToY(lat)
		if (y < mapY - 1 || y > mapY + mapH + 1) {
			continue
		}
		if (mode === "grid") {
			ctx.strokeStyle = "rgba(15,23,42,0.26)"
			ctx.beginPath()
			ctx.moveTo(mapX, y)
			ctx.lineTo(mapX + mapW, y)
			ctx.stroke()
		} else {
			ctx.strokeStyle = "rgba(15,23,42,0.85)"
			ctx.beginPath()
			ctx.moveTo(mapX, y)
			ctx.lineTo(mapX + tick, y)
			ctx.moveTo(mapX + mapW, y)
			ctx.lineTo(mapX + mapW - tick, y)
			ctx.stroke()
		}
		if (y > mapY + cornerPad && y < mapY + mapH - cornerPad) {
			const label = formatCoord(lat, true, decLat)
			drawHaloLabel(ctx, label, mapX + latLabelInsetX, y, "left", fs)
			drawHaloLabel(ctx, label, mapX + mapW - latLabelInsetX, y, "right", fs)
		}
	}

	ctx.restore()
}

/**
 * Draw a scaled north arrow centred at (cx, cy) with the given half-size in pixels.
 * A translucent white backing disc is drawn first so the arrow reads on both
 * light and dark basemaps.
 */
function drawNorthArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
	// (cx, cy) is the geometric CENTRE of the whole glyph (disc + arrow + "N"),
	// so callers can position it predictably without it poking outside the frame.
	ctx.save()
	const hw = Math.round(size * 0.4)
	const fs = Math.max(10, Math.round(size * 0.62))
	// Vertical layout, measured from the composition centre:
	//   "N" label · gap · arrow tip ········ arrow base
	const labelGap = Math.round(size * 0.12)
	const arrowTipY = cy - Math.round(size * 0.55)
	const arrowBaseY = arrowTipY + size
	const labelBaselineY = arrowTipY - labelGap
	const labelTopY = labelBaselineY - fs
	// Backing disc large enough to contain the label and the full arrow.
	const discCx = cx
	const discCy = (labelTopY + arrowBaseY) / 2
	const discR = (arrowBaseY - labelTopY) / 2 + Math.round(size * 0.18)
	ctx.fillStyle = "rgba(255,255,255,0.86)"
	ctx.beginPath()
	ctx.arc(discCx, discCy, discR, 0, Math.PI * 2)
	ctx.fill()
	ctx.strokeStyle = "rgba(30,41,59,0.18)"
	ctx.lineWidth = 1
	ctx.stroke()
	// Arrow — filled triangle pointing north.
	ctx.fillStyle = "#1f2933"
	ctx.beginPath()
	ctx.moveTo(cx, arrowTipY)
	ctx.lineTo(cx - hw, arrowBaseY)
	ctx.lineTo(cx, arrowBaseY - Math.round(size * 0.32))
	ctx.lineTo(cx + hw, arrowBaseY)
	ctx.closePath()
	ctx.fill()
	// White stroke for crispness on dark maps.
	ctx.strokeStyle = "rgba(255,255,255,0.55)"
	ctx.lineWidth = Math.max(1, Math.round(size * 0.08))
	ctx.stroke()
	// "N" label centred above the arrow tip.
	ctx.font = `700 ${fs}px system-ui, sans-serif` // north arrow 'N' always system-ui
	ctx.fillStyle = "#1f2933"
	ctx.textAlign = "center"
	ctx.textBaseline = "alphabetic"
	ctx.fillText("N", cx, labelBaselineY)
	ctx.textAlign = "left"
	ctx.restore()
}

/** Resolve canvas x-origin for a given text alignment within the margin-to-margin content width. */
function alignX(align: TextAlign, marginLeft: number, contentWidth: number): number {
	if (align === "center") {
		return marginLeft + contentWidth / 2
	}
	if (align === "right") {
		return marginLeft + contentWidth
	}
	return marginLeft
}

async function composePlate(
	mapCanvas: HTMLCanvasElement,
	spec: MapPlateSpec,
	snapshot: MapSceneSnapshot,
	readiness: ExportReadinessReport,
): Promise<{ canvas: HTMLCanvasElement; renderState: MapExportRenderState }> {
	const dims = pagePixels(spec.template, spec.dpi)
	const canvas = document.createElement("canvas")
	canvas.width = dims.width
	canvas.height = dims.height
	const ctx = canvas.getContext("2d")
	if (!ctx) {
		throw new Error("Unable to create export canvas")
	}

	const cfg = TEMPLATE_CONFIGS[spec.template]
	ctx.fillStyle = "#ffffff"
	ctx.fillRect(0, 0, dims.width, dims.height)

	const margin = Math.round(dims.width * cfg.marginFrac)
	const titleBand = Math.round(dims.height * cfg.titleBandFrac)
	const footerBand = Math.round(dims.height * cfg.footerBandFrac)
	const legendWidth =
		spec.elements.legend && cfg.legendPlacement === "side" && cfg.legendWidthFrac > 0
			? Math.round(dims.width * cfg.legendWidthFrac)
			: 0
	const legendGutter = legendWidth ? Math.round(margin * 0.55) : 0

	// Banner templates render a full-width accent band across the very top; the
	// map then begins immediately below it (no overlay → no "weird background"
	// strip of map hidden under the banner).
	const titleBandH = cfg.titleStyle === "banner" ? (cfg.mapAtTop ? Math.round(titleBand * 0.9) : titleBand) : titleBand

	const mapX = margin
	const mapY =
		cfg.titleStyle === "banner" ? titleBandH + (cfg.mapAtTop ? 0 : margin) : cfg.mapAtTop ? margin : margin + titleBand
	const mapW = dims.width - margin * 2 - legendWidth - legendGutter
	const mapH = dims.height - mapY - footerBand - margin

	// ── Title ────────────────────────────────────────────────────────────────
	const ff = spec.fontFamily || "system-ui, sans-serif"
	const contentW = dims.width - margin * 2

	if (cfg.titleStyle === "banner") {
		const bannerH = titleBandH
		ctx.fillStyle = cfg.accent
		ctx.fillRect(0, 0, dims.width, bannerH)
		// Vertically centre the title (and subtitle) within the band.
		const titleFs = Math.max(22, Math.round(dims.width * cfg.titleSizeFrac))
		const titleAlignX = alignX(spec.textAlign.title, margin, contentW)
		ctx.save()
		ctx.fillStyle = "#f8fafc"
		ctx.textBaseline = "middle"
		ctx.textAlign = spec.textAlign.title === "center" ? "center" : spec.textAlign.title === "right" ? "right" : "left"
		ctx.font = `${cfg.titleWeight} ${titleFs}px ${ff}`
		if (spec.text.subtitle) {
			ctx.fillText(spec.text.title || "AI-Hydro Map Plate", titleAlignX, Math.round(bannerH * 0.4))
			ctx.font = `500 ${Math.max(13, Math.round(dims.width * cfg.titleSizeFrac * 0.5))}px ${ff}`
			ctx.fillStyle = "#cbd5e1"
			ctx.textAlign =
				spec.textAlign.subtitle === "center" ? "center" : spec.textAlign.subtitle === "right" ? "right" : "left"
			const subAlignX = alignX(spec.textAlign.subtitle, margin, contentW)
			ctx.fillText(spec.text.subtitle, subAlignX, Math.round(bannerH * 0.72))
		} else {
			ctx.fillText(spec.text.title || "AI-Hydro Map Plate", titleAlignX, Math.round(bannerH * 0.5))
		}
		ctx.restore()
	} else if (cfg.titleStyle === "plain") {
		const titleAlignX = alignX(spec.textAlign.title, margin, contentW)
		ctx.save()
		ctx.fillStyle = cfg.accent
		ctx.textAlign = spec.textAlign.title === "center" ? "center" : spec.textAlign.title === "right" ? "right" : "left"
		ctx.font = `${cfg.titleWeight} ${Math.max(15, Math.round(dims.width * cfg.titleSizeFrac))}px ${ff}`
		ctx.fillText(spec.text.title || "AI-Hydro Map Plate", titleAlignX, margin + Math.round(titleBand * 0.4))
		if (spec.text.subtitle) {
			ctx.font = `${Math.max(11, Math.round(dims.width * cfg.titleSizeFrac * 0.72))}px ${ff}`
			ctx.fillStyle = "#4b5563"
			ctx.textAlign =
				spec.textAlign.subtitle === "center" ? "center" : spec.textAlign.subtitle === "right" ? "right" : "left"
			const subAlignX = alignX(spec.textAlign.subtitle, margin, contentW)
			ctx.fillText(spec.text.subtitle, subAlignX, margin + Math.round(titleBand * 0.72))
		}
		ctx.restore()
		// Thin accent rule under the title band.
		ctx.strokeStyle = "#d1d5db"
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(margin, margin + titleBand - Math.round(titleBand * 0.08))
		ctx.lineTo(dims.width - margin, margin + titleBand - Math.round(titleBand * 0.08))
		ctx.stroke()
	}

	// Aspect-preserving draw: the map is centre-cropped to fill the frame, never
	// stretched — so the same geometry looks identical across every template.
	drawImageCover(ctx, mapCanvas, mapX, mapY, mapW, mapH)

	// ── Map chrome (graticule / legend / scale bar / north arrow) ──────────────
	// A single base font size keeps every overlay proportional across DPIs and
	// template sizes.
	const chromeFs = Math.max(11, Math.round(dims.width * 0.011))

	// Graticule sits beneath the neat-line and the rest of the chrome.
	drawGraticule(ctx, snapshot.view, mapX, mapY, mapW, mapH, mapCanvas.width, mapCanvas.height, spec.graticule, chromeFs)

	if (cfg.frame) {
		ctx.strokeStyle = "#111827"
		ctx.lineWidth = Math.max(2, Math.round(dims.width * 0.0014))
		ctx.strokeRect(mapX, mapY, mapW, mapH)
	}

	// The map no longer sits beneath the banner, so top-anchored chrome only
	// needs to clear the neat-line inset.
	const inset = Math.round(chromeFs * 1.1)
	const topClear = mapY + inset

	if (spec.elements.legend) {
		if (cfg.legendPlacement === "side" && legendWidth) {
			drawLegend(ctx, snapshot, mapX + mapW + legendGutter, mapY, legendWidth, chromeFs, "tl", ff)
		} else if (cfg.legendPlacement === "inset-tl") {
			drawLegend(ctx, snapshot, mapX + inset, topClear, Math.round(mapW * 0.42), chromeFs, "tl", ff)
		} else if (cfg.legendPlacement === "inset-tr") {
			drawLegend(ctx, snapshot, mapX + mapW - inset, topClear, Math.round(mapW * 0.42), chromeFs, "tr", ff)
		} else if (cfg.legendPlacement === "inset-bl") {
			drawLegend(ctx, snapshot, mapX + inset, mapY + mapH - inset, Math.round(mapW * 0.42), chromeFs, "bl", ff)
		}
	}
	// Color ramp legend — bottom-right, stacked upward for each raster layer.
	if (spec.elements.colorRampLegend) {
		drawColorRampLegend(ctx, snapshot, mapX, mapY, mapW, mapH, chromeFs, ff)
	}
	if (spec.elements.northArrow) {
		// Proportional arrow — slightly larger for better visibility at all DPIs.
		const arrowSize = Math.max(chromeFs * 1.8, Math.round(Math.min(mapW, mapH) * 0.036))
		const arrowCx = mapX + mapW - inset - Math.round(arrowSize * 0.5)
		const arrowCy = topClear + Math.round(arrowSize * 1.5)
		drawNorthArrow(ctx, arrowCx, arrowCy, arrowSize)
	}
	if (spec.elements.scaleBar) {
		// Bottom-left, but shifted right when the legend already occupies that corner.
		const sbX = mapX + inset + (cfg.legendPlacement === "inset-bl" ? Math.round(mapW * 0.34) : 0)
		drawScaleBar(ctx, snapshot.view, sbX, mapY + mapH - Math.round(chromeFs * 1.6), mapW, chromeFs, ff)
	}
	// AI-Hydro watermark badge — on the map frame, bottom-left above scale bar.
	if (spec.elements.watermark) {
		drawWatermark(ctx, mapX, mapY, mapH, chromeFs, ff)
	}

	const footerFs = Math.max(10, Math.round(dims.width * 0.0075))
	const footerLineH = Math.max(14, Math.round(dims.width * 0.008))
	let footerY = mapY + mapH + Math.round(footerBand * 0.28)

	// ── Author / project line ────────────────────────────────────────────────
	if (spec.text.authorProject) {
		ctx.fillStyle = "#111827"
		ctx.font = `600 ${Math.max(10, Math.round(dims.width * 0.008))}px ${ff}`
		footerY = drawText(ctx, spec.text.authorProject, margin, footerY, contentW, footerLineH, spec.textAlign.author)
		footerY += Math.round(footerLineH * 0.15)
	}

	// ── Notes line ───────────────────────────────────────────────────────────
	if (spec.text.notes) {
		ctx.fillStyle = "#374151"
		ctx.font = `italic ${Math.max(9, Math.round(dims.width * 0.0068))}px ${ff}`
		footerY = drawText(
			ctx,
			spec.text.notes,
			margin,
			footerY,
			contentW,
			Math.max(12, Math.round(dims.width * 0.0075)),
			spec.textAlign.notes,
		)
		footerY += Math.round(footerLineH * 0.1)
	}

	// ── Provenance / attribution footer ─────────────────────────────────────
	ctx.fillStyle = "#374151"
	ctx.font = `${footerFs}px ${ff}`
	const footerText: string[] = []
	if (spec.elements.attribution && snapshot.basemap.attribution.length) {
		footerText.push(`Basemap: ${snapshot.basemap.attribution.join("; ")}`)
	}
	if (spec.elements.bounds) {
		footerText.push(
			`View center: ${snapshot.view.latitude.toFixed(4)}, ${snapshot.view.longitude.toFixed(4)}; zoom ${snapshot.view.zoom.toFixed(2)}`,
		)
	}
	if (spec.elements.provenanceFooter) {
		footerText.push(`AI-Hydro export ${snapshot.snapshotId}; ${readiness.qualityStatus}`)
	}
	if (footerText.length) {
		footerY = drawText(ctx, footerText.join(" | "), margin, footerY, contentW, footerLineH, spec.textAlign.footer)
	}
	if (spec.text.caption && cfg.showCaption) {
		ctx.fillStyle = "#111827"
		ctx.font = `${Math.max(10, Math.round(dims.width * 0.007))}px ${ff}`
		drawText(ctx, spec.text.caption, margin, footerY + 4, contentW, footerLineH, spec.textAlign.caption)
	}

	const warnings = [...readiness.warnings]
	if (dims.width > mapCanvas.width * 1.25) {
		warnings.push({
			code: "CAPTURE_LIMITED_RESOLUTION",
			message: "Exported plate uses the current rendered map frame as its source image.",
			severity: "warning",
		})
	}
	return {
		canvas,
		renderState: {
			requestedPixelDimensions: { width: dims.width, height: dims.height },
			actualPixelDimensions: { width: canvas.width, height: canvas.height },
			renderCompleted: true,
			basemapReady: true,
			layerStates: snapshot.layers.map((layer) => ({
				layerId: layer.id,
				state: layer.exportSupport === "verified" ? "ready" : "warning",
				message:
					layer.exportSupport === "capture-only"
						? "Captured from rendered scene; tile completeness not independently verified."
						: undefined,
			})),
			resolutionDowngraded: false,
			warnings,
		},
	}
}

function buildManifest(
	spec: MapPlateSpec,
	snapshot: MapSceneSnapshot,
	readiness: ExportReadinessReport,
	renderState: MapExportRenderState,
): Record<string, unknown> {
	const dims = pagePixels(spec.template, spec.dpi)
	return {
		schemaVersion: "1.0",
		artifactType: "ai-hydro.map-plate",
		exportId: snapshot.snapshotId,
		generatedAtUtc: new Date().toISOString(),
		requested: {
			template: spec.template,
			formats: spec.formats,
			dpi: spec.dpi,
			graticule: spec.graticule,
			extentStrategy: spec.extentStrategy,
			normalizeOrientation: TEMPLATE_CONFIGS[spec.template].normalizeOrientation,
		},
		rendered: {
			qualityStatus: readiness.qualityStatus === "blocked" ? "blocked" : readiness.qualityStatus,
			actualPixelDimensions: Object.fromEntries(spec.formats.map((format) => [format, renderState.actualPixelDimensions])),
			bearing: snapshot.view.bearing,
			pitch: snapshot.view.pitch,
			resolutionDowngraded: renderState.resolutionDowngraded,
			renderState,
		},
		page: {
			kind: TEMPLATE_LABELS[spec.template],
			widthInches: dims.page.widthIn,
			heightInches: dims.page.heightIn,
		},
		basemap: {
			id: snapshot.basemap.id,
			label: snapshot.basemap.label,
			attribution: snapshot.basemap.attribution,
			attributionIncluded: spec.elements.attribution,
		},
		visibleLayers: snapshot.layers,
		excludedLayers: [],
		citations: snapshot.citations,
		sourceArtifacts: snapshot.layers.map((layer) => ({
			artifactId: layer.id,
			provenanceRef: layer.sourceRef,
			role: "visible-map-layer",
		})),
		warnings: [...readiness.warnings, ...renderState.warnings],
		transport: {
			mode: "protobuf-json-base64-artifact-bridge",
			note: "Base64 is used only as the VS Code webview transport encoding; exported files are decoded and written by the extension host.",
			base64DataUrlUsed: false,
		},
		outputs: [],
	}
}

function pdfBytesFromCanvas(canvas: HTMLCanvasElement, spec: MapPlateSpec): Uint8Array {
	const dims = pagePixels(spec.template, spec.dpi)
	const orientation = dims.page.widthIn >= dims.page.heightIn ? "landscape" : "portrait"
	const pdf = new jsPDF({ orientation, unit: "in", format: [dims.page.widthIn, dims.page.heightIn], compress: true })
	pdf.setProperties({
		title: spec.text.title || "AI-Hydro Map Plate",
		subject: "AI-Hydro research map export",
		creator: "AI-Hydro Map Plate Composer",
	})
	pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, dims.page.widthIn, dims.page.heightIn, undefined, "FAST")
	return new Uint8Array(pdf.output("arraybuffer"))
}

export const MapExport: React.FC<MapExportProps> = ({
	mapStyle = "dark",
	onClose,
	layers = [],
	visibleLayerIds,
	viewState,
	currentBasemap,
}) => {
	const [template, setTemplate] = useState<ExportTemplate>("report")
	const [formats, setFormats] = useState<ExportFormat[]>(["png"])
	const [dpi, setDpi] = useState<ExportDpi>(300)
	const [extentStrategy, setExtentStrategy] = useState<ExtentStrategy>("preserve-visible-extent")
	const [graticule, setGraticule] = useState<GraticuleMode>("none")
	const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value)
	const [title, setTitle] = useState("AI-Hydro Map Plate")
	const [subtitle, setSubtitle] = useState("")
	const [caption, setCaption] = useState("")
	const [authorProject, setAuthorProject] = useState("")
	const [notes, setNotes] = useState("")
	const [textAlign, setTextAlign] = useState<MapPlateSpec["textAlign"]>({
		title: "left",
		subtitle: "left",
		caption: "left",
		author: "left",
		notes: "left",
		footer: "left",
	})
	const [elements, setElements] = useState<MapPlateSpec["elements"]>({
		legend: true,
		scaleBar: true,
		northArrow: true,
		attribution: true,
		bounds: true,
		provenanceFooter: true,
		colorRampLegend: true,
		watermark: true,
	})
	const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [previewUrl, setPreviewUrl] = useState<string>("")
	const [previewExpanded, setPreviewExpanded] = useState(false)
	const [previewScale, setPreviewScale] = useState<"fit" | "actual">("fit")
	const [previewStatus, setPreviewStatus] = useState<{ kind: "idle" | "busy" | "err"; msg: string }>({ kind: "idle", msg: "" })

	// ── Plate template save/load ──────────────────────────────────────────────
	const TMPL_STORAGE_KEY = "aihydro.map.plate.templates.v1"
	interface SavedPlateTemplate {
		id: string
		name: string
		createdAt: string
		template: ExportTemplate
		formats: ExportFormat[]
		dpi: ExportDpi
		graticule: GraticuleMode
		fontFamily: string
		textAlign: MapPlateSpec["textAlign"]
		elements: MapPlateSpec["elements"]
	}
	const [savedTemplates, setSavedTemplates] = useState<SavedPlateTemplate[]>(() => {
		try {
			const raw = localStorage.getItem(TMPL_STORAGE_KEY)
			return raw ? (JSON.parse(raw) as SavedPlateTemplate[]) : []
		} catch {
			return []
		}
	})
	const [tmplNaming, setTmplNaming] = useState(false)
	const [tmplName, setTmplName] = useState("")

	const savePlateTemplate = () => {
		if (!tmplName.trim()) {
			return
		}
		const tmpl: SavedPlateTemplate = {
			id: `pt_${Date.now()}`,
			name: tmplName.trim(),
			createdAt: new Date().toISOString(),
			template,
			formats,
			dpi,
			graticule,
			fontFamily,
			textAlign,
			elements,
		}
		const next = [...savedTemplates, tmpl]
		setSavedTemplates(next)
		try {
			localStorage.setItem(TMPL_STORAGE_KEY, JSON.stringify(next))
		} catch {
			/* ignore */
		}
		setTmplName("")
		setTmplNaming(false)
	}

	const applyPlateTemplate = (tmpl: SavedPlateTemplate) => {
		setTemplate(tmpl.template)
		setFormats(tmpl.formats)
		setDpi(tmpl.dpi)
		setGraticule(tmpl.graticule)
		setFontFamily(tmpl.fontFamily)
		setTextAlign(tmpl.textAlign)
		setElements(tmpl.elements)
	}

	const deletePlateTemplate = (id: string) => {
		const next = savedTemplates.filter((t) => t.id !== id)
		setSavedTemplates(next)
		try {
			localStorage.setItem(TMPL_STORAGE_KEY, JSON.stringify(next))
		} catch {
			/* ignore */
		}
	}

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl)
			}
		}
	}, [previewUrl])

	useEffect(() => {
		if (!previewExpanded) {
			return
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setPreviewExpanded(false)
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => window.removeEventListener("keydown", onKeyDown)
	}, [previewExpanded])

	const spec = useMemo<MapPlateSpec>(
		() => ({
			template,
			formats,
			dpi,
			extentStrategy,
			graticule,
			fontFamily,
			text: { title, subtitle, caption, authorProject, notes },
			textAlign,
			elements,
		}),
		[
			template,
			formats,
			dpi,
			extentStrategy,
			graticule,
			fontFamily,
			title,
			subtitle,
			caption,
			authorProject,
			notes,
			textAlign,
			elements,
		],
	)
	const mapCanvas = () => document.querySelector("canvas.deckgl-overlay, canvas") as HTMLCanvasElement | null
	const snapshot = useMemo(
		() => buildSnapshot(spec, { layers, visibleLayerIds, viewState, currentBasemap }),
		[spec, layers, visibleLayerIds, viewState, currentBasemap],
	)
	const readiness = useMemo(() => evaluateReadiness(spec, snapshot, mapCanvas()), [spec, snapshot])
	const dims = pagePixels(template, dpi)

	const isDark = mapStyle === "dark"
	const fg = isDark ? "var(--vscode-foreground, #ddd)" : "var(--vscode-foreground, #222)"
	const bg = isDark ? "rgba(20,20,28,0.96)" : "rgba(248,248,250,0.97)"
	const border = isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"
	const subtle = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"
	const accent = "var(--vscode-button-background, #0e639c)"

	const toggleFormat = (format: ExportFormat) => {
		setFormats((prev) => {
			const next = prev.includes(format) ? prev.filter((item) => item !== format) : [...prev, format]
			return next.length ? next : [format]
		})
	}

	const refreshPreview = async () => {
		const canvas = mapCanvas()
		if (!canvas) {
			setPreviewStatus({ kind: "err", msg: "Map canvas not found." })
			return
		}
		setPreviewStatus({ kind: "busy", msg: "Building preview..." })
		try {
			const previewSpec: MapPlateSpec = { ...spec, dpi: 150, formats: ["png"] }
			const previewSnapshot = { ...snapshot, snapshotId: "preview", capturedAtUtc: new Date().toISOString() }
			const previewReadiness = evaluateReadiness(previewSpec, previewSnapshot, canvas)
			const composed = await composePlate(canvas, previewSpec, previewSnapshot, previewReadiness)
			const blob = await canvasToBlob(composed.canvas, "image/jpeg", 0.82)
			const nextUrl = URL.createObjectURL(blob)
			setPreviewUrl((previous) => {
				if (previous) {
					URL.revokeObjectURL(previous)
				}
				return nextUrl
			})
			hasPreviewRef.current = true
			setPreviewStatus({ kind: "idle", msg: "Preview ready." })
		} catch (error) {
			setPreviewStatus({ kind: "err", msg: error instanceof Error ? error.message : String(error) })
		}
	}

	// Auto-refresh: re-render the preview 700ms after any spec/snapshot change,
	// but only when a preview is already shown (don't trigger on first open).
	const autoRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const hasPreviewRef = useRef(false)
	useEffect(() => {
		if (!hasPreviewRef.current) {
			return
		}
		if (autoRefreshTimer.current) {
			clearTimeout(autoRefreshTimer.current)
		}
		autoRefreshTimer.current = setTimeout(() => {
			void refreshPreview()
		}, 700)
		return () => {
			if (autoRefreshTimer.current) {
				clearTimeout(autoRefreshTimer.current)
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [spec, snapshot])

	const writeExport = async (quick: boolean) => {
		try {
			const canvas = mapCanvas()
			const currentReadiness = evaluateReadiness(spec, snapshot, canvas)
			if (!canvas) {
				setStatus({ kind: "err", msg: "Map canvas not found." })
				return
			}
			if (!quick && !currentReadiness.canResearchExport) {
				setStatus({ kind: "err", msg: `Research export blocked: ${currentReadiness.blockingReasons.join(" ")}` })
				return
			}
			const requestedFormats = quick ? (["png"] as ExportFormat[]) : spec.formats
			const activeSpec = quick
				? { ...spec, template: "clean" as ExportTemplate, formats: requestedFormats }
				: { ...spec, formats: requestedFormats }
			const activeSnapshot = { ...snapshot, snapshotId: exportId(), capturedAtUtc: new Date().toISOString() }
			const baseName = `${activeSpec.template}-map-${activeSnapshot.capturedAtUtc.slice(0, 19).replace(/[:T]/g, "-")}`

			setStatus({ kind: "busy", msg: "Step 1/4: choosing destination..." })
			const prepared = await MapServiceClient.prepareMapExport(
				PrepareMapExportRequest.create({
					exportId: activeSnapshot.snapshotId,
					suggestedFilename: baseName,
					formats: requestedFormats,
				}),
			)
			if (!prepared.accepted) {
				setStatus({ kind: "idle", msg: prepared.message || "Export cancelled." })
				return
			}

			reportMapEvent("map_export.started", {
				exportId: activeSnapshot.snapshotId,
				template: activeSpec.template,
				formats: requestedFormats,
				dpi: activeSpec.dpi,
				qualityStatus: currentReadiness.qualityStatus,
				visibleLayerIds: activeSnapshot.layers.map((layer) => layer.id),
			})

			setStatus({ kind: "busy", msg: "Step 2/4: composing map plate..." })
			const composed = await composePlate(canvas, activeSpec, activeSnapshot, currentReadiness)
			const artifacts = []
			if (requestedFormats.includes("png")) {
				setStatus({ kind: "busy", msg: "Step 3/4: encoding PNG..." })
				const png = await blobToBytes(await canvasToBlob(composed.canvas))
				artifacts.push(
					MapExportArtifact.create({
						format: "png",
						filename: `${baseName}.png`,
						mimeType: "image/png",
						dataBase64: bytesToBase64(png),
					}),
				)
			}
			if (requestedFormats.includes("pdf")) {
				setStatus({ kind: "busy", msg: "Step 3/4: encoding PDF..." })
				const pdf = pdfBytesFromCanvas(composed.canvas, activeSpec)
				artifacts.push(
					MapExportArtifact.create({
						format: "pdf",
						filename: `${baseName}.pdf`,
						mimeType: "application/pdf",
						dataBase64: bytesToBase64(pdf),
					}),
				)
			}
			const manifest = buildManifest(activeSpec, activeSnapshot, currentReadiness, composed.renderState)
			setStatus({ kind: "busy", msg: "Step 4/4: writing files and checksums..." })
			const saved = await MapServiceClient.saveMapExport(
				SaveMapExportRequest.create({
					exportId: activeSnapshot.snapshotId,
					basePath: prepared.basePath,
					artifacts,
					manifestJson: JSON.stringify(manifest),
				}),
			)
			if (!saved.ok) {
				setStatus({ kind: "err", msg: saved.message || "Export write failed." })
				return
			}
			setStatus({
				kind: "ok",
				msg: `Saved ${saved.outputs.length} artifact${saved.outputs.length === 1 ? "" : "s"} with provenance.`,
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			reportMapEvent("map_export.failed", { reason: "WEBVIEW_EXPORT_FAILED", message }, "system")
			setStatus({ kind: "err", msg: `Export failed: ${message}` })
			return
		}
	}

	const buttonStyle: React.CSSProperties = {
		width: "100%",
		padding: "7px 10px",
		fontSize: 12,
		fontWeight: 600,
		background: accent,
		color: "#fff",
		border: "none",
		borderRadius: 4,
		cursor: status.kind === "busy" ? "progress" : "pointer",
	}
	const inputStyle: React.CSSProperties = {
		width: "100%",
		boxSizing: "border-box",
		background: isDark ? "rgba(255,255,255,0.07)" : "#fff",
		border: `1px solid ${border}`,
		color: fg,
		borderRadius: 4,
		padding: "6px 7px",
		fontFamily: "inherit",
		fontSize: 11,
	}

	return (
		<div
			style={{
				padding: "10px 14px",
				background: bg,
				border: `1px solid ${border}`,
				borderRadius: 6,
				boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
				color: fg,
				fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
				fontSize: 12,
				width: "100%",
				boxSizing: "border-box",
				pointerEvents: "auto",
			}}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
				<div>
					<div style={{ fontWeight: 700, fontSize: 14 }}>Map Plate Composer</div>
					<div style={{ fontSize: 10, opacity: 0.68, marginTop: 2 }}>
						Preview, verify, and export reproducible map plates.
					</div>
				</div>
				<button
					onClick={onClose}
					style={{
						background: "transparent",
						border: `1px solid ${border}`,
						borderRadius: 4,
						color: fg,
						cursor: "pointer",
						fontSize: 12,
						padding: "4px 8px",
					}}>
					Close
				</button>
			</div>

			<div style={{ padding: 8, border: `1px solid ${border}`, borderRadius: 5, background: subtle, marginBottom: 8 }}>
				<div
					style={{
						fontWeight: 700,
						color:
							readiness.qualityStatus === "blocked"
								? "#f87171"
								: readiness.qualityStatus === "verified"
									? "#7dd3fc"
									: "#fbbf24",
					}}>
					{readiness.qualityStatus === "blocked"
						? "Research export blocked"
						: readiness.qualityStatus === "verified"
							? "Research export ready"
							: "Ready with warnings"}
				</div>
				<div style={{ opacity: 0.78, marginTop: 4 }}>
					{readiness.supportedLayers.length} verified layer(s), {readiness.captureOnlyLayers.length} capture-only,{" "}
					{readiness.unsupportedLayers.length} unsupported.
				</div>
				{readiness.blockingReasons.map((reason) => (
					<div key={reason} style={{ color: "#f87171", marginTop: 4 }}>
						{reason}
					</div>
				))}
				{readiness.warnings.slice(0, 3).map((warning) => (
					<div key={warning.code} style={{ color: "#fbbf24", marginTop: 4 }}>
						{warning.message}
					</div>
				))}
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: previewUrl ? "repeat(auto-fit, minmax(320px, 1fr))" : "1fr",
					gap: 10,
					alignItems: "start",
				}}>
				<div>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
						<div style={{ fontWeight: 700 }}>Preview</div>
						<div style={{ display: "flex", gap: 6 }}>
							<button
								disabled={!previewUrl}
								onClick={() => {
									setPreviewScale("fit")
									setPreviewExpanded(true)
								}}
								style={{
									padding: "4px 8px",
									fontSize: 11,
									background: "transparent",
									color: fg,
									border: `1px solid ${border}`,
									borderRadius: 4,
									cursor: previewUrl ? "pointer" : "default",
									opacity: previewUrl ? 1 : 0.55,
								}}>
								Expand
							</button>
							<button
								disabled={previewStatus.kind === "busy"}
								onClick={() => void refreshPreview()}
								style={{
									padding: "4px 8px",
									fontSize: 11,
									background: "transparent",
									color: fg,
									border: `1px solid ${border}`,
									borderRadius: 4,
									cursor: previewStatus.kind === "busy" ? "progress" : "pointer",
								}}>
								{previewStatus.kind === "busy" ? "Refreshing…" : "Refresh preview"}
							</button>
						</div>
					</div>
					<div
						style={{
							minHeight: 92,
							border: `1px solid ${border}`,
							borderRadius: 5,
							background: isDark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.8)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							overflow: "hidden",
							marginBottom: 8,
						}}>
						{previewUrl ? (
							<img
								alt="Map export preview"
								src={previewUrl}
								style={{ width: "100%", height: "auto", display: "block" }}
							/>
						) : (
							<div style={{ padding: 10, textAlign: "center", opacity: 0.74 }}>
								Click <strong>Refresh preview</strong> to generate the first preview. After that it updates
								automatically when you change settings.
							</div>
						)}
					</div>
					{previewStatus.msg && (
						<div
							style={{
								fontSize: 10,
								color: previewStatus.kind === "err" ? "#f87171" : "var(--vscode-descriptionForeground, #999)",
								marginBottom: 8,
							}}>
							{previewStatus.msg}
						</div>
					)}
				</div>

				<div>
					{/* ── Saved plate templates ── */}
					<div
						style={{
							marginBottom: 10,
							padding: "6px 8px",
							background: subtle,
							borderRadius: 4,
							border: `1px solid ${border}`,
						}}>
						<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
							<span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, flex: 1 }}>💾 My Templates</span>
							{!tmplNaming && (
								<button
									onClick={() => setTmplNaming(true)}
									style={{
										fontSize: 9,
										padding: "1px 7px",
										background: "transparent",
										color: fg,
										border: `1px solid ${border}`,
										borderRadius: 3,
										cursor: "pointer",
									}}
									title="Save current settings as a named template"
									type="button">
									＋ Save current
								</button>
							)}
						</div>
						{tmplNaming && (
							<div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
								<input
									autoFocus
									maxLength={40}
									onChange={(e) => setTmplName(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											savePlateTemplate()
										}
										if (e.key === "Escape") {
											setTmplNaming(false)
											setTmplName("")
										}
									}}
									placeholder="Template name…"
									style={{
										flex: 1,
										fontSize: 10,
										padding: "2px 6px",
										background: "rgba(255,255,255,0.07)",
										color: fg,
										border: `1px solid ${border}`,
										borderRadius: 3,
									}}
									type="text"
									value={tmplName}
								/>
								<button
									onClick={savePlateTemplate}
									style={{
										fontSize: 9,
										padding: "2px 6px",
										background: accent,
										color: "#fff",
										border: "none",
										borderRadius: 3,
										cursor: "pointer",
									}}
									type="button">
									✓
								</button>
								<button
									onClick={() => {
										setTmplNaming(false)
										setTmplName("")
									}}
									style={{
										fontSize: 9,
										padding: "2px 6px",
										background: "transparent",
										color: fg,
										border: `1px solid ${border}`,
										borderRadius: 3,
										cursor: "pointer",
									}}
									type="button">
									✕
								</button>
							</div>
						)}
						{savedTemplates.length === 0 ? (
							<div style={{ fontSize: 9, opacity: 0.45, textAlign: "center" }}>
								No templates yet. Configure layout settings then click ＋ Save current.
							</div>
						) : (
							<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
								{savedTemplates.map((t) => (
									<div
										key={t.id}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 5,
											padding: "2px 5px",
											background: "rgba(255,255,255,0.04)",
											border: `1px solid ${border}`,
											borderRadius: 3,
										}}>
										<button
											onClick={() => applyPlateTemplate(t)}
											style={{
												flex: 1,
												textAlign: "left",
												background: "transparent",
												border: "none",
												color: fg,
												cursor: "pointer",
												fontSize: 10,
												padding: 0,
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap",
											}}
											title={`Apply "${t.name}" (${t.template} · ${t.dpi} dpi)`}
											type="button">
											{t.name}
										</button>
										<span style={{ fontSize: 9, opacity: 0.4, whiteSpace: "nowrap" }}>
											{t.template} · {t.dpi}dpi
										</span>
										<button
											onClick={() => deletePlateTemplate(t.id)}
											style={{
												background: "transparent",
												border: "none",
												color: "rgba(220,53,69,0.7)",
												cursor: "pointer",
												fontSize: 12,
												padding: 0,
												lineHeight: 1,
											}}
											title="Delete template"
											type="button">
											✕
										</button>
									</div>
								))}
							</div>
						)}
					</div>

					<label style={{ display: "block", marginBottom: 6 }}>
						Template
						<select
							onChange={(event) => setTemplate(event.target.value as ExportTemplate)}
							style={inputStyle}
							value={template}>
							{TEMPLATE_GROUPS.map((group) => (
								<optgroup key={group.category} label={group.category}>
									{group.templates.map((key) => (
										<option key={key} value={key}>
											{TEMPLATE_CONFIGS[key].label}
										</option>
									))}
								</optgroup>
							))}
						</select>
					</label>
					<div
						style={{
							fontSize: 11,
							lineHeight: 1.35,
							color: "var(--vscode-descriptionForeground, #999)",
							margin: "-2px 0 8px",
						}}>
						{TEMPLATE_CONFIGS[template].description}
					</div>
					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
						<label>
							DPI
							<select
								onChange={(event) => setDpi(Number(event.target.value) as ExportDpi)}
								style={inputStyle}
								value={dpi}>
								<option value={150}>150 draft</option>
								<option value={300}>300 research</option>
								<option value={600}>600 guarded</option>
							</select>
						</label>
						<label>
							Extent
							<select
								onChange={(event) => setExtentStrategy(event.target.value as ExtentStrategy)}
								style={inputStyle}
								value={extentStrategy}>
								<option value="preserve-visible-extent">Preserve visible extent</option>
								<option value="preserve-center-scale">Preserve center and scale</option>
							</select>
						</label>
						<label>
							Graticule
							<select
								onChange={(event) => setGraticule(event.target.value as GraticuleMode)}
								style={inputStyle}
								value={graticule}>
								<option value="none">None</option>
								<option value="grid">Grid lines + labels</option>
								<option value="ticks">Edge ticks + labels</option>
							</select>
						</label>
						<label>
							Font
							<select onChange={(event) => setFontFamily(event.target.value)} style={inputStyle} value={fontFamily}>
								{FONT_OPTIONS.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</label>
					</div>
					<div style={{ display: "flex", gap: 8, margin: "6px 0 8px", flexWrap: "wrap" }}>
						{(["png", "pdf"] as ExportFormat[]).map((format) => (
							<label key={format} style={{ display: "flex", gap: 4, alignItems: "center" }}>
								<input checked={formats.includes(format)} onChange={() => toggleFormat(format)} type="checkbox" />
								{format === "pdf" ? "PDF (slower)" : "PNG"}
							</label>
						))}
					</div>

					{/* ── Text fields with per-field alignment toggles ── */}
					{(
						[
							{ field: "title" as const, label: "Title", value: title, setter: setTitle, multiline: false },
							{
								field: "subtitle" as const,
								label: "Subtitle",
								value: subtitle,
								setter: setSubtitle,
								multiline: false,
							},
							{ field: "caption" as const, label: "Caption", value: caption, setter: setCaption, multiline: true },
							{
								field: "author" as const,
								label: "Author / project",
								value: authorProject,
								setter: setAuthorProject,
								multiline: false,
							},
							{ field: "notes" as const, label: "Notes", value: notes, setter: setNotes, multiline: false },
						] as Array<{
							field: keyof MapPlateSpec["textAlign"]
							label: string
							value: string
							setter: (v: string) => void
							multiline: boolean
						}>
					).map(({ field, label, value: fieldValue, setter, multiline }) => (
						<div key={field} style={{ marginBottom: 6 }}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginBottom: 3,
								}}>
								<span style={{ fontSize: 10, opacity: 0.72 }}>{label}</span>
								{/* Alignment toggle */}
								<div style={{ display: "flex", gap: 2 }}>
									{(["left", "center", "right"] as TextAlign[]).map((a) => (
										<button
											key={a}
											onClick={() =>
												setTextAlign((prev) => ({
													...prev,
													[field]: a,
												}))
											}
											style={{
												width: 22,
												height: 20,
												padding: 0,
												fontSize: 11,
												lineHeight: "20px",
												textAlign: "center" as React.CSSProperties["textAlign"],
												border: `1px solid ${border}`,
												borderRadius: 3,
												cursor: "pointer",
												background:
													textAlign[field] === a ? accent : isDark ? "rgba(255,255,255,0.07)" : "#fff",
												color: textAlign[field] === a ? "#fff" : fg,
											}}
											title={`Align ${a}`}>
											{a === "left" ? "⬅" : a === "center" ? "≡" : "➡"}
										</button>
									))}
								</div>
							</div>
							{multiline ? (
								<textarea
									onChange={(event) => setter(event.target.value)}
									placeholder={label}
									style={{ ...inputStyle, minHeight: 48 }}
									value={fieldValue}
								/>
							) : (
								<input
									onChange={(event) => setter(event.target.value)}
									placeholder={label}
									style={inputStyle}
									value={fieldValue}
								/>
							)}
						</div>
					))}

					{/* Footer alignment toggle */}
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
						<span style={{ fontSize: 10, opacity: 0.72 }}>Footer text align</span>
						<div style={{ display: "flex", gap: 2 }}>
							{(["left", "center", "right"] as TextAlign[]).map((a) => (
								<button
									key={a}
									onClick={() => setTextAlign((prev) => ({ ...prev, footer: a }))}
									style={{
										width: 22,
										height: 20,
										padding: 0,
										fontSize: 11,
										lineHeight: "20px",
										textAlign: "center" as React.CSSProperties["textAlign"],
										border: `1px solid ${border}`,
										borderRadius: 3,
										cursor: "pointer",
										background: textAlign.footer === a ? accent : isDark ? "rgba(255,255,255,0.07)" : "#fff",
										color: textAlign.footer === a ? "#fff" : fg,
									}}
									title={`Footer align ${a}`}>
									{a === "left" ? "⬅" : a === "center" ? "≡" : "➡"}
								</button>
							))}
						</div>
					</div>

					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 6 }}>
						{Object.entries(elements).map(([key, value]) => (
							<label
								key={key}
								style={{
									display: "flex",
									gap: 4,
									alignItems: "center",
									opacity: key === "attribution" && snapshot.basemap.requiresVisibleAttribution ? 0.85 : 1,
								}}>
								<input
									checked={value}
									disabled={key === "attribution" && snapshot.basemap.requiresVisibleAttribution}
									onChange={() => setElements((prev) => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
									type="checkbox"
								/>
								{key === "colorRampLegend"
									? "color ramp legend"
									: key === "watermark"
										? "AI-Hydro watermark"
										: key.replace(/([A-Z])/g, " $1").toLowerCase()}
							</label>
						))}
					</div>

					<div style={{ fontSize: 10, opacity: 0.72, marginBottom: 8 }}>
						Output: {dims.width} x {dims.height}px ({Math.round(dims.pixels / 1_000_000)} MP),{" "}
						{TEMPLATE_PAGES[template].label}
					</div>
				</div>
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
				<button
					disabled={status.kind === "busy"}
					onClick={() => writeExport(true)}
					style={{ ...buttonStyle, background: isDark ? "#334155" : "#475569" }}>
					Quick Export
				</button>
				<button
					disabled={status.kind === "busy" || !readiness.canResearchExport}
					onClick={() => writeExport(false)}
					style={buttonStyle}>
					Research Plate Export
				</button>
			</div>
			<button
				onClick={() =>
					void navigator.clipboard?.writeText(caption || snapshot.citations.map((entry) => entry.text).join(" "))
				}
				style={{ ...buttonStyle, marginTop: 8, background: "transparent", color: fg, border: `1px solid ${border}` }}>
				Copy caption / citations
			</button>
			{status.msg && (
				<div
					style={{
						marginTop: 8,
						fontSize: 11,
						color:
							status.kind === "err"
								? "#f87171"
								: status.kind === "ok"
									? "#7dd3fc"
									: "var(--vscode-descriptionForeground, #999)",
					}}>
					{status.msg}
				</div>
			)}
			{previewExpanded &&
				previewUrl &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						onClick={() => setPreviewExpanded(false)}
						style={{
							position: "fixed",
							inset: 0,
							zIndex: 9999,
							background: "rgba(0,0,0,0.82)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							padding: 18,
						}}>
						<div
							onClick={(event) => event.stopPropagation()}
							style={{
								background: bg,
								border: `1px solid ${border}`,
								borderRadius: 8,
								boxShadow: "0 18px 70px rgba(0,0,0,0.45)",
								width: "min(1180px, 96vw)",
								height: "min(920px, 94vh)",
								display: "flex",
								flexDirection: "column",
								overflow: "hidden",
							}}>
							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									gap: 16,
									alignItems: "center",
									padding: "10px 12px",
									borderBottom: `1px solid ${border}`,
									background: isDark ? "rgba(15,23,42,0.96)" : "rgba(248,250,252,0.96)",
									flexShrink: 0,
								}}>
								<div>
									<div style={{ fontWeight: 700 }}>Export preview</div>
									<div style={{ fontSize: 11, opacity: 0.72 }}>
										{TEMPLATE_LABELS[template]} | {dims.width} x {dims.height}px | Press Esc or click Collapse
										to return to the panel
									</div>
								</div>
								<div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
									<button
										onClick={() => setPreviewScale("fit")}
										style={{
											...buttonStyle,
											width: "auto",
											background: previewScale === "fit" ? accent : "transparent",
											color: previewScale === "fit" ? "#fff" : fg,
											border: `1px solid ${border}`,
										}}>
										Fit
									</button>
									<button
										onClick={() => setPreviewScale("actual")}
										style={{
											...buttonStyle,
											width: "auto",
											background: previewScale === "actual" ? accent : "transparent",
											color: previewScale === "actual" ? "#fff" : fg,
											border: `1px solid ${border}`,
										}}>
										100%
									</button>
									<button
										onClick={() => setPreviewExpanded(false)}
										style={{ ...buttonStyle, width: "auto", background: "#334155" }}>
										Collapse to panel
									</button>
									<button
										aria-label="Close preview"
										onClick={() => setPreviewExpanded(false)}
										style={{
											width: 32,
											height: 32,
											borderRadius: 4,
											border: `1px solid ${border}`,
											background: "transparent",
											color: fg,
											cursor: "pointer",
											fontSize: 20,
											lineHeight: "28px",
										}}>
										x
									</button>
								</div>
							</div>
							<div
								style={{
									flex: 1,
									overflow: "auto",
									padding: 18,
									background: isDark ? "rgba(2,6,23,0.7)" : "rgba(226,232,240,0.9)",
									display: previewScale === "fit" ? "flex" : "block",
									alignItems: "center",
									justifyContent: "center",
								}}>
								<img
									alt="Expanded map export preview"
									src={previewUrl}
									style={
										previewScale === "fit"
											? {
													maxWidth: "100%",
													maxHeight: "100%",
													display: "block",
													boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
												}
											: {
													width: dims.width / 3,
													height: "auto",
													maxWidth: "none",
													display: "block",
													boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
												}
									}
								/>
							</div>
						</div>
					</div>,
					document.body,
				)}
		</div>
	)
}

export default MapExport
