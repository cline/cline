import { exec, spawn } from "node:child_process"
import * as path from "node:path"
import { promisify } from "node:util"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import type {
	DelineatePointResult,
	HucAtPointResult,
	MeritEnsureBasinResult,
	MeritEnsureRegionResult,
	MeritLayersResult,
	MeritPresetsResult,
	SearchHydrologyResult,
} from "./types"

const execAsync = promisify(exec)

interface HydroRunResult<T = Record<string, unknown>> {
	ok: boolean
	result?: T
	error?: string
	raw?: string
}

const AIHYDRO_TOOLS_SRC = path.join(process.env.HOME || "", "Documents", "AI-Hydro", "MCP", "aihydro-tools")

export class MapHydrologyService {
	private static _cachedPythonCmd: string | undefined
	private static _detectingPromise: Promise<string> | undefined

	private static getConfiguredPythonCommand(): string {
		const config = vscode.workspace.getConfiguration("aihydro.hydro")
		return config.get<string>("pythonPath") || "python3"
	}

	static invalidatePythonCache(): void {
		MapHydrologyService._cachedPythonCmd = undefined
		MapHydrologyService._detectingPromise = undefined
	}

	private static async canImportAiHydro(pythonCmd: string): Promise<boolean> {
		try {
			await execAsync(`"${pythonCmd}" -c "import ai_hydro.hydro_map_cli"`, { timeout: 8000 })
			return true
		} catch {
			return false
		}
	}

	private static resolvePythonCommandAsync(): Promise<string> {
		if (MapHydrologyService._cachedPythonCmd) {
			return Promise.resolve(MapHydrologyService._cachedPythonCmd)
		}
		if (MapHydrologyService._detectingPromise) {
			return MapHydrologyService._detectingPromise
		}
		MapHydrologyService._detectingPromise = (async () => {
			const configured = MapHydrologyService.getConfiguredPythonCommand().trim()
			const candidates = ["/opt/miniconda3/bin/python", "/opt/homebrew/bin/python3", configured, "python3", "python"]
			const seen = new Set<string>()
			for (const c of candidates) {
				if (!c || seen.has(c)) continue
				seen.add(c)
				if (await MapHydrologyService.canImportAiHydro(c)) {
					MapHydrologyService._cachedPythonCmd = c
					MapHydrologyService._detectingPromise = undefined
					return c
				}
			}
			const fallback = configured || "python3"
			MapHydrologyService._cachedPythonCmd = fallback
			MapHydrologyService._detectingPromise = undefined
			return fallback
		})()
		return MapHydrologyService._detectingPromise
	}

	private static async getWorkspaceRoot(): Promise<string> {
		try {
			const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
			return workspacePaths.paths[0] || process.cwd()
		} catch {
			return process.cwd()
		}
	}

	private static async runHydroCli(args: string[], timeoutMs = 600_000): Promise<HydroRunResult> {
		const pythonCmd = await MapHydrologyService.resolvePythonCommandAsync()
		const extensionRoot = HostProvider.get().extensionFsPath
		const pyPath = path.join(extensionRoot, "python")
		const toolsSrc = AIHYDRO_TOOLS_SRC
		const pythonPath = [toolsSrc, pyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)

		return new Promise((resolve) => {
			let settled = false
			const settle = (result: HydroRunResult) => {
				if (!settled) {
					settled = true
					resolve(result)
				}
			}

			const child = spawn(pythonCmd, ["-m", "ai_hydro.hydro_map_cli", "--json", ...args], {
				cwd: extensionRoot,
				env: { ...process.env, PYTHONPATH: pythonPath },
				stdio: ["ignore", "pipe", "pipe"],
			})

			const timer = setTimeout(() => {
				child.kill()
				settle({ ok: false, error: `Hydro CLI timed out after ${timeoutMs / 1000}s` })
			}, timeoutMs)

			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			child.stderr.on("data", (d) => {
				stderr += d.toString()
			})
			child.on("error", (err) => {
				clearTimeout(timer)
				settle({ ok: false, error: err.message, raw: stderr || stdout })
			})
			child.on("close", () => {
				clearTimeout(timer)
				const raw = stdout.trim() || stderr.trim()
				if (!raw) {
					settle({ ok: false, error: "Empty response from hydro_map_cli", raw })
					return
				}
				try {
					const parsed = JSON.parse(raw) as Record<string, unknown>
					settle({ ok: parsed.ok === true, result: parsed, raw })
				} catch {
					settle({ ok: false, error: `Invalid JSON: ${raw.slice(0, 400)}`, raw })
				}
			})
		})
	}

	static async listPresets(): Promise<MeritPresetsResult> {
		const run = await MapHydrologyService.runHydroCli(["list-presets"], 30_000)
		if (run.result) {
			return run.result as unknown as MeritPresetsResult
		}
		return { ok: false, type: "merit_presets", message: run.error || "Failed to list presets" }
	}

	static async meritEnsureBasin(lat: number, lon: number, download = true): Promise<MeritEnsureBasinResult> {
		const args = ["merit-ensure-basin", "--lat", String(lat), "--lon", String(lon)]
		if (!download) args.push("--no-download")
		const run = await MapHydrologyService.runHydroCli(args, 900_000)
		if (run.result) {
			return run.result as unknown as MeritEnsureBasinResult
		}
		return { ok: false, type: "merit_ensure_basin", message: run.error || "merit_ensure_basin failed" }
	}

	static async meritEnsureRegion(
		preset: string,
		lat?: number,
		lon?: number,
		download = true,
	): Promise<MeritEnsureRegionResult> {
		const args = ["merit-ensure-region", "--preset", preset]
		if (lat !== undefined) args.push("--lat", String(lat))
		if (lon !== undefined) args.push("--lon", String(lon))
		if (!download) args.push("--no-download")
		const run = await MapHydrologyService.runHydroCli(args, 900_000)
		if (run.result) {
			return run.result as unknown as MeritEnsureRegionResult
		}
		return { ok: false, type: "merit_ensure_region", message: run.error || "merit_ensure_region failed" }
	}

