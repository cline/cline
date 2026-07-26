import { createHash } from "node:crypto";
import {
	type Dirent,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
	basename,
	dirname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	isPluginModulePath,
	resolveBedrockCoderDir,
	resolvePluginModuleEntries,
} from "@bedrock-coder/shared/storage";
import {
	type McpServerRegistration,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
} from "../extensions/mcp";
import {
	type PluginMcpSettingsSyncResult,
	syncPluginMcpServersToSettings,
} from "./plugin-mcp-settings";

export interface PluginInstallOptions {
	source: string;
	sourceType?: PluginInstallSourceType;
	cwd?: string;
	force?: boolean;
}

export interface PluginInstallResult {
	source: string;
	installPath: string;
	entryPaths: string[];
	mcpSyncFailures: PluginMcpSettingsSyncResult["failures"];
	mcpOAuthCandidates: PluginMcpOAuthCandidate[];
}

export interface PluginMcpOAuthCandidate {
	name: string;
	pluginName: string;
	pluginPath: string;
	transportType: "sse" | "streamableHttp";
	lastError?: string;
}

export type ParsedPluginSource = {
	type: "local";
	path: string;
};

export type PluginInstallSourceType = "local";

interface PluginPackageManifest {
	bedrockCoder?: {
		plugins?: Array<{ paths?: string[] } | string>;
	};
}

const INSTALLS_DIRECTORY_NAME = "_installed";
const PACKAGE_DIRECTORY_NAME = "package";
const WRAPPER_PACKAGE_JSON = {
	name: "bedrock-coder-local-plugin",
	private: true,
	bedrockCoder: {
		plugins: [] as Array<{ paths: string[] }>,
	},
};

function resolveHomePath(value: string): string {
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/") || value.startsWith("~\\")) {
		return join(homedir(), value.slice(2));
	}
	return value;
}

function toPosixPath(path: string): string {
	return path.split(sep).join("/");
}

