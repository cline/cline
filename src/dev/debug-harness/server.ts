#!/usr/bin/env npx tsx
/**
 * Debug Harness Server
 *
 * Launches VSCode with the Cline extension in debug mode and provides
 * an HTTP API for:
 *   - Extension host debugging (breakpoints, evaluate, stepping) via CDP
 *   - Webview debugging (breakpoints, evaluate, stepping) via CDP
 *   - UI automation (click, type, screenshot) via Playwright
 *
 * Usage:
 *   npx tsx src/dev/debug-harness/server.ts [options]
 *
 * Options:
 *   --skip-build        Skip building extension/webview
 *   --auto-launch       Automatically launch VSCode on startup
 *   --workspace PATH    Workspace directory to open
 *   --port PORT         Server port (default: 19229)
 *
 * Then send commands:
 *   curl localhost:19229/api -d '{"method":"launch"}'
 *   curl localhost:19229/api -d '{"method":"ui.screenshot"}'
 *   curl localhost:19229/api -d '{"method":"ext.set_breakpoint","params":{"file":"src/extension.ts","line":42}}'
 */

import http from "node:http"
import path from "node:path"
import fs from "node:fs"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { execSync, type ExecSyncOptions } from "node:child_process"
import { _electron, type ElectronApplication, type Page, type Frame, type CDPSession } from "playwright"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import WebSocket from "ws"

const __script_dir = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url))

// ============================================================
// Configuration
// ============================================================

const args = process.argv.slice(2)
function getArg(name: string): string | undefined {
	const idx = args.indexOf(name)
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
}

const PORT = parseInt(getArg("--port") || "19229", 10)
const EXT_INSPECT_PORT = 9230
const PROJECT_ROOT = path.resolve(__script_dir, "..", "..", "..")
const SCREENSHOT_DIR = path.join(os.tmpdir(), "cline-debug")
const DEFAULT_WORKSPACE = path.join(os.tmpdir(), "cline-debug-workspace")
const SKIP_BUILD = args.includes("--skip-build")
const AUTO_LAUNCH = args.includes("--auto-launch")
const WORKSPACE_ARG = getArg("--workspace")

// ============================================================
// VLQ Sourcemap Decoder
// ============================================================

const VLQ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const VLQ_MAP: Record<string, number> = {}
for (let i = 0; i < VLQ_CHARS.length; i++) VLQ_MAP[VLQ_CHARS[i]] = i

function decodeVLQ(encoded: string): number[] {
	const result: number[] = []
	let shift = 0,
		value = 0
	for (const c of encoded) {
		let digit = VLQ_MAP[c]
		if (digit === undefined) continue
		const cont = digit & 32
		digit &= 31
		value += digit << shift
		if (cont) {
			shift += 5
		} else {
			result.push(value & 1 ? -(value >> 1) : value >> 1)
			value = 0
			shift = 0
		}
	}
	return result
}

interface SourceMapJSON {
	sources: string[]
	mappings: string
	sourceRoot?: string
}

/**
 * Given a sourcemap and an original source file + line, find the generated position.
 * Returns null if no mapping is found.
 */
function resolveSourceMapPosition(
	mapJson: SourceMapJSON,
	sourceFile: string,
	targetLine: number, // 1-indexed
): { line: number; column: number } | null {
	// Find source index - try exact match first, then suffix match
	let srcIdx = mapJson.sources.indexOf(sourceFile)
	if (srcIdx === -1) {
		srcIdx = mapJson.sources.findIndex(
			(s) => s.endsWith(sourceFile) || sourceFile.endsWith(s) || s.endsWith("/" + sourceFile),
		)
	}
	if (srcIdx === -1) return null

	const targetLine0 = targetLine - 1 // Convert to 0-indexed
	const lines = mapJson.mappings.split(";")
	let genCol = 0,
		srcFile = 0,
		srcLine = 0,
		srcCol = 0
	let bestMatch: { line: number; column: number } | null = null
	let bestDist = Infinity

	for (let genLine = 0; genLine < lines.length; genLine++) {
		genCol = 0
		if (!lines[genLine]) continue
		const segments = lines[genLine].split(",")
		for (const seg of segments) {
			if (!seg) continue
			const d = decodeVLQ(seg)
			genCol += d[0]
			if (d.length >= 4) {
				srcFile += d[1]
				srcLine += d[2]
				srcCol += d[3]
				if (srcFile === srcIdx) {
					const dist = Math.abs(srcLine - targetLine0)
					if (dist < bestDist) {
						bestDist = dist
						bestMatch = { line: genLine + 1, column: genCol + 1 }
					}
					if (srcLine === targetLine0) {
						return { line: genLine + 1, column: genCol + 1 }
					}
				}
			}
		}
	}

	// Return closest match if within 3 lines
	if (bestMatch && bestDist <= 3) return bestMatch
	return null
}

/**
 * List all source files referenced in a sourcemap.
 */
function listSourceMapFiles(mapJson: SourceMapJSON): string[] {
	return mapJson.sources.map((s) => {
		if (mapJson.sourceRoot) return mapJson.sourceRoot + s
		return s
	})
}

// ============================================================
// CDP Client - WebSocket wrapper for Chrome DevTools Protocol
// ============================================================

interface ScriptInfo {
	scriptId: string
	url: string
	sourceMapURL?: string
	startLine: number
	endLine: number
}

