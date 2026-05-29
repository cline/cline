import * as crypto from "node:crypto"
import * as os from "node:os"
import * as path from "node:path"
import type { Controller } from "@core/controller"
import { handleMapAgentTaskMessage } from "@core/map/handleMapAgentTask"
import axios from "axios"
import * as vscode from "vscode"
import { AiHydroEnv } from "@/config"
import { GeeService } from "@/services/gee/GeeService"
import { GeeTileProxyService } from "@/services/gee/GeeTileProxyService"
import { buildGeeMapLayer } from "@/services/gee/mapMessageHandler"
import { geeCommandSchema, geePreviewChirpsPayloadSchema, geeStatusPayloadSchema } from "@/services/gee/schemas"
import type { GeeProjectInfo, GeeStatusResult } from "@/services/gee/types"
import { handleHydroMapCommand } from "@/services/hydrology/handleHydroMapCommand"
import { MarketplaceRecognitionService } from "@/services/recognition/MarketplaceRecognitionService"

function expandHomePath(filePath: string): string {
	if (filePath === "~") {
		return os.homedir()
	}
	if (filePath.startsWith("~/")) {
		return path.join(os.homedir(), filePath.slice(2))
	}
	return filePath
}

const MAP_SUPPORTED_EXTENSIONS = new Set([
	".geojson",
	".json",
	".topojson",
	".kml",
	".kmz",
	".gpx",
	".zip",
	".tif",
	".tiff",
	".csv",
])

const extensionFromUrl = (url: string): string => {
	try {
		return path.extname(new URL(url).pathname).toLowerCase()
	} catch {
		return path.extname(url).toLowerCase()
	}
}

const safeFilename = (value: string, fallback = "map-layer"): string => {
	const cleaned = value
		.replace(/[?#].*$/, "")
		.split("/")
		.pop()
		?.replace(/[^a-zA-Z0-9._-]+/g, "_")
		.replace(/^_+|_+$/g, "")
	return cleaned || fallback
}

const checksum = (bytes: Uint8Array | string): string => crypto.createHash("sha256").update(bytes).digest("hex")

type ResearchGalleryItemType = "map_scene" | "style_preset" | "case_study" | "dataset_connector" | "map_plate_template"
type ResearchGalleryTrustLevel = "official" | "reviewed" | "community" | "local"

interface ResearchGalleryItem {
	id: string
	type: ResearchGalleryItemType
	title: string
	description: string
	version: string
	author: string
	license: string
	trustLevel: ResearchGalleryTrustLevel
	tags: string[]
	thumbnailUrl?: string
	githubUrl?: string
	artifactUrl?: string
	citation: string
	createdAt?: string
	updatedAt?: string
	isFeatured?: boolean
	isInstalled?: boolean
	downloadCount?: number
	aiHydroStars?: number
	starredByClient?: boolean
	contributors?: Array<Record<string, unknown>>
	badges?: string[]
	metrics?: Record<string, unknown>
	discussionUrl?: string
	source?: "remote" | "built_in" | "local"
	importWarnings?: string[]
}

const builtInResearchGalleryArtifacts: Record<string, { fileName: string; content: string }> = {
	"official-small-watershed-scene": {
		fileName: "aihydro_gallery_sample_watershed.geojson",
		content: JSON.stringify({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { name: "Sample watershed", area_km2: 128.4, source: "AI-Hydro Research Gallery" },
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[-86.96, 39.74],
								[-86.72, 39.84],
								[-86.52, 39.69],
								[-86.56, 39.48],
								[-86.82, 39.42],
								[-87.02, 39.56],
								[-86.96, 39.74],
							],
						],
					},
				},
			],
		}),
	},
	"official-stream-order-style-fixture": {
		fileName: "aihydro_gallery_sample_streams.geojson",
		content: JSON.stringify({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { name: "minor drainage", strmOrder: 1, uparea: 12 },
					geometry: {
						type: "LineString",
						coordinates: [
							[-86.98, 39.72],
							[-86.86, 39.62],
							[-86.72, 39.57],
						],
					},
				},
				{
					type: "Feature",
					properties: { name: "medium river", strmOrder: 3, uparea: 220 },
					geometry: {
						type: "LineString",
						coordinates: [
							[-86.72, 39.57],
							[-86.62, 39.54],
							[-86.54, 39.49],
						],
					},
				},
				{
					type: "Feature",
					properties: { name: "major river", strmOrder: 5, uparea: 2100 },
					geometry: {
						type: "LineString",
						coordinates: [
							[-86.9, 39.46],
							[-86.72, 39.57],
							[-86.53, 39.68],
						],
					},
				},
			],
		}),
	},
	"official-station-dataset-connector-fixture": {
		fileName: "aihydro_gallery_sample_stations.csv",
		content:
			"name,lat,lon,drainage_area_km2\nStation A,39.62,-86.82,42\nStation B,39.55,-86.65,118\nStation C,39.70,-86.58,377\n",
	},
}

