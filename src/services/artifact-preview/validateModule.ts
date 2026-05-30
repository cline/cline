/**
 * validateModule — deterministic lint for AI-Hydro interactive modules.
 *
 * Encodes the statically-checkable subset of the interactive-module-builder
 * pre-publish checklist as code, so human contributors (and the skill's own
 * self-review step) get a repeatable gate instead of a prompt-only checklist.
 *
 * Findings are advisory: this is a linter, not a hard fail. It parses raw HTML
 * with focused regular expressions (no DOM dependency) so it can run anywhere —
 * the extension host, a command, or a test. Anything that genuinely needs a
 * rendered DOM or a running kernel is intentionally out of scope.
 */

export type FindingSeverity = "error" | "warn" | "info"

export interface ModuleFinding {
	severity: FindingSeverity
	code: string
	message: string
	cellId?: string
}

export interface ModuleValidationResult {
	findings: ModuleFinding[]
	errorCount: number
	warnCount: number
	cellCount: number
	ok: boolean
}

const MANIFEST_TYPE = "application/vnd.aihydro.module+json"
const REQUIRED_MANIFEST_FIELDS = ["id", "title", "version", "authors", "license", "topic"]

// Patterns flagged inside Python cell source. Kept narrow to avoid false hits.
const PYTHON_CELL_RULES: Array<{ code: string; severity: FindingSeverity; re: RegExp; message: string }> = [
	{
		code: "PY_PLT_SHOW",
		severity: "warn",
		re: /\bplt\s*\.\s*show\s*\(/,
		message: "plt.show() is unnecessary — the kernel auto-captures open figures.",
	},
	{
		code: "PY_MPL_USE",
		severity: "warn",
		re: /matplotlib\s*\.\s*use\s*\(/,
		message: "matplotlib.use(...) is unnecessary — the kernel sets the Agg backend at startup.",
	},
	{
		code: "PY_CSS_RGBA",
		severity: "warn",
		re: /rgba\s*\(/,
		message: "CSS rgba() string in a cell — matplotlib needs hex or (r,g,b,a) tuples, not CSS syntax.",
	},
	{
		code: "PY_FILE_IO",
		severity: "warn",
		re: /\b(open\s*\(|os\.path\.exists\s*\(|json\.load\s*\()/,
		message: "File I/O in a cell — embed data as constants instead.",
	},
]

function extractManifest(html: string): { json: Record<string, unknown> | null; present: boolean; parseError?: string } {
	const re = new RegExp(`<script[^>]*type=["']${MANIFEST_TYPE.replace(/[.+/]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)</script>`, "i")
	const m = re.exec(html)
	if (!m) return { json: null, present: false }
	try {
		return { json: JSON.parse(m[1].trim()) as Record<string, unknown>, present: true }
	} catch (err) {
		return { json: null, present: true, parseError: err instanceof Error ? err.message : String(err) }
	}
}

interface ParsedCell {
	id: string | null
	language: string | null
	renderMode: string | null
	openTag: string
	body: string
}

function extractCells(html: string): ParsedCell[] {
	const cells: ParsedCell[] = []
	// Match each .aihydro-cell opening tag, then capture up to the matching count
	// is hard with regex; we slice from each opening tag to the next one (or EOF).
	// Match the cell class token exactly — the negative lookahead stops
	// `aihydro-cell` from also matching `aihydro-cell-header`, whose hyphen
	// otherwise satisfies the trailing \b and double-counts (and mis-segments) cells.
	const openRe = /<div\b[^>]*class=["'][^"']*\baihydro-cell(?![\w-])[^"']*["'][^>]*>/gi
	const matches: Array<{ tag: string; index: number }> = []
	let m: RegExpExecArray | null
	while ((m = openRe.exec(html)) !== null) {
		matches.push({ tag: m[0], index: m.index })
	}
	for (let i = 0; i < matches.length; i++) {
		const start = matches[i].index
		const end = i + 1 < matches.length ? matches[i + 1].index : html.length
		const segment = html.slice(start, end)
		const tag = matches[i].tag
		const idM = /data-aihydro-cell-id=["']([^"']*)["']/i.exec(tag)
		const langM = /data-language=["']([^"']*)["']/i.exec(tag)
		const renderM = /data-aihydro-render=["']([^"']*)["']/i.exec(tag)
		cells.push({
			id: idM ? idM[1] : null,
			language: langM ? langM[1] : null,
			renderMode: renderM ? renderM[1] : null,
			openTag: tag,
			body: segment,
		})
	}
	return cells
}

function extractSource(cellBody: string): string {
	const m = /<pre\b[^>]*class=["'][^"']*\baihydro-source\b[^"']*["'][^>]*>([\s\S]*?)<\/pre>/i.exec(cellBody)
	return m ? m[1] : ""
}

export function validateModule(html: string): ModuleValidationResult {
	const findings: ModuleFinding[] = []
	const add = (severity: FindingSeverity, code: string, message: string, cellId?: string) =>
		findings.push({ severity, code, message, cellId })

	// ── Manifest ──────────────────────────────────────────────────────────
	const manifest = extractManifest(html)
	if (!manifest.present) {
		add("error", "MANIFEST_MISSING", `Module manifest <script type="${MANIFEST_TYPE}"> is missing.`)
	} else if (!manifest.json) {
		add("error", "MANIFEST_INVALID", `Module manifest is not valid JSON: ${manifest.parseError ?? "parse failed"}.`)
	} else {
		for (const field of REQUIRED_MANIFEST_FIELDS) {
			const v = manifest.json[field]
			if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
				add("error", "MANIFEST_FIELD", `Manifest is missing required field "${field}".`)
			}
		}
		if (typeof manifest.json.license === "string" && manifest.json.license !== "CC-BY-4.0") {
			add("warn", "MANIFEST_LICENSE", `Manifest license is "${manifest.json.license}" — expected "CC-BY-4.0".`)
		}
		if (Array.isArray(manifest.json.authors) && manifest.json.authors.length === 0) {
			add("error", "MANIFEST_AUTHORS", "Manifest authors array is empty.")
		}
	}

	// ── Cells ─────────────────────────────────────────────────────────────
	const cells = extractCells(html)
	const seenIds = new Map<string, number>()
	for (const cell of cells) {
		if (!cell.id) {
			add("error", "CELL_NO_ID", "An .aihydro-cell is missing data-aihydro-cell-id.")
		} else {
			seenIds.set(cell.id, (seenIds.get(cell.id) ?? 0) + 1)
		}
		if (!cell.language) {
			add("error", "CELL_NO_LANG", "An .aihydro-cell is missing data-language.", cell.id ?? undefined)
		}
		// <code> wrapper inside the source pre breaks cell execution.
		if (/<pre\b[^>]*class=["'][^"']*\baihydro-source\b[^"']*["'][^>]*>\s*<code\b/i.test(cell.body)) {
			add(
				"error",
				"CELL_CODE_WRAPPER",
				'Cell source uses a <code> wrapper — use <pre class="aihydro-source"> directly.',
				cell.id ?? undefined,
			)
		}
		// Run button must not use onclick.
		if (/<button\b[^>]*\bonclick=/i.test(cell.body)) {
			add(
				"error",
				"CELL_ONCLICK",
				'Cell Run button uses onclick — use <button class="aihydro-run" type="button"> with no handler.',
				cell.id ?? undefined,
			)
		}
		// Python-source rules.
		const lang = (cell.language ?? "python").toLowerCase()
		const isVideoCell = cell.renderMode?.toLowerCase() === "video" || lang === "manim"
		if (lang === "python" && !isVideoCell) {
			const source = extractSource(cell.body)
			for (const rule of PYTHON_CELL_RULES) {
				if (rule.re.test(source)) {
					add(rule.severity, rule.code, rule.message, cell.id ?? undefined)
				}
			}
		}
		// Video-render (Manim) cells must define at least one Scene subclass,
		// otherwise the kernel renders nothing.
		if (isVideoCell) {
			const source = extractSource(cell.body)
			if (!/\bclass\s+\w+\s*\([^)]*\bScene\b[^)]*\)/.test(source)) {
				add(
					"error",
					"VIDEO_NO_SCENE",
					'Video-render cell (data-aihydro-render="video" / data-language="manim") defines no Manim Scene subclass — it will render nothing.',
					cell.id ?? undefined,
				)
			}
		}
	}
	for (const [id, count] of seenIds) {
		if (count > 1) {
			add(
				"error",
				"CELL_DUP_ID",
				`Duplicate data-aihydro-cell-id "${id}" (${count}×) — the kernel only matches the first.`,
				id,
			)
		}
	}

	// ── Required document furniture ─────────────────────────────────────────
	if (!/class=["'][^"']*\baihydro-provenance\b/i.test(html)) {
		add("warn", "NO_PROVENANCE", "No provenance footer (.aihydro-provenance) found.")
	}
	if (!/creativecommons\.org\/licenses\/by\/4\.0/i.test(html)) {
		add("warn", "NO_LICENSE_LINK", "No CC-BY-4.0 license link found in the document.")
	}
	if (!/\b(references|bibliography)\b/i.test(html)) {
		add("info", "NO_REFERENCES", "No References/Bibliography section heading detected.")
	}
	if (!/class=["'][^"']*\b(aihydro-quiz|aihydro-question)\b/i.test(html)) {
		add("info", "NO_QUIZ", "No quiz checkpoint (.aihydro-quiz) found — at least one is recommended.")
	}

	// ── Library / CDN hygiene ───────────────────────────────────────────────
	// scene3d owns three.js (pinned three@0.128.0, last UMD OrbitControls
	// release). Authors must not hardcode their own three.js tag, and ESM-only
	// (examples/jsm) or floating (@latest) paths silently break the scene.
	const scriptSrcRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi
	let s: RegExpExecArray | null
	while ((s = scriptSrcRe.exec(html)) !== null) {
		const src = s[1]
		if (/\bthree(\.min)?\.js\b|\/three@|\/build\/three\b/i.test(src)) {
			add(
				"warn",
				"THREE_HARDCODED",
				`Hardcoded three.js script tag (${src}) — let aihydro.scene3d() own three.js (it pins three@0.128.0). Remove the tag.`,
			)
		}
		if (/examples\/jsm\//i.test(src)) {
			add(
				"error",
				"CDN_JSM_PATH",
				`ESM-only path "${src}" — examples/jsm/ controls 404 under the UMD loader and leave the canvas black. Use the bridge's pinned loader instead.`,
			)
		}
		if (/@latest\b/i.test(src)) {
			add(
				"warn",
				"CDN_FLOATING",
				`Floating CDN version "@latest" in ${src} — pin an exact version so the module doesn't break when the CDN updates.`,
			)
		}
	}
	// Orphan interactive canvases: a sim/scene3d canvas with no matching
	// window.aihydro call will render nothing.
	if (/data-aihydro-sim\b/i.test(html) && !/\.sim\s*\(/.test(html)) {
		add(
			"warn",
			"SIM_NO_CALL",
			"A <canvas data-aihydro-sim> exists but no aihydro.sim(...) call drives it — the canvas will stay blank.",
		)
	}
	if (/data-aihydro-scene3d\b/i.test(html) && !/\.scene3d\s*\(/.test(html)) {
		add(
			"warn",
			"SCENE3D_NO_CALL",
			"A <canvas data-aihydro-scene3d> exists but no aihydro.scene3d(...) call drives it — the canvas will stay blank.",
		)
	}

	const errorCount = findings.filter((f) => f.severity === "error").length
	const warnCount = findings.filter((f) => f.severity === "warn").length
	return { findings, errorCount, warnCount, cellCount: cells.length, ok: errorCount === 0 }
}

/** Render findings as a human-readable report for an output channel or CLI. */
export function formatValidationReport(result: ModuleValidationResult, label?: string): string {
	const lines: string[] = []
	lines.push(`AI-Hydro module validation${label ? `: ${label}` : ""}`)
	lines.push(`  cells: ${result.cellCount}  errors: ${result.errorCount}  warnings: ${result.warnCount}`)
	if (result.findings.length === 0) {
		lines.push("  ✓ No issues found.")
		return lines.join("\n")
	}
	const order: FindingSeverity[] = ["error", "warn", "info"]
	const icon: Record<FindingSeverity, string> = { error: "✗", warn: "⚠", info: "ℹ" }
	for (const sev of order) {
		for (const f of result.findings.filter((x) => x.severity === sev)) {
			const where = f.cellId ? ` [cell: ${f.cellId}]` : ""
			lines.push(`  ${icon[sev]} ${f.code}${where}: ${f.message}`)
		}
	}
	return lines.join("\n")
}
