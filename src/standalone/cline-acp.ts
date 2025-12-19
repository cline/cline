import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { runAcp } from "./acp/acp-agent"

// Ensure logs do not interfere with ACP stdio traffic
console.log = console.error
console.info = console.error
console.warn = console.error
console.debug = console.error

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled rejection:", reason)
})

const args = parseArgs(process.argv.slice(2))
if (args.version) {
	const here = dirname(fileURLToPath(import.meta.url))
	const packagePath = resolve(here, "../../package.json")
	const raw = readFileSync(packagePath, "utf8")
	const json = JSON.parse(raw) as { version?: string }
	const version = json.version ?? "0.0.0"
	process.stdout.write(`${version}\n`)
	process.exit(0)
}
if (args.config) {
	process.env.CLINE_DIR = args.config
}

runAcp()

// Keep the process alive for stdio communication
process.stdin.resume()

function parseArgs(argv: string[]): { config?: string; version?: boolean } {
	const result: { config?: string; version?: boolean } = {}
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === "--config" || arg === "-c") {
			result.config = argv[i + 1]
			i += 1
		} else if (arg === "--version" || arg === "-v") {
			result.version = true
		}
	}
	return result
}
