import {
	existsSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	statSync,
} from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	discoverPluginModulePaths,
	resolvePluginConfigSearchPaths,
} from "@cline/shared/storage";
import { readGlobalSettings, writeGlobalSettings } from "./global-settings";
import { removePluginMcpServersFromSettings } from "./plugin-mcp-settings";

export interface PluginUninstallOptions {
	name?: string;
	path?: string;
	cwd?: string;
	workspaceRoot?: string;
}

export interface PluginUninstallResult {
	name: string;
	installPath: string;
	removedPaths: string[];
	entryPaths: string[];
}

interface PluginUninstallCandidate {
	installPath: string;
	entryPaths: string[];
	names: string[];
	installed: boolean;
}

const INSTALLS_DIRECTORY_NAME = "_installed";
const PACKAGE_DIRECTORY_NAME = "package";
const INSTALL_KIND_DEPTHS = new Map<string, number>([
	["git", 2],
	["local", 1],
	["npm", 1],
	["official", 1],
	["remote", 1],
]);

function normalizeMatchValue(value: string): string {
	return value.trim().toLowerCase();
}

function addName(names: Set<string>, value: string | undefined): void {
	const trimmed = value?.trim();
	if (!trimmed) {
		return;
	}
	names.add(trimmed);
}

function stripInstallHash(value: string): string {
	return value.replace(/-[0-9a-f]{12}$/i, "");
}

function withoutExtension(value: string): string {
	const extension = extname(value);
	return extension ? value.slice(0, -extension.length) : value;
}

function readPackageName(packageJsonPath: string): string | undefined {
	if (!existsSync(packageJsonPath)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			name?: unknown;
		};
		return typeof parsed.name === "string" ? parsed.name.trim() : undefined;
	} catch {
		return undefined;
	}
}