	static async meritLayers(params: {
		lat: number
		lon: number
		minLon?: number
		minLat?: number
		maxLon?: number
		maxLat?: number
		includeCatchments?: boolean
		/** Level-2 Pfaf index polygons (lookup only; not needed for map display). Default false. */
		includeLevel2?: boolean
	}): Promise<MeritLayersResult> {
		const args = ["merit-layers", "--lat", String(params.lat), "--lon", String(params.lon)]
		if (params.minLon !== undefined) args.push("--min-lon", String(params.minLon))
		if (params.minLat !== undefined) args.push("--min-lat", String(params.minLat))
		if (params.maxLon !== undefined) args.push("--max-lon", String(params.maxLon))
		if (params.maxLat !== undefined) args.push("--max-lat", String(params.maxLat))
		if (params.includeCatchments) args.push("--catchments")
		if (params.includeLevel2 !== true) args.push("--no-level2")
		const run = await MapHydrologyService.runHydroCli(args, 120_000)
		if (run.result) {
			return run.result as unknown as MeritLayersResult
		}
		return { ok: false, type: "merit_layers", message: run.error || "merit_layers failed" }
	}

	static async wbdLayers(params: {
		lat: number
		lon: number
		minLon?: number
		minLat?: number
		maxLon?: number
		maxLat?: number
		hucLevel?: number
	}): Promise<MeritLayersResult> {
		const args = ["wbd-layers", "--lat", String(params.lat), "--lon", String(params.lon)]
		if (params.minLon !== undefined) args.push("--min-lon", String(params.minLon))
		if (params.minLat !== undefined) args.push("--min-lat", String(params.minLat))
		if (params.maxLon !== undefined) args.push("--max-lon", String(params.maxLon))
		if (params.maxLat !== undefined) args.push("--max-lat", String(params.maxLat))
		if (params.hucLevel !== undefined) args.push("--huc-level", String(params.hucLevel))
		const run = await MapHydrologyService.runHydroCli(args, 120_000)
		if (run.result) {
			return run.result as unknown as MeritLayersResult
		}
		return { ok: false, type: "wbd_layers", message: run.error || "wbd_layers failed" }
	}

	static async hucAtPoint(params: { lat: number; lon: number; hucLevel?: number }): Promise<HucAtPointResult> {
		const args = ["huc-at-point", "--lat", String(params.lat), "--lon", String(params.lon)]
		if (params.hucLevel !== undefined) args.push("--huc-level", String(params.hucLevel))
		const run = await MapHydrologyService.runHydroCli(args, 60_000)
		if (run.result) {
			return run.result as unknown as HucAtPointResult
		}
		return { ok: false, type: "huc_at_point", message: run.error || "huc_at_point failed" }
	}

	static async searchHydrology(params: {
		q: string
		minLon?: number
		minLat?: number
		maxLon?: number
		maxLat?: number
		limit?: number
	}): Promise<SearchHydrologyResult> {
		const args = ["search-hydrology", "--q", params.q]
		if (params.minLon !== undefined) args.push("--min-lon", String(params.minLon))
		if (params.minLat !== undefined) args.push("--min-lat", String(params.minLat))
		if (params.maxLon !== undefined) args.push("--max-lon", String(params.maxLon))
		if (params.maxLat !== undefined) args.push("--max-lat", String(params.maxLat))
		if (params.limit !== undefined) args.push("--limit", String(params.limit))
		const run = await MapHydrologyService.runHydroCli(args, 90_000)
		if (run.result) {
			return run.result as unknown as SearchHydrologyResult
		}
		return { ok: false, type: "search_hydrology", message: run.error || "search_hydrology failed" }
	}

	static async gaugesInView(params: {
		lat: number
		lon: number
		minLon: number
		minLat: number
		maxLon: number
		maxLat: number
		limit?: number
	}): Promise<MeritLayersResult> {
		const args = [
			"gauges-in-view",
			"--lat",
			String(params.lat),
			"--lon",
			String(params.lon),
			"--min-lon",
			String(params.minLon),
			"--min-lat",
			String(params.minLat),
			"--max-lon",
			String(params.maxLon),
			"--max-lat",
			String(params.maxLat),
		]
		if (params.limit !== undefined) args.push("--limit", String(params.limit))
		const run = await MapHydrologyService.runHydroCli(args, 120_000)
		if (run.result) {
			return run.result as unknown as MeritLayersResult
		}
		return { ok: false, type: "gauges_in_view", message: run.error || "gauges_in_view failed" }
	}

	static async delineatePoint(params: {
		lat: number
		lon: number
		sessionId?: string
		method?: string
		expectedAreaKm2?: number
		name?: string
	}): Promise<DelineatePointResult> {
		const workspaceDir = await MapHydrologyService.getWorkspaceRoot()
		const args = [
			"delineate-point",
			"--lat",
			String(params.lat),
			"--lon",
			String(params.lon),
			"--session-id",
			params.sessionId || "map",
			"--method",
			params.method || "auto",
			"--workspace-dir",
			workspaceDir,
		]
		if (params.expectedAreaKm2 !== undefined) {
			args.push("--expected-area-km2", String(params.expectedAreaKm2))
		}
		if (params.name) args.push("--name", params.name)
		const run = await MapHydrologyService.runHydroCli(args, 1_200_000)
		if (run.result) {
			return run.result as unknown as DelineatePointResult
		}
		return { ok: false, type: "delineate_point", message: run.error || "Delineation failed" }
	}
}