class CdpClient {
	private ws: WebSocket | null = null
	private nextId = 1
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
	private listeners = new Map<string, Set<(params: any) => void>>()

	public paused = false
	public lastPauseInfo: any = null
	public scripts = new Map<string, ScriptInfo>()
	public name: string

	constructor(name: string) {
		this.name = name
	}

	async connect(wsUrl: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(wsUrl)
			ws.on("open", () => {
				this.ws = ws
				resolve()
			})
			ws.on("error", (e) => {
				if (!this.ws) reject(e)
			})
			ws.on("close", () => {
				this.ws = null
			})
			ws.on("message", (raw: WebSocket.Data) => {
				const msg = JSON.parse(raw.toString())
				if (msg.id !== undefined) {
					const p = this.pending.get(msg.id)
					if (p) {
						this.pending.delete(msg.id)
						if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
						else p.resolve(msg.result)
					}
				} else if (msg.method) {
					const hs = this.listeners.get(msg.method)
					if (hs) hs.forEach((h) => h(msg.params))
				}
			})
		})
	}

	async send(method: string, params: Record<string, any> = {}): Promise<any> {
		if (!this.ws) throw new Error(`CDP [${this.name}] not connected`)
		const id = this.nextId++
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject })
			this.ws!.send(JSON.stringify({ id, method, params }))
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id)
					reject(new Error(`CDP [${this.name}] timeout: ${method}`))
				}
			}, 30000)
		})
	}

	on(event: string, handler: (params: any) => void): void {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set())
		this.listeners.get(event)!.add(handler)
	}

	off(event: string, handler: (params: any) => void): void {
		this.listeners.get(event)?.delete(handler)
	}

	get connected(): boolean {
		return this.ws !== null
	}

	close(): void {
		this.ws?.close()
		this.ws = null
		this.pending.clear()
		this.scripts.clear()
	}

	/** Enable debugger and track scripts + pause events */
	async enableDebugger(): Promise<void> {
		await this.send("Debugger.enable", { maxScriptsCacheSize: 10000000 })
		await this.send("Runtime.enable")

		this.on("Debugger.scriptParsed", (params: any) => {
			if (params.url) {
				this.scripts.set(params.scriptId, {
					scriptId: params.scriptId,
					url: params.url,
					sourceMapURL: params.sourceMapURL,
					startLine: params.startLine || 0,
					endLine: params.endLine || 0,
				})
			}
		})

		this.on("Debugger.paused", (params: any) => {
			this.paused = true
			this.lastPauseInfo = params
			log(`[${this.name}] PAUSED: ${params.reason}`)
		})

		this.on("Debugger.resumed", () => {
			this.paused = false
			this.lastPauseInfo = null
			log(`[${this.name}] RESUMED`)
		})
	}
}

// ============================================================
// Debug Harness - Main orchestrator
// ============================================================

class DebugHarness {
	private app: ElectronApplication | null = null
	private page: Page | null = null
	private sidebarFrame: Frame | null = null
	private extCdp = new CdpClient("ext-host")
	private webCdp: CdpClient | null = null
	private webCdpSession: CDPSession | null = null // Playwright CDP session fallback
	private screenshotCounter = 0
	private extSourceMap: SourceMapJSON | null = null

	// Pause waiters - resolved when any debuggee hits a breakpoint
	private pauseWaiters: { resolve: (info: any) => void; timer: NodeJS.Timeout }[] = []

	// ────────────────────────────────────────────
	// Lifecycle
	// ────────────────────────────────────────────

	async launch(opts: { workspace?: string; skipBuild?: boolean } = {}): Promise<any> {
		if (this.app) return { status: "already_running" }

		const workspace = opts.workspace || WORKSPACE_ARG || DEFAULT_WORKSPACE
		fs.mkdirSync(workspace, { recursive: true })
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

		// Build
		if (!opts.skipBuild && !SKIP_BUILD) {
			log("Building extension (unminified, with sourcemaps)...")
			const execOpts: ExecSyncOptions = { cwd: PROJECT_ROOT, stdio: "inherit", env: { ...process.env, IS_DEV: "true" } }
			execSync("npm run protos", execOpts)
			execSync("node esbuild.mjs", execOpts)
			log("Building webview (unminified, with inline sourcemaps)...")
			execSync("cd webview-ui && npx vite build -- --dev-build", execOpts)
		}

		// Verify build output exists
		const extJs = path.join(PROJECT_ROOT, "dist", "extension.js")
		if (!fs.existsSync(extJs)) {
			throw new Error(`Extension not built: ${extJs} not found. Run without --skip-build.`)
		}

		// Load extension sourcemap for breakpoint resolution
		const mapFile = extJs + ".map"
		if (fs.existsSync(mapFile)) {
			try {
				this.extSourceMap = JSON.parse(fs.readFileSync(mapFile, "utf-8"))
				log(`Loaded extension sourcemap (${this.extSourceMap!.sources.length} source files)`)
			} catch (e: any) {
				log(`Warning: Could not load sourcemap: ${e.message}`)
			}
		}

		// Download VSCode binary
		log("Ensuring VSCode binary is available...")
		const executablePath = await downloadAndUnzipVSCode("stable", undefined, new SilentReporter())
		log(`VSCode binary: ${executablePath}`)

		// Create temp user data dir to avoid interfering with real VSCode profile
		const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-debug-profile-"))
		log(`User data dir: ${userDataDir}`)

		// Launch VSCode with Playwright
		log("Launching VSCode...")
		try {
			this.app = await _electron.launch({
				executablePath,
				args: [
					`--inspect-extensions=${EXT_INSPECT_PORT}`,
					`--extensionDevelopmentPath=${PROJECT_ROOT}`,
					"--disable-extensions",
					"--disable-workspace-trust",
					"--no-sandbox",
					"--disable-updates",
					"--skip-welcome",
					"--skip-release-notes",
					`--user-data-dir=${userDataDir}`,
					workspace,
				],
				env: {
					...process.env,
					IS_DEV: "true",
					TEMP_PROFILE: "true",
					DEV_WORKSPACE_FOLDER: PROJECT_ROOT,
					CLINE_ENVIRONMENT: "local",
				},
				timeout: 60000,
			})
		} catch (e: any) {
			this.app = null
			throw new Error(`Failed to launch VSCode: ${e.message}`)
		}

		// Wait for first window (firstWindow() already waits internally)
		log("Waiting for first window...")
		try {
			this.page = await this.app.firstWindow()
			log("VSCode window ready")
		} catch (e: any) {
			await this.app.close().catch(() => {})
			this.app = null
			throw new Error(`VSCode window did not appear: ${e.message}`)
		}

		// Connect to extension host inspector (Node.js CDP)
		await this.connectExtensionCdp()

		// Wait briefly for the extension to activate, then find the sidebar
		log("Waiting for extension activation...")
		await sleep(3000)

		return {
			status: "launched",
			workspace,
			extCdpConnected: this.extCdp.connected,
			screenshotDir: SCREENSHOT_DIR,
		}
	}