function hashSource(source: string): string {
	return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function sanitizeSegment(value: string): string {
	const sanitized = value
		.replace(/^@/, "")
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return sanitized || "plugin";
}

function isRemotePluginSource(source: string): boolean {
	return (
		/^(?:npm|git|https?|ssh):/i.test(source) ||
		/^git@/i.test(source) ||
		/^(?:github\.com|gitlab\.com|bitbucket\.org)\//i.test(source) ||
		/\.git(?:[#@].*)?$/i.test(source)
	);
}

/**
 * Parse an explicitly selected local plugin source.
 *
 * Bare and relative paths are intentionally accepted so callers may select a
 * workspace-relative directory. Existence and file type are validated during
 * installation. Hosted slugs, package specs, repositories, and URLs are never
 * interpreted as installable sources.
 */
export function parsePluginSource(
	source: string,
	sourceType?: PluginInstallSourceType,
): ParsedPluginSource {
	const trimmed = source.trim();
	if (!trimmed) {
		throw new Error("plugin install requires a local filesystem path");
	}
	if (sourceType !== undefined && sourceType !== "local") {
		throw new Error("Only local filesystem plugin sources are supported");
	}
	if (isRemotePluginSource(trimmed)) {
		throw new Error(
			`Remote, npm, and Git plugin sources are not supported: ${source}`,
		);
	}
	return { type: "local", path: source };
}

function getPluginRoot(cwd: string | undefined): string {
	return cwd
		? join(cwd, ".bedrock-coder", "plugins")
		: join(resolveBedrockCoderDir(), "plugins");
}

function readPackageManifest(
	packageRoot: string,
): PluginPackageManifest | null {
	const packageJsonPath = join(packageRoot, "package.json");
	if (!existsSync(packageJsonPath)) {
		return null;
	}
	try {
		return JSON.parse(
			readFileSync(packageJsonPath, "utf8"),
		) as PluginPackageManifest;
	} catch {
		return null;
	}
}

function getManifestPaths(manifest: PluginPackageManifest | null): string[] {
	const entries = manifest?.bedrockCoder?.plugins;
	if (!Array.isArray(entries)) {
		return [];
	}
	return entries.flatMap((entry) =>
		typeof entry === "string" ? [entry] : (entry.paths ?? []),
	);
}

function statSafeReadDir(dir: string): Dirent[] {
	try {
		return readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function collectPluginEntries(packageRoot: string): string[] {
	const manifestPaths = getManifestPaths(readPackageManifest(packageRoot))
		.map((entry) => resolve(packageRoot, entry))
		.filter(
			(entry) =>
				existsSync(entry) &&
				statSync(entry).isFile() &&
				isPluginModulePath(entry),
		);
	if (manifestPaths.length > 0) {
		return manifestPaths;
	}
	const directEntries = resolvePluginModuleEntries(packageRoot);
	if (directEntries?.length) {
		return directEntries;
	}
	const entries: string[] = [];
	const stack = [packageRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		for (const entry of statSafeReadDir(current)) {
			const entryPath = join(current, entry.name);
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === INSTALLS_DIRECTORY_NAME
			) {
				continue;
			}
			if (entry.isDirectory()) {
				stack.push(entryPath);
			} else if (
				entry.isFile() &&
				!entry.name.startsWith(".") &&
				isPluginModulePath(entryPath)
			) {
				entries.push(entryPath);
			}
		}
	}
	return entries.sort((left, right) => left.localeCompare(right));
}

async function copyLocalPlugin(
	sourcePath: string,
	stagingRoot: string,
): Promise<{ packageRoot: string; needsWrapper: boolean }> {
	if (!existsSync(sourcePath)) {
		throw new Error(`Plugin source path does not exist: ${sourcePath}`);
	}
	const stats = statSync(sourcePath);
	if (stats.isFile()) {
		if (!isPluginModulePath(sourcePath)) {
			throw new Error(`Plugin file must be .js or .ts: ${sourcePath}`);
		}
		await mkdir(stagingRoot, { recursive: true });
		await cp(sourcePath, join(stagingRoot, basename(sourcePath)));
		return { packageRoot: stagingRoot, needsWrapper: false };
	}
	if (!stats.isDirectory()) {
		throw new Error(
			`Plugin source must be a file or directory: ${sourcePath}`,
		);
	}

	const packageRoot = join(stagingRoot, PACKAGE_DIRECTORY_NAME);
	await cp(sourcePath, packageRoot, {
		recursive: true,
		filter: (candidate) => {
			const name = basename(candidate);
			return name !== ".git" && name !== INSTALLS_DIRECTORY_NAME;
		},
	});
	return { packageRoot, needsWrapper: true };
}

async function writeWrapperManifest(
	stagingRoot: string,
	packageRoot: string,
	packageName: string,
): Promise<string[]> {
	const entries = collectPluginEntries(packageRoot);
	if (entries.length === 0) {
		throw new Error(`No plugin entry files found in ${packageRoot}`);
	}
	const entryPaths = entries.map(
		(entry) => `./${toPosixPath(relative(stagingRoot, entry))}`,
	);
	await writeFile(
		join(stagingRoot, "package.json"),
		`${JSON.stringify(
			{
				...WRAPPER_PACKAGE_JSON,
				name: packageName,
				bedrockCoder: { plugins: [{ paths: entryPaths }] },
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return entryPaths;
}

function replaceInstallPath(
	stagingRoot: string,
	installPath: string,
	force: boolean,
): void {
	mkdirSync(dirname(installPath), { recursive: true });
	if (!existsSync(installPath)) {
		renameSync(stagingRoot, installPath);
		return;
	}
	if (!force) {
		throw new Error(
			`Plugin is already installed at ${installPath}. Use --force to replace it.`,
		);
	}

	const backupPath = join(
		dirname(installPath),
		`.replace-${basename(installPath)}-${Date.now()}-${process.pid}`,
	);
	renameSync(installPath, backupPath);
	try {
		renameSync(stagingRoot, installPath);
	} catch (error) {
		if (!existsSync(installPath) && existsSync(backupPath)) {
			renameSync(backupPath, installPath);
		}
		throw error;
	}
	try {
		rmSync(backupPath, { recursive: true, force: true });
	} catch {
		// Replacement succeeded; a leftover backup is safe to clean manually.
	}
}

function hasStaticHeaders(registration: McpServerRegistration): boolean {
	const transport = registration.transport;
	return (
		transport.type !== "stdio" &&
		transport.headers !== undefined &&
		Object.keys(transport.headers).length > 0
	);
}

function hasOAuthAccessToken(registration: McpServerRegistration): boolean {
	const accessToken = registration.oauth?.tokens?.access_token;
	return typeof accessToken === "string" && accessToken.trim().length > 0;
}

function getPluginOwner(
	registration: McpServerRegistration,
): { pluginName: string; pluginPath: string } | undefined {
	const metadata = registration.metadata;
	if (
		!metadata ||
		metadata.source !== "plugin" ||
		typeof metadata.pluginName !== "string" ||
		typeof metadata.pluginPath !== "string"
	) {
		return undefined;
	}
	return {
		pluginName: metadata.pluginName,
		pluginPath: metadata.pluginPath,
	};
}

export function collectPluginMcpOAuthCandidates(input: {
	pluginPaths: readonly string[];
	settingsPath?: string;
}): PluginMcpOAuthCandidate[] {
	const pluginPaths = new Set(input.pluginPaths.map((path) => resolve(path)));
	if (pluginPaths.size === 0) {
		return [];
	}

	let registrations: McpServerRegistration[];
	try {
		registrations = resolveMcpServerRegistrations({
			filePath: input.settingsPath ?? resolveDefaultMcpSettingsPath(),
		});
	} catch {
		return [];
	}

	const candidates: PluginMcpOAuthCandidate[] = [];
	for (const registration of registrations) {
		const owner = getPluginOwner(registration);
		if (!owner || !pluginPaths.has(resolve(owner.pluginPath))) {
			continue;
		}
		const transportType = registration.transport.type;
		if (
			transportType === "stdio" ||
			hasStaticHeaders(registration) ||
			hasOAuthAccessToken(registration)
		) {
			continue;
		}
		candidates.push({
			name: registration.name,
			pluginName: owner.pluginName,
			pluginPath: owner.pluginPath,
			transportType,
			lastError: registration.oauth?.lastError,
		});
	}
	return candidates.sort((left, right) => left.name.localeCompare(right.name));
}

export async function installPlugin(
	options: PluginInstallOptions,
): Promise<PluginInstallResult> {
	const source = options.source.trim();
	const parsed = parsePluginSource(source, options.sourceType);
	const explicitCwd = options.cwd?.trim();
	const cwd = explicitCwd ? resolve(explicitCwd) : process.cwd();
	const sourcePath = resolve(cwd, resolveHomePath(parsed.path));
	const pluginRoot = getPluginRoot(explicitCwd ? cwd : undefined);
	const sourceKey = `local:${sourcePath}`;
	const installPath = join(
		pluginRoot,
		INSTALLS_DIRECTORY_NAME,
		"local",
		`${sanitizeSegment(basename(sourcePath))}-${hashSource(sourceKey)}`,
	);
	const stagingParent = join(pluginRoot, INSTALLS_DIRECTORY_NAME, ".tmp");
	const stagingRoot = join(
		stagingParent,
		`${Date.now()}-${process.pid}-${hashSource(`${source}:${Math.random()}`)}`,
	);

	if (existsSync(installPath) && !options.force) {
		throw new Error(
			`Plugin is already installed at ${installPath}. Use --force to replace it.`,
		);
	}
	await mkdir(stagingParent, { recursive: true });

	try {
		const { packageRoot, needsWrapper } = await copyLocalPlugin(
			sourcePath,
			stagingRoot,
		);
		const entryPaths = needsWrapper
			? await writeWrapperManifest(
					stagingRoot,
					packageRoot,
					sanitizeSegment(basename(sourcePath)),
				)
			: collectPluginEntries(stagingRoot).map(
					(entry) => `./${toPosixPath(relative(stagingRoot, entry))}`,
				);
		if (entryPaths.length === 0) {
			throw new Error(`No plugin entry files found for ${source}`);
		}

		replaceInstallPath(
			stagingRoot,
			installPath,
			options.force === true,
		);
		const result: PluginInstallResult = {
			source,
			installPath,
			entryPaths: entryPaths.map((entry) => resolve(installPath, entry)),
			mcpSyncFailures: [],
			mcpOAuthCandidates: [],
		};
		const syncResult = await syncPluginMcpServersToSettings({
			pluginPaths: result.entryPaths,
			cwd,
			workspacePath: cwd,
		});
		result.mcpSyncFailures = syncResult.failures;
		result.mcpOAuthCandidates = collectPluginMcpOAuthCandidates({
			pluginPaths: result.entryPaths,
		});
		return result;
	} catch (error) {
		rmSync(stagingRoot, { recursive: true, force: true });
		throw error;
	}
}
