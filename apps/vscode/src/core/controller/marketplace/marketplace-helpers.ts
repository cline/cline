import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { homedir, platform } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import {
	installMcpServer,
	isMarketplaceSkillInstalled,
	type MarketplaceActionResult,
	type MarketplaceEntryInput,
	type MarketplacePrimitiveType,
	parseMcpInstallArgs,
	uninstallMarketplaceEntry as uninstallCoreMarketplaceEntry,
} from "@cline/core"
import { deleteSkillFile } from "@core/controller/file/deleteSkillFile"
import { refreshSkills } from "@core/controller/file/refreshSkills"
import { toggleSkill } from "@core/controller/file/toggleSkill"
import { DeleteSkillRequest, ToggleSkillRequest } from "@shared/proto/cline/file"
import {
	MarketplaceCatalog,
	MarketplaceEntry,
	MarketplaceInstalledEntries,
	MarketplaceInstallResult,
	MarketplaceLocalInstalledEntries,
	MarketplaceLocalInstalledEntry,
	MarketplaceLocalInstalledEntryRequest,
	ToggleMarketplaceLocalInstalledEntryRequest,
} from "@shared/proto/cline/marketplace"
import { HostProvider } from "@/hosts/host-provider"
import type { Controller } from "../index"

type MarketplaceType = "mcp" | "skill"

type SpawnResult = {
	exitCode: number
	stdout: string
	stderr: string
}

const MARKETPLACE_CATALOG_URL = "https://cline.github.io/marketplace/catalog.json"
const INSTALL_COMMAND_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 12_000
const SECRET_PATTERN =
	/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|authorization|credential)/i
const SECRET_KEY_VALUE_PATTERN =
	/((?:^|[^\w])(?:[a-z0-9_]*?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|credential)[a-z0-9_]*)\s*[:=]\s*)(.+)$/gi
