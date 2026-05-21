import { exec, spawn } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import type { GeeProjectsResult, GeeStatusResult, GeeTileLayerResult } from "./types"

interface GeeRunResult {
	ok: boolean
	result?: GeeProjectsResult | GeeStatusResult | GeeTileLayerResult
	error?: string
	raw?: string
}

const PYTHON_CACHE_FILE = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "/tmp", ".aihydro", "cache", "python_path.txt")

export class GeeService {
	// Cached after the first async detection — subsequent calls return instantly.
	private static _cachedPythonCmd: string | undefined
	// Single in-flight detection promise so concurrent calls share one probe.
	private static _detectingPromise: Promise<string> | undefined

	private static getConfiguredPythonCommand(): string {
		const config = vscode.workspace.getConfiguration("aihydro.gee")
		return config.get<string>("pythonPath") || "python3"
	}

	private static async canImportEarthEngineAsync(pythonCmd: string): Promise<boolean> {
		try {
			await execAsync(`"${pythonCmd}" -c "import ai_hydro.gee; import ee"`, { timeout: 6000 })
			return true
		} catch {
			return false
		}
	}

	private static async commandExistsAsync(pythonCmd: string): Promise<boolean> {
		try {
			await execAsync(`"${pythonCmd}" -c "import sys"`, { timeout: 3000 })
			return true
		} catch {
			return false
		}
	}

	// Invalidate cache when settings change (e.g. user sets aihydro.gee.pythonPath)
	static invalidatePythonCache(): void {
		GeeService._cachedPythonCmd = undefined
		GeeService._detectingPromise = undefined
		fs.unlink(PYTHON_CACHE_FILE).catch(() => {})
	}

	private static async loadCachedPythonPath(): Promise<string | undefined> {
		try {
			const cached = (await fs.readFile(PYTHON_CACHE_FILE, "utf-8")).trim()
			if (cached && (await GeeService.canImportEarthEngineAsync(cached))) {
				return cached
			}
		} catch {
			// no cache or stale
		}
		return undefined
	}

	private static async saveCachedPythonPath(cmd: string): Promise<void> {
		try {
			await fs.mkdir(path.dirname(PYTHON_CACHE_FILE), { recursive: true })
			await fs.writeFile(PYTHON_CACHE_FILE, cmd, "utf-8")
		} catch {
			// best-effort
		}
	}

