/**
 * Gateway-owned Marketplace, MCP settings, and managed Agent Plugin state.
 *
 * This module deliberately has no dependency on the legacy Hub/Core/SDK or
 * the `cline` executable. Marketplace requests are resolved against the
 * authoritative catalog inside the Gateway. Package acquisition uses `git`
 * with an argument vector (never a shell), publishes only validated Agent
 * Plugin packages, and keeps all mutable state under the Gateway namespace.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { promisify } from "node:util";
import type { EngineMcpServer } from "@cline/bot";
import { z } from "zod";
import type { GatewayPaths } from "./paths";
import type { PluginCatalog } from "./plugins/catalog";
import { type LoadedPlugin, loadPlugin } from "./plugins/loader";
import { AGENT_PLUGIN_SCHEMA_1_0_0 } from "./plugins/manifest";
import { readSecretFile, writeSecretFile } from "./secrets";

export const MCP_OAUTH_UNAVAILABLE_MESSAGE =
	"Browser-based MCP OAuth is not available in the Bundled Gateway yet. " +
	"Add a token as an Authorization header in MCP settings instead; the Gateway stores header values in its owner-only secrets directory.";

export const MCP_REDACTED_VALUE = "[stored securely]";

const execFileAsync = promisify(execFile);
const MARKETPLACE_CATALOG_URL =
	process.env.CLINE_MARKETPLACE_CATALOG_URL?.trim() ||
	"https://cline.github.io/marketplace/catalog.json";
const OFFICIAL_PLUGINS_REPOSITORY = "https://github.com/cline/plugins.git";
const MAX_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_PACKAGE_FILES = 8_000;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_LENGTH = 8_192;
const SECRET_METADATA_KEY =
	/(?:api.?key|access.?token|refresh.?token|authorization|credential|password|secret)/i;
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const EXECUTABLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,255}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_MCP_HTTP_HEADERS = new Set([
	"accept",
	"content-length",
	"content-type",
	"host",
	"mcp-session-id",
]);
const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

const MarketplacePrimitiveTypeSchema = z.enum(["mcp", "skill", "plugin"]);
export type MarketplacePrimitiveType = z.infer<
	typeof MarketplacePrimitiveTypeSchema
>;

const MarketplaceEntrySchema = z
	.object({
		id: z.string().min(1).max(128),
		type: MarketplacePrimitiveTypeSchema,
		name: z.string().min(1).max(256),
		install: z
			.object({
				args: z.array(z.string().max(MAX_ARGUMENT_LENGTH)).min(1).max(256),
			})
			.passthrough(),
	})
	.passthrough();

export type GatewayMarketplaceEntry = z.infer<typeof MarketplaceEntrySchema>;

const CatalogSchema = z
	.object({ entries: z.array(MarketplaceEntrySchema).max(10_000) })
	.passthrough();

export type GatewayMarketplaceCatalog = z.infer<typeof CatalogSchema>;

const StoredMcpServerSchema = z
	.object({
		name: z.string(),
		transportType: z.enum(["stdio", "sse", "streamableHttp"]),
		disabled: z.boolean(),
		command: z.string().optional(),
		args: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		url: z.string().optional(),
		envKeys: z.array(z.string()).optional(),
		headerKeys: z.array(z.string()).optional(),
		secretRef: z.string().optional(),
		metadata: z.unknown().optional(),
	})
	.strict();

const McpSettingsSchema = z
	.object({
		version: z.literal(1),
		servers: z.record(z.string(), StoredMcpServerSchema),
	})
	.strict();

type StoredMcpServer = z.infer<typeof StoredMcpServerSchema>;
type McpSettings = z.infer<typeof McpSettingsSchema>;

const ManagedPackageSchema = z
	.object({
		type: z.enum(["skill", "plugin"]),
		id: z.string(),
		name: z.string(),
		dirName: z.string().regex(SAFE_SEGMENT_PATTERN),
		disabled: z.boolean(),
		installedAt: z.number().int().nonnegative(),
		marketplaceKey: z.string().optional(),
	})
	.strict();

const MarketplaceMcpRecordSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		serverName: z.string(),
		installedAt: z.number().int().nonnegative(),
	})
	.strict();

const ExtensionStateSchema = z
	.object({
		version: z.literal(1),
		packages: z.record(z.string(), ManagedPackageSchema),
		marketplaceMcp: z.record(z.string(), MarketplaceMcpRecordSchema),
	})
	.strict();

type ExtensionState = z.infer<typeof ExtensionStateSchema>;
type ManagedPackage = z.infer<typeof ManagedPackageSchema>;

const McpSecretSchema = z
	.object({
		env: z.record(z.string(), z.string()).optional(),
		headers: z.record(z.string(), z.string()).optional(),
	})
	.strict();

type McpSecret = z.infer<typeof McpSecretSchema>;

export type GatewayMcpTransportType = "stdio" | "sse" | "streamableHttp";

export interface GatewayMcpServerInput {
	readonly name: string;
	readonly previousName?: string;
	readonly transportType: GatewayMcpTransportType;
	readonly command?: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly url?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly disabled?: boolean;
	readonly metadata?: unknown;
}

export interface GatewayMcpServerView {
	readonly name: string;
	readonly transportType: GatewayMcpTransportType;
	readonly disabled: boolean;
	readonly command?: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly url?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly metadata?: unknown;
	readonly configurationError?: string;
	readonly oauthStatus: {
		readonly supported: false;
		readonly configured: boolean;
		readonly authorizationRequired: false;
		readonly lastError?: string;
	};
}

export interface GatewayMcpServersResponse {
	readonly settingsPath: string;
	readonly hasSettingsFile: boolean;
	readonly servers: readonly GatewayMcpServerView[];
	readonly capabilities: {
		readonly oauth: {
			readonly supported: false;
			readonly reason: string;
		};
	};
}

export interface GatewayManagedPluginView {
	readonly name: string;
	readonly path: string;
	readonly enabled: boolean;
	readonly managed: boolean;
	readonly contributions: {
		readonly inspectionStatus: "available" | "disabled" | "failed";
		readonly capabilities: readonly string[];
		readonly tools: readonly string[];
		readonly skills: readonly string[];
		readonly rules: readonly string[];
		readonly hooks: readonly string[];
		readonly commands: readonly string[];
		readonly mcpServers: readonly string[];
		readonly providers: readonly string[];
	};
	readonly runtimeSupport: {
		readonly status: "active-next-run" | "catalog-only" | "unsupported";
		readonly message: string;
	};
}

export interface GatewayManagedSkillView {
	readonly name: string;
	readonly description: string;
	readonly instructions: string;
	readonly path: string;
	readonly pluginName: string;
}

export interface GatewayManagedExtensionsResponse {
	readonly plugins: readonly GatewayManagedPluginView[];
	readonly skills: readonly GatewayManagedSkillView[];
}

export interface GatewayMarketplaceActionResult {
	readonly id: string;
	readonly type: MarketplacePrimitiveType;
	readonly status: "installed" | "uninstalled";
	readonly message: string;
	readonly runtimeSupport?: GatewayManagedPluginView["runtimeSupport"];
}

export class GatewayExtensionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GatewayExtensionError";
	}
}

export type MarketplaceCatalogLoader = () => Promise<unknown>;
export type MarketplacePackageMaterializer = (
	entry: GatewayMarketplaceEntry,
	destination: string,
) => Promise<void>;

export interface GatewayExtensionStoreOptions {
	readonly paths: GatewayPaths;
	readonly plugins?: PluginCatalog;
	readonly clock?: () => number;
	readonly loadCatalog?: MarketplaceCatalogLoader;
	readonly materializePackage?: MarketplacePackageMaterializer;
}

function emptyState(): ExtensionState {
	return { version: 1, packages: {}, marketplaceMcp: {} };
}

function emptyMcpSettings(): McpSettings {
	return { version: 1, servers: {} };
}

function marketplaceKey(type: MarketplacePrimitiveType, id: string): string {
	return `${type}:${id}`;
}

function hash(value: string, length = 16): string {
	return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function safeSegment(value: string): string {
	const segment = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[._-]+|[._-]+$/g, "")
		.slice(0, 80);
	return segment || "extension";
}

function isInside(parent: string, child: string): boolean {
	const rel = relative(resolve(parent), resolve(child));
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function assertInside(parent: string, child: string, label: string): void {
	if (!isInside(parent, child)) {
		throw new GatewayExtensionError(
			`${label} escapes the Gateway data directory`,
		);
	}
}

interface FileSnapshot {
	readonly existed: boolean;
	readonly contents?: Buffer;
}

function snapshotFile(filePath: string): FileSnapshot {
	return existsSync(filePath)
		? { existed: true, contents: readFileSync(filePath) }
		: { existed: false };
}

function atomicWriteFile(filePath: string, contents: string | Buffer): void {
	mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
	const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, contents, {
			mode: 0o600,
			flag: "wx",
		});
		chmodSync(temporary, 0o600);
		renameSync(temporary, filePath);
		chmodSync(filePath, 0o600);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function atomicWriteJson(filePath: string, value: unknown): void {
	atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function restoreFileSnapshot(filePath: string, snapshot: FileSnapshot): void {
	if (!snapshot.existed) {
		rmSync(filePath, { force: true });
		return;
	}
	if (!snapshot.contents) {
		throw new GatewayExtensionError(
			`Could not restore empty file snapshot for ${filePath}`,
		);
	}
	atomicWriteFile(filePath, snapshot.contents);
}

async function defaultCatalogLoader(): Promise<unknown> {
	const url = new URL(MARKETPLACE_CATALOG_URL);
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new GatewayExtensionError(
			"Marketplace catalog URL must use HTTPS (HTTP is allowed only on loopback for development)",
		);
	}
	if (url.username || url.password) {
		throw new GatewayExtensionError(
			"Marketplace catalog URL must not contain credentials",
		);
	}
	const response = await fetch(url, {
		headers: { Accept: "application/json" },
		redirect: "error",
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		throw new GatewayExtensionError(
			`Marketplace catalog request failed: ${response.status} ${response.statusText}`.trim(),
		);
	}
	const length = Number(response.headers.get("content-length") ?? 0);
	if (Number.isFinite(length) && length > MAX_CATALOG_BYTES) {
		throw new GatewayExtensionError("Marketplace catalog is too large");
	}
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_CATALOG_BYTES) {
		throw new GatewayExtensionError("Marketplace catalog is too large");
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new GatewayExtensionError("Marketplace catalog is not valid JSON");
	}
}

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname.endsWith(".localhost")
	);
}

function validateRemoteUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new GatewayExtensionError(`Invalid MCP server URL: ${value}`);
	}
	if (
		url.protocol !== "https:" &&
		!(url.protocol === "http:" && isLoopbackHostname(url.hostname))
	) {
		throw new GatewayExtensionError(
			"Remote MCP URLs must use HTTPS (HTTP is allowed only on loopback)",
		);
	}
	if (url.username || url.password) {
		throw new GatewayExtensionError(
			"MCP server URLs must not contain credentials; use a request header instead",
		);
	}
	if (url.hash) {
		throw new GatewayExtensionError(
			"MCP server URLs must not contain fragments",
		);
	}
	if (url.toString().length > 2_048) {
		throw new GatewayExtensionError("MCP server URL is too long");
	}
	return url.toString();
}

function validateCommand(value: string): string {
	const command = value.trim();
	if (!command || command.includes("\0") || /[\r\n]/.test(command)) {
		throw new GatewayExtensionError("MCP command is invalid");
	}
	if (isAbsolute(command)) {
		let file: string;
		try {
			file = realpathSync(command);
		} catch {
			throw new GatewayExtensionError(`MCP command does not exist: ${command}`);
		}
		if (!statSync(file).isFile()) {
			throw new GatewayExtensionError(`MCP command is not a file: ${command}`);
		}
		return file;
	}
	if (!EXECUTABLE_PATTERN.test(command)) {
		throw new GatewayExtensionError(
			"MCP command must be an executable name or an existing absolute file path",
		);
	}
	return command;
}

function validateArguments(values: readonly string[] | undefined): string[] {
	const args = [...(values ?? [])];
	if (args.length > MAX_ARGUMENTS) {
		throw new GatewayExtensionError(
			`MCP commands support at most ${MAX_ARGUMENTS} arguments`,
		);
	}
	for (const value of args) {
		if (
			typeof value !== "string" ||
			value.length > MAX_ARGUMENT_LENGTH ||
			value.includes("\0") ||
			/[\r\n]/.test(value)
		) {
			throw new GatewayExtensionError(
				"MCP command contains an invalid argument",
			);
		}
	}
	return args;
}

function validateCwd(value: string | undefined): string | undefined {
	if (!value?.trim()) return undefined;
	if (!isAbsolute(value)) {
		throw new GatewayExtensionError("MCP working directory must be absolute");
	}
	let directory: string;
	try {
		directory = realpathSync(value);
	} catch {
		throw new GatewayExtensionError(
			`MCP working directory does not exist: ${value}`,
		);
	}
	if (!statSync(directory).isDirectory()) {
		throw new GatewayExtensionError(
			`MCP working directory is not a directory: ${value}`,
		);
	}
	return directory;
}

function validateSecretMap(
	value: Readonly<Record<string, string>> | undefined,
	kind: "environment variable" | "header",
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [rawKey, rawValue] of Object.entries(value ?? {})) {
		const key = rawKey.trim();
		if (
			(kind === "environment variable" && !ENV_NAME_PATTERN.test(key)) ||
			(kind === "header" && !HEADER_NAME_PATTERN.test(key))
		) {
			throw new GatewayExtensionError(`Invalid MCP ${kind} name: ${rawKey}`);
		}
		if (kind === "header" && RESERVED_MCP_HTTP_HEADERS.has(key.toLowerCase())) {
			throw new GatewayExtensionError(
				`MCP header is managed by the Gateway and cannot be overridden: ${key}`,
			);
		}
		if (
			typeof rawValue !== "string" ||
			rawValue.length > 32_768 ||
			rawValue.includes("\0") ||
			/[\r\n]/.test(rawValue)
		) {
			throw new GatewayExtensionError(`Invalid value for MCP ${kind} ${key}`);
		}
		result[key] = rawValue;
	}
	return result;
}

function validateMetadata(value: unknown): unknown {
	if (value === undefined) return undefined;
	let json: string;
	try {
		json = JSON.stringify(value);
	} catch {
		throw new GatewayExtensionError("MCP metadata must be JSON serializable");
	}
	if (Buffer.byteLength(json) > MAX_METADATA_BYTES) {
		throw new GatewayExtensionError("MCP metadata is too large");
	}
	const inspect = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) inspect(item);
			return;
		}
		if (!candidate || typeof candidate !== "object") return;
		for (const [key, item] of Object.entries(candidate)) {
			if (SECRET_METADATA_KEY.test(key)) {
				throw new GatewayExtensionError(
					`MCP metadata field "${key}" looks like a secret; put it in env or headers so the Gateway can store it securely`,
				);
			}
			inspect(item);
		}
	};
	inspect(value);
	return JSON.parse(json);
}

function resolveSecretMap(
	incoming: Record<string, string>,
	previous: Record<string, string> | undefined,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(incoming).map(([key, value]) => [
			key,
			value === MCP_REDACTED_VALUE && previous?.[key] !== undefined
				? previous[key]
				: value,
		]),
	);
}

function assertPackageTreeSafe(root: string): void {
	let files = 0;
	let bytes = 0;
	const visit = (directory: string): void => {
		for (const name of readdirSync(directory)) {
			const candidate = join(directory, name);
			const stat = lstatSync(candidate);
			if (stat.isSymbolicLink()) {
				throw new GatewayExtensionError(
					`Marketplace package contains a symbolic link: ${relative(root, candidate)}`,
				);
			}
			if (stat.isDirectory()) {
				visit(candidate);
				continue;
			}
			if (!stat.isFile()) {
				throw new GatewayExtensionError(
					`Marketplace package contains an unsupported filesystem entry: ${relative(root, candidate)}`,
				);
			}
			files += 1;
			bytes += stat.size;
			if (files > MAX_PACKAGE_FILES || bytes > MAX_PACKAGE_BYTES) {
				throw new GatewayExtensionError(
					"Marketplace package exceeds the Gateway package size limit",
				);
			}
		}
	};
	visit(root);
}

function copyPackageTree(source: string, destination: string): void {
	assertPackageTreeSafe(source);
	cpSync(source, destination, {
		recursive: true,
		errorOnExist: true,
		force: false,
		preserveTimestamps: true,
	});
}

async function cloneGitHubRepository(
	repository: string,
	destination: string,
): Promise<void> {
	if (!GITHUB_REPOSITORY_PATTERN.test(repository)) {
		throw new GatewayExtensionError(
			`Marketplace package source must be a GitHub owner/repository pair: ${repository}`,
		);
	}
	const url = `https://github.com/${repository}.git`;
	try {
		await execFileAsync(
			"git",
			[
				"clone",
				"--depth",
				"1",
				"--filter=blob:none",
				"--no-tags",
				url,
				destination,
			],
			{
				timeout: 120_000,
				maxBuffer: 512 * 1024,
				windowsHide: true,
			},
		);
	} catch (error) {
		throw new GatewayExtensionError(
			`Unable to download Marketplace package ${repository}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function skillSource(entry: GatewayMarketplaceEntry): {
	repository: string;
	skill?: string;
} {
	const [repository, ...rest] = entry.install.args;
	if (!repository || !GITHUB_REPOSITORY_PATTERN.test(repository)) {
		throw new GatewayExtensionError(
			`Skill ${entry.id} has an unsupported source; Bundled Gateway installs GitHub owner/repository sources only`,
		);
	}
	let skill: string | undefined;
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (arg === "--skill" || arg === "-s") {
			skill = rest[++index];
			if (!skill) {
				throw new GatewayExtensionError(
					`Skill ${entry.id} has a missing --skill value`,
				);
			}
			continue;
		}
		throw new GatewayExtensionError(
			`Skill ${entry.id} has an unsupported install option: ${arg}`,
		);
	}
	if (skill && !NAME_PATTERN.test(skill)) {
		throw new GatewayExtensionError(`Skill name is invalid: ${skill}`);
	}
	return { repository, skill };
}

async function defaultPackageMaterializer(
	entry: GatewayMarketplaceEntry,
	destination: string,
): Promise<void> {
	const work = dirname(destination);
	const checkout = join(work, "checkout");
	if (entry.type === "plugin") {
		const [slug, ...extra] = entry.install.args;
		if (!slug || extra.length > 0 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
			throw new GatewayExtensionError(
				`Plugin ${entry.id} is not an official Cline Marketplace plugin slug`,
			);
		}
		await cloneGitHubRepository("cline/plugins", checkout);
		const source = join(checkout, "plugins", slug);
		if (!existsSync(source) || !statSync(source).isDirectory()) {
			throw new GatewayExtensionError(
				`Official plugin ${slug} was not found in ${OFFICIAL_PLUGINS_REPOSITORY}`,
			);
		}
		copyPackageTree(source, destination);
		return;
	}
	if (entry.type !== "skill") {
		throw new GatewayExtensionError(
			`Package materialization does not support ${entry.type}`,
		);
	}
	const source = skillSource(entry);
	await cloneGitHubRepository(source.repository, checkout);
	const candidates = source.skill
		? [join(checkout, "skills", source.skill), join(checkout, source.skill)]
		: [checkout, join(checkout, "skills", entry.id), join(checkout, entry.id)];
	const selected = candidates.find((candidate) =>
		existsSync(join(candidate, "SKILL.md")),
	);
	if (!selected) {
		throw new GatewayExtensionError(
			`Skill ${source.skill ?? entry.id} was not found in ${source.repository}`,
		);
	}
	mkdirSync(join(destination, "skills"), { recursive: true, mode: 0o700 });
	const skillName = safeSegment(source.skill ?? entry.id);
	copyPackageTree(selected, join(destination, "skills", skillName));
	writeFileSync(
		join(destination, "plugin.json"),
		`${JSON.stringify(
			{
				$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
				name: `marketplace.${safeSegment(entry.id)}`.slice(0, 64),
				description: `Marketplace skill package for ${entry.name}`,
				repository: `https://github.com/${source.repository}`,
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
}

function parseMarketplaceMcp(
	entry: GatewayMarketplaceEntry,
): GatewayMcpServerInput {
	const [rawName, ...rest] = entry.install.args;
	const name = rawName?.trim();
	if (!name || !NAME_PATTERN.test(name)) {
		throw new GatewayExtensionError(
			`Marketplace MCP entry ${entry.id} has an invalid server name`,
		);
	}
	let transportType: GatewayMcpTransportType = "stdio";
	const headers: Record<string, string> = {};
	const target: string[] = [];
	let parsingOptions = true;
	for (let index = 0; index < rest.length; index += 1) {
		const arg = rest[index];
		if (parsingOptions && arg === "--") {
			target.push(...rest.slice(index + 1));
			break;
		}
		if (parsingOptions && (arg === "--transport" || arg === "-t")) {
			const value = rest[++index];
			if (!value) {
				throw new GatewayExtensionError("--transport requires a value");
			}
			if (value === "http" || value === "streamable-http") {
				transportType = "streamableHttp";
			} else if (
				value === "stdio" ||
				value === "sse" ||
				value === "streamableHttp"
			) {
				transportType = value;
			} else {
				throw new GatewayExtensionError(`Unsupported MCP transport: ${value}`);
			}
			continue;
		}
		if (
			parsingOptions &&
			(arg === "--header" || arg?.startsWith("--header="))
		) {
			const raw = arg === "--header" ? rest[++index] : arg.slice(9);
			const separator = raw?.indexOf(":") ?? -1;
			if (!raw || separator <= 0) {
				throw new GatewayExtensionError(
					"Marketplace MCP header must use `Header-Name: value`",
				);
			}
			headers[raw.slice(0, separator).trim()] = raw.slice(separator + 1).trim();
			continue;
		}
		parsingOptions = false;
		target.push(arg);
	}
	if (transportType === "stdio") {
		const [command, ...args] = target;
		if (!command) {
			throw new GatewayExtensionError(
				`Marketplace MCP entry ${entry.id} does not specify a command`,
			);
		}
		return { name, transportType, command, args, disabled: false };
	}
	if (target.length !== 1) {
		throw new GatewayExtensionError(
			`Marketplace MCP entry ${entry.id} must specify exactly one remote URL`,
		);
	}
	return {
		name,
		transportType,
		url: target[0],
		headers,
		disabled: false,
	};
}

function runtimeSupport(
	plugin: LoadedPlugin,
): GatewayManagedPluginView["runtimeSupport"] {
	if (plugin.mcpServers.length > 0) {
		return {
			status: "active-next-run",
			message:
				"This plugin's MCP tools are loaded by the Gateway for the next run; active runs retain their pinned plugin generation.",
		};
	}
	if (plugin.skills.length > 0) {
		return {
			status: "catalog-only",
			message:
				"The bundled Gateway can inspect this plugin's skills, but it does not automatically add global skill text to an active bot prompt.",
		};
	}
	return {
		status: "unsupported",
		message:
			"This package has no Agent Plugin MCP or skill components supported by the bundled Gateway. Legacy SDK tool/hook modules are not loaded.",
	};
}

export class GatewayExtensionStore {
	readonly paths: GatewayPaths;
	readonly stateFile: string;
	readonly mcpSettingsFile: string;
	private readonly plugins: PluginCatalog | undefined;
	private readonly clock: () => number;
	private readonly loadCatalog: MarketplaceCatalogLoader;
	private readonly materializePackage: MarketplacePackageMaterializer;
	private mutationTail: Promise<void> = Promise.resolve();

	constructor(options: GatewayExtensionStoreOptions) {
		this.paths = options.paths;
		this.stateFile = join(options.paths.dataDir, "managed-extensions.json");
		this.mcpSettingsFile = join(options.paths.dataDir, "mcp-settings.json");
		this.plugins = options.plugins;
		this.clock = options.clock ?? (() => Date.now());
		this.loadCatalog = options.loadCatalog ?? defaultCatalogLoader;
		this.materializePackage =
			options.materializePackage ?? defaultPackageMaterializer;
		this.applyDisabledPolicy(this.readState());
	}

	async getMarketplaceCatalog(): Promise<GatewayMarketplaceCatalog> {
		const result = CatalogSchema.safeParse(await this.loadCatalog());
		if (!result.success) {
			throw new GatewayExtensionError(
				`Marketplace catalog is invalid: ${result.error.issues[0]?.message ?? "unknown error"}`,
			);
		}
		return result.data;
	}

	listMarketplaceInstalled(): { installedKeys: readonly string[] } {
		const state = this.readState();
		const installed = new Set<string>();
		for (const record of Object.values(state.packages)) {
			if (
				record.marketplaceKey &&
				existsSync(join(this.paths.pluginsDir, record.dirName))
			) {
				installed.add(record.marketplaceKey);
			}
		}
		const settings = this.readMcpSettings();
		for (const [key, record] of Object.entries(state.marketplaceMcp)) {
			if (settings.servers[record.serverName]) installed.add(key);
		}
		return { installedKeys: [...installed].sort() };
	}

	async installMarketplace(input: {
		type: MarketplacePrimitiveType;
		id: string;
	}): Promise<GatewayMarketplaceActionResult> {
		return this.serialize(async () => {
			const entry = await this.resolveCatalogEntry(input.type, input.id);
			if (entry.type === "mcp") {
				const mcp = parseMarketplaceMcp(entry);
				this.putMcpServer(mcp);
				const state = this.readState();
				const key = marketplaceKey(entry.type, entry.id);
				state.marketplaceMcp[key] = {
					id: entry.id,
					name: entry.name,
					serverName: mcp.name,
					installedAt: this.clock(),
				};
				this.writeState(state);
				return {
					id: entry.id,
					type: entry.type,
					status: "installed",
					message: `Installed ${entry.name}.`,
				};
			}
			const key = marketplaceKey(entry.type, entry.id);
			const previousState = this.readState();
			const existing = Object.values(previousState.packages).find(
				(record) => record.marketplaceKey === key,
			);
			if (
				existing &&
				existsSync(join(this.paths.pluginsDir, existing.dirName))
			) {
				const loaded = this.requireLoadedPlugin(
					join(this.paths.pluginsDir, existing.dirName),
				);
				return {
					id: entry.id,
					type: entry.type,
					status: "installed",
					message: `${entry.name} is already installed.`,
					runtimeSupport: runtimeSupport(loaded),
				};
			}

			mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 });
			mkdirSync(this.paths.pluginsDir, { recursive: true, mode: 0o700 });
			const work = mkdtempSync(join(this.paths.dataDir, ".marketplace-"));
			const staging = join(work, "package");
			const dirName = `marketplace-${entry.type}-${safeSegment(entry.id)}-${hash(key, 10)}`;
			const target = join(this.paths.pluginsDir, dirName);
			assertInside(this.paths.pluginsDir, target, "Marketplace package path");
			let published = false;
			try {
				await this.materializePackage(entry, staging);
				const loaded = this.requireLoadedPlugin(staging);
				if (existsSync(target)) {
					throw new GatewayExtensionError(
						`Marketplace target already exists: ${target}`,
					);
				}
				renameSync(staging, target);
				published = true;
				const nextState = structuredClone(previousState);
				nextState.packages[key] = {
					type: entry.type,
					id: entry.id,
					name: entry.name,
					dirName,
					disabled: false,
					installedAt: this.clock(),
					marketplaceKey: key,
				};
				this.commitPluginState(previousState, nextState, () => {
					rmSync(target, { recursive: true, force: true });
					published = false;
				});
				return {
					id: entry.id,
					type: entry.type,
					status: "installed",
					message: `Installed ${entry.name}. ${runtimeSupport(loaded).message}`,
					runtimeSupport: runtimeSupport(loaded),
				};
			} catch (error) {
				if (published) rmSync(target, { recursive: true, force: true });
				throw error;
			} finally {
				rmSync(work, { recursive: true, force: true });
			}
		});
	}

	async uninstallMarketplace(input: {
		type: MarketplacePrimitiveType;
		id: string;
	}): Promise<GatewayMarketplaceActionResult> {
		return this.serialize(async () => {
			const key = marketplaceKey(input.type, input.id);
			const state = this.readState();
			if (input.type === "mcp") {
				const record = state.marketplaceMcp[key];
				if (!record) {
					throw new GatewayExtensionError(
						`Marketplace MCP entry is not installed: ${key}`,
					);
				}
				this.deleteMcpServer(record.serverName);
				delete state.marketplaceMcp[key];
				this.writeState(state);
				return {
					id: input.id,
					type: input.type,
					status: "uninstalled",
					message: `Uninstalled ${record.name}.`,
				};
			}
			const match = Object.entries(state.packages).find(
				([, candidate]) => candidate.marketplaceKey === key,
			);
			if (!match) {
				throw new GatewayExtensionError(
					`Marketplace package is not installed: ${key}`,
				);
			}
			const [stateKey, record] = match;
			const target = join(this.paths.pluginsDir, record.dirName);
			assertInside(this.paths.pluginsDir, target, "Marketplace package path");
			mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 });
			const work = mkdtempSync(join(this.paths.dataDir, ".uninstall-"));
			const quarantined = join(work, "package");
			try {
				renameSync(target, quarantined);
				const nextState = structuredClone(state);
				delete nextState.packages[stateKey];
				this.commitPluginState(state, nextState, () => {
					renameSync(quarantined, target);
				});
				return {
					id: input.id,
					type: input.type,
					status: "uninstalled",
					message: `Uninstalled ${record.name}.`,
				};
			} finally {
				rmSync(work, { recursive: true, force: true });
			}
		});
	}

	listMcpServers(): GatewayMcpServersResponse {
		const settings = this.readMcpSettings();
		const servers = Object.values(settings.servers)
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((server): GatewayMcpServerView => {
				const env = server.envKeys?.length
					? Object.fromEntries(
							server.envKeys.map((key) => [key, MCP_REDACTED_VALUE]),
						)
					: undefined;
				const headers = server.headerKeys?.length
					? Object.fromEntries(
							server.headerKeys.map((key) => [key, MCP_REDACTED_VALUE]),
						)
					: undefined;
				const legacyError =
					server.transportType === "sse"
						? "Legacy SSE MCP transport is saved but is not executable by the Bundled Gateway. Use Streamable HTTP or stdio."
						: undefined;
				return {
					name: server.name,
					transportType: server.transportType,
					disabled: server.disabled,
					...(server.command ? { command: server.command } : {}),
					...(server.args?.length ? { args: server.args } : {}),
					...(server.cwd ? { cwd: server.cwd } : {}),
					...(env ? { env } : {}),
					...(server.url ? { url: server.url } : {}),
					...(headers ? { headers } : {}),
					...(server.metadata !== undefined
						? { metadata: server.metadata }
						: {}),
					...(legacyError ? { configurationError: legacyError } : {}),
					oauthStatus: {
						supported: false,
						configured:
							server.headerKeys?.some(
								(key) => key.toLowerCase() === "authorization",
							) ?? false,
						authorizationRequired: false,
						...(server.transportType !== "stdio"
							? { lastError: MCP_OAUTH_UNAVAILABLE_MESSAGE }
							: {}),
					},
				};
			});
		return {
			settingsPath: this.mcpSettingsFile,
			hasSettingsFile: existsSync(this.mcpSettingsFile),
			servers,
			capabilities: {
				oauth: { supported: false, reason: MCP_OAUTH_UNAVAILABLE_MESSAGE },
			},
		};
	}

	putMcpServer(input: GatewayMcpServerInput): GatewayMcpServersResponse {
		const name = input.name.trim();
		const previousName = input.previousName?.trim() || name;
		if (!NAME_PATTERN.test(name)) {
			throw new GatewayExtensionError(
				"MCP server names must use letters, numbers, dots, underscores, and hyphens",
			);
		}
		if (!NAME_PATTERN.test(previousName)) {
			throw new GatewayExtensionError("Previous MCP server name is invalid");
		}
		const settings = this.readMcpSettings();
		const existing = settings.servers[previousName];
		if (name !== previousName && settings.servers[name]) {
			throw new GatewayExtensionError(`MCP server already exists: ${name}`);
		}
		const oldSecret = existing ? this.readMcpSecret(existing) : undefined;
		const incomingEnv = validateSecretMap(input.env, "environment variable");
		const incomingHeaders = validateSecretMap(input.headers, "header");
		const env = resolveSecretMap(incomingEnv, oldSecret?.env);
		const headers = resolveSecretMap(incomingHeaders, oldSecret?.headers);
		const metadata = validateMetadata(input.metadata);
		let stored: StoredMcpServer;
		if (input.transportType === "stdio") {
			if (Object.keys(headers).length > 0) {
				throw new GatewayExtensionError(
					"Stdio MCP servers do not support request headers",
				);
			}
			stored = {
				name,
				transportType: "stdio",
				disabled: input.disabled ?? false,
				command: validateCommand(input.command ?? ""),
				args: validateArguments(input.args),
				...(validateCwd(input.cwd) ? { cwd: validateCwd(input.cwd) } : {}),
				...(Object.keys(env).length > 0
					? { envKeys: Object.keys(env).sort() }
					: {}),
				...(metadata !== undefined ? { metadata } : {}),
			};
		} else {
			if (Object.keys(env).length > 0) {
				throw new GatewayExtensionError(
					"Remote MCP servers do not support process environment variables",
				);
			}
			stored = {
				name,
				transportType: input.transportType,
				disabled: input.disabled ?? false,
				url: validateRemoteUrl(input.url ?? ""),
				...(Object.keys(headers).length > 0
					? { headerKeys: Object.keys(headers).sort() }
					: {}),
				...(metadata !== undefined ? { metadata } : {}),
			};
		}

		const secretRef = this.secretRef(name);
		if (Object.keys(env).length > 0 || Object.keys(headers).length > 0) {
			writeSecretFile(
				this.paths,
				secretRef,
				JSON.stringify({
					...(Object.keys(env).length > 0 ? { env } : {}),
					...(Object.keys(headers).length > 0 ? { headers } : {}),
				} satisfies McpSecret),
			);
			stored.secretRef = secretRef;
		} else {
			this.deleteMcpSecret(secretRef);
		}
		if (existing?.secretRef && existing.secretRef !== secretRef) {
			this.deleteMcpSecret(existing.secretRef);
		}
		if (name !== previousName) delete settings.servers[previousName];
		settings.servers[name] = stored;
		this.writeMcpSettings(settings);

		if (name !== previousName) {
			const state = this.readState();
			let changed = false;
			for (const record of Object.values(state.marketplaceMcp)) {
				if (record.serverName === previousName) {
					record.serverName = name;
					changed = true;
				}
			}
			if (changed) this.writeState(state);
		}
		return this.listMcpServers();
	}

	deleteMcpServer(nameInput: string): GatewayMcpServersResponse {
		const name = nameInput.trim();
		const settings = this.readMcpSettings();
		const existing = settings.servers[name];
		if (!existing) {
			throw new GatewayExtensionError(`Unknown MCP server: ${name}`);
		}
		delete settings.servers[name];
		this.writeMcpSettings(settings);
		if (existing.secretRef) this.deleteMcpSecret(existing.secretRef);
		const state = this.readState();
		let changed = false;
		for (const [key, record] of Object.entries(state.marketplaceMcp)) {
			if (record.serverName === name) {
				delete state.marketplaceMcp[key];
				changed = true;
			}
		}
		if (changed) this.writeState(state);
		return this.listMcpServers();
	}

	setMcpServerDisabled(
		nameInput: string,
		disabled: boolean,
	): GatewayMcpServersResponse {
		const name = nameInput.trim();
		const settings = this.readMcpSettings();
		const existing = settings.servers[name];
		if (!existing) {
			throw new GatewayExtensionError(`Unknown MCP server: ${name}`);
		}
		settings.servers[name] = { ...existing, disabled };
		this.writeMcpSettings(settings);
		return this.listMcpServers();
	}

	/** Definitions with secret values resolved only inside the Gateway process. */
	listExecutableMcpDefinitions(): readonly EngineMcpServer[] {
		const definitions: EngineMcpServer[] = [];
		for (const server of Object.values(this.readMcpSettings().servers)) {
			if (server.disabled || server.transportType === "sse") continue;
			const secret = this.readMcpSecret(server);
			if (server.transportType === "stdio" && server.command) {
				definitions.push({
					name: `settings/${server.name}`,
					transport: {
						kind: "stdio",
						command: server.command,
						...(server.args?.length ? { args: server.args } : {}),
						...(server.cwd ? { cwd: server.cwd } : {}),
						...(secret?.env ? { env: secret.env } : {}),
					},
				});
			} else if (server.transportType === "streamableHttp" && server.url) {
				definitions.push({
					name: `settings/${server.name}`,
					transport: {
						kind: "http",
						url: server.url,
						...(secret?.headers ? { headers: secret.headers } : {}),
					},
				});
			}
		}
		return definitions;
	}

	listManagedExtensions(): GatewayManagedExtensionsResponse {
		const state = this.readState();
		const roots = new Map<
			string,
			{ record?: ManagedPackage; loaded?: LoadedPlugin; failed?: boolean }
		>();
		for (const record of Object.values(state.packages)) {
			const root = join(this.paths.pluginsDir, record.dirName);
			try {
				roots.set(resolve(root), {
					record,
					loaded: this.requireLoadedPlugin(root),
				});
			} catch {
				roots.set(resolve(root), { record, failed: true });
			}
		}
		for (const entry of this.plugins?.current.entries ?? []) {
			if (entry.scope.kind !== "global") continue;
			if (!isInside(this.paths.pluginsDir, entry.plugin.rootPath)) continue;
			if (!roots.has(resolve(entry.plugin.rootPath))) {
				roots.set(resolve(entry.plugin.rootPath), { loaded: entry.plugin });
			}
		}
		const plugins: GatewayManagedPluginView[] = [];
		const skills: GatewayManagedSkillView[] = [];
		for (const [root, item] of roots) {
			const disabled = item.record?.disabled ?? false;
			const plugin = item.loaded;
			if (plugin) {
				for (const skill of plugin.skills) {
					skills.push({
						name: skill.name,
						description: skill.description,
						instructions: skill.content,
						path: skill.skillFile,
						pluginName: plugin.manifest.name,
					});
				}
			}
			if (item.record?.type === "skill") continue;
			const name = plugin?.manifest.name ?? item.record?.name ?? basename(root);
			const support = plugin
				? runtimeSupport(plugin)
				: {
						status: "unsupported" as const,
						message: "The Gateway could not load this plugin package.",
					};
			plugins.push({
				name,
				path: root,
				enabled: !disabled,
				managed: Boolean(item.record),
				contributions: {
					inspectionStatus: item.failed
						? "failed"
						: disabled
							? "disabled"
							: "available",
					capabilities: [],
					tools: plugin?.mcpServers.map((server) => server.name) ?? [],
					skills: plugin?.skills.map((skill) => skill.name) ?? [],
					rules: [],
					hooks: [],
					commands: [],
					mcpServers: plugin?.mcpServers.map((server) => server.name) ?? [],
					providers: [],
				},
				runtimeSupport: support,
			});
		}
		return {
			plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
			skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
		};
	}

	setPluginDisabled(
		pathInput: string,
		disabled: boolean,
	): GatewayManagedExtensionsResponse {
		const requested = resolve(pathInput);
		assertInside(this.paths.pluginsDir, requested, "Plugin path");
		const previousState = this.readState();
		const nextState = structuredClone(previousState);
		let key = Object.entries(nextState.packages).find(
			([, record]) =>
				resolve(join(this.paths.pluginsDir, record.dirName)) === requested,
		)?.[0];
		if (!key) {
			const entry = this.plugins?.current.entries.find(
				(candidate) =>
					candidate.scope.kind === "global" &&
					resolve(candidate.plugin.rootPath) === requested,
			);
			if (!entry) {
				throw new GatewayExtensionError(
					"Plugin path is not an installed Gateway plugin",
				);
			}
			key = `local:${hash(requested)}`;
			nextState.packages[key] = {
				type: "plugin",
				id: entry.plugin.manifest.name,
				name: entry.plugin.manifest.name,
				dirName: basename(requested),
				disabled,
				installedAt: this.clock(),
			};
		} else {
			nextState.packages[key] = {
				...nextState.packages[key],
				disabled,
			};
		}
		this.commitPluginState(previousState, nextState, () => {});
		return this.listManagedExtensions();
	}

	uninstallLocal(input: {
		type: "mcp" | "skill" | "workflow" | "plugin";
		id?: string;
		name?: string;
		path?: string;
	}): GatewayMarketplaceActionResult {
		if (input.type === "workflow") {
			throw new GatewayExtensionError(
				"Bundled Gateway does not own workflow files. Remove the workflow from its project or global configuration directory.",
			);
		}
		if (input.type === "mcp") {
			const name = input.name?.trim() || input.id?.trim();
			if (!name) throw new GatewayExtensionError("MCP server name is required");
			this.deleteMcpServer(name);
			return {
				id: input.id ?? name,
				type: "mcp",
				status: "uninstalled",
				message: `Uninstalled ${name}.`,
			};
		}
		const state = this.readState();
		const requestedPath = input.path ? resolve(input.path) : undefined;
		const match = Object.entries(state.packages).find(([, record]) => {
			const root = resolve(join(this.paths.pluginsDir, record.dirName));
			if (requestedPath) {
				if (root === requestedPath) return true;
				if (record.type === "skill") {
					try {
						const loaded = this.requireLoadedPlugin(root);
						return loaded.skills.some(
							(skill) => resolve(skill.skillFile) === requestedPath,
						);
					} catch {
						return false;
					}
				}
			}
			return Boolean(
				(input.id && record.id === input.id) ||
					(input.name && record.name === input.name),
			);
		});
		if (!match) {
			throw new GatewayExtensionError(
				`The ${input.type} is not a Gateway-managed installation and cannot be removed from this UI`,
			);
		}
		const [key, record] = match;
		if (record.type !== input.type) {
			throw new GatewayExtensionError(
				`Managed package is ${record.type}, not ${input.type}`,
			);
		}
		const target = resolve(join(this.paths.pluginsDir, record.dirName));
		assertInside(this.paths.pluginsDir, target, "Managed package path");
		mkdirSync(this.paths.dataDir, { recursive: true, mode: 0o700 });
		const work = mkdtempSync(join(this.paths.dataDir, ".uninstall-"));
		const quarantined = join(work, "package");
		try {
			renameSync(target, quarantined);
			const nextState = structuredClone(state);
			delete nextState.packages[key];
			this.commitPluginState(state, nextState, () => {
				renameSync(quarantined, target);
			});
			return {
				id: input.id ?? record.id,
				type: input.type,
				status: "uninstalled",
				message: `Uninstalled ${record.name}.`,
			};
		} finally {
			rmSync(work, { recursive: true, force: true });
		}
	}

	private async resolveCatalogEntry(
		type: MarketplacePrimitiveType,
		idInput: string,
	): Promise<GatewayMarketplaceEntry> {
		const id = idInput.trim();
		if (!NAME_PATTERN.test(id)) {
			throw new GatewayExtensionError("Marketplace entry ID is invalid");
		}
		const catalog = await this.getMarketplaceCatalog();
		const matches = catalog.entries.filter(
			(entry) => entry.type === type && entry.id === id,
		);
		if (matches.length !== 1) {
			throw new GatewayExtensionError(
				matches.length === 0
					? `Marketplace entry not found: ${type}:${id}`
					: `Marketplace catalog contains a duplicate entry: ${type}:${id}`,
			);
		}
		return matches[0];
	}

	private readState(): ExtensionState {
		if (!existsSync(this.stateFile)) return emptyState();
		try {
			return ExtensionStateSchema.parse(
				JSON.parse(readFileSync(this.stateFile, "utf8")),
			);
		} catch (error) {
			throw new GatewayExtensionError(
				`Gateway managed extension state is invalid at ${this.stateFile}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private writeState(state: ExtensionState): void {
		atomicWriteJson(this.stateFile, ExtensionStateSchema.parse(state));
	}

	private readMcpSettings(): McpSettings {
		if (!existsSync(this.mcpSettingsFile)) return emptyMcpSettings();
		try {
			return McpSettingsSchema.parse(
				JSON.parse(readFileSync(this.mcpSettingsFile, "utf8")),
			);
		} catch (error) {
			throw new GatewayExtensionError(
				`Gateway MCP settings are invalid at ${this.mcpSettingsFile}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private writeMcpSettings(settings: McpSettings): void {
		atomicWriteJson(this.mcpSettingsFile, McpSettingsSchema.parse(settings));
	}

	private secretRef(name: string): string {
		return `mcp-${hash(name, 24)}`;
	}

	private readMcpSecret(server: StoredMcpServer): McpSecret | undefined {
		if (!server.secretRef) return undefined;
		const value = readSecretFile(this.paths, server.secretRef);
		if (value === undefined) return undefined;
		try {
			return McpSecretSchema.parse(JSON.parse(value));
		} catch (error) {
			throw new GatewayExtensionError(
				`Secret data for MCP server ${server.name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private deleteMcpSecret(secretRef: string): void {
		const file = this.paths.secretFile(secretRef);
		assertInside(this.paths.secretsDir, file, "MCP secret path");
		rmSync(file, { force: true });
	}

	private requireLoadedPlugin(root: string): LoadedPlugin {
		const result = loadPlugin(root);
		if (!result.ok) {
			throw new GatewayExtensionError(
				`Marketplace package is not a valid Agent Plugin: ${result.diagnostics.map((item) => item.message).join("; ")}`,
			);
		}
		return result.plugin;
	}

	private applyDisabledPolicy(state: ExtensionState): void {
		this.plugins?.setDisabledRoots(
			Object.values(state.packages)
				.filter((record) => record.disabled)
				.map((record) => join(this.paths.pluginsDir, record.dirName)),
		);
	}

	private reloadPlugins(state: ExtensionState): void {
		this.applyDisabledPolicy(state);
		const report = this.plugins?.reload();
		if (report && !report.ok) {
			throw new GatewayExtensionError(
				`Plugin catalog reload failed; the previous generation is still active: ${report.error ?? "unknown error"}`,
			);
		}
	}

	/**
	 * Publish a managed-plugin mutation as one catalog/state transition. A
	 * catalog reconciliation is itself generation-atomic; this wrapper also
	 * restores the prior on-disk state, package tree, and disabled-root policy
	 * when reconciliation rejects the proposed generation.
	 */
	private commitPluginState(
		previousState: ExtensionState,
		nextState: ExtensionState,
		rollbackFiles: () => void,
	): void {
		const stateFileSnapshot = snapshotFile(this.stateFile);
		try {
			this.writeState(nextState);
			this.reloadPlugins(nextState);
		} catch (error) {
			try {
				rollbackFiles();
				restoreFileSnapshot(this.stateFile, stateFileSnapshot);
				this.applyDisabledPolicy(previousState);
			} catch (rollbackError) {
				throw new GatewayExtensionError(
					`Plugin mutation failed (${error instanceof Error ? error.message : String(error)}) and rollback failed (${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)})`,
				);
			}
			throw error;
		}
	}

	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutationTail.then(operation, operation);
		this.mutationTail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