const SECRET_BEARER_VALUE_PATTERN = /((?:^|[^\w])authorization\s*[:=]\s*)bearer\s+([^\s,"'}\]]+)/gi
const SECRET_AUTHORIZATION_VALUE_PATTERN = /((?:^|[^\w])authorization\s*[:=])(?!\s*bearer\b)\s*(.+)$/gi

function isMarketplaceType(value: string): value is MarketplaceType {
	return value === "mcp" || value === "skill"
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function sanitizeEntry(raw: unknown): MarketplaceEntry | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const record = raw as Record<string, unknown>
	const id = typeof record.id === "string" ? record.id.trim() : ""
	const type = typeof record.type === "string" ? record.type.trim() : ""
	const name = typeof record.name === "string" ? record.name.trim() : id
	if (!id || !isMarketplaceType(type) || !name) return undefined
	const install = record.install && typeof record.install === "object" ? (record.install as Record<string, unknown>) : undefined
	return MarketplaceEntry.create({
		id,
		type,
		name,
		tagline: typeof record.tagline === "string" ? record.tagline : undefined,
		description: typeof record.description === "string" ? record.description : undefined,
		tags: asStringArray(record.tags),
		author: typeof record.author === "string" ? record.author : undefined,
		sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl : undefined,
		homepageUrl: typeof record.homepageUrl === "string" ? record.homepageUrl : undefined,
		install: install
			? {
					args: asStringArray(install.args),
					env: Array.isArray(install.env)
						? install.env
								.map((item) => {
									if (!item || typeof item !== "object") return undefined
									const env = item as Record<string, unknown>
									if (typeof env.name !== "string") return undefined
									return {
										name: env.name,
										required: env.required === true,
										description: typeof env.description === "string" ? env.description : undefined,
										url: typeof env.url === "string" ? env.url : undefined,
									}
								})
								.filter((item): item is NonNullable<typeof item> => item !== undefined)
						: [],
					command: typeof install.command === "string" ? install.command : undefined,
					notes: typeof install.notes === "string" ? install.notes : undefined,
				}
			: undefined,
	})
}

export async function fetchMarketplaceCatalog(): Promise<MarketplaceCatalog> {
	const response = await fetch(MARKETPLACE_CATALOG_URL, {
		headers: { Accept: "application/json" },
	})
	if (!response.ok) {
		throw new Error(`Failed to fetch marketplace catalog: ${response.status} ${response.statusText}`.trim())
	}
	const json = (await response.json()) as Record<string, unknown>
	const entries = Array.isArray(json.entries)
		? json.entries.map(sanitizeEntry).filter((entry): entry is MarketplaceEntry => entry !== undefined)
		: []
	return MarketplaceCatalog.create({ entries })
}

function normalizeMatchValue(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function marketplaceKey(entry: MarketplaceEntry): string {
	return `${entry.type}:${entry.id}`
}

function getEntryArgs(entry: MarketplaceEntry): string[] {
	return entry.install?.args ?? []
}

function isMcpInstalled(controller: Controller, entry: MarketplaceEntry): boolean {
	if (entry.type !== "mcp") return false
	const [name] = getEntryArgs(entry)
	const candidates = new Set([normalizeMatchValue(name), normalizeMatchValue(entry.id), normalizeMatchValue(entry.name)])
	candidates.delete("")
	return (controller.mcpHub?.getServers() ?? []).some((server) => candidates.has(normalizeMatchValue(server.name)))
}

function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12)
}

function resolveClineHome(): string {
	return process.env.CLINE_DIR?.trim() || join(homedir(), ".cline")
}

function isSkillInstalled(entry: MarketplaceEntry): boolean {
	if (entry.type !== "skill") return false
	return isMarketplaceSkillInstalled(toCoreMarketplaceEntry(entry))
}

export function listInstalledMarketplaceEntries(
	controller: Controller,
	entries: MarketplaceEntry[],
): MarketplaceInstalledEntries {
	return MarketplaceInstalledEntries.create({
		installedKeys: entries
			.filter((entry) => isMcpInstalled(controller, entry) || isSkillInstalled(entry))
			.map(marketplaceKey),
	})
}

function redactOutput(value: string): string {
	return value
		.split(/\r?\n/)
		.map((line) => {
			if (!SECRET_PATTERN.test(line)) return line
			return line
				.replace(SECRET_KEY_VALUE_PATTERN, "$1[redacted]")
				.replace(SECRET_BEARER_VALUE_PATTERN, "$1Bearer [redacted]")
				.replace(/\b(Bearer)\s+(?!\[redacted\])([^\s,"'}\]]+)/gi, "$1 [redacted]")
				.replace(SECRET_AUTHORIZATION_VALUE_PATTERN, "$1 [redacted]")
				.replace(
					/((?:^|[^\w])(?:api\s+key|access\s+token|refresh\s+token|auth(?:orization)?\s+token|secret|password|credential)\s+(?:is\s+)?)(\S+)/gi,
					"$1[redacted]",
				)
		})
		.join("\n")
		.slice(-MAX_OUTPUT_CHARS)
}

function quoteCommandPart(value: string): string {
	if (value === "") return '""'
	if (/^[a-zA-Z0-9_./:=@%+,-]+$/.test(value)) return value
	return JSON.stringify(value)
}

function formatCommand(command: string, args: string[]): string {
	return [command, ...args].map((part) => quoteCommandPart(redactOutput(part).trim())).join(" ")
}

function extractJsonErrorMessage(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined
	if (!value || typeof value !== "object") return undefined
	if (Array.isArray(value)) {
		return value.map(extractJsonErrorMessage).filter(Boolean).join("\n") || undefined
	}
	const record = value as Record<string, unknown>
	for (const key of ["message", "error", "details", "detail", "reason", "stderr", "stdout"]) {
		const message = extractJsonErrorMessage(record[key])
		if (message) return message
	}
	return undefined
}

function parseJsonErrorMessage(output: string): string | undefined {
	const trimmed = output.trim()
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined
	try {
		return extractJsonErrorMessage(JSON.parse(trimmed))
	} catch {
		return undefined
	}
}

function commandOutput(result: SpawnResult): string | undefined {
	const stdout = redactOutput(result.stdout).trim()
	const stderr = redactOutput(result.stderr).trim()
	const parsedMessages = [stdout, stderr].map(parseJsonErrorMessage).filter((message): message is string => Boolean(message))
	if (parsedMessages.length > 0) return parsedMessages.join("\n")
	const parts = [stderr ? `stderr:\n${stderr}` : undefined, stdout ? `stdout:\n${stdout}` : undefined].filter(
		(part): part is string => Boolean(part),
	)
	return parts.join("\n\n") || undefined
}

async function runCommand(command: string, args: string[]): Promise<SpawnResult> {
	return new Promise((resolveResult, reject) => {
		let settled = false
		let timedOut = false
		const child = spawn(command, args, {
			env: process.env,
			shell: platform() === "win32",
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		})
		let stdout = ""
		let stderr = ""
		const forceKillTimeout = setTimeout(() => {
			if (!settled) child.kill("SIGKILL")
		}, INSTALL_COMMAND_TIMEOUT_MS + 5_000)
		const timeout = setTimeout(() => {
			timedOut = true
			stderr += `\nTimed out after ${INSTALL_COMMAND_TIMEOUT_MS / 1000}s.`
			child.kill("SIGTERM")
		}, INSTALL_COMMAND_TIMEOUT_MS)
		forceKillTimeout.unref?.()
		timeout.unref?.()
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk)
			if (stdout.length > MAX_OUTPUT_CHARS * 2) stdout = stdout.slice(-MAX_OUTPUT_CHARS)
		})
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk)
			if (stderr.length > MAX_OUTPUT_CHARS * 2) stderr = stderr.slice(-MAX_OUTPUT_CHARS)
		})
		child.once("error", reject)
		child.once("close", (code, signal) => {
			settled = true
			clearTimeout(timeout)
			clearTimeout(forceKillTimeout)
			resolveResult({
				exitCode: timedOut ? 124 : (code ?? (signal === "SIGINT" ? 130 : 1)),
				stdout,
				stderr,
			})
		})
	})
}

