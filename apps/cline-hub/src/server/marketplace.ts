import { type SpawnOptions, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { resolveClineDir } from "@cline/shared/storage";
import { readMcpServersResponse, upsertMcpServer } from "./mcp";
import type { JsonRecord } from "./types";

type MarketplacePrimitiveType = "mcp" | "skill" | "plugin";

type MarketplaceEnvVar = {
	name: string;
	required?: boolean;
	description?: string;
	url?: string;
};

type MarketplaceInstallInput = {
	id: string;
	type: MarketplacePrimitiveType;
	name?: string;
	install: {
		args?: string[];
		env?: MarketplaceEnvVar[];
		command?: string;
		notes?: string;
	};
};

type MarketplaceInstallResult = {
	id: string;
	type: MarketplacePrimitiveType;
	status: "installed";
	message: string;
	details?: JsonRecord;
	output?: string;
	warnings?: string[];
};

type MarketplaceInstallStatusResult = {
	installedKeys: string[];
};

type SpawnResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type SpawnCommand = (
	command: string,
	args: string[],
	options?: SpawnOptions,
) => Promise<SpawnResult>;
type CatalogFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
type CatalogLoader = () => Promise<unknown>;

const MAX_OUTPUT_CHARS = 12_000;
const INSTALL_COMMAND_TIMEOUT_MS = 120_000;
const OFFICIAL_PLUGINS_REPO = "https://github.com/cline/plugins.git";
const MARKETPLACE_CATALOG_URL =
	process.env.CLINE_MARKETPLACE_CATALOG_URL?.trim() ||
	"https://cline.github.io/marketplace/catalog.json";
const SECRET_PATTERN =
	/(api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth(?:orization)?[_ -]?token|token|secret|password|authorization|credential)/i;
const DEBUG_MARKETPLACE =
	process.env.CLINE_HUB_DEBUG === "1" ||
	process.env.CLINE_HUB_DEBUG?.toLowerCase() === "true";

function logMarketplace(message: string, details?: Record<string, unknown>) {
	if (!DEBUG_MARKETPLACE) return;
	console.info("[marketplace]", message, details ?? {});
}

export async function fetchMarketplaceCatalog(
	fetchImpl: CatalogFetch = fetch,
): Promise<unknown> {
	const response = await fetchImpl(MARKETPLACE_CATALOG_URL, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch marketplace catalog: ${response.status} ${response.statusText}`.trim(),
		);
	}
	return response.json();
}

function isPrimitiveType(value: unknown): value is MarketplacePrimitiveType {
	return value === "mcp" || value === "skill" || value === "plugin";
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readInstallInput(
	args?: Record<string, unknown>,
): MarketplaceInstallInput {
	const entry = readInstallRecord(args);
	const install =
		entry.install && typeof entry.install === "object"
			? (entry.install as Record<string, unknown>)
			: {};
	const installArgs = toStringArray(install.args);
	if (installArgs.length === 0) {
		throw new Error("marketplace install args are required");
	}
	const env = Array.isArray(install.env)
		? install.env
				.map((item): MarketplaceEnvVar | null => {
					if (!item || typeof item !== "object") return null;
					const candidate = item as Record<string, unknown>;
					if (typeof candidate.name !== "string") return null;
					const parsed: MarketplaceEnvVar = {
						name: candidate.name,
					};
					if (typeof candidate.required === "boolean") {
						parsed.required = candidate.required;
					}
					if (typeof candidate.description === "string") {
						parsed.description = candidate.description;
					}
					if (typeof candidate.url === "string") {
						parsed.url = candidate.url;
					}
					return parsed;
				})
				.filter((item): item is MarketplaceEnvVar => item !== null)
		: undefined;
	return {
		id: entry.id.trim(),
		type: entry.type,
		name: typeof entry.name === "string" ? entry.name : undefined,
		install: {
			args: installArgs,
			command:
				typeof install.command === "string" ? install.command : undefined,
			env,
			notes: typeof install.notes === "string" ? install.notes : undefined,
		},
	};
}

function readInstallRecord(
	args?: Record<string, unknown>,
): Record<string, unknown> & { id: string; type: MarketplacePrimitiveType } {
	const entry =
		args?.entry && typeof args.entry === "object"
			? (args.entry as Record<string, unknown>)
			: (args ?? {});
	if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
		throw new Error("marketplace entry id is required");
	}
	if (!isPrimitiveType(entry.type)) {
		throw new Error("marketplace entry type must be mcp, skill, or plugin");
	}
	return entry as Record<string, unknown> & {
		id: string;
		type: MarketplacePrimitiveType;
	};
}

function readInstallRequest(args?: Record<string, unknown>) {
	const entry = readInstallRecord(args);
	return {
		id: entry.id.trim(),
		type: entry.type,
	};
}

function readInstallInputList(
	args?: Record<string, unknown>,
): MarketplaceInstallInput[] {
	const rawEntries = Array.isArray(args?.entries) ? args.entries : [];
	return rawEntries
		.map((entry) => {
			try {
				return readInstallInput({ entry });
			} catch {
				return null;
			}
		})
		.filter((entry): entry is MarketplaceInstallInput => entry !== null);
}

function readCatalogEntries(catalog: unknown): MarketplaceInstallInput[] {
	const catalogEntries =
		catalog && typeof catalog === "object"
			? (catalog as Record<string, unknown>).entries
			: undefined;
	if (!Array.isArray(catalogEntries)) {
		throw new Error("marketplace catalog entries are required");
	}
	return catalogEntries
		.map((entry) => {
			try {
				return readInstallInput({ entry });
			} catch {
				return null;
			}
		})
		.filter((entry): entry is MarketplaceInstallInput => entry !== null);
}

function marketplaceEntryKey(
	entry: Pick<MarketplaceInstallInput, "id" | "type">,
) {
	return `${entry.type}:${entry.id}`;
}

function redactOutput(value: string): string {
	const lines = value.split(/\r?\n/).map((line) => {
		if (!SECRET_PATTERN.test(line)) return line;
		return line
			.replace(
				/(\b(?:api[_ -]?key|token|secret|password|authorization|credential)\b\s*[:=]\s*)(.+)$/gi,
				"$1[redacted]",
			)
			.replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]")
			.replace(
				/(\b(?:api\s+key|access\s+token|refresh\s+token|auth(?:orization)?\s+token|secret|password|credential)\s+(?:is\s+)?)(\S+)/gi,
				"$1[redacted]",
			);
	});
	return lines.join("\n").slice(-MAX_OUTPUT_CHARS);
}

const defaultSpawnCommand: SpawnCommand = async (command, args, options = {}) =>
	new Promise<SpawnResult>((resolve, reject) => {
		let settled = false;
		let timedOut = false;
		const startedAt = Date.now();
		logMarketplace("spawn-start", {
			command,
			args: args.map((arg) => (SECRET_PATTERN.test(arg) ? "[redacted]" : arg)),
		});
		const child = spawn(command, args, {
			...options,
			env: options.env ?? process.env,
			shell: options.shell ?? platform() === "win32",
			stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		const forceKillTimeout = setTimeout(() => {
			if (!settled) {
				child.kill("SIGKILL");
			}
		}, INSTALL_COMMAND_TIMEOUT_MS + 5_000);
		const timeout = setTimeout(() => {
			timedOut = true;
			stderr += `\nTimed out after ${INSTALL_COMMAND_TIMEOUT_MS / 1000}s.`;
			child.kill("SIGTERM");
		}, INSTALL_COMMAND_TIMEOUT_MS);
		forceKillTimeout.unref?.();
		timeout.unref?.();
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
			if (stdout.length > MAX_OUTPUT_CHARS * 2) {
				stdout = stdout.slice(-MAX_OUTPUT_CHARS);
			}
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
			if (stderr.length > MAX_OUTPUT_CHARS * 2) {
				stderr = stderr.slice(-MAX_OUTPUT_CHARS);
			}
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			clearTimeout(forceKillTimeout);
			logMarketplace("spawn-error", {
				command,
				elapsedMs: Date.now() - startedAt,
				error: error.message,
			});
			reject(error);
		});
		child.once("close", (code, signal) => {
			settled = true;
			clearTimeout(timeout);
			clearTimeout(forceKillTimeout);
			const result = {
				exitCode: timedOut ? 124 : (code ?? (signal === "SIGINT" ? 130 : 1)),
				stdout,
				stderr,
			};
			logMarketplace("spawn-close", {
				command,
				exitCode: result.exitCode,
				signal,
				timedOut,
				elapsedMs: Date.now() - startedAt,
				stdoutChars: stdout.length,
				stderrChars: stderr.length,
			});
			resolve(result);
		});
	});

function normalizeTransport(value: string | undefined): string {
	const normalized = (value ?? "stdio").trim();
	if (normalized === "http" || normalized === "streamable-http") {
		return "streamableHttp";
	}
	if (
		normalized === "stdio" ||
		normalized === "sse" ||
		normalized === "streamableHttp"
	) {
		return normalized;
	}
	throw new Error(
		`Unsupported MCP transport "${normalized}". Expected stdio, sse, http, streamable-http, or streamableHttp.`,
	);
}

function assertUrl(value: string): void {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`Invalid MCP server URL: ${value}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Invalid MCP server URL: ${value}`);
	}
}

export function buildMarketplaceMcpInput(args: string[]): JsonRecord {
	const [rawName, ...rest] = args;
	const name = rawName?.trim();
	if (!name) {
		throw new Error("MCP marketplace install requires a server name");
	}
	let transportType = "stdio";
	const targetArgs: string[] = [];
	let parsingMarketplaceOptions = true;
	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (parsingMarketplaceOptions && arg === "--") {
			targetArgs.push(...rest.slice(index + 1));
			break;
		}
		if (parsingMarketplaceOptions && (arg === "--transport" || arg === "-t")) {
			const next = rest[index + 1]?.trim();
			if (!next) throw new Error("--transport requires a value");
			transportType = normalizeTransport(next);
			index++;
			continue;
		}
		parsingMarketplaceOptions = false;
		targetArgs.push(arg);
	}
	transportType = normalizeTransport(transportType);
	if (transportType === "stdio") {
		const [command, ...commandArgs] = targetArgs;
		if (!command?.trim()) {
			throw new Error("Stdio MCP install requires a command");
		}
		return {
			name,
			transportType,
			command,
			args: commandArgs.length > 0 ? commandArgs : undefined,
			disabled: false,
		};
	}
	if (targetArgs.length !== 1) {
		throw new Error("Remote MCP install requires exactly one URL");
	}
	const url = targetArgs[0]?.trim() ?? "";
	assertUrl(url);
	return {
		name,
		transportType,
		url,
		disabled: false,
	};
}

function resolveClineInvocation(): { command: string; argsPrefix: string[] } {
	const wrapperPath = process.env.CLINE_WRAPPER_PATH?.trim();
	if (wrapperPath) {
		return { command: wrapperPath, argsPrefix: [] };
	}
	const entry = process.argv[1]?.trim();
	if (entry && /(?:^|[/\\])apps[/\\]cli[/\\]src[/\\]index\.ts$/.test(entry)) {
		return { command: process.execPath, argsPrefix: [entry] };
	}
	return { command: "cline", argsPrefix: [] };
}

function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function sanitizeSegment(value: string): string {
	const sanitized = value
		.replace(/^@/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return sanitized || "plugin";
}

function sanitizeSkillSegment(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9._]+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "")
		.slice(0, 255);
	return sanitized || "skill";
}

function isOfficialPluginSlug(source: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.trim());
}

function getOfficialPluginInstallPath(source: string): string | undefined {
	const slug = source.trim();
	if (!isOfficialPluginSlug(slug)) return undefined;
	const sourceKey = `official:${OFFICIAL_PLUGINS_REPO}#plugins/${slug}`;
	return join(
		resolveClineDir(),
		"plugins",
		"_installed",
		"official",
		`${sanitizeSegment(slug)}-${hashSource(sourceKey)}`,
	);
}

function isOfficialPluginInstalled(entry: MarketplaceInstallInput): boolean {
	if (entry.type !== "plugin") return false;
	const [source] = entry.install.args ?? [];
	if (!source) return false;
	const installPath = getOfficialPluginInstallPath(source);
	const installed = Boolean(installPath && existsSync(installPath));
	logMarketplace("plugin-installed-check", {
		id: entry.id,
		source,
		installPath,
		installed,
	});
	return installed;
}

function normalizeMatchValue(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function getSkillInstallCandidates(entry: MarketplaceInstallInput): string[] {
	const candidates = new Set<string>();
	const addCandidate = (value: string | undefined) => {
		const normalized = sanitizeSkillSegment(value ?? "");
		if (normalized && normalized !== "skill") {
			candidates.add(normalized);
		}
	};
	addCandidate(entry.id);
	addCandidate(entry.name);
	const installArgs = entry.install.args ?? [];
	for (let index = 0; index < installArgs.length; index++) {
		const arg = installArgs[index];
		if ((arg === "--skill" || arg === "-s") && installArgs[index + 1]) {
			addCandidate(installArgs[index + 1]);
			index++;
			continue;
		}
		const skillFilter = arg.split("@").at(1);
		if (skillFilter) {
			addCandidate(skillFilter);
		}
	}
	return [...candidates];
}

function getGlobalSkillPaths(skillName: string): string[] {
	return [
		join(resolveClineDir(), "skills", skillName, "SKILL.md"),
		join(homedir(), ".agents", "skills", skillName, "SKILL.md"),
	].filter((path, index, paths) => paths.indexOf(path) === index);
}

function ensureGlobalSkillsDirWritable(): void {
	const skillsDir = join(homedir(), ".agents", "skills");
	try {
		mkdirSync(skillsDir, { recursive: true });
		const probePath = join(
			skillsDir,
			`.cline-marketplace-write-test-${process.pid}-${Date.now()}`,
		);
		writeFileSync(probePath, "", { flag: "wx" });
		unlinkSync(probePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Cannot install skill globally because ~/.agents/skills is not writable: ${message}`,
		);
	}
}

function isGlobalSkillInstalled(entry: MarketplaceInstallInput): boolean {
	if (entry.type !== "skill") return false;
	const candidates = getSkillInstallCandidates(entry);
	const checkedPaths = candidates.flatMap(getGlobalSkillPaths);
	const installed = checkedPaths.some((path) => existsSync(path));
	logMarketplace("skill-installed-check", {
		id: entry.id,
		candidates,
		checkedPaths,
		installed,
	});
	return installed;
}

function hasMatchingInventoryItem(
	items: unknown,
	entry: MarketplaceInstallInput,
): boolean {
	if (!Array.isArray(items)) return false;
	const candidates = new Set([
		normalizeMatchValue(entry.id),
		normalizeMatchValue(entry.name),
		...(entry.install.args ?? []).map(normalizeMatchValue),
	]);
	candidates.delete("");
	return items.some((item) => {
		if (!item || typeof item !== "object") return false;
		const record = item as JsonRecord;
		const values = [
			typeof record.name === "string" ? record.name : undefined,
			typeof record.id === "string" ? record.id : undefined,
			typeof record.path === "string" ? record.path : undefined,
		]
			.map(normalizeMatchValue)
			.filter(Boolean);
		return values.some((value) =>
			[...candidates].some(
				(candidate) => value === candidate || value.includes(candidate),
			),
		);
	});
}

function isMcpEntryInstalled(entry: MarketplaceInstallInput): boolean {
	if (entry.type !== "mcp") return false;
	const input = buildMarketplaceMcpInput(entry.install.args ?? []);
	const response = readMcpServersResponse();
	const servers = Array.isArray(response.servers) ? response.servers : [];
	return servers.some((server) => {
		if (!server || typeof server !== "object") return false;
		const record = server as JsonRecord;
		return record.name === input.name;
	});
}

function isMarketplaceEntryInstalled(
	entry: MarketplaceInstallInput,
	inventory?: JsonRecord,
): boolean {
	if (entry.type === "mcp") return isMcpEntryInstalled(entry);
	if (entry.type === "plugin") {
		return (
			isOfficialPluginInstalled(entry) ||
			hasMatchingInventoryItem(inventory?.plugins, entry)
		);
	}
	if (entry.type === "skill") {
		return isGlobalSkillInstalled(entry);
	}
	return false;
}

function commandOutput(result: SpawnResult): string | undefined {
	const output = redactOutput(
		[result.stdout, result.stderr].filter(Boolean).join("\n"),
	);
	return output.trim().length > 0 ? output.trim() : undefined;
}

async function installSkill(
	entry: MarketplaceInstallInput,
	spawnCommand: SpawnCommand,
): Promise<MarketplaceInstallResult> {
	if (isGlobalSkillInstalled(entry)) {
		logMarketplace("skill-install-skip-installed", {
			id: entry.id,
			name: entry.name,
		});
		return {
			id: entry.id,
			type: entry.type,
			status: "installed",
			message: `${entry.name ?? entry.id} is already installed.`,
		};
	}
	logMarketplace("skill-install-start", {
		id: entry.id,
		name: entry.name,
	});
	ensureGlobalSkillsDirWritable();
	const result = await spawnCommand("npx", [
		"-y",
		"skills@latest",
		"add",
		...(entry.install.args ?? []),
		"-g",
		"-a",
		"cline",
		"-y",
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`Skill install failed with exit code ${result.exitCode}${commandOutput(result) ? `:\n${commandOutput(result)}` : ""}`,
		);
	}
	const output = commandOutput(result);
	if (/\bFailed to install\b/i.test(output ?? "")) {
		throw new Error(`Skill install failed${output ? `:\n${output}` : ""}`);
	}
	if (!isGlobalSkillInstalled(entry)) {
		throw new Error(
			`Skill install completed, but ${entry.name ?? entry.id} was not found in Cline's global skills directories.`,
		);
	}
	return {
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name ?? entry.id} globally for Cline.`,
		output,
	};
}

async function installPlugin(
	entry: MarketplaceInstallInput,
	spawnCommand: SpawnCommand,
): Promise<MarketplaceInstallResult> {
	const installArgs = entry.install.args ?? [];
	if (installArgs.length !== 1) {
		throw new Error(
			"Plugin marketplace installs currently support exactly one source argument.",
		);
	}
	if (isOfficialPluginInstalled(entry)) {
		logMarketplace("plugin-install-skip-installed", {
			id: entry.id,
			name: entry.name,
			source: installArgs[0],
		});
		return {
			id: entry.id,
			type: entry.type,
			status: "installed",
			message: `${entry.name ?? entry.id} is already installed.`,
		};
	}
	const { command, argsPrefix } = resolveClineInvocation();
	logMarketplace("plugin-install-start", {
		id: entry.id,
		name: entry.name,
		source: installArgs[0],
		command,
		argsPrefix,
	});
	const result = await spawnCommand(command, [
		...argsPrefix,
		"plugin",
		"install",
		installArgs[0] ?? "",
		"--json",
	]);
	if (result.exitCode !== 0) {
		throw new Error(
			`Plugin install failed with exit code ${result.exitCode}${commandOutput(result) ? `:\n${commandOutput(result)}` : ""}`,
		);
	}
	let details: JsonRecord | undefined;
	try {
		details = result.stdout.trim()
			? (JSON.parse(result.stdout.trim()) as JsonRecord)
			: undefined;
	} catch {
		details = undefined;
	}
	return {
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name ?? entry.id}.`,
		details,
		output: commandOutput(result),
	};
}

export async function installMarketplaceEntry(
	args?: Record<string, unknown>,
	options: { spawnCommand?: SpawnCommand } = {},
): Promise<MarketplaceInstallResult> {
	const entry = readInstallInput(args);
	logMarketplace("install-entry", {
		id: entry.id,
		type: entry.type,
		name: entry.name,
	});
	const spawnCommand = options.spawnCommand ?? defaultSpawnCommand;
	if (entry.type === "mcp") {
		const input = buildMarketplaceMcpInput(entry.install.args ?? []);
		const response = upsertMcpServer(input);
		return {
			id: entry.id,
			type: entry.type,
			status: "installed",
			message: `Installed ${entry.name ?? input.name ?? entry.id}.`,
			details: { mcp: response },
		};
	}
	if (entry.type === "skill") {
		return installSkill(entry, spawnCommand);
	}
	if (entry.type === "plugin") {
		return installPlugin(entry, spawnCommand);
	}
	throw new Error(`Unsupported marketplace entry type: ${entry.type}`);
}

export async function installMarketplaceEntryFromCatalog(
	args?: Record<string, unknown>,
	options: {
		spawnCommand?: SpawnCommand;
		loadCatalog?: CatalogLoader;
	} = {},
): Promise<MarketplaceInstallResult> {
	const requested = readInstallRequest(args);
	const catalog = await (options.loadCatalog ?? fetchMarketplaceCatalog)();
	const entry = readCatalogEntries(catalog).find(
		(candidate) =>
			candidate.id === requested.id && candidate.type === requested.type,
	);
	if (!entry) {
		throw new Error(
			`Marketplace entry ${requested.type}:${requested.id} was not found in the catalog.`,
		);
	}
	return installMarketplaceEntry(
		{ entry },
		{ spawnCommand: options.spawnCommand },
	);
}

export function listMarketplaceInstalledEntries(
	args?: Record<string, unknown>,
	inventory?: JsonRecord,
): MarketplaceInstallStatusResult {
	const entries = readInstallInputList(args);
	const installedKeys = entries
		.filter((entry) => isMarketplaceEntryInstalled(entry, inventory))
		.map(marketplaceEntryKey);
	logMarketplace("list-installed", {
		entryCount: entries.length,
		installedKeys,
		inventorySkillCount: Array.isArray(inventory?.skills)
			? inventory.skills.length
			: undefined,
		inventoryPluginCount: Array.isArray(inventory?.plugins)
			? inventory.plugins.length
			: undefined,
	});
	return { installedKeys };
}

export async function installMarketplaceEntryForDesktopCommand(
	args?: Record<string, unknown>,
	options: {
		spawnCommand?: SpawnCommand;
		loadCatalog?: CatalogLoader;
	} = {},
): Promise<MarketplaceInstallResult> {
	return installMarketplaceEntryFromCatalog(args, options);
}