const builtInResearchGalleryItems: ResearchGalleryItem[] = [
	{
		id: "official-small-watershed-scene",
		type: "map_scene",
		title: "Official small watershed scene",
		description: "Small basin polygon for testing layer load, fit, style, export, and scene save.",
		version: "0.1.0",
		author: "AI-Hydro Team",
		license: "AI-Hydro example data",
		trustLevel: "official",
		tags: ["watershed", "scene", "geojson", "example"],
		artifactUrl: "aihydro-gallery://official-small-watershed-scene",
		citation: "AI-Hydro Research Gallery official example.",
		isFeatured: true,
		source: "built_in",
	},
	{
		id: "official-stream-order-style-fixture",
		type: "style_preset",
		title: "Official stream-order style fixture",
		description: "Stream reaches with order/upstream-area attributes for symbology and legend testing.",
		version: "0.1.0",
		author: "AI-Hydro Team",
		license: "AI-Hydro example data",
		trustLevel: "official",
		tags: ["streams", "symbology", "style", "geojson", "example"],
		artifactUrl: "aihydro-gallery://official-stream-order-style-fixture",
		citation: "AI-Hydro Research Gallery official example.",
		isFeatured: true,
		source: "built_in",
		importWarnings: ["This seed imports sample stream features; full style-preset application is handled by layer styling."],
	},
	{
		id: "official-station-dataset-connector-fixture",
		type: "dataset_connector",
		title: "Official station connector fixture",
		description: "Lat/lon station points for CSV detection and point-layer testing.",
		version: "0.1.0",
		author: "AI-Hydro Team",
		license: "AI-Hydro example data",
		trustLevel: "official",
		tags: ["csv", "stations", "points", "example"],
		artifactUrl: "aihydro-gallery://official-station-dataset-connector-fixture",
		citation: "AI-Hydro Research Gallery official example.",
		isFeatured: true,
		source: "built_in",
	},
]

function geeNeedsProject(result: GeeStatusResult): boolean {
	const text = `${result.message ?? ""}\n${result.error ?? ""}`.toLowerCase()
	return text.includes("project") && (text.includes("registered") || text.includes("serviceusage"))
}

async function promptForGeeProjectAndRetry(operation: "connect" | "status", result: GeeStatusResult): Promise<GeeStatusResult> {
	if (!geeNeedsProject(result)) {
		return result
	}
	const projectId = await chooseGeeProject()
	if (!projectId) {
		return result
	}
	return operation === "connect" ? GeeService.connect(projectId) : GeeService.status(projectId)
}

async function chooseGeeProject(): Promise<string | undefined> {
	const projectsResult = await GeeService.listProjects()
	if (!projectsResult.ok || (projectsResult.projects ?? []).length === 0) {
		const projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: `${projectsResult.message} Enter a Google Cloud project ID registered for Earth Engine.`,
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
		if (!projectId) {
			return undefined
		}
		await vscode.workspace
			.getConfiguration("aihydro.gee")
			.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
		await GeeService.setProject(projectId.trim())
		return projectId.trim()
	}

	const manualItem = {
		label: "$(edit) Enter project ID manually",
		description: "Type your project ID manually",
		project: undefined as GeeProjectInfo | undefined,
	}
	const items = [
		...(projectsResult.projects ?? []).map((project) => ({
			label: project.project_id,
			description: project.name,
			detail: project.project_number ? `Project number: ${project.project_number}` : undefined,
			project,
		})),
		manualItem,
	]
	const selected = await vscode.window.showQuickPick(items, {
		title: "AI-Hydro: Select Google Earth Engine Project",
		placeHolder: "Choose a Google Cloud project registered for Earth Engine",
		ignoreFocusOut: true,
	})
	if (!selected) {
		return undefined
	}
	let projectId = selected.project?.project_id
	if (!projectId) {
		projectId = await vscode.window.showInputBox({
			title: "AI-Hydro: Google Earth Engine Project",
			prompt: "Enter a Google Cloud project ID registered for Earth Engine. AI-Hydro will save it to settings.",
			placeHolder: "my-earthengine-project",
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim().length < 3 ? "Enter a valid Google Cloud project ID." : undefined),
		})
	}
	if (!projectId) {
		return undefined
	}
	await vscode.workspace
		.getConfiguration("aihydro.gee")
		.update("projectId", projectId.trim(), vscode.ConfigurationTarget.Global)
	await GeeService.setProject(projectId.trim())
	return projectId.trim()
}

