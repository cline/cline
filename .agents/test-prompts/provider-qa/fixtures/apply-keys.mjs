#!/usr/bin/env node
// Writes a providers.json into a Cline data directory from a qa-keys.json file.
//
//   --keys <file>     source credentials (required)
//   --list            print which entries carry usable credentials, write nothing
//   --dir <dataDir>   target data dir; providers.json goes to <dataDir>/settings/
//   --select <id>     mark that provider as lastUsedProvider
//   --only <a,b>      restrict the written providers to these ids
//   --print           echo the resulting file
//
// Only providers.json is written. The legacy globalState store is deliberately
// left alone: it is one of the things under test.

import fs from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
function flag(name) {
	return args.includes(name)
}
function opt(name, fallback) {
	const i = args.indexOf(name)
	return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const keysPath = opt("--keys", "/tmp/qa-keys.json")
const listOnly = flag("--list")
const printResult = flag("--print")
const dataDir = opt("--dir", process.env.CLINE_DATA_DIR)
const select = opt("--select", null)
const only = opt("--only", null)

if (!fs.existsSync(keysPath)) {
	console.error(`apply-keys: keys file not found: ${keysPath}`)
	process.exit(2)
}

const keys = JSON.parse(fs.readFileSync(keysPath, "utf8"))

// Providers that are usable without an apiKey, because they authenticate some
// other way or run locally.
const NO_API_KEY_NEEDED = new Set(["ollama", "lmstudio", "vscode-lm", "bedrock", "vertex"])

function hasCredential(id, entry) {
	if (!entry || typeof entry !== "object") return false
	if (id === "bedrock") return Boolean(entry.awsAccessKey && entry.awsSecretKey)
	if (id === "vertex") return Boolean(entry.vertexProjectId)
	if (NO_API_KEY_NEEDED.has(id)) return Boolean(entry.baseUrl)
	return Boolean(entry.apiKey)
}

function toSettings(id, entry) {
	const settings = { provider: id }
	if (entry.apiKey) settings.apiKey = entry.apiKey
	if (entry.model) settings.model = entry.model
	if (entry.baseUrl) settings.baseUrl = entry.baseUrl
	if (entry.awsAccessKey || entry.awsSecretKey || entry.awsRegion) {
		settings.aws = {}
		if (entry.awsAccessKey) settings.aws.accessKey = entry.awsAccessKey
		if (entry.awsSecretKey) settings.aws.secretKey = entry.awsSecretKey
		if (entry.awsRegion) settings.aws.region = entry.awsRegion
	}
	if (entry.vertexProjectId || entry.vertexRegion) {
		settings.gcp = {}
		if (entry.vertexProjectId) settings.gcp.projectId = entry.vertexProjectId
		if (entry.vertexRegion) settings.gcp.region = entry.vertexRegion
	}
	return settings
}

const usable = []
const notProvided = []
for (const [id, entry] of Object.entries(keys)) {
	;(hasCredential(id, entry) ? usable : notProvided).push(id)
}

if (listOnly) {
	console.log(`keys file: ${keysPath}`)
	console.log(`usable        (${usable.length}): ${usable.join(", ") || "(none)"}`)
	console.log(`not provided  (${notProvided.length}): ${notProvided.join(", ") || "(none)"}`)
	for (const id of usable) {
		const e = keys[id]
		const masked = e.apiKey ? `${String(e.apiKey).slice(0, 6)}…(${String(e.apiKey).length})` : "-"
		console.log(`  ${id.padEnd(20)} key=${masked.padEnd(16)} model=${e.model || "-"} baseUrl=${e.baseUrl || "-"}`)
	}
	process.exit(0)
}

if (!dataDir) {
	console.error("apply-keys: --dir or CLINE_DATA_DIR required")
	process.exit(2)
}

const allow = only ? new Set(only.split(",").map((s) => s.trim())) : null
const providers = {}
for (const id of usable) {
	if (allow && !allow.has(id)) continue
	providers[id] = {
		settings: toSettings(id, keys[id]),
		updatedAt: new Date().toISOString(),
		tokenSource: "manual",
	}
}

if (select && !providers[select]) {
	console.error(`apply-keys: --select ${select} has no usable credential in ${keysPath}`)
	process.exit(2)
}

const stored = { version: 1, providers }
if (select) stored.lastUsedProvider = select

const settingsDir = path.join(dataDir, "settings")
fs.mkdirSync(settingsDir, { recursive: true })
const target = path.join(settingsDir, "providers.json")
fs.writeFileSync(target, `${JSON.stringify(stored, null, 2)}\n`)

console.log(`apply-keys: wrote ${Object.keys(providers).length} provider(s) to ${target}`)
console.log(`apply-keys: lastUsedProvider=${stored.lastUsedProvider ?? "(unset)"}`)
if (printResult) console.log(fs.readFileSync(target, "utf8"))
