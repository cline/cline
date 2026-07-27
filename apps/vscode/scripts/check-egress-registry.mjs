import { readdir, readFile } from "node:fs/promises"
import { dirname, extname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "../../..")
const registryPath = resolve(repositoryRoot, "security/egress-registry.json")
const scanRoots = [
	"apps/vscode/src",
	"apps/vscode/scripts",
	"sdk/packages/shared/src",
	"sdk/packages/llms/src",
	"sdk/packages/agents/src",
	"sdk/packages/core/src",
	"sdk/scripts",
]
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".mts", ".cjs"])

const patterns = {
	fetch_call: /\b(?:globalThis\.)?fetch\s*\(/g,
	fetch_impl_call: /\bfetchImpl\s*\(/g,
	fetch_reference: /\bfetch\s*:\s*globalThis\.fetch\b/g,
	axios_call: /\baxios\.(?:get|post|head|put|patch|delete|request)\s*\(/g,
	node_http_request: /\b(?:http|https)\.(?:request|get)\s*\(/g,
	websocket_construct: /\bnew\s+(?:WebSocket|WebSocketServer)\s*\(/g,
	aws_client_construct: /\bnew\s+(?:BedrockRuntimeClient|BedrockClient|STSClient)\s*\(/g,
	browser_navigation: /\.goto\s*\(/g,
	mcp_remote_transport: /\bnew\s+(?:SSEClientTransport|StreamableHTTPClientTransport)\s*\(/g,
	bun_spawn: /\bBun\.spawn\s*\(/g,
	open_external: /\bopenExternal\s*\(/g,
	vscode_terminal_send: /\.sendText\s*\(/g,
}

const childProcessCallPattern = /\b(?:spawn|spawnSync|execFile|execFileSync|execSync|exec)\s*\(/g

function ignored(relativePath) {
	const normalized = relativePath.replaceAll("\\", "/")
	return (
		/(?:^|\/)(?:node_modules|dist|build|out|generated|dev|test|tests|__tests__)(?:\/|$)/.test(normalized) ||
		/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
	)
}

async function collectFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	const files = []
	for (const entry of entries) {
		const absolute = resolve(directory, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(absolute)))
		} else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
			files.push(absolute)
		}
	}
	return files
}

function countMatches(source, pattern) {
	pattern.lastIndex = 0
	return [...source.matchAll(pattern)].length
}

async function discover() {
	const discovered = {}
	for (const root of scanRoots) {
		const absoluteRoot = resolve(repositoryRoot, root)
		for (const file of await collectFiles(absoluteRoot)) {
			const relativePath = relative(repositoryRoot, file).replaceAll("\\", "/")
			if (ignored(relativePath)) continue
			const source = await readFile(file, "utf8")
			const counts = {}
			for (const [kind, pattern] of Object.entries(patterns)) {
				const count = countMatches(source, pattern)
				if (count > 0) counts[kind] = count
			}
			if (/from\s+["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\)/.test(source)) {
				const count = countMatches(source, childProcessCallPattern)
				if (count > 0) counts.child_process_call = count
			}
			if (Object.keys(counts).length > 0) discovered[relativePath] = counts
		}
	}
	return discovered
}

const discovered = await discover()
if (process.argv.includes("--print")) {
	console.log(JSON.stringify(discovered, null, 2))
	process.exit(0)
}

const registry = JSON.parse(await readFile(registryPath, "utf8"))
const registered = Object.fromEntries(registry.entries.map((entry) => [entry.file, entry.counts]))
const failures = []

for (const [file, counts] of Object.entries(discovered)) {
	if (!registered[file]) {
		failures.push(`Unregistered egress/execution sink file: ${file} ${JSON.stringify(counts)}`)
		continue
	}
	if (JSON.stringify(counts) !== JSON.stringify(registered[file])) {
		failures.push(
			`Sink count changed for ${file}: expected ${JSON.stringify(registered[file])}, found ${JSON.stringify(counts)}`,
		)
	}
}
for (const file of Object.keys(registered)) {
	if (!discovered[file]) failures.push(`Registry entry has no matching sink: ${file}`)
}

const forbiddenProductionPatterns = [
	["webhook integration", /webhook-hooks|lg-cns-integration|webhook_url|webhook-token/i],
	["remote MCP transport construction", /new\s+(?:SSEClientTransport|StreamableHTTPClientTransport)\s*\(/],
	["automatic link preview request", /open-graph-scraper|axios\.head\s*\(/],
	["telemetry/analytics service", /\b(?:posthog|sentry|segment\.io|google-analytics)\b/i],
]
const productionBundleInputs = [resolve(repositoryRoot, "apps/vscode/src"), resolve(repositoryRoot, "sdk/packages/core/src")]
for (const root of productionBundleInputs) {
	for (const file of await collectFiles(root)) {
		const relativePath = relative(repositoryRoot, file).replaceAll("\\", "/")
		if (ignored(relativePath)) continue
		const source = await readFile(file, "utf8")
		for (const [name, pattern] of forbiddenProductionPatterns) {
			if (pattern.test(source)) failures.push(`Forbidden ${name} remains in ${relativePath}`)
		}
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`[egress] ${failure}`)
	process.exit(1)
}
console.log(`[egress] ${Object.keys(discovered).length} registered sink files verified`)
