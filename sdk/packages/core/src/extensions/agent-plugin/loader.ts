import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { validateHeaderName, validateHeaderValue } from "node:http";
import { isIP } from "node:net";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	AGENT_PLUGIN_MANIFEST_FILE_NAME,
	resolveAgentPluginSearchPaths,
	resolveClineDataDir,
	SKILLS_CONFIG_DIRECTORY_NAME,
} from "@cline/shared/storage";
import type { McpServerRegistration, McpServerTransportConfig } from "../mcp";
import { parseAgentSkillMarkdown } from "./agent-skill";
import type {
	AgentPluginPackageDiagnostic,
	AgentPluginPackageLoadReport,
	AgentPluginPackageManifest,
	AgentPluginPackageMcpServer,
	AgentPluginPackageSkill,
	LoadAgentPluginPackagesOptions,
	LoadedAgentPluginPackage,
} from "./types";

export const AGENT_PLUGINS_V1_MANIFEST_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_V1_MCP_SCHEMA =
	"https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const MANIFEST_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);
const AUTHOR_FIELDS = new Set(["name", "email", "url"]);
const PLUGIN_NAME_PATTERN =
	/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
// biome-ignore lint/suspicious/noTemplateCurlyInString: Agent Plugins defines this exact literal placeholder.
const PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Agent Plugins defines this exact literal placeholder.
const PLUGIN_DATA_PLACEHOLDER = "${PLUGIN_DATA}";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isMissingPathError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function diagnostic(
	input: Omit<AgentPluginPackageDiagnostic, "level"> & {
		level?: AgentPluginPackageDiagnostic["level"];
	},
): AgentPluginPackageDiagnostic {
	return { level: input.level ?? "error", ...input };
}

async function resolveDirectory(path: string): Promise<string> {
	const resolvedPath = await realpath(path);
	if (!(await stat(resolvedPath)).isDirectory()) {
		throw new Error("expected a directory");
	}
	return resolvedPath;
}

async function resolveContainedExistingPath(
	rootPath: string,
	path: string,
	expectedKind: "file" | "directory",
): Promise<string> {
	const resolvedPath = await realpath(path);
	if (!isPathWithin(rootPath, resolvedPath)) {
		throw new Error(`path resolves outside the plugin root: ${path}`);
	}
	const pathStat = await stat(resolvedPath);
	const hasExpectedKind =
		expectedKind === "file" ? pathStat.isFile() : pathStat.isDirectory();
	if (!hasExpectedKind) {
		throw new Error(`expected a regular ${expectedKind}: ${path}`);
	}
	return resolvedPath;
}

/**
 * Resolve a possibly-not-yet-created path while still resolving every existing
 * ancestor. This catches an escaping symlink before handing the projected path
 * to a subprocess and keeps a future child under the intended package/data root.
 */
async function resolveContainedProjectedPath(
	rootPath: string,
	path: string,
): Promise<string> {
	const absolutePath = resolve(path);
	if (!isPathWithin(rootPath, absolutePath)) {
		throw new Error(`path resolves outside its permitted root: ${path}`);
	}

	let existingAncestor = absolutePath;
	while (true) {
		try {
			const resolvedAncestor = await realpath(existingAncestor);
			const projected = resolve(
				resolvedAncestor,
				relative(existingAncestor, absolutePath),
			);
			if (!isPathWithin(rootPath, projected)) {
				throw new Error(`path resolves outside its permitted root: ${path}`);
			}
			return projected;
		} catch (error) {
			if (!isMissingPathError(error)) {
				throw error;
			}
			const parent = dirname(existingAncestor);
			if (parent === existingAncestor) {
				throw error;
			}
			existingAncestor = parent;
		}
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

async function pathLocationExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissingPathError(error)) {
			return false;
		}
		throw error;
	}
}