	private async connectExtensionCdp(): Promise<void> {
		log("Connecting to extension host inspector...")
		const wsUrl = await this.waitForInspector(EXT_INSPECT_PORT, 30000)
		await this.extCdp.connect(wsUrl)
		await this.extCdp.enableDebugger()

		// Wire pause events to waiters
		this.extCdp.on("Debugger.paused", (params: any) => {
			this.resolvePauseWaiters({ target: "extension", ...this.formatPauseInfo(params) })
		})

		log("Extension host CDP connected")
	}

	async connectWebview(): Promise<any> {
		if (!this.page) throw new Error("VSCode not running")

		// First find the sidebar frame via Playwright
		const sidebar = await this.findSidebar()
		if (!sidebar) return { error: "Sidebar frame not found" }

		// Try creating a CDP session for the sidebar frame
		try {
			// Try via Playwright's newCDPSession with the frame
			this.webCdpSession = await this.page.context().newCDPSession(sidebar as any)
			await this.webCdpSession.send("Debugger.enable")
			await this.webCdpSession.send("Runtime.enable")

			this.webCdpSession.on("Debugger.paused", (params: any) => {
				log("[webview] PAUSED:", params.reason)
				this.resolvePauseWaiters({ target: "webview", ...this.formatPauseInfo(params) })
			})

			log("Webview CDP session connected via Playwright")
			return { status: "connected", method: "playwright_cdp" }
		} catch (e: any) {
			log(`Playwright CDP session failed: ${e.message}`)
			log("Webview debugging via CDP not available. Use web.evaluate for expression evaluation.")
			return { status: "partial", method: "playwright_frame_only", note: e.message }
		}
	}

