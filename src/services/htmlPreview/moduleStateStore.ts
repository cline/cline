/**
 * Module State Store — extension-host side.
 *
 * Persists the interactive control state of an HTML module (slider/`bindParam`
 * values) so a learner who tweaks parameters, closes the panel, and reopens it
 * lands back on the same configuration instead of the authored defaults.
 *
 * One JSON file per module, keyed by the module's file path:
 *
 *   ~/.aihydro/module_state/<safeKey>.json
 *
 * State is a flat string→string map keyed by "<cellId>::<paramName>" inside the
 * bridge; the host treats it as an opaque bag and never interprets the values.
 * Atomic write-then-rename keeps the file consistent across crashes. No caching:
 * one small disk read per module open is negligible.
 */
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const STATE_DIR = path.join(os.homedir(), ".aihydro", "module_state")

export interface ModuleState {
	moduleKey: string
	updatedAt: number
	values: Record<string, string>
}

function safeKey(key: string): string {
	return key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200) || "unknown"
}

function stateFilePath(moduleKey: string): string {
	return path.join(STATE_DIR, `${safeKey(moduleKey)}.json`)
}

function emptyState(moduleKey: string): ModuleState {
	return { moduleKey, updatedAt: Date.now(), values: {} }
}

export async function loadModuleState(moduleKey: string): Promise<ModuleState> {
	if (!moduleKey) return emptyState(moduleKey || "unknown")
	try {
		const content = await fs.readFile(stateFilePath(moduleKey), "utf8")
		const parsed = JSON.parse(content) as ModuleState
		if (!parsed.values || typeof parsed.values !== "object") parsed.values = {}
		parsed.moduleKey = moduleKey
		return parsed
	} catch {
		return emptyState(moduleKey)
	}
}

export async function saveModuleState(moduleKey: string, values: Record<string, string>): Promise<ModuleState> {
	const state: ModuleState = { moduleKey, updatedAt: Date.now(), values: values ?? {} }
	await fs.mkdir(STATE_DIR, { recursive: true })
	const file = stateFilePath(moduleKey)
	const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
	await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
	await fs.rename(tmp, file)
	return state
}

export async function resetModuleState(moduleKey: string): Promise<ModuleState> {
	try {
		await fs.unlink(stateFilePath(moduleKey))
	} catch {
		// nothing to remove
	}
	return emptyState(moduleKey)
}