async function discoverPluginRoots(searchPath: string): Promise<string[]> {
	let searchRoot: string;
	try {
		searchRoot = await resolveDirectory(searchPath);
	} catch {
		return [];
	}

	const roots: string[] = [];
	let entries: Dirent[];
	try {
		entries = await readdir(searchRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	for (const entry of entries) {
		const candidate = join(searchRoot, entry.name);
		let candidateRoot: string;
		try {
			candidateRoot = await resolveDirectory(candidate);
		} catch {
			continue;
		}
		let hasManifest = false;
		try {
			hasManifest = await pathLocationExists(
				join(candidateRoot, AGENT_PLUGIN_MANIFEST_FILE_NAME),
			);
		} catch {
			continue;
		}
		if (hasManifest) {
			roots.push(candidateRoot);
		}
	}
	return roots.sort((left, right) => left.localeCompare(right));
}

async function resolveCandidateRoots(
	options: LoadAgentPluginPackagesOptions,
	diagnostics: AgentPluginPackageDiagnostic[],
): Promise<string[]> {
	const cwd = resolve(options.cwd ?? process.cwd());
	const candidates: string[] = [];
	for (const configuredPath of options.pluginPaths ?? []) {
		const trimmed = configuredPath.trim();
		if (!trimmed) {
			continue;
		}
		const absolutePath = resolve(cwd, trimmed);
		try {
			candidates.push(await resolveDirectory(absolutePath));
		} catch (error) {
			diagnostics.push(
				diagnostic({
					scope: "plugin",
					pluginPath: absolutePath,
					message: `Cannot load Agent Plugin directory: ${errorMessage(error)}`,
				}),
			);
		}
	}

	const searchPaths = options.searchPaths ?? resolveAgentPluginSearchPaths();
	for (const searchPath of searchPaths) {
		candidates.push(...(await discoverPluginRoots(searchPath)));
	}

	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (!seen.has(candidate)) {
			seen.add(candidate);
			deduped.push(candidate);
		}
	}
	return deduped;
}

function requireOptionalString(
	manifest: Record<string, unknown>,
	fieldName: string,
): string | undefined {
	const value = manifest[fieldName];
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Manifest field '${fieldName}' must be a string.`);
	}
	return value;
}

function parseManifest(
	value: unknown,
	pluginPath: string,
	diagnostics: AgentPluginPackageDiagnostic[],
): AgentPluginPackageManifest {
	if (!isRecord(value)) {
		throw new Error("plugin.json must contain a JSON object.");
	}

	for (const field of Object.keys(value)
		.filter((name) => !MANIFEST_FIELDS.has(name))
		.sort()) {
		diagnostics.push(
			diagnostic({
				level: "warning",
				scope: "manifest",
				pluginPath,
				message: `Ignoring unknown plugin.json field '${field}'.`,
			}),
		);
	}

	if (value.$schema !== AGENT_PLUGINS_V1_MANIFEST_SCHEMA) {
		throw new Error(
			`Unsupported or missing plugin.json $schema; expected '${AGENT_PLUGINS_V1_MANIFEST_SCHEMA}'.`,
		);
	}
	if (typeof value.name !== "string") {
		throw new Error("Manifest field 'name' must be a string.");
	}
	if (
		value.name.length < 1 ||
		value.name.length > 64 ||
		!PLUGIN_NAME_PATTERN.test(value.name)
	) {
		throw new Error(
			"Manifest field 'name' must be 1-64 lowercase alphanumeric, hyphen, or period characters; it must start and end alphanumeric and cannot contain '--' or '..'.",
		);
	}

	let author: AgentPluginPackageManifest["author"];
	if (value.author !== undefined) {
		if (!isRecord(value.author)) {
			throw new Error("Manifest field 'author' must be an object.");
		}
		const unknownAuthorFields = Object.keys(value.author).filter(
			(field) => !AUTHOR_FIELDS.has(field),
		);
		if (unknownAuthorFields.length > 0) {
			throw new Error(
				`Manifest author contains unknown field '${unknownAuthorFields.sort()[0]}'.`,
			);
		}
		for (const [field, entry] of Object.entries(value.author)) {
			if (typeof entry !== "string") {
				throw new Error(`Manifest author field '${field}' must be a string.`);
			}
		}
		author = value.author as AgentPluginPackageManifest["author"];
	}

	let keywords: string[] | undefined;
	if (value.keywords !== undefined) {
		if (
			!Array.isArray(value.keywords) ||
			!value.keywords.every((entry) => typeof entry === "string")
		) {
			throw new Error("Manifest field 'keywords' must be an array of strings.");
		}
		keywords = [...value.keywords];
	}

	let extensions: Record<string, unknown> | undefined;
	if (value.extensions !== undefined) {
		if (isRecord(value.extensions)) {
			// Cline currently implements no Agent Plugins client-extension
			// namespace. Per the spec, leave every value wholly unvalidated.
			extensions = { ...value.extensions };
		} else {
			diagnostics.push(
				diagnostic({
					level: "warning",
					scope: "manifest",
					pluginPath,
					pluginName: value.name,
					message: "Ignoring non-object plugin.json 'extensions' field.",
				}),
			);
		}
	}

	return {
		$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
		name: value.name,
		...(requireOptionalString(value, "version") !== undefined
			? { version: value.version as string }
			: {}),
		...(requireOptionalString(value, "description") !== undefined
			? { description: value.description as string }
			: {}),
		...(author ? { author } : {}),
		...(requireOptionalString(value, "homepage") !== undefined
			? { homepage: value.homepage as string }
			: {}),
		...(requireOptionalString(value, "repository") !== undefined
			? { repository: value.repository as string }
			: {}),
		...(requireOptionalString(value, "license") !== undefined
			? { license: value.license as string }
			: {}),
		...(keywords ? { keywords } : {}),
		...(extensions ? { extensions } : {}),
	};
}

async function loadManifest(
	pluginRoot: string,
	diagnostics: AgentPluginPackageDiagnostic[],
): Promise<{
	manifestPath: string;
	manifest: AgentPluginPackageManifest;
}> {
	const candidatePath = join(pluginRoot, AGENT_PLUGIN_MANIFEST_FILE_NAME);
	const manifestPath = await resolveContainedExistingPath(
		pluginRoot,
		candidatePath,
		"file",
	);
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(`Invalid plugin.json: ${errorMessage(error)}`);
	}
	return {
		manifestPath,
		manifest: parseManifest(parsed, pluginRoot, diagnostics),
	};
}

async function loadSkills(
	pluginRoot: string,
	pluginName: string,
	diagnostics: AgentPluginPackageDiagnostic[],
): Promise<AgentPluginPackageSkill[]> {
	const candidatePath = join(pluginRoot, SKILLS_CONFIG_DIRECTORY_NAME);
	let hasSkillsLocation: boolean;
	try {
		hasSkillsLocation = await pathLocationExists(candidatePath);
	} catch (error) {
		diagnostics.push(
			diagnostic({
				scope: "skills",
				pluginPath: pluginRoot,
				pluginName,
				componentPath: candidatePath,
				message: `Cannot inspect Agent Plugin skills component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}
	if (!hasSkillsLocation) {
		return [];
	}

	let skillsRoot: string;
	try {
		skillsRoot = await resolveContainedExistingPath(
			pluginRoot,
			candidatePath,
			"directory",
		);
	} catch (error) {
		diagnostics.push(
			diagnostic({
				scope: "skills",
				pluginPath: pluginRoot,
				pluginName,
				componentPath: candidatePath,
				message: `Invalid Agent Plugin skills component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}

	const skills: AgentPluginPackageSkill[] = [];
	let entries: Dirent[];
	try {
		entries = await readdir(skillsRoot, { withFileTypes: true });
	} catch (error) {
		diagnostics.push(
			diagnostic({
				scope: "skills",
				pluginPath: pluginRoot,
				pluginName,
				componentPath: skillsRoot,
				message: `Cannot read Agent Plugin skills component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}

	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const candidateSkillRoot = join(skillsRoot, entry.name);
		let skillRoot: string;
		try {
			skillRoot = await resolveContainedExistingPath(
				pluginRoot,
				candidateSkillRoot,
				"directory",
			);
		} catch (error) {
			if (entry.isSymbolicLink()) {
				diagnostics.push(
					diagnostic({
						scope: "skill",
						pluginPath: pluginRoot,
						pluginName,
						componentPath: candidateSkillRoot,
						componentName: entry.name,
						message: `Skipping invalid Agent Plugin skill directory '${entry.name}': ${errorMessage(error)}`,
					}),
				);
			}
			continue;
		}
		const candidateFilePath = join(skillRoot, "SKILL.md");
		let hasSkillFile: boolean;
		try {
			hasSkillFile = await pathLocationExists(candidateFilePath);
		} catch (error) {
			diagnostics.push(
				diagnostic({
					scope: "skill",
					pluginPath: pluginRoot,
					pluginName,
					componentPath: candidateFilePath,
					componentName: entry.name,
					message: `Cannot inspect Agent Plugin skill '${entry.name}': ${errorMessage(error)}`,
				}),
			);
			continue;
		}
		if (!hasSkillFile) {
			continue;
		}

		let filePath: string;
		try {
			filePath = await resolveContainedExistingPath(
				pluginRoot,
				candidateFilePath,
				"file",
			);
		} catch (error) {
			diagnostics.push(
				diagnostic({
					scope: "skill",
					pluginPath: pluginRoot,
					pluginName,
					componentPath: candidateFilePath,
					componentName: entry.name,
					message: `Skipping invalid Agent Plugin skill '${entry.name}': ${errorMessage(error)}`,
				}),
			);
			continue;
		}

		try {
			const parsed = parseAgentSkillMarkdown(
				await readFile(filePath, "utf8"),
				entry.name,
			);
			skills.push({
				pluginName,
				pluginRoot,
				directoryPath: skillRoot,
				filePath,
				metadata: parsed.metadata,
			});
		} catch (error) {
			diagnostics.push(
				diagnostic({
					scope: "skill",
					pluginPath: pluginRoot,
					pluginName,
					componentPath: filePath,
					componentName: entry.name,
					message: `Skipping invalid Agent Plugin skill '${entry.name}': ${errorMessage(error)}`,
				}),
			);
		}
	}
	return skills;
}

function assertExactFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	label: string,
): void {
	const unknown = Object.keys(value)
		.filter((field) => !allowed.has(field))
		.sort();
	if (unknown.length > 0) {
		throw new Error(`${label} contains unknown field '${unknown[0]}'.`);
	}
}

function requireStringArray(
	value: unknown,
	fieldName: string,
): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		!value.every((entry) => typeof entry === "string")
	) {
		throw new Error(`MCP field '${fieldName}' must be an array of strings.`);
	}
	return [...value];
}

