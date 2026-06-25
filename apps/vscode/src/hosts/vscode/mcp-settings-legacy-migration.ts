import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { getDocumentsPath } from "@/core/storage/documents-path"
import type * as vscode from "vscode"
import { updateMcpSettingsFile } from "@/services/mcp/settingsLock"
import type { StorageContext } from "@/shared/storage/storage-context"
import { Logger } from "@/shared/services/Logger"
import { getServerAuthHash } from "@/utils/mcpAuth"
import { arePathsEqual } from "@/utils/path"

const MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json"
const MCP_SETTINGS_MIGRATION_KEY = "__vscodeLegacyMcpSettingsMigration"

type JsonRecord = Record<string, unknown>

export interface LegacyMcpSettingsMigrationResult {
	migrated: boolean
	sourcesChecked: number
	sourcesMigrated: number
	serversAdded: number
	serversSkippedExisting: number
	serversSkippedInvalid: number
}

interface LegacyMcpSource {
	id: string
	path: string
}

interface PreparedLegacyMcpSource {
	source: LegacyMcpSource
	servers: Record<string, JsonRecord>
	skippedInvalid: number
}

export interface LegacyMcpSourceOptions {
	extensionStorageDir?: string
	documentsDir?: string
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJsonRecord(filePath: string): JsonRecord | undefined {
	try {
		if (!existsSync(filePath)) {
			return undefined
		}
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown
		return isRecord(parsed) ? parsed : undefined
	} catch (error) {
		Logger.warn(`[Migration] Failed to read legacy MCP settings from ${filePath}:`, error)
		return undefined
	}
}

function getServers(settings: JsonRecord | undefined): JsonRecord {
	const servers = settings?.mcpServers
	return isRecord(servers) ? servers : {}
}

function mapLegacyTransportType(value: unknown): "stdio" | "sse" | "streamableHttp" | undefined {
	if (value === "stdio" || value === "sse" || value === "streamableHttp") {
		return value
	}
	if (value === "http") {
		return "streamableHttp"
	}
	return undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}
	const strings = value.filter((item): item is string => typeof item === "string")
	return strings.length === value.length ? strings : undefined
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const entries = Object.entries(value)
	if (!entries.every(([, entryValue]) => typeof entryValue === "string")) {
		return undefined
	}
	return Object.fromEntries(entries) as Record<string, string>
}

function compactRecord(record: JsonRecord): JsonRecord {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

function normalizeOauthState(value: unknown): JsonRecord | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const normalized = compactRecord({
		clientInformation: isRecord(value.clientInformation) ? value.clientInformation : undefined,
		tokens: isRecord(value.tokens) ? value.tokens : undefined,
		codeVerifier: typeof value.codeVerifier === "string" ? value.codeVerifier : undefined,
		discoveryState: isRecord(value.discoveryState) ? value.discoveryState : undefined,
		redirectUrl: typeof value.redirectUrl === "string" ? value.redirectUrl : undefined,
		lastError: typeof value.lastError === "string" ? value.lastError : undefined,
		lastAuthenticatedAt: typeof value.lastAuthenticatedAt === "number" ? value.lastAuthenticatedAt : undefined,
	})
	return Object.keys(normalized).length > 0 ? normalized : undefined
}

function normalizeLegacyOAuthSecret(value: unknown): JsonRecord | undefined {
	if (!isRecord(value)) {
		return undefined
	}
	const normalized = compactRecord({
		clientInformation: isRecord(value.client_info) ? value.client_info : undefined,
		tokens: isRecord(value.tokens) ? value.tokens : undefined,
		codeVerifier: typeof value.code_verifier === "string" ? value.code_verifier : undefined,
		redirectUrl: typeof value.redirect_url_at_registration === "string" ? value.redirect_url_at_registration : undefined,
		lastAuthenticatedAt: typeof value.tokens_saved_at === "number" ? value.tokens_saved_at : undefined,
	})
	return Object.keys(normalized).length > 0 ? normalized : undefined
}

function getUrlForAuthHash(registration: JsonRecord): string | undefined {
	const transport = isRecord(registration.transport) ? registration.transport : registration
	return typeof transport.url === "string" ? transport.url : undefined
}