	private async waitForInspector(port: number, timeout: number): Promise<string> {
		const start = Date.now()
		while (Date.now() - start < timeout) {
			try {
				const res = await fetch(`http://127.0.0.1:${port}/json`)
				const targets: any[] = await res.json() as any[]
				for (const t of targets) {
					if (t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl
				}
			} catch {}
			await sleep(500)
		}
		throw new Error(`Inspector not available on port ${port} after ${timeout}ms`)
	}

	private async findSidebar(forceRefresh = false): Promise<Frame | null> {
		// Validate cached reference - check both detached AND that it's still responsive
		if (!forceRefresh && this.sidebarFrame && !this.sidebarFrame.isDetached()) {
			try {
				// Verify the frame is still alive by attempting a lightweight operation
				await this.sidebarFrame.title()
				return this.sidebarFrame
			} catch {
				// Frame reference is stale, clear and re-discover
				this.sidebarFrame = null
			}
		}

		this.sidebarFrame = null
		if (!this.page) return null

		const start = Date.now()
		while (Date.now() - start < 30000) {
			for (const frame of this.page.frames()) {
				if (frame.isDetached()) continue
				try {
					const title = await frame.title()
					if (title.startsWith("Cline")) {
						this.sidebarFrame = frame
						return frame
					}
				} catch {}
			}
			await sleep(500)
		}
		return null
	}

	async shutdown(): Promise<any> {
		this.extCdp.close()
		this.webCdp?.close()
		try {
			await this.webCdpSession?.detach()
		} catch {}
		this.webCdpSession = null
		if (this.app) {
			try {
				await this.app.close()
			} catch {}
			this.app = null
		}
		this.page = null
		this.sidebarFrame = null
		this.webCdp = null
		return { status: "shutdown" }
	}

	// ────────────────────────────────────────────
	// Extension Host Debugging
	// ────────────────────────────────────────────

	async extSetBreakpoint(params: { file: string; line: number; column?: number; condition?: string }): Promise<any> {
		const absPath = path.isAbsolute(params.file) ? params.file : path.resolve(PROJECT_ROOT, params.file)

		// Strategy 1: If we have a sourcemap, resolve to the generated position
		if (this.extSourceMap) {
			const relPath = path.relative(PROJECT_ROOT, absPath)
			// Try various path formats that esbuild might use in the sourcemap
			const candidates = [relPath, "./" + relPath, absPath, "src/" + relPath.replace(/^src\//, "")]

			for (const candidate of candidates) {
				const pos = resolveSourceMapPosition(this.extSourceMap, candidate, params.line)
				if (pos) {
					log(`Sourcemap resolved: ${params.file}:${params.line} → dist/extension.js:${pos.line}:${pos.column}`)
					const bundledUrl = `file://${path.join(PROJECT_ROOT, "dist", "extension.js")}`
					const result = await this.extCdp.send("Debugger.setBreakpointByUrl", {
						url: bundledUrl,
						lineNumber: pos.line - 1,
						columnNumber: pos.column - 1,
						condition: params.condition || "",
					})
					return {
						...result,
						resolvedVia: "sourcemap",
						originalFile: params.file,
						originalLine: params.line,
						generatedLine: pos.line,
						generatedColumn: pos.column,
					}
				}
			}
			log(`Sourcemap: no mapping found for ${relPath}:${params.line}`)
		}

		// Strategy 2: Try setting by the original file URL directly (V8 may resolve sourcemaps)
		const fileUrl = `file://${absPath}`
		try {
			const result = await this.extCdp.send("Debugger.setBreakpointByUrl", {
				url: fileUrl,
				lineNumber: params.line - 1,
				columnNumber: params.column ? params.column - 1 : 0,
				condition: params.condition || "",
			})
			return { ...result, resolvedVia: "direct_url" }
		} catch (e: any) {
			// Strategy 3: Try URL regex
			const filename = path.basename(absPath)
			const result = await this.extCdp.send("Debugger.setBreakpointByUrl", {
				urlRegex: filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
				lineNumber: params.line - 1,
				columnNumber: params.column ? params.column - 1 : 0,
				condition: params.condition || "",
			})
			return { ...result, resolvedVia: "url_regex" }
		}
	}

	async extSetBreakpointRaw(params: {
		url?: string
		urlRegex?: string
		scriptId?: string
		lineNumber: number
		columnNumber?: number
		condition?: string
	}): Promise<any> {
		if (params.scriptId) {
			return this.extCdp.send("Debugger.setBreakpoint", {
				location: {
					scriptId: params.scriptId,
					lineNumber: params.lineNumber - 1,
					columnNumber: (params.columnNumber || 1) - 1,
				},
				condition: params.condition || "",
			})
		}
		return this.extCdp.send("Debugger.setBreakpointByUrl", {
			url: params.url,
			urlRegex: params.urlRegex,
			lineNumber: params.lineNumber - 1,
			columnNumber: (params.columnNumber || 1) - 1,
			condition: params.condition || "",
		})
	}

	async extRemoveBreakpoint(params: { breakpointId: string }): Promise<void> {
		await this.extCdp.send("Debugger.removeBreakpoint", { breakpointId: params.breakpointId })
	}

	async extEvaluate(params: { expression: string; callFrameId?: string }): Promise<any> {
		if (params.callFrameId) {
			return this.extCdp.send("Debugger.evaluateOnCallFrame", {
				callFrameId: params.callFrameId,
				expression: params.expression,
				returnByValue: true,
				generatePreview: true,
			})
		}
		return this.extCdp.send("Runtime.evaluate", {
			expression: params.expression,
			returnByValue: true,
			generatePreview: true,
		})
	}

	async extPause(): Promise<void> {
		await this.extCdp.send("Debugger.pause")
	}
	async extResume(): Promise<void> {
		await this.extCdp.send("Debugger.resume")
	}
	async extStepOver(): Promise<void> {
		await this.extCdp.send("Debugger.stepOver")
	}
	async extStepInto(): Promise<void> {
		await this.extCdp.send("Debugger.stepInto")
	}
	async extStepOut(): Promise<void> {
		await this.extCdp.send("Debugger.stepOut")
	}

	async extCallStack(): Promise<any> {
		if (!this.extCdp.paused || !this.extCdp.lastPauseInfo) {
			return { paused: false, error: "Extension host not paused" }
		}
		return {
			paused: true,
			reason: this.extCdp.lastPauseInfo.reason,
			callFrames: this.extCdp.lastPauseInfo.callFrames?.map(formatCallFrame),
		}
	}

	async extScripts(params: { filter?: string } = {}): Promise<any> {
		const scripts = Array.from(this.extCdp.scripts.values())
		const filter = params.filter?.toLowerCase()
		const filtered = filter ? scripts.filter((s) => s.url.toLowerCase().includes(filter)) : scripts
		return {
			total: scripts.length,
			shown: filtered.length,
			scripts: filtered.slice(0, 100).map((s) => ({
				scriptId: s.scriptId,
				url: s.url,
				hasSourceMap: !!s.sourceMapURL,
			})),
		}
	}

	async extSourceFiles(): Promise<any> {
		if (!this.extSourceMap) {
			return { error: "No sourcemap loaded. Build without --skip-build to generate sourcemaps." }
		}
		return {
			sourceRoot: this.extSourceMap.sourceRoot || "",
			files: listSourceMapFiles(this.extSourceMap),
		}
	}

	async extGetProperties(params: { objectId: string; ownProperties?: boolean }): Promise<any> {
		return this.extCdp.send("Runtime.getProperties", {
			objectId: params.objectId,
			ownProperties: params.ownProperties !== false,
			generatePreview: true,
		})
	}

	async extGetScriptSource(params: { scriptId: string }): Promise<any> {
		return this.extCdp.send("Debugger.getScriptSource", { scriptId: params.scriptId })
	}

	// ────────────────────────────────────────────
	// Webview Debugging
	// ────────────────────────────────────────────

	private getWebCdp(): CDPSession {
		if (!this.webCdpSession) throw new Error("Webview CDP not connected. Call connect_webview first.")
		return this.webCdpSession
	}

	async webSetBreakpoint(params: { url: string; line: number; column?: number; condition?: string }): Promise<any> {
		return this.getWebCdp().send("Debugger.setBreakpointByUrl", {
			urlRegex: params.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
			lineNumber: params.line - 1,
			columnNumber: params.column ? params.column - 1 : 0,
			condition: params.condition || "",
		})
	}

	async webRemoveBreakpoint(params: { breakpointId: string }): Promise<void> {
		await this.getWebCdp().send("Debugger.removeBreakpoint", { breakpointId: params.breakpointId })
	}

	async webEvaluate(params: { expression: string; callFrameId?: string }): Promise<any> {
		// For simple evaluation without breakpoints, use Playwright frame.evaluate
		if (!params.callFrameId) {
			const sidebar = await this.findSidebar()
			if (sidebar) {
				try {
					const result = await sidebar.evaluate((expr: string) => {
						// eslint-disable-next-line no-eval
						return eval(expr)
					}, params.expression)
					return { result: { type: typeof result, value: result } }
				} catch (e: any) {
					return { error: e.message }
				}
			}
		}
		// For evaluation at a breakpoint, use CDP
		if (params.callFrameId) {
			return this.getWebCdp().send("Debugger.evaluateOnCallFrame", {
				callFrameId: params.callFrameId,
				expression: params.expression,
				returnByValue: true,
				generatePreview: true,
			})
		}
		return this.getWebCdp().send("Runtime.evaluate", {
			expression: params.expression,
			returnByValue: true,
			generatePreview: true,
		})
	}

	/**
	 * Send a postMessage to the extension host via the webview's exposed vsCodeApi.
	 * The vsCodeApi is exposed on window.__clineVsCodeApi by platform.config.ts.
	 * This works even though acquireVsCodeApi() can only be called once.
	 */
	async webPostMessage(params: { message: any }): Promise<any> {
		const sidebar = await this.findSidebar()
		if (!sidebar) throw new Error("Sidebar not found")
		try {
			const result = await sidebar.evaluate((msg: any) => {
				const api = (window as any).__clineVsCodeApi
				if (!api) {
					throw new Error(
						"window.__clineVsCodeApi not found. " +
							"The webview may not have loaded yet, or the extension was built without the debug bridge.",
					)
				}
				api.postMessage(msg)
				return { sent: true }
			}, params.message)
			return result
		} catch (e: any) {
			return { error: e.message }
		}
	}

	async webPause(): Promise<void> {
		await this.getWebCdp().send("Debugger.pause")
	}
	async webResume(): Promise<void> {
		await this.getWebCdp().send("Debugger.resume")
	}
	async webStepOver(): Promise<void> {
		await this.getWebCdp().send("Debugger.stepOver")
	}
	async webStepInto(): Promise<void> {
		await this.getWebCdp().send("Debugger.stepInto")
	}
	async webStepOut(): Promise<void> {
		await this.getWebCdp().send("Debugger.stepOut")
	}

	// ────────────────────────────────────────────
	// UI Automation
	// ────────────────────────────────────────────

	async uiScreenshot(params: { fullPage?: boolean } = {}): Promise<any> {
		if (!this.page) throw new Error("VSCode not running")
		this.screenshotCounter++
		const filePath = path.join(SCREENSHOT_DIR, `screenshot-${String(this.screenshotCounter).padStart(4, "0")}.png`)
		await this.page.screenshot({ path: filePath, fullPage: params.fullPage })
		log(`Screenshot saved: ${filePath}`)
		return { path: filePath, counter: this.screenshotCounter }
	}

	async uiSidebarScreenshot(): Promise<any> {
		const sidebar = await this.findSidebar()
		if (!sidebar) throw new Error("Sidebar not found")
		this.screenshotCounter++
		const filePath = path.join(SCREENSHOT_DIR, `sidebar-${String(this.screenshotCounter).padStart(4, "0")}.png`)
		// Take a full page screenshot - frame-level screenshots might not work on webviews
		if (this.page) {
			await this.page.screenshot({ path: filePath })
		}
		return { path: filePath, counter: this.screenshotCounter }
	}

	async uiClick(params: { selector: string; frame?: string; delay?: number }): Promise<void> {
		const target = await this.getTarget(params.frame)
		await target.click(params.selector, { delay: params.delay })
	}

	async uiFill(params: { selector: string; text: string; frame?: string }): Promise<void> {
		const target = await this.getTarget(params.frame)
		await target.fill(params.selector, params.text)
	}

	async uiPress(params: { key: string }): Promise<void> {
		if (!this.page) throw new Error("VSCode not running")
		await this.page.keyboard.press(params.key)
	}

	async uiType(params: { text: string; delay?: number }): Promise<void> {
		if (!this.page) throw new Error("VSCode not running")
		await this.page.keyboard.type(params.text, { delay: params.delay })
	}

	async uiOpenSidebar(): Promise<any> {
		if (!this.page) throw new Error("VSCode not running")
		try {
			await this.page.getByRole("tab", { name: /Cline/ }).locator("a").click()
		} catch {
			// Activity bar might need a different approach
			await this.page.keyboard.press("Meta+Shift+p")
			await sleep(300)
			await this.page.keyboard.type("Cline: Focus on Cline View")
			await sleep(200)
			await this.page.keyboard.press("Enter")
		}
		const sidebar = await this.findSidebar()
		return { found: !!sidebar }
	}

	async uiFrames(): Promise<any> {
		if (!this.page) throw new Error("VSCode not running")
		const frames: { name: string; url: string; title: string; detached: boolean }[] = []
		for (const f of this.page.frames()) {
			try {
				frames.push({
					name: f.name(),
					url: f.url(),
					title: await f.title().catch(() => ""),
					detached: f.isDetached(),
				})
			} catch {}
		}
		return { frames }
	}

	async uiWaitForSelector(params: { selector: string; frame?: string; timeout?: number }): Promise<void> {
		const target = await this.getTarget(params.frame)
		await target.waitForSelector(params.selector, { timeout: params.timeout || 10000 })
	}

	async uiCommandPalette(params: { command: string }): Promise<void> {
		if (!this.page) throw new Error("VSCode not running")
		await this.page.keyboard.press("Meta+Shift+p")
		await sleep(500)
		await this.page.keyboard.type(params.command)
		await sleep(300)
		await this.page.keyboard.press("Enter")
	}

	async uiGetText(params: { selector: string; frame?: string }): Promise<any> {
		const target = await this.getTarget(params.frame)
		const text = await target.textContent(params.selector)
		return { text }
	}

	/**
	 * Set text in a React-controlled textarea using execCommand('insertText').
	 * This fires real InputEvent/input events that React's onChange handler processes,
	 * unlike Playwright's fill() or nativeInputValueSetter which bypass React's
	 * synthetic event system and fail after the first task.
	 *
	 * Params:
	 *   selector - CSS selector for the textarea (default: '[data-testid="chat-input"]')
	 *   text     - Text to insert
	 *   clear    - Whether to clear existing content first (default: true)
	 *   submit   - Whether to press Enter after typing (default: false)
	 */
	async uiReactInput(params: { selector?: string; text: string; clear?: boolean; submit?: boolean }): Promise<any> {
		const sidebar = await this.findSidebar()
		if (!sidebar) throw new Error("Sidebar not found")

		const selector = params.selector || '[data-testid="chat-input"]'
		const clear = params.clear !== false
		const text = params.text

		const result = await sidebar.evaluate(
			({ selector, text, clear }: { selector: string; text: string; clear: boolean }) => {
				const el = document.querySelector(selector) as HTMLTextAreaElement | null
				if (!el) throw new Error(`Element not found: ${selector}`)

				// Focus the element
				el.focus()

				// Clear existing content if requested
				if (clear && el.value.length > 0) {
					// Select all text and delete it
					el.setSelectionRange(0, el.value.length)
					document.execCommand("delete", false)
				}

				// Insert new text using execCommand which fires proper InputEvents
				// that React's synthetic event system handles correctly
				document.execCommand("insertText", false, text)

				return { value: el.value, length: el.value.length }
			},
			{ selector, text, clear },
		)

		// Optionally submit by pressing Enter
		if (params.submit && this.page) {
			// Brief pause to let React process the input event
			await sleep(100)
			await this.page.keyboard.press("Enter")
		}

		return { ...result, submitted: !!params.submit }
	}

	/**
	 * Send a chat message by directly invoking the webview's gRPC client.
	 * This completely bypasses the textarea, avoiding all React state issues.
	 * Works reliably regardless of how many tasks have been completed.
	 *
	 * For new tasks (no active conversation), sends via TaskServiceClient.newTask().
	 * For active conversations, sends via TaskServiceClient.askResponse().
	 */
	async uiSendMessage(params: {
		text: string
		images?: string[]
		files?: string[]
		responseType?: string
	}): Promise<any> {
		const sidebar = await this.findSidebar()
		if (!sidebar) throw new Error("Sidebar not found")

		return sidebar.evaluate(
			({ text, images, files, responseType }: { text: string; images: string[]; files: string[]; responseType?: string }) => {
				const api = (window as any).__clineVsCodeApi
				if (!api) {
					throw new Error("window.__clineVsCodeApi not found")
				}

				// Send as a gRPC request via postMessage, which the extension host
				// processes through its ProtoBus handler. This is the same mechanism
				// the webview uses internally.
				if (responseType) {
					// Responding to an ask (followup, resume, etc.)
					api.postMessage({
						type: "grpc_request",
						service: "cline.TaskService",
						method: "askResponse",
						requestId: `debug-${Date.now()}`,
						payload: { responseType, text, images, files },
					})
				} else {
					// New task
					api.postMessage({
						type: "grpc_request",
						service: "cline.TaskService",
						method: "newTask",
						requestId: `debug-${Date.now()}`,
						payload: { text, images, files },
					})
				}

				return { sent: true, method: responseType ? "askResponse" : "newTask" }
			},
			{
				text: params.text,
				images: params.images || [],
				files: params.files || [],
				responseType: params.responseType,
			},
		)
	}

	async uiLocator(params: {
		role?: string
		name?: string
		testId?: string
		text?: string
		frame?: string
		action?: "click" | "fill" | "text" | "visible" | "count"
		value?: string
	}): Promise<any> {
		// Retry with frame re-discovery on failure for sidebar targets
		const maxRetries = params.frame === "sidebar" ? 2 : 1
		let lastError: Error | null = null

		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				const forceRefresh = attempt > 0
				const target = await this.getTarget(params.frame, forceRefresh)
				let locator
				if (params.testId) {
					locator = target.getByTestId(params.testId)
				} else if (params.role) {
					locator = target.getByRole(params.role as any, params.name ? { name: params.name } : undefined)
				} else if (params.text) {
					locator = target.getByText(params.text)
				} else {
					throw new Error("Provide role, testId, or text")
				}

				switch (params.action) {
					case "click":
						await locator.click()
						return { done: true }
					case "fill":
						await locator.fill(params.value || "")
						return { done: true }
					case "text":
						return { text: await locator.textContent() }
					case "visible":
						return { visible: await locator.isVisible() }
					case "count":
						return { count: await locator.count() }
					default:
						return { visible: await locator.isVisible(), count: await locator.count() }
				}
			} catch (e: any) {
				lastError = e
				if (attempt < maxRetries - 1) {
					log(`ui.locator attempt ${attempt + 1} failed (${e.message}), retrying with frame refresh...`)
					this.sidebarFrame = null // Force re-discovery
					await sleep(500)
				}
			}
		}

		throw lastError || new Error("ui.locator failed")
	}

	private async getTarget(frame?: string, forceRefresh = false): Promise<Page | Frame> {
		if (!this.page) throw new Error("VSCode not running")
		if (frame === "sidebar") {
			const sb = await this.findSidebar(forceRefresh)
			if (!sb) throw new Error("Sidebar not found")
			return sb
		}
		return this.page
	}

	// ────────────────────────────────────────────
	// Combined
	// ────────────────────────────────────────────

	async waitForPause(params: { timeout?: number } = {}): Promise<any> {
		const timeout = params.timeout || 30000

		// Check if already paused
		if (this.extCdp.paused && this.extCdp.lastPauseInfo) {
			return { target: "extension", ...this.formatPauseInfo(this.extCdp.lastPauseInfo) }
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pauseWaiters = this.pauseWaiters.filter((w) => w.timer !== timer)
				reject(new Error(`wait_for_pause timed out after ${timeout}ms`))
			}, timeout)

			this.pauseWaiters.push({ resolve, timer })
		})
	}

	private resolvePauseWaiters(info: any): void {
		const waiters = this.pauseWaiters
		this.pauseWaiters = []
		for (const w of waiters) {
			clearTimeout(w.timer)
			w.resolve(info)
		}
	}

	async status(): Promise<any> {
		return {
			running: !!this.app,
			extCdpConnected: this.extCdp.connected,
			extPaused: this.extCdp.paused,
			extScriptsLoaded: this.extCdp.scripts.size,
			webCdpConnected: !!this.webCdpSession,
			sidebarFound: !!this.sidebarFrame && !this.sidebarFrame.isDetached(),
			hasSourceMap: !!this.extSourceMap,
			sourceMapFiles: this.extSourceMap?.sources.length || 0,
			screenshotDir: SCREENSHOT_DIR,
			projectRoot: PROJECT_ROOT,
		}
	}

	// ────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────

	private formatPauseInfo(params: any): any {
		return {
			reason: params.reason,
			hitBreakpoints: params.hitBreakpoints,
			callFrames: params.callFrames?.slice(0, 10).map(formatCallFrame),
		}
	}

	// ────────────────────────────────────────────
	// Command Dispatch
	// ────────────────────────────────────────────

	async handleCommand(method: string, params: any): Promise<any> {
		switch (method) {
			// Lifecycle
			case "launch":
				return this.launch(params)
			case "shutdown":
				return this.shutdown()
			case "status":
				return this.status()
			case "connect_webview":
				return this.connectWebview()

			// Extension host debugging
			case "ext.set_breakpoint":
				return this.extSetBreakpoint(params)
			case "ext.set_breakpoint_raw":
				return this.extSetBreakpointRaw(params)
			case "ext.remove_breakpoint":
				return this.extRemoveBreakpoint(params)
			case "ext.evaluate":
				return this.extEvaluate(params)
			case "ext.pause":
				return this.extPause()
			case "ext.resume":
				return this.extResume()
			case "ext.step_over":
				return this.extStepOver()
			case "ext.step_into":
				return this.extStepInto()
			case "ext.step_out":
				return this.extStepOut()
			case "ext.call_stack":
				return this.extCallStack()
			case "ext.scripts":
				return this.extScripts(params)
			case "ext.source_files":
				return this.extSourceFiles()
			case "ext.get_properties":
				return this.extGetProperties(params)
			case "ext.get_script_source":
				return this.extGetScriptSource(params)

			// Webview debugging
			case "web.set_breakpoint":
				return this.webSetBreakpoint(params)
			case "web.remove_breakpoint":
				return this.webRemoveBreakpoint(params)
			case "web.evaluate":
				return this.webEvaluate(params)
			case "web.post_message":
				return this.webPostMessage(params)
			case "web.pause":
				return this.webPause()
			case "web.resume":
				return this.webResume()
			case "web.step_over":
				return this.webStepOver()
			case "web.step_into":
				return this.webStepInto()
			case "web.step_out":
				return this.webStepOut()

			// UI automation
			case "ui.screenshot":
				return this.uiScreenshot(params)
			case "ui.sidebar_screenshot":
				return this.uiSidebarScreenshot()
			case "ui.click":
				return this.uiClick(params)
			case "ui.fill":
				return this.uiFill(params)
			case "ui.press":
				return this.uiPress(params)
			case "ui.type":
				return this.uiType(params)
			case "ui.open_sidebar":
				return this.uiOpenSidebar()
			case "ui.frames":
				return this.uiFrames()
			case "ui.wait_for_selector":
				return this.uiWaitForSelector(params)
			case "ui.command_palette":
				return this.uiCommandPalette(params)
			case "ui.get_text":
				return this.uiGetText(params)
			case "ui.locator":
				return this.uiLocator(params)
			case "ui.react_input":
				return this.uiReactInput(params)
			case "ui.send_message":
				return this.uiSendMessage(params)

			// Combined
			case "wait_for_pause":
				return this.waitForPause(params)

			default:
				throw new Error(`Unknown method: ${method}`)
		}
	}
}

