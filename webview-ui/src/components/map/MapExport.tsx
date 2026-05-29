import type { MapViewState } from "@deck.gl/core"
import type { MapLayer } from "@shared/proto/cline/map"
import { MapExportArtifact, PrepareMapExportRequest, SaveMapExportRequest } from "@shared/proto/cline/map"
import { jsPDF } from "jspdf"
import React, { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { MapServiceClient } from "../../services/grpc-client"
import { BASE_MAP_STYLES } from "./BaseMapSelector"
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

interface MapExportProps {
	mapStyle?: "dark" | "light"
	onClose?: () => void
	layers?: MapLayer[]
	visibleLayerIds?: Set<string>
	viewState?: MapViewState
	currentBasemap?: string
}

interface MapPlateSpec {
	template: ExportTemplate
	formats: ExportFormat[]
	dpi: ExportDpi
	extentStrategy: ExtentStrategy
	text: {
		title: string
		subtitle: string
		caption: string
		authorProject: string
		notes: string
	}
	elements: {
		legend: boolean
		scaleBar: boolean
		northArrow: boolean
		attribution: boolean
		bounds: boolean
		provenanceFooter: boolean
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
		visible: boolean
		opacity?: number
		exportSupport: "verified" | "capture-only" | "unsupported"
		sourceRef?: string
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
type LegendPlacement = "side" | "inset-tr" | "inset-bl" | "none"

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
		description: "Two-column journal figure (7.2 × 4.8 in). Inset legend, long caption band.",
		page: { label: "Double-column figure", widthIn: 7.2, heightIn: 4.8 },
		marginFrac: 0.035,
		titleBandFrac: 0.055,
		footerBandFrac: 0.14,
		legendWidthFrac: 0,
		legendPlacement: "inset-tr",
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
		legendPlacement: "inset-tr",
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
		description: "Full-page portrait plate (6.5 × 9 in). Map over caption, inset legend.",
		page: { label: "Full-page portrait plate", widthIn: 6.5, heightIn: 9 },
		marginFrac: 0.045,
		titleBandFrac: 0.07,
		footerBandFrac: 0.1,
		legendWidthFrac: 0,
		legendPlacement: "inset-tr",
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
		description: "US Letter portrait (8.5 × 11 in). Inset legend, tall map area.",
		page: { label: "Letter portrait", widthIn: 8.5, heightIn: 11 },
		marginFrac: 0.05,
		titleBandFrac: 0.085,
		footerBandFrac: 0.07,
		legendWidthFrac: 0,
		legendPlacement: "inset-tr",
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
		description: "Square 1:1 tile (8 × 8 in) for web and social. Banner title, inset legend.",
		page: { label: "Square tile", widthIn: 8, heightIn: 8 },
		marginFrac: 0.035,
		titleBandFrac: 0.1,
		footerBandFrac: 0.05,
		legendWidthFrac: 0,
		legendPlacement: "inset-tr",
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
	if (type.includes("gee") || source.includes("gee")) return "gee"
	if (type.includes("raster")) return "raster"
	if (source.includes("merit") || layer.name.toLowerCase().includes("merit")) return "hydrography"
	return type || "vector"
}

function layerSupport(layer: MapLayer): "verified" | "capture-only" | "unsupported" {
	const kind = layerKind(layer)
	if (kind === "gee" || kind === "raster") return "capture-only"
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
		if (p * magnitude >= rawKm) return p * magnitude
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
): number {
	const words = text.split(/\s+/).filter(Boolean)
	let line = ""
	let cursorY = y
	for (const word of words) {
		const next = line ? `${line} ${word}` : word
		if (ctx.measureText(next).width > maxWidth && line) {
			ctx.fillText(line, x, cursorY)
			cursorY += lineHeight
			line = word
		} else {
			line = next
		}
	}
	if (line) {
		ctx.fillText(line, x, cursorY)
		cursorY += lineHeight
	}
	return cursorY
}

function drawLegend(ctx: CanvasRenderingContext2D, snapshot: MapSceneSnapshot, x: number, y: number, width: number): number {
	ctx.save()
	ctx.fillStyle = "rgba(255,255,255,0.92)"
	ctx.strokeStyle = "rgba(34,45,55,0.28)"
	ctx.lineWidth = 1
	const lineHeight = 18
	const rows = Math.max(1, Math.min(8, snapshot.layers.length))
	const height = 34 + rows * lineHeight
	ctx.fillRect(x, y, width, height)
	ctx.strokeRect(x, y, width, height)
	ctx.fillStyle = "#1f2933"
	ctx.font = "700 13px system-ui, sans-serif"
	ctx.fillText("Legend", x + 12, y + 20)
	ctx.font = "12px system-ui, sans-serif"
	let cursorY = y + 42
	for (const layer of snapshot.layers.slice(0, 8)) {
		const color = layer.label.toLowerCase().includes("river")
			? "#0ea5e9"
			: layer.label.toLowerCase().includes("catchment")
				? "#0f766e"
				: "#d97706"
		ctx.strokeStyle = color
		ctx.fillStyle =
			layer.kind === "hydrography" && layer.label.toLowerCase().includes("catchment") ? "rgba(20,184,166,0.25)" : color
		if (layer.label.toLowerCase().includes("catchment") || layer.kind.includes("polygon")) {
			ctx.fillRect(x + 12, cursorY - 10, 18, 10)
			ctx.strokeRect(x + 12, cursorY - 10, 18, 10)
		} else {
			ctx.lineWidth = layer.label.toLowerCase().includes("river") ? 4 : 2
			ctx.beginPath()
			ctx.moveTo(x + 12, cursorY - 5)
			ctx.lineTo(x + 31, cursorY - 5)
			ctx.stroke()
		}
		ctx.fillStyle = "#1f2933"
		ctx.fillText(layer.label.slice(0, 34), x + 40, cursorY - 1)
		cursorY += lineHeight
	}
	ctx.restore()
	return y + height
}

function drawScaleBar(
	ctx: CanvasRenderingContext2D,
	view: MapSceneSnapshot["view"],
	x: number,
	y: number,
	mapFrameWidthPx: number,
): void {
	const kmPerScreenPx = (156543.03392 * Math.cos((view.latitude * Math.PI) / 180)) / 1000 / 2 ** view.zoom
	const targetPx = Math.min(180, mapFrameWidthPx * 0.22)
	const km = niceScaleKm(targetPx * kmPerScreenPx)
	const px = Math.max(40, km / kmPerScreenPx)
	ctx.save()
	ctx.strokeStyle = "#1f2933"
	ctx.fillStyle = "#1f2933"
	ctx.lineWidth = 3
	ctx.beginPath()
	ctx.moveTo(x, y)
	ctx.lineTo(x + px, y)
	ctx.moveTo(x, y - 7)
	ctx.lineTo(x, y + 7)
	ctx.moveTo(x + px, y - 7)
	ctx.lineTo(x + px, y + 7)
	ctx.stroke()
	ctx.font = "12px system-ui, sans-serif"
	ctx.fillText(`${km >= 1 ? km.toLocaleString(undefined, { maximumFractionDigits: 0 }) : km.toFixed(1)} km`, x + px + 10, y + 4)
	ctx.restore()
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
	ctx.save()
	ctx.fillStyle = "#1f2933"
	ctx.strokeStyle = "#1f2933"
	ctx.beginPath()
	ctx.moveTo(x, y - 28)
	ctx.lineTo(x - 10, y + 6)
	ctx.lineTo(x, y)
	ctx.lineTo(x + 10, y + 6)
	ctx.closePath()
	ctx.fill()
	ctx.font = "700 13px system-ui, sans-serif"
	ctx.fillText("N", x - 5, y - 36)
	ctx.restore()
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
	if (!ctx) throw new Error("Unable to create export canvas")

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

	const mapX = margin
	const mapY = cfg.mapAtTop ? margin : margin + titleBand
	const mapW = dims.width - margin * 2 - legendWidth - legendGutter
	const mapH = dims.height - mapY - footerBand - margin

	// ── Title ────────────────────────────────────────────────────────────────
	if (cfg.titleStyle === "banner") {
		const bannerH = cfg.mapAtTop ? Math.round(titleBand * 0.9) : titleBand
		ctx.fillStyle = cfg.accent
		ctx.fillRect(0, 0, dims.width, bannerH)
		ctx.fillStyle = "#f8fafc"
		ctx.font = `${cfg.titleWeight} ${Math.max(22, Math.round(dims.width * cfg.titleSizeFrac))}px system-ui, sans-serif`
		ctx.fillText(spec.text.title || "AI-Hydro Map Plate", margin, Math.round(bannerH * 0.42))
		if (spec.text.subtitle) {
			ctx.font = `500 ${Math.max(13, Math.round(dims.width * cfg.titleSizeFrac * 0.5))}px system-ui, sans-serif`
			ctx.fillStyle = "#cbd5e1"
			ctx.fillText(spec.text.subtitle, margin, Math.round(bannerH * 0.74))
		}
	} else if (cfg.titleStyle === "plain") {
		ctx.fillStyle = cfg.accent
		ctx.font = `${cfg.titleWeight} ${Math.max(15, Math.round(dims.width * cfg.titleSizeFrac))}px system-ui, sans-serif`
		ctx.fillText(spec.text.title || "AI-Hydro Map Plate", margin, margin + Math.round(titleBand * 0.4))
		if (spec.text.subtitle) {
			ctx.font = `${Math.max(11, Math.round(dims.width * cfg.titleSizeFrac * 0.72))}px system-ui, sans-serif`
			ctx.fillStyle = "#4b5563"
			ctx.fillText(spec.text.subtitle, margin, margin + Math.round(titleBand * 0.72))
		}
		// Thin accent rule under the title band.
		ctx.strokeStyle = "#d1d5db"
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.moveTo(margin, margin + titleBand - Math.round(titleBand * 0.08))
		ctx.lineTo(dims.width - margin, margin + titleBand - Math.round(titleBand * 0.08))
		ctx.stroke()
	}

	ctx.drawImage(mapCanvas, mapX, mapY, mapW, mapH)
	if (cfg.frame) {
		ctx.strokeStyle = "#111827"
		ctx.lineWidth = 2
		ctx.strokeRect(mapX, mapY, mapW, mapH)
	}

	// ── Legend ───────────────────────────────────────────────────────────────
	if (spec.elements.legend) {
		if (cfg.legendPlacement === "side" && legendWidth) {
			drawLegend(ctx, snapshot, mapX + mapW + legendGutter, mapY, legendWidth)
		} else if (cfg.legendPlacement === "inset-tr") {
			const w = Math.round(dims.width * 0.24)
			drawLegend(ctx, snapshot, mapX + mapW - w - 12, mapY + 12, w)
		} else if (cfg.legendPlacement === "inset-bl") {
			const w = Math.round(dims.width * 0.26)
			drawLegend(ctx, snapshot, mapX + 18, mapY + mapH - Math.round(dims.height * 0.2), w)
		}
	}
	if (spec.elements.scaleBar) {
		drawScaleBar(ctx, snapshot.view, mapX + 24, mapY + mapH - 30, mapW)
	}
	if (spec.elements.northArrow) {
		drawNorthArrow(ctx, mapX + mapW - 34, mapY + 54)
	}

	let footerY = mapY + mapH + Math.round(footerBand * 0.35)
	ctx.fillStyle = "#374151"
	ctx.font = `${Math.max(10, Math.round(dims.width * 0.0075))}px system-ui, sans-serif`
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
	footerY = drawText(
		ctx,
		footerText.join(" | "),
		margin,
		footerY,
		dims.width - margin * 2,
		Math.max(14, Math.round(dims.width * 0.008)),
	)
	if (spec.text.caption && cfg.showCaption) {
		ctx.fillStyle = "#111827"
		ctx.font = `${Math.max(10, Math.round(dims.width * 0.007))}px system-ui, sans-serif`
		drawText(
			ctx,
			spec.text.caption,
			margin,
			footerY + 4,
			dims.width - margin * 2,
			Math.max(14, Math.round(dims.width * 0.008)),
		)
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
	const [title, setTitle] = useState("AI-Hydro Map Plate")
	const [subtitle, setSubtitle] = useState("")
	const [caption, setCaption] = useState("")
	const [authorProject, setAuthorProject] = useState("")
	const [notes, setNotes] = useState("")
	const [elements, setElements] = useState<MapPlateSpec["elements"]>({
		legend: true,
		scaleBar: true,
		northArrow: true,
		attribution: true,
		bounds: true,
		provenanceFooter: true,
	})
	const [status, setStatus] = useState<{ kind: "idle" | "busy" | "ok" | "err"; msg: string }>({ kind: "idle", msg: "" })
	const [previewUrl, setPreviewUrl] = useState<string>("")
	const [previewExpanded, setPreviewExpanded] = useState(false)
	const [previewScale, setPreviewScale] = useState<"fit" | "actual">("fit")
	const [previewStatus, setPreviewStatus] = useState<{ kind: "idle" | "busy" | "err"; msg: string }>({ kind: "idle", msg: "" })

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl)
			}
		}
	}, [previewUrl])

	useEffect(() => {
		if (!previewExpanded) return
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
			text: { title, subtitle, caption, authorProject, notes },
			elements,
		}),
		[template, formats, dpi, extentStrategy, title, subtitle, caption, authorProject, notes, elements],
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
				if (previous) URL.revokeObjectURL(previous)
				return nextUrl
			})
			setPreviewStatus({ kind: "idle", msg: "Preview ready." })
		} catch (error) {
			setPreviewStatus({ kind: "err", msg: error instanceof Error ? error.message : String(error) })
		}
	}

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
								Refresh preview
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
								Click Refresh preview to see the plate layout before exporting.
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
					</div>
					<div style={{ display: "flex", gap: 8, margin: "6px 0 8px", flexWrap: "wrap" }}>
						{(["png", "pdf"] as ExportFormat[]).map((format) => (
							<label key={format} style={{ display: "flex", gap: 4, alignItems: "center" }}>
								<input checked={formats.includes(format)} onChange={() => toggleFormat(format)} type="checkbox" />
								{format === "pdf" ? "PDF (slower)" : "PNG"}
							</label>
						))}
					</div>
					<input
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Title"
						style={{ ...inputStyle, marginBottom: 6 }}
						value={title}
					/>
					<input
						onChange={(event) => setSubtitle(event.target.value)}
						placeholder="Subtitle"
						style={{ ...inputStyle, marginBottom: 6 }}
						value={subtitle}
					/>
					<textarea
						onChange={(event) => setCaption(event.target.value)}
						placeholder="Caption"
						style={{ ...inputStyle, minHeight: 48, marginBottom: 6 }}
						value={caption}
					/>
					<input
						onChange={(event) => setAuthorProject(event.target.value)}
						placeholder="Author / project"
						style={{ ...inputStyle, marginBottom: 6 }}
						value={authorProject}
					/>
					<input
						onChange={(event) => setNotes(event.target.value)}
						placeholder="Notes"
						style={{ ...inputStyle, marginBottom: 8 }}
						value={notes}
					/>

					<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 8 }}>
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
								{key.replace(/([A-Z])/g, " $1").toLowerCase()}
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