export function normalizeLegacyMcpServer(
	value: unknown,
	legacyOAuthSecrets: JsonRecord | undefined,
	serverName: string,
): JsonRecord | undefined {
	if (!isRecord(value)) {
		return undefined
	}

	const source = isRecord(value.transport) ? { ...value.transport, ...value } : { ...value }
	delete source.transport

	const explicitType = mapLegacyTransportType(source.type)
	const transportType = mapLegacyTransportType(source.transportType)
	const resolvedType = explicitType ?? transportType ?? (typeof source.command === "string" ? "stdio" : undefined)

	let transport: JsonRecord | undefined
	if (resolvedType === "stdio" && typeof source.command === "string" && source.command.trim()) {
		transport = compactRecord({
			type: "stdio",
			command: source.command,
			args: normalizeStringArray(source.args),
			cwd: typeof source.cwd === "string" && source.cwd.trim() ? source.cwd : undefined,
			env: normalizeStringRecord(source.env),
		})
	} else {
		const urlType = resolvedType ?? "sse"
		if ((urlType === "sse" || urlType === "streamableHttp") && typeof source.url === "string") {
			transport = compactRecord({
				type: urlType,
				url: source.url,
				headers: normalizeStringRecord(source.headers),
			})
		}
	}

	if (!transport) {
		return undefined
	}

	const normalized: JsonRecord = compactRecord({
		transport,
		disabled: typeof source.disabled === "boolean" ? source.disabled : undefined,
		metadata: isRecord(source.metadata) ? source.metadata : undefined,
	})

	const autoApprove = normalizeStringArray(source.autoApprove)
	if (autoApprove) {
		normalized.autoApprove = autoApprove
	}
	if (typeof source.timeout === "number") {
		normalized.timeout = source.timeout
	}
	if (typeof source.remoteConfigured === "boolean") {
		normalized.remoteConfigured = source.remoteConfigured
	}
	// Remote-config sync historically keys URL-based remote servers by a top-level
	// `url`. Keep that compatibility field on migrated remote-configured servers
	// so the next sync does not delete/recreate them and lose user state.
	if (source.remoteConfigured === true && typeof transport.url === "string") {
		normalized.url = transport.url
	}

	const inlineOAuth = normalizeOauthState(source.oauth)
	const serverUrl = getUrlForAuthHash(normalized)
	const legacyOAuth =
		serverUrl && legacyOAuthSecrets
			? normalizeLegacyOAuthSecret(legacyOAuthSecrets[getServerAuthHash(serverName, serverUrl)])
			: undefined
	const oauth = inlineOAuth ?? legacyOAuth
	if (oauth) {
		normalized.oauth = oauth
	}

	return normalized
}

function parseLegacyOAuthSecrets(raw: string | undefined): JsonRecord | undefined {
	if (!raw) {
		return undefined
	}
	try {
		const parsed = JSON.parse(raw) as unknown
		return isRecord(parsed) ? parsed : undefined
	} catch (error) {
		Logger.warn("[Migration] Failed to parse legacy MCP OAuth secrets:", error)
		return undefined
	}
}

async function readLegacyOAuthSecrets(
	vscodeContext: vscode.ExtensionContext,
	storage: StorageContext,
): Promise<JsonRecord | undefined> {
	let vscodeSecrets: JsonRecord | undefined
	try {
		vscodeSecrets = parseLegacyOAuthSecrets(await vscodeContext.secrets.get("mcpOAuthSecrets"))
	} catch (error) {
		Logger.warn("[Migration] Failed to read legacy MCP OAuth secrets from VSCode storage:", error)
	}
	const fileBackedSecrets = parseLegacyOAuthSecrets(storage.secrets.get("mcpOAuthSecrets"))
	if (!vscodeSecrets) {
		return fileBackedSecrets
	}
	if (!fileBackedSecrets) {
		return vscodeSecrets
	}
	return { ...vscodeSecrets, ...fileBackedSecrets }
}

export async function getLegacyMcpSettingsSources(options: LegacyMcpSourceOptions = {}): Promise<LegacyMcpSource[]> {
	const sources: LegacyMcpSource[] = []
	if (options.extensionStorageDir) {
		sources.push({
			id: "vscodeGlobalStorage",
			path: path.join(options.extensionStorageDir, "settings", MCP_SETTINGS_FILE_NAME),
		})
	}
	const documentsDir = options.documentsDir ?? (await getDocumentsPath())
	sources.push({
		id: "documentsClineMcp",
		path: path.join(documentsDir, "Cline", "MCP", MCP_SETTINGS_FILE_NAME),
	})
	return sources
}

