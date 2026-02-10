#!/usr/bin/env node
/**
 * End-to-end CLI verification for Bedrock parallel tool calling.
 * - Builds the CLI if needed
 * - Runs a headless CLI task with yolo mode + JSON output
 * - Inspects latest task ui_messages.json for multiple tool calls in the same assistant turn
 */
import { execSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const section = (title) => console.log(`\n=== ${title} ===`)
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts })

const prompt = "Read README.md, read package.json, and list files in the repo root. Use tools in parallel if supported."

const workspace = process.cwd()
const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
const dataDir = path.join(clineDir, "data")

section("Build CLI (if needed)")
try {
	run("npm run cli:build", { stdio: "inherit" })
} catch (error) {
	console.error("❌ Failed to build CLI. Run `npm run cli:build` manually.")
	process.exit(1)
}

section("Run headless task")
try {
	// json + yolo force plain-text mode; act mode to avoid plan-only
	run(`node ./cli/dist/cli.mjs task -a -y --json --cwd "${workspace}" --config "${clineDir}" "${prompt}"`, { stdio: "inherit" })
} catch (error) {
	console.error("❌ CLI run failed. Check authentication and provider settings.")
	process.exit(1)
}

section("Locate latest task history")
const taskHistoryPath = path.join(dataDir, "state", "taskHistory.json")
if (!fs.existsSync(taskHistoryPath)) {
	console.error(`❌ taskHistory.json not found at ${taskHistoryPath}`)
	process.exit(1)
}
const history = JSON.parse(fs.readFileSync(taskHistoryPath, "utf8"))
if (!Array.isArray(history) || history.length === 0) {
	console.error("❌ No task history found.")
	process.exit(1)
}
const latest = [...history].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0]
if (!latest?.id) {
	console.error("❌ Could not determine latest task id.")
	process.exit(1)
}
console.log(`Latest task: ${latest.id}`)

section("Inspect ui_messages.json for parallel tool calls")
const uiMessagesPath = path.join(dataDir, "tasks", latest.id, "ui_messages.json")
if (!fs.existsSync(uiMessagesPath)) {
	console.error(`❌ ui_messages.json not found at ${uiMessagesPath}`)
	process.exit(1)
}
const messages = JSON.parse(fs.readFileSync(uiMessagesPath, "utf8"))

// Heuristic: find an api_req_started message and count tool messages until the next api_req_started
//
// NOTE: In Cline, tool execution messages are emitted as `say: "tool"` (not `ask: "tool"`).
// Also, this codebase no longer emits `api_req_finished` messages.
let hasParallel = false
for (let i = 0; i < messages.length; i++) {
	const msg = messages[i]
	if (msg.say === "api_req_started") {
		let toolCount = 0
		for (let j = i + 1; j < messages.length; j++) {
			const next = messages[j]
			// Next api_req_started means the previous request/turn is over.
			if (next.say === "api_req_started") {
				break
			}
			if (next.say === "tool") {
				toolCount += 1
			}
		}
		if (toolCount >= 2) {
			hasParallel = true
			break
		}
	}
}

if (hasParallel) {
	console.log("✅ Detected multiple tool calls within a single API turn (parallel tool calling).")
	process.exit(0)
}

console.log("⚠️ Did not detect multiple tool calls in a single API turn.")
console.log("- If you used Bedrock + Claude 4+ with parallel tool calling disabled, this should be ✅.")
console.log("- If not, check provider/model settings and try again.")
process.exit(2)
