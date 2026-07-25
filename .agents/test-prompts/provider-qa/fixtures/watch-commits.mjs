#!/usr/bin/env node
// Logs every change to the committed provider/model selection, so a UI
// interaction can be attributed to the exact value it wrote without reading
// anything off the screen.
//
//   node watch-commits.mjs <dataDir> [--interval 100]
//
// Polls providers.json (isolated) and ~/.cline/data/globalState.json (home) and
// prints a timestamped line whenever either changes.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const dataDir = process.argv[2]
if (!dataDir) {
	console.error("usage: watch-commits.mjs <dataDir> [--interval ms]")
	process.exit(2)
}
const i = process.argv.indexOf("--interval")
const interval = i !== -1 ? Number(process.argv[i + 1]) : 100

const providersPath = path.join(dataDir, "settings", "providers.json")
const homeStatePath = path.join(os.homedir(), ".cline", "data", "globalState.json")

function readJson(p) {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"))
	} catch {
		return null
	}
}

function snapshot() {
	const prov = readJson(providersPath)
	const home = readJson(homeStatePath)
	const lastUsed = prov?.lastUsedProvider
	return {
		provLastUsed: lastUsed ?? "(unset)",
		provModel: prov?.providers?.[lastUsed]?.settings?.model ?? "(unset)",
		homeActProvider: home?.actModeApiProvider ?? "(unset)",
		homeActModel: home?.actModeApiModelId ?? "(unset)",
		homePlanProvider: home?.planModeApiProvider ?? "(unset)",
		homePlanModel: home?.planModeApiModelId ?? "(unset)",
		planActSeparate: home?.planActSeparateModelsSetting ?? "(unset)",
	}
}

let prev = snapshot()
const stamp = () => new Date().toISOString().slice(11, 23)
console.log(`${stamp()}  BASELINE  ${JSON.stringify(prev)}`)

setInterval(() => {
	const next = snapshot()
	const changed = Object.keys(next).filter((k) => next[k] !== prev[k])
	if (changed.length) {
		const diff = changed.map((k) => `${k}: ${prev[k]} -> ${next[k]}`).join("  |  ")
		console.log(`${stamp()}  CHANGE    ${diff}`)
		prev = next
	}
}, interval)