export function getSharedMcpSettingsPath(storage: StorageContext): string {
	const explicitPath = process.env.CLINE_MCP_SETTINGS_PATH?.trim()
	if (explicitPath) {
		return explicitPath
	}
	const explicitDataDir = process.env.CLINE_DATA_DIR?.trim()
	if (explicitDataDir) {
		return path.join(explicitDataDir, "settings", MCP_SETTINGS_FILE_NAME)
	}
	const clineDir = process.env.CLINE_DIR?.trim() || path.join(os.homedir(), ".cline")
	return path.join(clineDir, "data", "settings", MCP_SETTINGS_FILE_NAME)
}

function readMigrationState(storage: StorageContext): JsonRecord {
	const value = storage.globalState.get(MCP_SETTINGS_MIGRATION_KEY)
	return isRecord(value) ? value : {}
}

function writeMigrationState(storage: StorageContext, state: JsonRecord): void {
	storage.globalState.update(MCP_SETTINGS_MIGRATION_KEY, state)
}

function prepareLegacySource(
	source: LegacyMcpSource,
	legacyOAuthSecrets: JsonRecord | undefined,
): PreparedLegacyMcpSource | undefined {
	if (!existsSync(source.path)) {
		return undefined
	}
	const legacySettings = readJsonRecord(source.path)
	if (!legacySettings) {
		return undefined
	}
	const servers: Record<string, JsonRecord> = {}
	let skippedInvalid = 0
	for (const [serverName, serverValue] of Object.entries(getServers(legacySettings))) {
		const normalized = normalizeLegacyMcpServer(serverValue, legacyOAuthSecrets, serverName)
		if (!normalized) {
			skippedInvalid++
			continue
		}
		servers[serverName] = normalized
	}
	return { source, servers, skippedInvalid }
}

export async function migrateLegacyMcpSettings(
	vscodeContext: vscode.ExtensionContext,
	storage: StorageContext,
	options: LegacyMcpSourceOptions = {},
): Promise<LegacyMcpSettingsMigrationResult> {
	const result: LegacyMcpSettingsMigrationResult = {
		migrated: false,
		sourcesChecked: 0,
		sourcesMigrated: 0,
		serversAdded: 0,
		serversSkippedExisting: 0,
		serversSkippedInvalid: 0,
	}

	const migrationState = readMigrationState(storage)
	const migratedSources = isRecord(migrationState.sources) ? migrationState.sources : {}
	const sharedSettingsPath = getSharedMcpSettingsPath(storage)
	const legacyOAuthSecrets = await readLegacyOAuthSecrets(vscodeContext, storage)
	const preparedSources: PreparedLegacyMcpSource[] = []

	for (const source of await getLegacyMcpSettingsSources({
		extensionStorageDir: options.extensionStorageDir ?? vscodeContext.globalStorageUri?.fsPath,
		documentsDir: options.documentsDir,
	})) {
		result.sourcesChecked++
		if (migratedSources[source.id] || arePathsEqual(source.path, sharedSettingsPath)) {
			continue
		}
		const prepared = prepareLegacySource(source, legacyOAuthSecrets)
		if (!prepared) {
			continue
		}
		preparedSources.push(prepared)
		result.serversSkippedInvalid += prepared.skippedInvalid
	}

	if (preparedSources.length > 0) {
		const mergeResult = await updateMcpSettingsFile(sharedSettingsPath, (settings) => {
			const existingServersValue = settings.mcpServers
			const servers = isRecord(existingServersValue) ? { ...existingServersValue } : {}
			let serversAdded = 0
			let serversSkippedExisting = 0
			let sourcesMigrated = 0

			for (const prepared of preparedSources) {
				let sourceAdded = 0
				for (const [serverName, serverConfig] of Object.entries(prepared.servers)) {
					if (Object.hasOwn(servers, serverName)) {
						serversSkippedExisting++
						continue
					}
					servers[serverName] = serverConfig
					serversAdded++
					sourceAdded++
				}
				if (sourceAdded > 0) {
					sourcesMigrated++
				}
			}

			settings.mcpServers = servers
			return { serversAdded, serversSkippedExisting, sourcesMigrated }
		})

		result.serversAdded += mergeResult.serversAdded
		result.serversSkippedExisting += mergeResult.serversSkippedExisting
		result.sourcesMigrated += mergeResult.sourcesMigrated

		for (const prepared of preparedSources) {
			migratedSources[prepared.source.id] = {
				path: prepared.source.path,
				migratedAt: Date.now(),
			}
		}
		result.migrated = true
	}

	if (result.migrated) {
		writeMigrationState(storage, { sources: migratedSources })
	}

	return result
}
