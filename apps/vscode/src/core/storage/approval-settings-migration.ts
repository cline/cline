import fs from "node:fs/promises"
import path from "node:path"
import type { StorageContext } from "@/shared/storage/storage-context"

const APPROVAL_MIGRATION_VERSION = 1
const APPROVAL_MIGRATION_VERSION_KEY = "phase5ApprovalMigrationVersion"

export const LEGACY_APPROVAL_KEYS = [
	"autoApprovalSettings",
	"autoApprove",
	"autoApproveTools",
	"backgroundEditEnabled",
	"rememberedApprovals",
	"safeCommands",
	"yoloModeToggled",
] as const

export function stripLegacyApprovalKeys(record: Record<string, unknown>): Record<string, unknown> {
	const cleaned = { ...record }
	for (const key of LEGACY_APPROVAL_KEYS) {
		delete cleaned[key]
	}
	return cleaned
}

export function stripMcpAutoApprove(settings: Record<string, unknown>): Record<string, unknown> {
	const serversValue = settings.mcpServers
	if (!serversValue || typeof serversValue !== "object" || Array.isArray(serversValue)) {
		return settings
	}
	const servers = Object.fromEntries(
		Object.entries(serversValue).map(([name, value]) => {
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				return [name, value]
			}
			const server = { ...(value as Record<string, unknown>) }
			delete server.autoApprove
			return [name, server]
		}),
	)
	return { ...settings, mcpServers: servers }
}

async function cleanMcpSettings(storage: StorageContext): Promise<void> {
	const settingsPath =
		process.env.CLINE_MCP_SETTINGS_PATH?.trim() ||
		path.join(storage.dataDir, "settings", "cline_mcp_settings.json")
	try {
		const raw = await fs.readFile(settingsPath, "utf8")
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return
		}
		const cleaned = stripMcpAutoApprove(parsed as Record<string, unknown>)
		if (JSON.stringify(cleaned) !== JSON.stringify(parsed)) {
			await fs.writeFile(settingsPath, `${JSON.stringify(cleaned, null, 2)}\n`, "utf8")
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error
		}
	}
}

/**
 * Removes legacy approval grants from file-backed global/workspace state and
 * MCP settings. Old true values are deleted, never converted into permission.
 */
export async function migrateLegacyApprovalSettings(storage: StorageContext): Promise<void> {
	if (storage.globalState.get<number>(APPROVAL_MIGRATION_VERSION_KEY, 0) >= APPROVAL_MIGRATION_VERSION) {
		return
	}
	const removals = Object.fromEntries(LEGACY_APPROVAL_KEYS.map((key) => [key, undefined]))
	await cleanMcpSettings(storage)
	await storage.workspaceState.setBatch(removals)
	await storage.globalState.setBatch({
		...removals,
		[APPROVAL_MIGRATION_VERSION_KEY]: APPROVAL_MIGRATION_VERSION,
	})
}
