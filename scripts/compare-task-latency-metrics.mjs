import fs from "node:fs/promises"
import path from "node:path"
import { compareTaskLatencySummaries, summarizeTaskLatencyEvents } from "../src/services/telemetry/taskLatencySummary"

function parseEventLines(raw) {
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.map((entry) => entry.properties ?? entry)
		.filter(Boolean)
}

async function loadSummary(inputPath) {
	const absolutePath = path.resolve(process.cwd(), inputPath)
	const raw = await fs.readFile(absolutePath, "utf8")
	return summarizeTaskLatencyEvents(parseEventLines(raw))
}

async function main() {
	const baselinePath = process.argv[2]
	const candidatePath = process.argv[3]
	if (!baselinePath || !candidatePath) {
		console.error("Usage: node scripts/compare-task-latency-metrics.mjs <baseline-jsonl> <candidate-jsonl>")
		process.exit(1)
	}

	const baseline = await loadSummary(baselinePath)
	const candidate = await loadSummary(candidatePath)
	console.log(JSON.stringify(compareTaskLatencySummaries(baseline, candidate), null, 2))
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
