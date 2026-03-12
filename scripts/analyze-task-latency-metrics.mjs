import fs from "node:fs/promises"
import path from "node:path"
import { summarizeTaskLatencyEvents } from "../src/services/telemetry/taskLatencySummary"

function parseEventLines(raw) {
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.map((entry) => entry.properties ?? entry)
		.filter((entry) => entry)
}

async function main() {
	const inputPath = process.argv[2]
	if (!inputPath) {
		console.error("Usage: node scripts/analyze-task-latency-metrics.mjs <path-to-jsonl>")
		process.exit(1)
	}

	const absolutePath = path.resolve(process.cwd(), inputPath)
	const raw = await fs.readFile(absolutePath, "utf8")
	const events = parseEventLines(raw)
	const summary = summarizeTaskLatencyEvents(events)
	console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