function isInsidePath(childPath: string, parentPath: string): boolean {
	const relativePath = relative(parentPath, childPath);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function resolveInstalledRootFromPath(filePath: string): string | undefined {
	const absolutePath = resolve(filePath);
	const parts = absolutePath.split(sep);
	const installedIndex = parts.lastIndexOf(INSTALLS_DIRECTORY_NAME);
	if (installedIndex < 0) {
		return undefined;
	}
	const kind = parts[installedIndex + 1];
	if (!kind) {
		return undefined;
	}
	const depth = INSTALL_KIND_DEPTHS.get(kind) ?? 1;
	const endIndex = installedIndex + 2 + depth;
	if (parts.length < endIndex) {
		return undefined;
	}
	const root = parts.slice(0, endIndex).join(sep) || sep;
	return existsSync(root) ? root : undefined;
}

function safeReadDir(directoryPath: string) {
	try {
		return readdirSync(directoryPath, { withFileTypes: true });
	} catch {
		return [];
	}
}

function collectInstalledRoots(pluginRoot: string): string[] {
	const installedRoot = join(pluginRoot, INSTALLS_DIRECTORY_NAME);
	if (!existsSync(installedRoot)) {
		return [];
	}
	const roots: string[] = [];
	for (const kindEntry of safeReadDir(installedRoot)) {
		if (!kindEntry.isDirectory()) {
			continue;
		}
		const kindPath = join(installedRoot, kindEntry.name);
		if (kindEntry.name === "git") {
			for (const hostEntry of safeReadDir(kindPath)) {
				if (!hostEntry.isDirectory()) {
					continue;
				}
				const hostPath = join(kindPath, hostEntry.name);
				for (const installEntry of safeReadDir(hostPath)) {
					if (installEntry.isDirectory()) {
						roots.push(join(hostPath, installEntry.name));
					}
				}
			}
			continue;
		}
		for (const installEntry of safeReadDir(kindPath)) {
			if (installEntry.isDirectory()) {
				roots.push(join(kindPath, installEntry.name));
			}
		}
	}
	return roots.sort((left, right) => left.localeCompare(right));
}

function discoverEntriesWithin(root: string): string[] {
	try {
		return discoverPluginModulePaths(root);
	} catch {
		return [];
	}
}

function createInstalledCandidate(
	installPath: string,
): PluginUninstallCandidate {
	const entryPaths = discoverEntriesWithin(installPath);
	const names = new Set<string>();
	addName(names, basename(installPath));
	addName(names, stripInstallHash(basename(installPath)));
	addName(names, readPackageName(join(installPath, "package.json")));
	addName(
		names,
		readPackageName(join(installPath, PACKAGE_DIRECTORY_NAME, "package.json")),
	);
	for (const entryPath of entryPaths) {
		addName(names, basename(entryPath));
		addName(names, withoutExtension(basename(entryPath)));
	}
	return {
		installPath,
		entryPaths,
		names: [...names].sort((left, right) => left.localeCompare(right)),
		installed: true,
	};
}

function resolveDirectPluginInstallPath(
	filePath: string,
	pluginRoots: string[],
): string | undefined {
	const absolutePath = resolve(filePath);
	const pluginRoot = pluginRoots.find((root) =>
		isInsidePath(absolutePath, root),
	);
	if (!pluginRoot) {
		return undefined;
	}
	let current = dirname(absolutePath);
	while (current !== pluginRoot && current !== dirname(current)) {
		if (existsSync(join(current, "package.json"))) {
			return current;
		}
		current = dirname(current);
	}
	const filename = basename(absolutePath);
	if (
		(filename === "index.ts" || filename === "index.js") &&
		dirname(absolutePath) !== pluginRoot
	) {
		return dirname(absolutePath);
	}
	return absolutePath;
}

function createDirectCandidate(
	entryPath: string,
	pluginRoots: string[],
): PluginUninstallCandidate | undefined {
	const installPath = resolveDirectPluginInstallPath(entryPath, pluginRoots);
	if (!installPath) {
		return undefined;
	}
	const names = new Set<string>();
	addName(names, basename(entryPath));
	addName(names, withoutExtension(basename(entryPath)));
	addName(names, basename(installPath));
	addName(names, withoutExtension(basename(installPath)));
	addName(names, readPackageName(join(installPath, "package.json")));
	return {
		installPath,
		entryPaths: [entryPath],
		names: [...names].sort((left, right) => left.localeCompare(right)),
		installed: false,
	};
}

function getPluginRoots(options: PluginUninstallOptions): string[] {
	const workspaceRoot =
		options.workspaceRoot?.trim() || options.cwd?.trim() || process.cwd();
	return resolvePluginConfigSearchPaths(workspaceRoot).filter((directory) =>
		existsSync(directory),
	);
}

function collectCandidates(pluginRoots: string[]): PluginUninstallCandidate[] {
	const candidatesByInstallPath = new Map<string, PluginUninstallCandidate>();

	for (const pluginRoot of pluginRoots) {
		for (const installPath of collectInstalledRoots(pluginRoot)) {
			candidatesByInstallPath.set(
				installPath,
				createInstalledCandidate(installPath),
			);
		}
		for (const entryPath of discoverEntriesWithin(pluginRoot)) {
			const installedRoot = resolveInstalledRootFromPath(entryPath);
			if (installedRoot) {
				if (!candidatesByInstallPath.has(installedRoot)) {
					candidatesByInstallPath.set(
						installedRoot,
						createInstalledCandidate(installedRoot),
					);
				}
				continue;
			}
			const directCandidate = createDirectCandidate(entryPath, pluginRoots);
			if (directCandidate) {
				candidatesByInstallPath.set(
					directCandidate.installPath,
					directCandidate,
				);
			}
		}
	}

	return [...candidatesByInstallPath.values()].sort((left, right) =>
		left.installPath.localeCompare(right.installPath),
	);
}

function candidateMatchesName(
	candidate: PluginUninstallCandidate,
	name: string,
): boolean {
	const normalizedName = normalizeMatchValue(name);
	if (!normalizedName) {
		return false;
	}
	if (normalizeMatchValue(candidate.installPath) === normalizedName) {
		return true;
	}
	return candidate.names.some(
		(candidateName) => normalizeMatchValue(candidateName) === normalizedName,
	);
}

function findCandidateByPath(
	path: string,
	candidates: PluginUninstallCandidate[],
	pluginRoots: string[],
): PluginUninstallCandidate | undefined {
	const absolutePath = resolve(path);
	for (const candidate of candidates) {
		if (isInsidePath(absolutePath, candidate.installPath)) {
			return candidate;
		}
		if (
			candidate.entryPaths.some(
				(entryPath) => resolve(entryPath) === absolutePath,
			)
		) {
			return candidate;
		}
	}
	const installedRoot = resolveInstalledRootFromPath(absolutePath);
	if (installedRoot) {
		return createInstalledCandidate(installedRoot);
	}
	if (existsSync(absolutePath)) {
		return createDirectCandidate(absolutePath, pluginRoots);
	}
	return undefined;
}

function cleanupDisabledPluginPaths(candidate: PluginUninstallCandidate): void {
	const settings = readGlobalSettings();
	const disabledPlugins = settings.disabledPlugins;
	if (!disabledPlugins?.length) {
		return;
	}
	const remaining = disabledPlugins.filter((pluginPath) => {
		const absolutePath = resolve(pluginPath);
		if (isInsidePath(absolutePath, candidate.installPath)) {
			return false;
		}
		return !candidate.entryPaths.some(
			(entryPath) => resolve(entryPath) === absolutePath,
		);
	});
	if (remaining.length === disabledPlugins.length) {
		return;
	}
	writeGlobalSettings({ ...settings, disabledPlugins: remaining });
}

function cleanupEmptyInstallParents(installPath: string): void {
	let current = dirname(installPath);
	while (
		current !== dirname(current) &&
		basename(current) !== INSTALLS_DIRECTORY_NAME
	) {
		try {
			rmdirSync(current);
		} catch {
			return;
		}
		current = dirname(current);
	}
}

function describeCandidate(candidate: PluginUninstallCandidate): string {
	const primaryName = candidate.names[0] ?? basename(candidate.installPath);
	return `${primaryName} at ${candidate.installPath}`;
}

export async function uninstallPlugin(
	options: PluginUninstallOptions,
): Promise<PluginUninstallResult> {
	const pluginRoots = getPluginRoots(options);
	const candidates = collectCandidates(pluginRoots);
	const explicitPath = options.path?.trim();
	const requestedName = options.name?.trim();

	let candidate: PluginUninstallCandidate | undefined;
	if (explicitPath) {
		candidate = findCandidateByPath(explicitPath, candidates, pluginRoots);
		if (!candidate) {
			throw new Error(`No plugin found at ${explicitPath}`);
		}
	} else {
		if (!requestedName) {
			throw new Error("plugin uninstall requires a plugin name");
		}
		const matches = candidates.filter((item) =>
			candidateMatchesName(item, requestedName),
		);
		if (matches.length === 0) {
			throw new Error(`No plugin found matching "${requestedName}"`);
		}
		if (matches.length > 1) {
			throw new Error(
				`Multiple plugins match "${requestedName}": ${matches.map(describeCandidate).join(", ")}`,
			);
		}
		candidate = matches[0];
	}

	const stats = statSync(candidate.installPath, { throwIfNoEntry: false });
	if (!stats) {
		throw new Error(
			`Plugin install path does not exist: ${candidate.installPath}`,
		);
	}
	rmSync(candidate.installPath, {
		recursive: stats.isDirectory(),
		force: true,
	});
	cleanupDisabledPluginPaths(candidate);
	removePluginMcpServersFromSettings({
		pluginPaths: [candidate.installPath, ...candidate.entryPaths],
		pluginNames: candidate.names,
	});
	if (candidate.installed) {
		cleanupEmptyInstallParents(candidate.installPath);
	}
	return {
		name:
			requestedName || candidate.names[0] || basename(candidate.installPath),
		installPath: candidate.installPath,
		removedPaths: [candidate.installPath],
		entryPaths: candidate.entryPaths,
	};
}