function requireStringRecord(
	value: unknown,
	fieldName: string,
): Record<string, string> | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (
		!isRecord(value) ||
		!Object.values(value).every((entry) => typeof entry === "string")
	) {
		throw new Error(`MCP field '${fieldName}' must be an object of strings.`);
	}
	return value as Record<string, string>;
}

function expandPluginVariables(
	value: string,
	pluginRoot: string,
	pluginDataPath: string,
): string {
	return value.replace(
		/\$\{PLUGIN_(ROOT|DATA)\}/g,
		(_match, kind: "ROOT" | "DATA") =>
			kind === "ROOT" ? pluginRoot : pluginDataPath,
	);
}

function resolvePluginDataPath(
	pluginDataRoot: string,
	pluginName: string,
	pluginRoot: string,
): string {
	const instanceHash = createHash("sha256")
		.update(pluginRoot)
		.digest("hex")
		.slice(0, 12);
	return join(pluginDataRoot, `${pluginName}-${instanceHash}`);
}

function normalizeReservedEnvironment(
	env: Record<string, string>,
	pluginRoot: string,
	pluginDataPath: string,
): Record<string, string> {
	const output = { ...env };
	if (process.platform === "win32") {
		for (const key of Object.keys(output)) {
			const normalized = key.toUpperCase();
			if (normalized === "PLUGIN_ROOT" || normalized === "PLUGIN_DATA") {
				delete output[key];
			}
		}
	}
	output.PLUGIN_ROOT = pluginRoot;
	output.PLUGIN_DATA = pluginDataPath;
	return output;
}