export class VscodeMapPanelProvider {
	private static currentPanel: vscode.WebviewPanel | undefined
	private static context: vscode.ExtensionContext
	private static controller: Controller | undefined
	private static disposables: vscode.Disposable[] = []

	public static initialize(context: vscode.ExtensionContext, controller: Controller) {
		VscodeMapPanelProvider.context = context
		VscodeMapPanelProvider.controller = controller
	}

	/** Returns true if the map panel is currently open (even if not visible). */
	public static isOpen(): boolean {
		return VscodeMapPanelProvider.currentPanel !== undefined
	}

	/**
	 * Send raw file bytes to the map webview for client-side parsing.
	 * Opens the panel first if it's not already visible.
	 * Kept for small legacy callers. Prefer sendFileUrisToMap for workspace files,
	 * especially binary rasters, to avoid JSON-serializing large byte arrays.
	 */
	public static async sendFilesToMap(files: Array<{ name: string; data: Uint8Array }>): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		// Small delay to let the webview finish mounting before we push data
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const file of files) {
			await panel.webview.postMessage({
				type: "aihydro-load-file",
				name: file.name,
				// Transfer as plain number array so JSON serialization works
				data: Array.from(file.data),
			})
		}
	}

	/**
	 * Send file references to the map webview. The webview fetches each URI as
	 * a Blob and parses it client-side, avoiding the huge number[] payload that
	 * can crash VS Code/webview when loading GeoTIFFs from the file prompt.
	 */
	public static async sendFileUrisToMap(
		uris: vscode.Uri[],
		sourceExtras: Record<string, Record<string, string | number | undefined>> = {},
	): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const panel = VscodeMapPanelProvider.currentPanel
		if (!panel) {
			return
		}
		VscodeMapPanelProvider.allowLocalFileRoots(
			panel,
			uris.map((uri) => vscode.Uri.file(path.dirname(uri.fsPath))),
		)
		await new Promise((resolve) => setTimeout(resolve, 400))
		for (const uri of uris) {
			let stat: vscode.FileStat | undefined
			try {
				stat = await vscode.workspace.fs.stat(uri)
			} catch {
				/* ignore */
			}
			await panel.webview.postMessage({
				type: "aihydro-load-file-uri",
				name: path.basename(uri.fsPath),
				uri: panel.webview.asWebviewUri(uri).toString(),
				sourcePath: uri.fsPath,
				sourceUri: uri.toString(),
				sourceMtimeMs: stat?.mtime,
				sourceSizeBytes: stat?.size,
				...(sourceExtras[uri.fsPath] ?? {}),
			})
		}
	}

	public static async addLayerFromUrl(initialUrl?: string): Promise<void> {
		if (!VscodeMapPanelProvider.context) {
			vscode.window.showWarningMessage("AI-Hydro Map is not ready yet.")
			return
		}
		const url =
			initialUrl ??
			(await vscode.window.showInputBox({
				title: "AI-Hydro Map: Add Layer from URL",
				prompt: "Paste a public GeoJSON, TopoJSON, KML, GPX, CSV, zipped shapefile, or GeoTIFF URL.",
				placeHolder: "https://example.org/layer.geojson",
				ignoreFocusOut: true,
				validateInput: (value) => {
					const trimmed = value.trim()
					if (!/^https?:\/\//i.test(trimmed)) {
						return "Enter an http(s) URL."
					}
					const ext = extensionFromUrl(trimmed)
					if (ext && !MAP_SUPPORTED_EXTENSIONS.has(ext)) {
						return `.${ext.replace(/^\./, "")} is not a supported map layer type yet.`
					}
					return undefined
				},
			}))
		if (!url) {
			return
		}
		const trimmedUrl = url.trim()
		const response = await fetch(trimmedUrl)
		if (!response.ok) {
			vscode.window.showErrorMessage(`AI-Hydro Map: URL failed with HTTP ${response.status}.`)
			return
		}
		const bytes = new Uint8Array(await response.arrayBuffer())
		const ext = extensionFromUrl(trimmedUrl) || ".geojson"
		const name = safeFilename(trimmedUrl, `remote_layer${ext}`)
		const cacheDir = vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, "map-url-cache")
		await vscode.workspace.fs.createDirectory(cacheDir)
		const target = vscode.Uri.joinPath(cacheDir, `${Date.now()}_${name}`)
		await vscode.workspace.fs.writeFile(target, bytes)
		await VscodeMapPanelProvider.sendFileUrisToMap([target], {
			[target.fsPath]: {
				sourceRemoteUrl: trimmedUrl,
				sourceDisplayPath: trimmedUrl,
			},
		})
		vscode.window.showInformationMessage(`AI-Hydro Map: Added ${name} from URL.`)
	}

	public static async openMapGallery(): Promise<void> {
		if (!VscodeMapPanelProvider.context) {
			vscode.window.showWarningMessage("AI-Hydro Map is not ready yet.")
			return
		}
		await VscodeMapPanelProvider.createOrShow()
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-open-research-gallery",
		})
	}

	private static normalizeResearchGalleryItem(item: any, source: "remote" | "built_in" | "local"): ResearchGalleryItem {
		const id = String(item.id || item.galleryId || "")
		const rawType = String(item.type || "dataset_connector")
		const validTypes = new Set<ResearchGalleryItemType>([
			"map_scene",
			"style_preset",
			"dataset_connector",
			"case_study",
			"map_plate_template",
		])
		const type = validTypes.has(rawType as ResearchGalleryItemType)
			? (rawType as ResearchGalleryItemType)
			: "dataset_connector"
		const rawTrust = String(
			item.trustLevel || item.trust_level || item.trust || (source === "built_in" ? "official" : "community"),
		)
		const validTrust = new Set<ResearchGalleryTrustLevel>(["official", "reviewed", "community", "local"])
		const trustLevel = validTrust.has(rawTrust as ResearchGalleryTrustLevel)
			? (rawTrust as ResearchGalleryTrustLevel)
			: "community"
		return {
			id,
			type,
			title: String(item.title || item.name || id || "Untitled gallery item"),
			description: String(item.description || ""),
			version: String(item.version || "0.1.0"),
			author: String(item.author || "Unknown"),
			license: String(item.license || ""),
			trustLevel,
			tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
			thumbnailUrl: item.thumbnailUrl || item.thumbnail_url || "",
			githubUrl: item.githubUrl || item.github_url || "",
			artifactUrl: item.artifactUrl || item.artifact_url || item.downloadUrl || item.download_url || "",
			citation: typeof item.citation === "string" ? item.citation : item.citation?.text || "",
			createdAt: item.createdAt || item.created_at || "",
			updatedAt: item.updatedAt || item.updated_at || "",
			isFeatured: Boolean(item.isFeatured ?? item.is_featured ?? false),
			isInstalled: Boolean(item.isInstalled ?? item.is_installed ?? false),
			downloadCount: Number(item.downloadCount ?? item.download_count ?? 0),
			aiHydroStars: Number(item.aiHydroStars ?? item.ai_hydro_stars ?? item.metrics?.aiHydroStars ?? 0),
			starredByClient: Boolean(item.starredByClient ?? item.starred_by_client ?? false),
			contributors: Array.isArray(item.contributors) ? item.contributors : [],
			badges: Array.isArray(item.badges) ? item.badges.map(String) : [],
			metrics: item.metrics && typeof item.metrics === "object" ? item.metrics : {},
			discussionUrl: item.discussionUrl || item.discussion_url || "",
			source,
			importWarnings: Array.isArray(item.importWarnings ?? item.import_warnings)
				? (item.importWarnings ?? item.import_warnings).map(String)
				: [],
		}
	}

	private static async fetchResearchGalleryCatalog(): Promise<{
		items: ResearchGalleryItem[]
		sourceUrl: string
		warning?: string
	}> {
		const configuredUrl = `${AiHydroEnv.config().researchGalleryBaseUrl}/gallery.json`
		const fallbackUrl = "https://raw.githubusercontent.com/AI-Hydro/Gallery/main/api/gallery.json"
		const candidateUrls = Array.from(new Set([configuredUrl, fallbackUrl]))
		let lastError: unknown
		try {
			for (const sourceUrl of candidateUrls) {
				try {
					const response = await axios.get(sourceUrl, {
						headers: { "Content-Type": "application/json", "User-Agent": "aihydro-vscode-extension" },
						timeout: 10_000,
					})
					const rawItems: any[] = Array.isArray(response.data)
						? response.data
						: Array.isArray(response.data?.items)
							? response.data.items
							: []
					const remoteItems = rawItems
						.map((item) => VscodeMapPanelProvider.normalizeResearchGalleryItem(item, "remote"))
						.filter((item) => item.id && item.title)
					const recognitionCounts = await MarketplaceRecognitionService.getCounts("gallery")
					for (const item of remoteItems) {
						const counts = recognitionCounts.get(item.id)
						if (!counts) continue
						const imports = Number(counts.events.import ?? 0)
						const templateOpens = Number(counts.events.template_open ?? 0)
						const aiHydroStars = Number(counts.aiHydroStars ?? counts.events.star ?? 0)
						item.metrics = {
							...(item.metrics ?? {}),
							installs: imports + templateOpens,
							imports,
							templateOpens,
							aiHydroStars,
						}
						item.downloadCount = imports + templateOpens
						item.aiHydroStars = aiHydroStars
						item.starredByClient = counts.starredByClient
					}
					const builtinIds = new Set(remoteItems.map((item) => item.id))
					const fallbackItems = builtInResearchGalleryItems.filter((item) => !builtinIds.has(item.id))
					return {
						items: [...remoteItems, ...fallbackItems],
						sourceUrl,
						warning:
							sourceUrl !== configuredUrl
								? `GitHub Pages catalog is not available yet; using the live raw GitHub catalog.`
								: undefined,
					}
				} catch (err) {
					lastError = err
				}
			}
			throw lastError
		} catch (err) {
			return {
				items: builtInResearchGalleryItems,
				sourceUrl: configuredUrl,
				warning: `Remote catalog unavailable; showing built-in official seed items. ${err instanceof Error ? err.message : String(err)}`,
			}
		}
	}

	private static async setResearchGalleryStar(panel: vscode.WebviewPanel, requestId: string, itemId: string, starred: boolean) {
		try {
			const result = await MarketplaceRecognitionService.setStar("gallery", itemId, starred)
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-star-result",
				requestId,
				ok: true,
				itemId: result.itemId,
				starred: result.starred,
				aiHydroStars: result.aiHydroStars,
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-star-result",
				requestId,
				ok: false,
				itemId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	private static async importResearchGalleryItem(panel: vscode.WebviewPanel, requestId: string, item: ResearchGalleryItem) {
		try {
			if (!VscodeMapPanelProvider.context) {
				throw new Error("AI-Hydro Map is not ready yet.")
			}
			if (item.type === "map_plate_template") {
				void MarketplaceRecognitionService.recordEvent({
					marketplace: "gallery",
					itemId: item.id,
					eventType: "template_open",
					itemType: item.type,
					itemVersion: item.version,
					source: "ui",
				})
				await panel.webview.postMessage({
					type: "aihydro-open-export-panel",
				})
				await panel.webview.postMessage({
					type: "aihydro-research-gallery-import-result",
					requestId,
					ok: true,
					openExport: true,
					message: `Opened Research Plate Export for ${item.title}. Template-specific presets will be attached when template manifests are available.`,
				})
				return
			}

			const artifact = builtInResearchGalleryArtifacts[item.id]
			const artifactUrl = item.artifactUrl ?? ""
			let fileName = artifact?.fileName || safeFilename(artifactUrl, `${item.id}.geojson`)
			let bytes: Uint8Array
			if (artifact) {
				bytes = Buffer.from(artifact.content, "utf8")
			} else {
				if (!/^https?:\/\//i.test(artifactUrl)) {
					throw new Error("Gallery item does not provide an importable artifact URL.")
				}
				const response = await axios.get(artifactUrl, { responseType: "arraybuffer", timeout: 30_000 })
				bytes = new Uint8Array(response.data)
				fileName = safeFilename(artifactUrl, fileName)
			}

			const galleryDir = vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, "research-gallery", item.id)
			await vscode.workspace.fs.createDirectory(galleryDir)
			const target = vscode.Uri.joinPath(galleryDir, fileName)
			await vscode.workspace.fs.writeFile(target, bytes)

			const text = Buffer.from(bytes).toString("utf8")
			const parsed = (() => {
				try {
					return JSON.parse(text)
				} catch {
					return undefined
				}
			})()
			if (parsed?.artifactType === "ai-hydro.map-scene") {
				await panel.webview.postMessage({
					type: "aihydro-open-map-scene",
					name: fileName,
					scene: text,
				})
			} else {
				await VscodeMapPanelProvider.sendFileUrisToMap([target], {
					[target.fsPath]: {
						sourceRemoteUrl: artifactUrl || `aihydro-gallery://${item.id}`,
						sourceDisplayPath: `AI-Hydro Research Gallery: ${item.title}`,
					},
				})
			}

			await panel.webview.postMessage({
				type: "aihydro-research-gallery-import-result",
				requestId,
				ok: true,
				message: `Imported ${item.title} from Research Gallery.`,
				itemId: item.id,
				path: target.fsPath,
				sha256: checksum(bytes),
			})
			void MarketplaceRecognitionService.recordEvent({
				marketplace: "gallery",
				itemId: item.id,
				eventType: "import",
				itemType: item.type,
				itemVersion: item.version,
				source: "ui",
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-import-result",
				requestId,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
				itemId: item?.id,
			})
		}
	}

	private static async postResearchGalleryCatalog(panel: vscode.WebviewPanel, requestId: string) {
		try {
			const catalog = await VscodeMapPanelProvider.fetchResearchGalleryCatalog()
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-catalog-result",
				requestId,
				ok: true,
				items: catalog.items,
				sourceUrl: catalog.sourceUrl,
				warning: catalog.warning,
			})
		} catch (err) {
			await panel.webview.postMessage({
				type: "aihydro-research-gallery-catalog-result",
				requestId,
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	private static async openExternalUrl(url: string): Promise<void> {
		if (!/^https?:\/\//i.test(url)) {
			vscode.window.showWarningMessage("AI-Hydro Map: only http(s) URLs can be opened externally.")
			return
		}
		await vscode.env.openExternal(vscode.Uri.parse(url))
	}

	public static async requestSaveMapScene(): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-map-save-scene-request",
		})
	}

	public static async openMapScene(): Promise<void> {
		await VscodeMapPanelProvider.createOrShow()
		const picked = await vscode.window.showOpenDialog({
			title: "AI-Hydro Map: Open Scene",
			canSelectMany: false,
			filters: { "AI-Hydro Map Scene": ["aihydro-map.json", "json"] },
		})
		const uri = picked?.[0]
		if (!uri) {
			return
		}
		const bytes = await vscode.workspace.fs.readFile(uri)
		await VscodeMapPanelProvider.currentPanel?.webview.postMessage({
			type: "aihydro-open-map-scene",
			name: path.basename(uri.fsPath),
			scene: Buffer.from(bytes).toString("utf8"),
		})
	}

	public static async notifyFileSaved(uri: vscode.Uri): Promise<void> {
		if (!VscodeMapPanelProvider.currentPanel || uri.scheme !== "file") {
			return
		}
		const ext = path.extname(uri.fsPath).toLowerCase()
		if (!MAP_SUPPORTED_EXTENSIONS.has(ext)) {
			return
		}
		let stat: vscode.FileStat | undefined
		try {
			stat = await vscode.workspace.fs.stat(uri)
		} catch {
			/* ignore */
		}
		await VscodeMapPanelProvider.currentPanel.webview.postMessage({
			type: "aihydro-source-file-saved",
			path: uri.fsPath,
			uri: uri.toString(),
			mtimeMs: stat?.mtime,
			sizeBytes: stat?.size,
		})
	}

	private static allowLocalFileRoots(panel: vscode.WebviewPanel, roots: vscode.Uri[]): void {
		const existing = panel.webview.options.localResourceRoots ?? []
		const next = [...existing]
		const seen = new Set(existing.map((uri) => uri.toString()))
		for (const root of roots) {
			const key = root.toString()
			if (!seen.has(key)) {
				seen.add(key)
				next.push(root)
			}
		}
		panel.webview.options = {
			...panel.webview.options,
			localResourceRoots: next,
		}
	}

	public static async createOrShow() {
		if (!VscodeMapPanelProvider.context) {
			console.warn("[VscodeMapPanelProvider] Not yet initialized — cannot open map panel")
			return
		}

		const column = vscode.ViewColumn.Two

		// If we already have a panel, show it
		if (VscodeMapPanelProvider.currentPanel) {
			VscodeMapPanelProvider.currentPanel.reveal(column)
			return
		}

		// Otherwise, create a new panel
		const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []
		const panel = vscode.window.createWebviewPanel("aihydroMapView", "AI-Hydro Map", column, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build"),
				...workspaceRoots,
			],
		})

		VscodeMapPanelProvider.currentPanel = panel

		// Set the webview's HTML content
		panel.webview.html = VscodeMapPanelProvider.getHtmlForWebview(panel.webview)

		// CRITICAL: Set up message handler so this panel can communicate with the extension
		VscodeMapPanelProvider.setupMessageHandler(panel)

		// Handle disposal
		panel.onDidDispose(
			() => {
				VscodeMapPanelProvider.currentPanel = undefined
				// Clean up disposables
				while (VscodeMapPanelProvider.disposables.length) {
					const x = VscodeMapPanelProvider.disposables.pop()
					if (x) {
						x.dispose()
					}
				}
			},
			null,
			[],
		)
	}

	/**
	 * Sets up message handling between the webview panel and the extension
	 * This allows the map panel to receive layer updates from the backend
	 */
	private static setupMessageHandler(panel: vscode.WebviewPanel) {
		const { WebviewProvider } = require("@core/webview")
		const { handleGrpcRequest, handleGrpcRequestCancel } = require("@/core/controller/grpc-handler")

		// Get the main webview instance to access the controller
		const mainWebview = WebviewProvider.getInstance()
		if (!mainWebview) {
			console.error("[VscodeMapPanelProvider] Cannot set up message handler: no main webview instance")
			return
		}

		// Set up message listener for this panel
		panel.webview.onDidReceiveMessage(
			async (message) => {
				const postMessageToWebview = (response: any) => panel.webview.postMessage(response)

				switch (message.type) {
					case "grpc_request": {
						if (message.grpc_request) {
							await handleGrpcRequest(mainWebview.controller, postMessageToWebview, message.grpc_request)
						}
						break
					}
					case "grpc_request_cancel": {
						if (message.grpc_request_cancel) {
							await handleGrpcRequestCancel(postMessageToWebview, message.grpc_request_cancel)
						}
						break
					}
					case "aihydro-hydro-command": {
						if (mainWebview?.controller) {
							await handleHydroMapCommand(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-map-agent-task": {
						if (mainWebview?.controller) {
							await handleMapAgentTaskMessage(mainWebview.controller, message, async (response) => {
								await postMessageToWebview(response)
							})
						}
						break
					}
					case "aihydro-resolve-file-uri": {
						const requestId = message.requestId
						const filePath = typeof message.path === "string" ? expandHomePath(message.path) : ""
						try {
							if (!filePath) {
								throw new Error("Missing file path")
							}
							const uri = vscode.Uri.file(filePath)
							VscodeMapPanelProvider.allowLocalFileRoots(panel, [vscode.Uri.file(path.dirname(uri.fsPath))])
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: true,
								name: path.basename(uri.fsPath),
								uri: panel.webview.asWebviewUri(uri).toString(),
							})
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-resolve-file-uri-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-open-source-file": {
						const filePath = typeof message.path === "string" ? expandHomePath(message.path) : ""
						try {
							if (!filePath) {
								throw new Error("Missing source file path")
							}
							const uri = vscode.Uri.file(filePath)
							await vscode.window.showTextDocument(uri, { preview: false })
						} catch (err) {
							vscode.window.showWarningMessage(
								`AI-Hydro Map: Could not open source file: ${err instanceof Error ? err.message : String(err)}`,
							)
						}
						break
					}
					case "aihydro-map-add-url-command": {
						await VscodeMapPanelProvider.addLayerFromUrl()
						break
					}
					case "aihydro-map-gallery-command": {
						await VscodeMapPanelProvider.openMapGallery()
						break
					}
					case "aihydro-research-gallery-catalog": {
						await VscodeMapPanelProvider.postResearchGalleryCatalog(panel, String(message.requestId ?? ""))
						break
					}
					case "aihydro-research-gallery-import": {
						await VscodeMapPanelProvider.importResearchGalleryItem(
							panel,
							String(message.requestId ?? ""),
							message.item as ResearchGalleryItem,
						)
						break
					}
					case "aihydro-research-gallery-star": {
						await VscodeMapPanelProvider.setResearchGalleryStar(
							panel,
							String(message.requestId ?? ""),
							String(message.itemId ?? ""),
							Boolean(message.starred),
						)
						break
					}
					case "openExternal": {
						await VscodeMapPanelProvider.openExternalUrl(String(message.url ?? ""))
						break
					}
					case "aihydro-map-save-scene-command": {
						await VscodeMapPanelProvider.requestSaveMapScene()
						break
					}
					case "aihydro-map-open-scene-command": {
						await VscodeMapPanelProvider.openMapScene()
						break
					}
					case "aihydro-write-derived-geojson": {
						const requestId = message.requestId
						try {
							const workspaceRoot =
								vscode.workspace.workspaceFolders?.[0]?.uri ?? VscodeMapPanelProvider.context.globalStorageUri
							const derivedDir = vscode.Uri.joinPath(workspaceRoot, ".aihydro", "map-derived")
							await vscode.workspace.fs.createDirectory(derivedDir)
							const baseName = safeFilename(String(message.name ?? "layer.geojson"), "layer.geojson").replace(
								/\.(geojson|json)$/i,
								"",
							)
							const geojson = typeof message.geojson === "string" ? message.geojson : ""
							if (!geojson) {
								throw new Error("No GeoJSON payload")
							}
							const featureCount = (() => {
								try {
									const parsed = JSON.parse(geojson)
									return parsed?.type === "FeatureCollection" && Array.isArray(parsed.features)
										? parsed.features.length
										: undefined
								} catch {
									return undefined
								}
							})()
							const artifactPath = vscode.Uri.joinPath(derivedDir, `${baseName}.geojson`)
							const provenancePath = vscode.Uri.joinPath(derivedDir, `${baseName}.provenance.json`)
							const geojsonBytes = Buffer.from(geojson, "utf8")
							await vscode.workspace.fs.writeFile(artifactPath, geojsonBytes)
							const provenance = {
								schemaVersion: "1.0",
								artifactType: "ai-hydro.map-derived-vector",
								generatedAtUtc: new Date().toISOString(),
								source: message.source ?? null,
								format: message.format ?? null,
								featureCount,
								artifactPath: artifactPath.fsPath,
								sha256: checksum(geojsonBytes),
								warnings: Array.isArray(message.warnings) ? message.warnings : [],
							}
							await vscode.workspace.fs.writeFile(
								provenancePath,
								Buffer.from(JSON.stringify(provenance, null, 2), "utf8"),
							)
							await panel.webview.postMessage({
								type: "aihydro-write-derived-geojson-result",
								requestId,
								ok: true,
								artifactPath: artifactPath.fsPath,
								provenancePath: provenancePath.fsPath,
							})
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-write-derived-geojson-result",
								requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-save-map-scene": {
						try {
							const scene =
								typeof message.scene === "string" ? message.scene : JSON.stringify(message.scene ?? {}, null, 2)
							const defaultName = `ai-hydro-map-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.aihydro-map.json`
							const target = await vscode.window.showSaveDialog({
								title: "AI-Hydro Map: Save Scene",
								defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
									? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, defaultName)
									: vscode.Uri.joinPath(VscodeMapPanelProvider.context.globalStorageUri, defaultName),
								filters: { "AI-Hydro Map Scene": ["aihydro-map.json", "json"] },
							})
							if (!target) {
								await panel.webview.postMessage({
									type: "aihydro-save-map-scene-result",
									ok: false,
									cancelled: true,
									message: "Save cancelled.",
								})
								break
							}
							const bytes = Buffer.from(scene, "utf8")
							await vscode.workspace.fs.writeFile(target, bytes)
							await panel.webview.postMessage({
								type: "aihydro-save-map-scene-result",
								ok: true,
								path: target.fsPath,
								sha256: checksum(bytes),
							})
							vscode.window.showInformationMessage(`AI-Hydro Map scene saved: ${target.fsPath}`)
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-save-map-scene-result",
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					case "aihydro-gee-command": {
						try {
							const parsed = geeCommandSchema.parse(message)
							const requestId = parsed.requestId
							if (parsed.command === "connect") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.connect(payload?.projectId)
								result = await promptForGeeProjectAndRetry("connect", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "status") {
								const payload = geeStatusPayloadSchema.parse(parsed.payload)
								let result = await GeeService.status(payload?.projectId)
								result = await promptForGeeProjectAndRetry("status", result)
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message,
									result,
								})
							} else if (parsed.command === "chooseProject") {
								const projectId = await chooseGeeProject()
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: Boolean(projectId),
									message: projectId ? `Saved GEE project: ${projectId}` : "No GEE project selected",
									result: { ok: Boolean(projectId), project_id: projectId },
								})
							} else if (parsed.command === "previewChirpsLayer") {
								const payload = geePreviewChirpsPayloadSchema.parse(parsed.payload ?? {})
								const result = await GeeService.previewChirpsLayer(payload)
								if (result.ok && (result.tile_url_template || result.tile_url)) {
									const remoteTemplate = result.tile_url_template || result.tile_url || ""
									const proxiedTemplate = await GeeTileProxyService.proxify(remoteTemplate)
									const layer = buildGeeMapLayer(
										{
											...result,
											tile_url: proxiedTemplate,
											tile_url_template: proxiedTemplate,
											remote_tile_url_template: remoteTemplate,
										} as any,
										(result as any).provenance_path,
									)
									mainWebview.controller.addMapLayer(layer)
								}
								await panel.webview.postMessage({
									type: "aihydro-gee-result",
									requestId,
									ok: result.ok,
									message: result.message || (result.ok ? "CHIRPS layer added" : "CHIRPS layer failed"),
									result,
									error: result.error,
								})
							}
						} catch (err) {
							await panel.webview.postMessage({
								type: "aihydro-gee-result",
								requestId: message.requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							})
						}
						break
					}
					default: {
						console.error("[VscodeMapPanelProvider] Received unhandled message type:", JSON.stringify(message))
					}
				}
			},
			null,
			VscodeMapPanelProvider.disposables,
		)
	}

	private static getHtmlForWebview(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.js"),
		)
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(VscodeMapPanelProvider.context.extensionUri, "webview-ui", "build", "assets", "index.css"),
		)

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce()

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none';
		style-src ${webview.cspSource} 'unsafe-inline';
		script-src 'nonce-${nonce}';
		img-src ${webview.cspSource} https: data: blob:;
		font-src ${webview.cspSource} https: data:;
		connect-src https: http://127.0.0.1:* http://localhost:* ${webview.cspSource};
		worker-src blob:;">
	<link href="${styleUri}" rel="stylesheet">
	<title>AI-Hydro Map</title>
	<style>
		body {
			margin: 0;
			padding: 0;
			overflow: hidden;
			width: 100vw;
			height: 100vh;
		}
		#root {
			width: 100%;
			height: 100%;
		}
		.map-standalone {
			width: 100%;
			height: 100%;
		}
	</style>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}">
		// Set standalone map mode flag
		window.AIHYDRO_MAP_STANDALONE = true;
	</script>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
	}
}

function getNonce() {
	let text = ""
	const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length))
	}
	return text
}
