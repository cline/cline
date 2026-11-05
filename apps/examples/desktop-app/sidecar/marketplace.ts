import { createHash } from "node:crypto";
import { existsSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
	fetchMarketplaceCatalog,
	installPlugin as installCorePlugin,
	type MarketplaceActionResult,
	type MarketplaceEntryInput,
	resolveWorkflowsConfigSearchPaths,
	uninstallMarketplaceEntry as uninstallCoreMarketplaceEntry,
	uninstallPlugin as uninstallLocalPlugin,
} from "@cline/core";
import {
	discoverPluginModulePaths,
	resolveClineDir,
} from "@cline/shared/storage";
import type { JsonRecord } from "./types";

type MarketplacePrimitiveType = "mcp" | "skill" | "plugin";
type LocalPrimitiveType = MarketplacePrimitiveType | "workflow";

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
	type: LocalPrimitiveType;
	status: "installed" | "uninstalled";
	message: string;
	details?: JsonRecord;
	output?: string;
};

type MarketplaceInstallStatusResult = {
	installedKeys: string[];
};

type CatalogLoader = () => Promise<unknown>;

const OFFICIAL_PLUGINS_REPO = "https://github.com/cline/plugins.git";
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

function readLocalUninstallInput(args?: Record<string, unknown>): {
	id: string;
	type: LocalPrimitiveType;
	name?: string;
	path?: string;
} {
	const type = typeof args?.type === "string" ? args.type.trim() : "";
	if (
		type !== "mcp" &&
		type !== "skill" &&
		type !== "workflow" &&
		type !== "plugin"
	) {
		throw new Error(
			"local uninstall type must be mcp, skill, workflow, or plugin",
		);
	}
	const id =
		typeof args?.id === "string" && args.id.trim().length > 0
			? args.id.trim()
			: typeof args?.name === "string" && args.name.trim().length > 0
				? args.name.trim()
				: typeof args?.path === "string" && args.path.trim().length > 0
					? args.path.trim()
					: "";
	if (!id) {
		throw new Error("local uninstall id, name, or path is required");
	}
	return {
		id,
		type,
		name: typeof args?.name === "string" ? args.name.trim() : undefined,
		path: typeof args?.path === "string" ? args.path.trim() : undefined,
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

function isInsidePath(childPath: string, parentPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function resolveUserInstructionRemovalTarget(input: {
	type: "workflow";
	path: string;
	workspaceRoot?: string;
}): string {
	const filePath = resolve(input.path);
	const searchPaths = resolveWorkflowsConfigSearchPaths(input.workspaceRoot);
	const containingRoot = searchPaths.find((root) =>
		isInsidePath(filePath, root),
	);
	if (!containingRoot) {
		throw new Error(
			`${input.type} uninstall requires a file inside a configured ${input.type} directory.`,
		);
	}
	const stats = statSync(filePath, { throwIfNoEntry: false });
	if (!stats?.isFile()) {
		throw new Error(`${input.type} file does not exist: ${filePath}`);
	}
	return filePath;
}

export async function uninstallLocalPrimitive(
	args?: Record<string, unknown>,
	options: { workspaceRoot?: string } = {},
): Promise<MarketplaceInstallResult> {
	const input = readLocalUninstallInput(args);
	if (input.type === "mcp" || input.type === "skill")
		throw new Error("MCP and skill management belong to the Hub");
	if (input.type === "plugin") {
		const result = await uninstallLocalPlugin({
			name: input.path ? undefined : (input.name ?? input.id),
			path: input.path,
			workspaceRoot: options.workspaceRoot,
		});
		return {
			id: input.id,
			type: input.type,
			status: "uninstalled",
			message: `Uninstalled ${result.name}.`,
			details: result as unknown as JsonRecord,
		};
	}
	if (input.type === "workflow") {
		if (!input.path) {
			throw new Error(`${input.type} uninstall requires a path.`);
		}
		const target = resolveUserInstructionRemovalTarget({
			type: input.type,
			path: input.path,
			workspaceRoot: options.workspaceRoot,
		});
		const stats = statSync(target, { throwIfNoEntry: false });
		if (!stats) {
			throw new Error(`${input.type} target does not exist: ${target}`);
		}
		rmSync(target, { recursive: stats.isDirectory(), force: true });
		return {
			id: input.id,
			type: input.type,
			status: "uninstalled",
			message: `Uninstalled ${input.name ?? basename(target)}.`,
			details: { path: target },
		};
	}
	throw new Error(`Unsupported local uninstall type: ${input.type}`);
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

function isOfficialPluginSlug(source: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.trim());
}

export function getOfficialPluginInstallPath(
	source: string,
): string | undefined {
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

type OfficialPluginInstallState = "installed" | "partial" | "missing";

function getOfficialPluginInstallState(
	entry: MarketplaceInstallInput,
): OfficialPluginInstallState {
	if (entry.type !== "plugin") return "missing";
	const [source] = entry.install.args ?? [];
	if (!source) return "missing";
	const installPath = getOfficialPluginInstallPath(source);
	if (!installPath || !existsSync(installPath)) return "missing";
	// A bare directory is not an install: a failed or interrupted install can
	// leave the directory behind with no plugin inside, and treating that as
	// installed makes the next install attempt "succeed" silently ("already
	// installed") while nothing actually works. Require a loadable plugin
	// module before reporting the entry as installed; a directory without one
	// is "partial" so the installer can reclaim it with --force.
	try {
		return discoverPluginModulePaths(installPath).length > 0
			? "installed"
			: "partial";
	} catch {
		return "partial";
	}
}

function isOfficialPluginInstalled(entry: MarketplaceInstallInput): boolean {
	return getOfficialPluginInstallState(entry) === "installed";
}

function normalizeMatchValue(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
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
		if (record.agentPlugin === true) return false;
		const values = [
			typeof record.name === "string" ? record.name : undefined,
			typeof record.id === "string" ? record.id : undefined,
			typeof record.path === "string" ? record.path : undefined,
		]
			.map(normalizeMatchValue)
			.filter(Boolean);
		return values.some((value) => candidates.has(value));
	});
}

function isMarketplaceEntryInstalled(
	entry: MarketplaceInstallInput,
	inventory?: JsonRecord,
): boolean {
	try {
		if (entry.type === "mcp" || entry.type === "skill") return false;
		if (entry.type === "plugin") {
			return (
				isOfficialPluginInstalled(entry) ||
				hasMatchingInventoryItem(inventory?.plugins, entry)
			);
		}
		return false;
	} catch {
		return false;
	}
}

async function installPlugin(
	entry: MarketplaceInstallInput,
): Promise<MarketplaceInstallResult> {
	const installArgs = entry.install.args ?? [];
	if (installArgs.length !== 1) {
		throw new Error(
			"Plugin marketplace installs currently support exactly one source argument.",
		);
	}
	const installState = getOfficialPluginInstallState(entry);
	if (installState === "installed") {
		return {
			id: entry.id,
			type: entry.type,
			status: "installed",
			message: `${entry.name ?? entry.id} is already installed.`,
		};
	}
	// Install in-process instead of shelling out to a `cline` binary: the
	// packaged desktop app cannot assume a CLI install exists on the user's
	// PATH (GUI apps inherit launchd's minimal PATH on macOS), which surfaced
	// as 'Executable not found in $PATH: "cline"' in the marketplace UI.
	//
	// force reclaims a leftover directory from a failed or interrupted
	// install: without it the installer refuses to replace the existing path
	// and every retry from the UI would fail the same way. This is safe
	// because the state check just confirmed the directory contains no
	// loadable plugin module.
	const result = await installCorePlugin({
		source: installArgs[0] ?? "",
		force: installState === "partial",
	});
	const warnings = result.mcpSyncFailures.map(
		(failure) =>
			`Failed to sync plugin MCP servers for ${failure.pluginName ?? failure.pluginPath}: ${failure.message}`,
	);
	return {
		id: entry.id,
		type: entry.type,
		status: "installed",
		message: `Installed ${entry.name ?? entry.id}.`,
		details: {
			source: result.source,
			installPath: result.installPath,
			entryPaths: result.entryPaths,
			mcpSyncFailures: result.mcpSyncFailures,
		} as JsonRecord,
		output: [`Path: ${result.installPath}`, ...warnings].join("\n"),
	};
}

export async function installMarketplaceEntry(
	args?: Record<string, unknown>,
): Promise<MarketplaceInstallResult> {
	const entry = readInstallInput(args);
	if (entry.type === "mcp" || entry.type === "skill")
		throw new Error("MCP and skill management belong to the Hub");
	if (entry.type === "plugin") {
		return installPlugin(entry);
	}
	throw new Error(`Unsupported marketplace entry type: ${entry.type}`);
}

export async function uninstallMarketplaceEntry(
	args?: Record<string, unknown>,
): Promise<MarketplaceInstallResult> {
	const entry = readInstallInput(args);
	if (entry.type === "mcp" || entry.type === "skill")
		throw new Error("MCP and skill management belong to the Hub");

	const result = await uninstallCoreMarketplaceEntry(
		entry satisfies MarketplaceEntryInput,
	);
	return {
		...(result satisfies MarketplaceActionResult),
	};
}

export async function installMarketplaceEntryFromCatalog(
	args?: Record<string, unknown>,
	options: {
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
	return installMarketplaceEntry({ entry });
}

export async function uninstallMarketplaceEntryFromCatalog(
	args?: Record<string, unknown>,
	options: {
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
	return uninstallMarketplaceEntry({ entry });
}

export function listMarketplaceInstalledEntries(
	args?: Record<string, unknown>,
	inventory?: JsonRecord,
): MarketplaceInstallStatusResult {
	const entries = readInstallInputList(args);
	const installedKeys = entries
		.filter((entry) => isMarketplaceEntryInstalled(entry, inventory))
		.map(marketplaceEntryKey);
	return { installedKeys };
}

export async function installMarketplaceEntryForDesktopCommand(
	args?: Record<string, unknown>,
	options: {
		loadCatalog?: CatalogLoader;
	} = {},
): Promise<MarketplaceInstallResult> {
	return installMarketplaceEntryFromCatalog(args, options);
}

export async function uninstallMarketplaceEntryForDesktopCommand(
	args?: Record<string, unknown>,
	options: {
		loadCatalog?: CatalogLoader;
	} = {},
): Promise<MarketplaceInstallResult> {
	return uninstallMarketplaceEntryFromCatalog(args, options);
}