// ============================================================
// Utilities
// ============================================================

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms))
}

async function waitUntil(pred: () => boolean, timeout: number, label: string): Promise<void> {
	const start = Date.now()
	while (!pred()) {
		if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`)
		await sleep(200)
	}
}

function formatCallFrame(f: any): any {
	return {
		callFrameId: f.callFrameId,
		functionName: f.functionName || "(anonymous)",
		url: f.url,
		lineNumber: (f.location?.lineNumber ?? f.lineNumber ?? -1) + 1,
		columnNumber: (f.location?.columnNumber ?? f.columnNumber ?? -1) + 1,
		scopeChain: f.scopeChain?.map((s: any) => ({
			type: s.type,
			name: s.name,
		})),
	}
}

function log(...args: any[]): void {
	const ts = new Date().toISOString().slice(11, 23)
	console.log(`[${ts}]`, ...args)
}

// ============================================================
// HTTP Server
// ============================================================

async function readBody(req: http.IncomingMessage): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of req) chunks.push(chunk as Buffer)
	return Buffer.concat(chunks).toString()
}

const harness = new DebugHarness()

const server = http.createServer(async (req, res) => {
	res.setHeader("Access-Control-Allow-Origin", "*")
	res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	res.setHeader("Access-Control-Allow-Headers", "Content-Type")

	if (req.method === "OPTIONS") {
		res.writeHead(204)
		res.end()
		return
	}

	if (req.method === "GET" && req.url === "/health") {
		res.writeHead(200, { "Content-Type": "application/json" })
		res.end(JSON.stringify({ status: "ok", port: PORT }))
		return
	}

	if (req.method === "GET" && req.url === "/status") {
		try {
			const status = await harness.handleCommand("status", {})
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify(status, null, 2))
		} catch (e: any) {
			res.writeHead(500, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: e.message }))
		}
		return
	}

	if (req.method === "POST" && req.url === "/api") {
		const startTime = Date.now()
		try {
			const body = await readBody(req)
			const { method, params } = JSON.parse(body)
			log(`→ ${method}`, params ? JSON.stringify(params).slice(0, 200) : "")
			const result = await harness.handleCommand(method, params || {})
			const elapsed = Date.now() - startTime
			log(`← ${method} (${elapsed}ms)`)
			res.writeHead(200, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ result }, null, 2))
		} catch (e: any) {
			const elapsed = Date.now() - startTime
			log(`✘ (${elapsed}ms)`, e.message)
			res.writeHead(500, { "Content-Type": "application/json" })
			res.end(JSON.stringify({ error: e.message, stack: e.stack?.split("\n").slice(0, 5) }))
		}
		return
	}

	res.writeHead(404, { "Content-Type": "text/plain" })
	res.end("Not found. Use POST /api or GET /health")
})

server.listen(PORT, "127.0.0.1", () => {
	log(`Debug harness server listening on http://localhost:${PORT}`)
	log(``)
	log(`Quick start:`)
	log(`  curl localhost:${PORT}/api -d '{"method":"launch"}'`)
	log(`  curl localhost:${PORT}/api -d '{"method":"ui.open_sidebar"}'`)
	log(`  curl localhost:${PORT}/api -d '{"method":"ui.screenshot"}'`)
	log(`  curl localhost:${PORT}/api -d '{"method":"ext.set_breakpoint","params":{"file":"src/extension.ts","line":42}}'`)
	log(`  curl localhost:${PORT}/api -d '{"method":"status"}'`)
	log(``)

	if (AUTO_LAUNCH) {
		harness
			.launch({
				workspace: WORKSPACE_ARG || DEFAULT_WORKSPACE,
				skipBuild: SKIP_BUILD,
			})
			.then((r) => log("Auto-launch complete:", r))
			.catch((e) => log("Auto-launch failed:", e.message))
	}
})

// Graceful shutdown
async function cleanShutdown() {
	log("Shutting down...")
	await harness.shutdown().catch(() => {})
	server.close()
	process.exit(0)
}
process.on("SIGINT", cleanShutdown)
process.on("SIGTERM", cleanShutdown)