async function resolveStdioTransport(input: {
	server: Record<string, unknown>;
	pluginRoot: string;
	pluginDataPath: string;
}): Promise<McpServerTransportConfig> {
	assertExactFields(
		input.server,
		new Set(["type", "command", "args", "env", "cwd"]),
		"stdio MCP server",
	);
	if (typeof input.server.command !== "string" || !input.server.command) {
		throw new Error("stdio MCP server requires a non-empty 'command'.");
	}

	let command: string;
	if (input.server.command.startsWith("./")) {
		command = await resolveContainedProjectedPath(
			input.pluginRoot,
			resolve(input.pluginRoot, input.server.command),
		);
		if (await pathExists(command)) {
			const commandStat = await stat(command);
			if (!commandStat.isFile()) {
				throw new Error("stdio MCP 'command' must resolve to a regular file.");
			}
		}
	} else {
		if (
			isAbsolute(input.server.command) ||
			/[\s/\\\0]/u.test(input.server.command)
		) {
			throw new Error(
				"stdio MCP 'command' must be one bare executable token or a plugin-relative path beginning with './'.",
			);
		}
		command = input.server.command;
	}

	const args = requireStringArray(input.server.args, "args")?.map((entry) =>
		expandPluginVariables(entry, input.pluginRoot, input.pluginDataPath),
	);
	const configuredEnv = requireStringRecord(input.server.env, "env") ?? {};
	for (const key of Object.keys(configuredEnv)) {
		const isReserved =
			process.platform === "win32"
				? key.toUpperCase() === "PLUGIN_ROOT" ||
					key.toUpperCase() === "PLUGIN_DATA"
				: key === "PLUGIN_ROOT" || key === "PLUGIN_DATA";
		if (isReserved) {
			throw new Error(`stdio MCP env cannot configure reserved key '${key}'.`);
		}
	}
	const expandedEnv = Object.fromEntries(
		Object.entries(configuredEnv).map(([key, value]) => [
			key,
			expandPluginVariables(value, input.pluginRoot, input.pluginDataPath),
		]),
	);
	const env = normalizeReservedEnvironment(
		expandedEnv,
		input.pluginRoot,
		input.pluginDataPath,
	);

	let cwd = input.pluginRoot;
	if (input.server.cwd !== undefined) {
		if (typeof input.server.cwd !== "string") {
			throw new Error("stdio MCP field 'cwd' must be a string.");
		}
		let permittedRoot: string;
		if (input.server.cwd.startsWith("./")) {
			permittedRoot = input.pluginRoot;
		} else if (
			input.server.cwd === PLUGIN_ROOT_PLACEHOLDER ||
			input.server.cwd.startsWith(`${PLUGIN_ROOT_PLACEHOLDER}/`)
		) {
			permittedRoot = input.pluginRoot;
		} else if (
			input.server.cwd === PLUGIN_DATA_PLACEHOLDER ||
			input.server.cwd.startsWith(`${PLUGIN_DATA_PLACEHOLDER}/`)
		) {
			permittedRoot = input.pluginDataPath;
		} else {
			throw new Error(
				`stdio MCP 'cwd' must begin with './', '${PLUGIN_ROOT_PLACEHOLDER}', or '${PLUGIN_DATA_PLACEHOLDER}'.`,
			);
		}
		const expandedCwd = expandPluginVariables(
			input.server.cwd,
			input.pluginRoot,
			input.pluginDataPath,
		);
		cwd = await resolveContainedProjectedPath(
			permittedRoot,
			input.server.cwd.startsWith("./")
				? resolve(input.pluginRoot, expandedCwd)
				: expandedCwd,
		);
		if ((await pathExists(cwd)) && !(await stat(cwd)).isDirectory()) {
			throw new Error("stdio MCP 'cwd' must resolve to a directory.");
		}
	}

	return {
		type: "stdio",
		command,
		...(args ? { args } : {}),
		cwd,
		env,
	};
}