function installMcpMarketplaceEntry(entry: MarketplaceEntry, args: string[]): MarketplaceInstallResult {
	const parsed = parseMcpInstallArgs(args)
	const result = installMcpServer(parsed)
	return MarketplaceInstallResult.create({
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name || entry.id}.`,
		output: result.warnings.join("\n") || undefined,
	})
}

async function installSkillMarketplaceEntry(entry: MarketplaceEntry, args: string[]): Promise<MarketplaceInstallResult> {
	const command = "npx"
	const commandArgs = ["-y", "skills@latest", "add", ...args, "-g", "-a", "cline", "-y"]
	const displayCommand = formatCommand(command, commandArgs)
	let result: SpawnResult
	try {
		result = await runCommand(command, commandArgs)
	} catch (error) {
		throw new Error(
			`Failed to start ${entry.name || entry.id} install command:\n${displayCommand}\n${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
	const output = commandOutput(result)
	if (result.exitCode !== 0) {
		throw new Error(
			`${entry.name || entry.id} install failed with exit code ${result.exitCode}.\nCommand:\n${displayCommand}${
				output ? `\n\n${output}` : ""
			}`,
		)
	}
	return MarketplaceInstallResult.create({
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name || entry.id}.`,
		output,
	})
}

export async function installMarketplaceEntryFromCatalog(entry: MarketplaceEntry): Promise<MarketplaceInstallResult> {
	if (entry.type === "plugin") throw new Error("Plugin installation is not supported in the VS Code extension.")
	const args = getEntryArgs(entry)
	if (args.length === 0) throw new Error("Marketplace install args are required.")
	if (entry.type === "mcp") return installMcpMarketplaceEntry(entry, args)
	return installSkillMarketplaceEntry(entry, args)
}

function toCoreMarketplaceEntry(entry: MarketplaceEntry): MarketplaceEntryInput {
	if (entry.type !== "mcp" && entry.type !== "skill") {
		throw new Error(`Unsupported marketplace entry type: ${entry.type}`)
	}
	return {
		id: entry.id,
		type: entry.type as MarketplacePrimitiveType,
		name: entry.name,
		install: {
			args: getEntryArgs(entry),
		},
	}
}

function toProtoMarketplaceInstallResult(result: MarketplaceActionResult): MarketplaceInstallResult {
	return MarketplaceInstallResult.create({
		id: result.id,
		type: result.type,
		status: result.status,
		message: result.message,
		output: result.output,
	})
}

export async function uninstallMarketplaceEntryFromCatalog(
	controller: Controller,
	entry: MarketplaceEntry,
): Promise<MarketplaceInstallResult> {
	const workspaceRoot = await getWorkspacePath()
	const result = await uninstallCoreMarketplaceEntry(toCoreMarketplaceEntry(entry), {
		deleteMcpServer: async (name) => {
			await controller.mcpHub?.deleteServerRPC(name)
		},
		workspaceRoot,
	})
	return toProtoMarketplaceInstallResult(result)
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath))
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function isGlobalClinePath(filePath: string | undefined): boolean {
	if (!filePath || filePath.startsWith("remote:")) return false
	return [resolveClineHome(), join(homedir(), ".agents", "skills")].some((root) => isPathWithin(root, filePath))
}

export async function listLocalMarketplaceInstalledEntries(controller: Controller): Promise<MarketplaceLocalInstalledEntries> {
	const mcpEntries = (controller.mcpHub?.getServers() ?? []).map((server) =>
		MarketplaceLocalInstalledEntry.create({
			id: server.name,
			type: "mcp",
			name: server.name,
			description: server.status,
			enabled: server.disabled !== true,
		}),
	)
	const refreshedSkills = await refreshSkills(controller)
	const skillEntries = [
		...refreshedSkills.globalSkills.map((skill) =>
			MarketplaceLocalInstalledEntry.create({
				id: skill.name,
				type: "skill",
				name: skill.name,
				description: skill.description,
				path: skill.path,
				source: skill.path.startsWith("remote:") ? "remote" : "global",
				enabled: skill.enabled,
			}),
		),
		...refreshedSkills.localSkills.map((skill) =>
			MarketplaceLocalInstalledEntry.create({
				id: skill.name,
				type: "skill",
				name: skill.name,
				description: skill.description,
				path: skill.path,
				source: isGlobalClinePath(skill.path) ? "global" : "workspace",
				enabled: skill.enabled,
			}),
		),
	]
	return MarketplaceLocalInstalledEntries.create({ entries: [...mcpEntries, ...skillEntries] })
}

async function getWorkspacePath(): Promise<string | undefined> {
	return HostProvider.isInitialized() ? (await HostProvider.workspace.getWorkspacePaths({})).paths[0] : undefined
}

export async function toggleLocalMarketplaceInstalledEntry(
	controller: Controller,
	request: ToggleMarketplaceLocalInstalledEntryRequest,
): Promise<MarketplaceLocalInstalledEntries> {
	const { entry, enabled } = request
	if (!entry) throw new Error("Installed marketplace entry is required.")
	if (entry.type === "plugin") throw new Error("Plugin management is not supported in the VS Code extension.")
	if (entry.type === "mcp") {
		const name = entry.name || entry.id
		if (!name) throw new Error("MCP server name is required.")
		await controller.mcpHub?.toggleServerDisabledRPC(name, !enabled)
		return listLocalMarketplaceInstalledEntries(controller)
	}
	if (entry.type === "skill") {
		await toggleSkill(
			controller,
			ToggleSkillRequest.create({
				skillPath: entry.path || entry.id,
				isGlobal: entry.source === "global",
				enabled,
			}),
		)
		return listLocalMarketplaceInstalledEntries(controller)
	}
	throw new Error(`Marketplace toggle is not supported for ${entry.type}.`)
}

export async function uninstallLocalMarketplaceInstalledEntry(
	controller: Controller,
	request: MarketplaceLocalInstalledEntryRequest,
): Promise<MarketplaceInstallResult> {
	const { entry } = request
	if (!entry) throw new Error("Installed marketplace entry is required.")
	if (entry.type === "plugin") throw new Error("Plugin management is not supported in the VS Code extension.")
	const name = entry.name || entry.id
	if (entry.type === "mcp") {
		if (!name) throw new Error("MCP server name is required.")
		await controller.mcpHub?.deleteServerRPC(name)
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${name}.`,
		})
	}
	if (entry.type === "skill") {
		if (entry.path?.startsWith("remote:")) {
			throw new Error("Remote-managed skills cannot be uninstalled from Customize.")
		}
		if (!entry.path) throw new Error("Skill path is required for uninstall.")
		await deleteSkillFile(
			controller,
			DeleteSkillRequest.create({
				skillPath: entry.path,
				isGlobal: entry.source === "global",
			}),
		)
		await controller.invalidateUserInstructionService()
		return MarketplaceInstallResult.create({
			id: entry.id,
			type: entry.type,
			status: "uninstalled",
			message: `Uninstalled ${name || entry.id}.`,
		})
	}
	throw new Error(`Marketplace uninstall is not supported for ${entry.type}.`)
}