	private static resolvePythonCommandAsync(): Promise<string> {
		if (GeeService._cachedPythonCmd) {
			return Promise.resolve(GeeService._cachedPythonCmd)
		}
		// Coalesce concurrent callers onto one probe
		if (GeeService._detectingPromise) {
			return GeeService._detectingPromise
		}
		GeeService._detectingPromise = (async () => {
			// Check disk cache first — avoids 4s+ import probe on every extension restart
			const cached = await GeeService.loadCachedPythonPath()
			if (cached) {
				GeeService._cachedPythonCmd = cached
				GeeService._detectingPromise = undefined
				return cached
			}

			const configured = GeeService.getConfiguredPythonCommand().trim()
			// Known-good absolute paths first — avoids 6s × N timeout cascade on systems
			// where the PATH-based shims don't have ai_hydro.gee / ee installed.
			const rawCandidates = [
				"/opt/miniconda3/bin/python",
				"/opt/homebrew/bin/python3",
				process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, "bin", "python") : undefined,
				configured,
				"python3",
				"python",
				"/usr/bin/python3",
			]
			// Deduplicate while preserving order
			const seen = new Set<string>()
			const candidates = rawCandidates.filter((v): v is string => {
				if (!v?.trim()) return false
				if (seen.has(v)) return false
				seen.add(v)
				return true
			})

			for (const candidate of candidates) {
				if (await GeeService.canImportEarthEngineAsync(candidate)) {
					GeeService._cachedPythonCmd = candidate
					GeeService._detectingPromise = undefined
					GeeService.saveCachedPythonPath(candidate)
					return candidate
				}
			}
			for (const candidate of candidates) {
				if (await GeeService.commandExistsAsync(candidate)) {
					GeeService._cachedPythonCmd = candidate
					GeeService._detectingPromise = undefined
					return candidate
				}
			}
			const fallback = configured || "python3"
			GeeService._cachedPythonCmd = fallback
			GeeService._detectingPromise = undefined
			return fallback
		})()
		return GeeService._detectingPromise
	}

	private static getProjectId(provided?: string): string | undefined {
		if (provided && provided.trim()) {
			return provided.trim()
		}
		const config = vscode.workspace.getConfiguration("aihydro.gee")
		const fromSettings = config.get<string>("projectId")
		return fromSettings?.trim() || undefined
	}

	private static async getWorkspaceRoot(): Promise<string> {
		try {
			const workspacePaths = await HostProvider.workspace.getWorkspacePaths({})
			return workspacePaths.paths[0] || process.cwd()
		} catch {
			return process.cwd()
		}
	}

	private static async writeProvenance(kind: string, payload: unknown, result: unknown): Promise<string> {
		const workspaceRoot = await GeeService.getWorkspaceRoot()
		const outputDir = path.join(workspaceRoot, ".aihydro", "outputs", "gee")
		await fs.mkdir(outputDir, { recursive: true })
		const stamp = new Date().toISOString().replace(/[:.]/g, "-")
		const outPath = path.join(outputDir, `${kind}_${stamp}.json`)
		await fs.writeFile(
			outPath,
			JSON.stringify(
				{
					timestamp: new Date().toISOString(),
					kind,
					workspaceRoot,
					payload,
					result,
				},
				null,
				2,
			),
			"utf-8",
		)
		return outPath
	}

	private static async runGeeCli(args: string[], timeoutMs = 15_000): Promise<GeeRunResult> {
		const pythonCmd = await GeeService.resolvePythonCommandAsync()
		const extensionRoot = HostProvider.get().extensionFsPath
		const pyPath = path.join(extensionRoot, "python")
		const pythonPath = [pyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)

		return new Promise((resolve) => {
			let settled = false
			const settle = (result: GeeRunResult) => {
				if (!settled) {
					settled = true
					resolve(result)
				}
			}

			const child = spawn(pythonCmd, ["-m", "ai_hydro.gee.cli", ...args], {
				cwd: extensionRoot,
				env: {
					...process.env,
					PYTHONPATH: pythonPath,
				},
				stdio: ["ignore", "pipe", "pipe"],
			})

			const timer = setTimeout(() => {
				child.kill()
				settle({ ok: false, error: `GEE CLI timed out after ${timeoutMs / 1000}s` })
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
				settle({
					ok: false,
					error: `[python: ${pythonCmd}] ${err.message}`,
					raw: stderr || stdout,
				})
			})
			child.on("close", () => {
				clearTimeout(timer)
				const raw = stdout.trim() || stderr.trim()
				if (!raw) {
					settle({ ok: false, error: `Empty response from GEE adapter [python: ${pythonCmd}]`, raw })
					return
				}
				try {
					const parsed = JSON.parse(raw)
					settle({ ok: parsed.ok === true, result: parsed, raw })
				} catch {
					settle({
						ok: false,
						error: `Invalid JSON from GEE adapter [python: ${pythonCmd}]: ${raw.slice(0, 500)}`,
						raw,
					})
				}
			})
		})
	}

	static async connect(projectId?: string): Promise<GeeStatusResult & { provenance_path?: string }> {
		const pid = GeeService.getProjectId(projectId)
		const args = ["connect", "--json"]
		if (pid) {
			args.push("--project-id", pid)
		}
		const result = await GeeService.runGeeCli(args)
		if (result.result) {
			const parsed = result.result as GeeStatusResult
			if (parsed.ok) {
				const provenance_path = await GeeService.writeProvenance("connect", { projectId: pid }, parsed)
				return { ...parsed, provenance_path }
			}
			return parsed
		}
		return {
			ok: false,
			type: "gee_status",
			authenticated: false,
			ee_available: false,
			project_id: pid,
			message: result.error || "GEE connect failed",
			error: result.raw,
			provenance: { source: "extension_host", operation: "gee.connect" },
		}
	}

	static async status(projectId?: string): Promise<GeeStatusResult & { provenance_path?: string }> {
		const pid = GeeService.getProjectId(projectId)
		const args = ["status", "--json"]
		if (pid) {
			args.push("--project-id", pid)
		}
		const result = await GeeService.runGeeCli(args)
		if (result.result) {
			const parsed = result.result as GeeStatusResult
			if (parsed.ok) {
				const provenance_path = await GeeService.writeProvenance("status", { projectId: pid }, parsed)
				return { ...parsed, provenance_path }
			}
			return parsed
		}
		return {
			ok: false,
			type: "gee_status",
			authenticated: false,
			ee_available: false,
			project_id: pid,
			message: result.error || "GEE status failed",
			error: result.raw,
			provenance: { source: "extension_host", operation: "gee.status" },
		}
	}

	static async listProjects(): Promise<GeeProjectsResult> {
		const result = await GeeService.runGeeCli(["list-projects", "--json"])
		if (!result.result) {
			return {
				ok: false,
				type: "gee_projects",
				projects: [],
				message: result.error || "Could not list Google Cloud projects.",
				error: result.raw,
			}
		}
		return result.result as GeeProjectsResult
	}

	static async setProject(projectId: string): Promise<{ ok: boolean; message: string; project_id?: string; error?: string }> {
		const pid = projectId.trim()
		if (!pid) {
			return { ok: false, message: "Project ID is required." }
		}
		const result = await GeeService.runGeeCli(["set-project", "--project-id", pid, "--json"])
		if (!result.result) {
			return {
				ok: false,
				message: result.error || "Failed to persist Earth Engine project id.",
				error: result.raw,
			}
		}
		const parsed = result.result as any
		return {
			ok: Boolean(parsed.ok),
			message: String(parsed.message || (parsed.ok ? "Project saved." : "Project save failed.")),
			project_id: parsed.project_id ? String(parsed.project_id) : undefined,
			error: parsed.error ? String(parsed.error) : undefined,
		}
	}

	static async previewChirpsLayer(input: {
		startDate: string
		endDate: string
		projectId?: string
		roiGeoJson?: string
	}): Promise<GeeTileLayerResult & { provenance_path?: string }> {
		const pid = GeeService.getProjectId(input.projectId)
		const args = ["preview-chirps", "--start-date", input.startDate, "--end-date", input.endDate, "--json"]
		if (pid) {
			args.push("--project-id", pid)
		}
		if (input.roiGeoJson) {
			args.push("--roi-geojson", input.roiGeoJson)
		}
		const result = await GeeService.runGeeCli(args)
		if (result.result) {
			const parsed = result.result as GeeTileLayerResult
			if (parsed.ok) {
				const provenance_path = await GeeService.writeProvenance("preview_chirps", input, parsed)
				return { ...parsed, provenance_path }
			}
			return parsed
		}
		return {
			ok: false,
			type: "gee_tile_layer",
			name: "CHIRPS precipitation",
			dataset_id: "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
			start_date: input.startDate,
			end_date: input.endDate,
			message: result.error || "GEE CHIRPS preview failed",
			error: result.raw,
			provenance: { source: "extension_host", operation: "gee.preview_layer" },
		}
	}
}