function isLoopbackHostname(hostname: string): boolean {
	const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (normalized === "localhost" || normalized === "::1") {
		return true;
	}
	if (isIP(normalized) === 4) {
		return normalized.split(".")[0] === "127";
	}
	return false;
}

function resolveRemoteTransport(
	server: Record<string, unknown>,
	type: "streamable-http" | "sse",
): McpServerTransportConfig {
	assertExactFields(
		server,
		new Set(["type", "url", "headers"]),
		`${type} MCP server`,
	);
	if (typeof server.url !== "string" || !server.url) {
		throw new Error(`${type} MCP server requires a non-empty 'url'.`);
	}
	let url: URL;
	try {
		url = new URL(server.url);
	} catch {
		throw new Error(`${type} MCP 'url' must be an absolute HTTP(S) URL.`);
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.hash
	) {
		throw new Error(
			`${type} MCP 'url' must be HTTP(S) without user information or a fragment.`,
		);
	}
	if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
		throw new Error(`${type} MCP endpoints must use HTTPS unless loopback.`);
	}

	const headers = requireStringRecord(server.headers, "headers");
	const seenHeaderNames = new Set<string>();
	for (const [name, value] of Object.entries(headers ?? {})) {
		const normalizedName = name.toLowerCase();
		if (seenHeaderNames.has(normalizedName)) {
			throw new Error(`Duplicate case-insensitive MCP header '${name}'.`);
		}
		seenHeaderNames.add(normalizedName);
		try {
			validateHeaderName(name);
			validateHeaderValue(name, value);
		} catch (error) {
			throw new Error(`Invalid MCP header '${name}': ${errorMessage(error)}`);
		}
	}

	return type === "sse"
		? { type: "sse", url: url.toString(), ...(headers ? { headers } : {}) }
		: {
				type: "streamableHttp",
				url: url.toString(),
				...(headers ? { headers } : {}),
			};
}

