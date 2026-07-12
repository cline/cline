import fs from "node:fs"
import path from "node:path"

const sourceRoot = path.resolve(process.argv[2] || "test-results/playwright")
const outputRoot = path.resolve(process.argv[3] || "test-results/sanitized")
const textAllowlist = new Set([".json", ".log", ".md", ".txt"])
const secretPatterns = [
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
	/\bsk-[A-Za-z0-9_-]{16,}\b/,
	/\bBearer\s+[A-Za-z0-9._~-]{12,}\b/i,
	/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
	/["']?(api[_-]?key|token|secret|password)["']?\s*[:=]\s*["'][^"']{4,}["']/i,
]

const manifest = { copied: [], skipped: [] }
fs.rmSync(outputRoot, { recursive: true, force: true })
fs.mkdirSync(outputRoot, { recursive: true })

function redact(text) {
	let sanitized = text
	for (const value of [process.env.HOME, process.env.USERPROFILE]) {
		if (value) sanitized = sanitized.split(value).join("<HOME>")
	}
	return sanitized
		.replace(/\/Users\/[^/\s"']+/g, "/Users/<USER>")
		.replace(/\/home\/[^/\s"']+/g, "/home/<USER>")
		.replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, "C:\\Users\\<USER>")
		.replace(/aihydro-(phase0-workspace|e2e-home)-[A-Za-z0-9_-]+/g, "aihydro-$1-<RUN>")
}

function visit(dir) {
	if (!fs.existsSync(dir)) return
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const absolute = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			visit(absolute)
			continue
		}
		const relative = path.relative(sourceRoot, absolute)
		const extension = path.extname(entry.name).toLowerCase()
		const destination = path.join(outputRoot, relative)
		if (!textAllowlist.has(extension)) {
			manifest.skipped.push({ file: relative, reason: "not-redactable-or-not-allowlisted" })
			continue
		}
		const sanitized = redact(fs.readFileSync(absolute, "utf8"))
		if (secretPatterns.some((pattern) => pattern.test(sanitized))) {
			manifest.skipped.push({ file: relative, reason: "sensitive-pattern" })
			continue
		}
		fs.mkdirSync(path.dirname(destination), { recursive: true })
		fs.writeFileSync(destination, sanitized, "utf8")
		manifest.copied.push(relative)
	}
}

visit(sourceRoot)
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