async function loadMcpServers(input: {
	pluginRoot: string;
	pluginName: string;
	pluginDataRoot: string;
	diagnostics: AgentPluginPackageDiagnostic[];
}): Promise<AgentPluginPackageMcpServer[]> {
	const candidatePath = join(input.pluginRoot, "mcp.json");
	let hasMcpLocation: boolean;
	try {
		hasMcpLocation = await pathLocationExists(candidatePath);
	} catch (error) {
		input.diagnostics.push(
			diagnostic({
				scope: "mcp",
				pluginPath: input.pluginRoot,
				pluginName: input.pluginName,
				componentPath: candidatePath,
				message: `Cannot inspect Agent Plugin MCP component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}
	if (!hasMcpLocation) {
		return [];
	}

	let mcpPath: string;
	try {
		mcpPath = await resolveContainedExistingPath(
			input.pluginRoot,
			candidatePath,
			"file",
		);
	} catch (error) {
		input.diagnostics.push(
			diagnostic({
				scope: "mcp",
				pluginPath: input.pluginRoot,
				pluginName: input.pluginName,
				componentPath: candidatePath,
				message: `Invalid Agent Plugin MCP component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}

	let document: unknown;
	try {
		document = JSON.parse(await readFile(mcpPath, "utf8"));
	} catch (error) {
		input.diagnostics.push(
			diagnostic({
				scope: "mcp",
				pluginPath: input.pluginRoot,
				pluginName: input.pluginName,
				componentPath: mcpPath,
				message: `Invalid mcp.json: ${errorMessage(error)}`,
			}),
		);
		return [];
	}
	if (!isRecord(document)) {
		input.diagnostics.push(
			diagnostic({
				scope: "mcp",
				pluginPath: input.pluginRoot,
				pluginName: input.pluginName,
				componentPath: mcpPath,
				message: "mcp.json must contain a JSON object.",
			}),
		);
		return [];
	}
	try {
		assertExactFields(document, new Set(["$schema", "mcpServers"]), "mcp.json");
		if (document.$schema !== AGENT_PLUGINS_V1_MCP_SCHEMA) {
			throw new Error(
				`Unsupported or mismatched mcp.json $schema; expected '${AGENT_PLUGINS_V1_MCP_SCHEMA}'.`,
			);
		}
		if (!isRecord(document.mcpServers)) {
			throw new Error("mcp.json field 'mcpServers' must be an object.");
		}
	} catch (error) {
		input.diagnostics.push(
			diagnostic({
				scope: "mcp",
				pluginPath: input.pluginRoot,
				pluginName: input.pluginName,
				componentPath: mcpPath,
				message: `Invalid Agent Plugin MCP component: ${errorMessage(error)}`,
			}),
		);
		return [];
	}

	const pluginDataPath = resolvePluginDataPath(
		input.pluginDataRoot,
		input.pluginName,
		input.pluginRoot,
	);
	const servers: AgentPluginPackageMcpServer[] = [];
	for (const [serverName, rawServer] of Object.entries(
		document.mcpServers as Record<string, unknown>,
	).sort(([left], [right]) => left.localeCompare(right))) {
		try {
			if (!isRecord(rawServer)) {
				throw new Error("server configuration must be an object.");
			}
			if (
				rawServer.type !== "stdio" &&
				rawServer.type !== "streamable-http" &&
				rawServer.type !== "sse"
			) {
				throw new Error("server has an unsupported or missing transport type.");
			}

			let transport: McpServerTransportConfig;
			let dataPath: string | undefined;
			if (rawServer.type === "stdio") {
				// Discovery must remain read-only. The dedicated data directory is
				// created by the stdio client immediately before launch.
				dataPath = pluginDataPath;
				transport = await resolveStdioTransport({
					server: rawServer,
					pluginRoot: input.pluginRoot,
					pluginDataPath: dataPath,
				});
			} else {
				transport = resolveRemoteTransport(rawServer, rawServer.type);
			}

			const runtimeName = `${input.pluginName}.${serverName}`;
			const registration: McpServerRegistration = {
				name: runtimeName,
				transport,
				metadata: {
					source: "agent-plugin",
					pluginName: input.pluginName,
					pluginPath: input.pluginRoot,
					serverName,
					...(dataPath ? { pluginDataPath: dataPath } : {}),
				},
			};
			servers.push({
				pluginName: input.pluginName,
				pluginRoot: input.pluginRoot,
				...(dataPath ? { pluginDataPath: dataPath } : {}),
				serverName,
				registration,
			});
		} catch (error) {
			input.diagnostics.push(
				diagnostic({
					scope: "mcp-server",
					pluginPath: input.pluginRoot,
					pluginName: input.pluginName,
					componentPath: mcpPath,
					componentName: serverName,
					message: `Skipping invalid Agent Plugin MCP server '${serverName}': ${errorMessage(error)}`,
				}),
			);
		}
	}
	return servers;
}

async function loadPackageManifest(
	pluginRoot: string,
	diagnostics: AgentPluginPackageDiagnostic[],
): Promise<
	| Pick<LoadedAgentPluginPackage, "rootPath" | "manifestPath" | "manifest">
	| undefined
> {
	let loadedManifest: Awaited<ReturnType<typeof loadManifest>>;
	try {
		loadedManifest = await loadManifest(pluginRoot, diagnostics);
	} catch (error) {
		diagnostics.push(
			diagnostic({
				scope: "manifest",
				pluginPath: pluginRoot,
				componentPath: join(pluginRoot, AGENT_PLUGIN_MANIFEST_FILE_NAME),
				message: `Rejecting Agent Plugin: ${errorMessage(error)}`,
			}),
		);
		return undefined;
	}

	const { manifest, manifestPath } = loadedManifest;
	return {
		rootPath: pluginRoot,
		manifestPath,
		manifest,
	};
}

async function loadPackageComponents(
	loadedManifest: Pick<
		LoadedAgentPluginPackage,
		"rootPath" | "manifestPath" | "manifest"
	>,
	pluginDataRoot: string,
	diagnostics: AgentPluginPackageDiagnostic[],
): Promise<LoadedAgentPluginPackage> {
	const { rootPath: pluginRoot, manifest } = loadedManifest;
	const [skills, mcpServers] = await Promise.all([
		loadSkills(pluginRoot, manifest.name, diagnostics),
		loadMcpServers({
			pluginRoot,
			pluginName: manifest.name,
			pluginDataRoot,
			diagnostics,
		}),
	]);
	return {
		...loadedManifest,
		skills,
		mcpServers,
	};
}

/**
 * Discover and load Agent Plugins v1 from runtime-host-local filesystem paths.
 * No schema is fetched over the network: canonical identifiers select the
 * validation code bundled with this SDK build.
 */
export async function loadAgentPluginPackages(
	options: LoadAgentPluginPackagesOptions = {},
): Promise<AgentPluginPackageLoadReport> {
	const diagnostics: AgentPluginPackageDiagnostic[] = [];
	const candidateRoots = await resolveCandidateRoots(options, diagnostics);
	const pluginDataRoot = resolve(
		options.pluginDataRoot ?? join(resolveClineDataDir(), "agent-plugins"),
	);
	const disabledPluginNames = new Set(
		(options.disabledPluginNames ?? [])
			.map((name) => name.trim())
			.filter(Boolean),
	);
	const plugins: LoadedAgentPluginPackage[] = [];
	const selectedPluginNames = new Map<string, string>();

	for (const pluginRoot of candidateRoots) {
		const loadedManifest = await loadPackageManifest(pluginRoot, diagnostics);
		if (!loadedManifest) {
			continue;
		}
		const pluginName = loadedManifest.manifest.name;
		const selectedRoot = selectedPluginNames.get(pluginName);
		if (selectedRoot) {
			diagnostics.push(
				diagnostic({
					level: "warning",
					scope: "plugin",
					pluginPath: pluginRoot,
					pluginName,
					message: `Ignoring duplicate Agent Plugin '${pluginName}'; '${selectedRoot}' has precedence.`,
				}),
			);
			continue;
		}
		selectedPluginNames.set(pluginName, pluginRoot);
		if (disabledPluginNames.has(pluginName)) {
			continue;
		}
		plugins.push(
			await loadPackageComponents(loadedManifest, pluginDataRoot, diagnostics),
		);
	}

	const mcpServers: AgentPluginPackageMcpServer[] = [];
	const runtimeMcpNames = new Set<string>();
	for (const plugin of plugins) {
		for (const server of plugin.mcpServers) {
			if (runtimeMcpNames.has(server.registration.name)) {
				diagnostics.push(
					diagnostic({
						scope: "mcp-server",
						pluginPath: plugin.rootPath,
						pluginName: plugin.manifest.name,
						componentName: server.serverName,
						message: `Skipping duplicate Agent Plugin MCP runtime name '${server.registration.name}'.`,
					}),
				);
				continue;
			}
			runtimeMcpNames.add(server.registration.name);
			mcpServers.push(server);
		}
	}

	return {
		plugins,
		skills: plugins.flatMap((plugin) => plugin.skills),
		mcpServers,
		diagnostics,
	};
}

export function getAgentPluginPackageDisplayName(path: string): string {
	return basename(path);
}
