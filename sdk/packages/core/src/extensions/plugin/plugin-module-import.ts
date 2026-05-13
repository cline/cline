import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_FILE_EXTENSIONS } from "@cline/shared";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const HOST_REQUIRE = createRequire(import.meta.url);
// `plugin-module-import.ts` lives at `packages/core/src/extensions/plugin`, so
// walking up five levels lands at the repo root.
const WORKSPACE_ROOT = resolve(MODULE_DIR, "..", "..", "..", "..", "..");
const WORKSPACE_ALIASES = collectWorkspaceAliases(WORKSPACE_ROOT);
const HOST_PROVIDED_SDK_SPECIFIERS = [
	"@cline/agents",
	"@cline/core",
	"@cline/core/hub",
	"@cline/core/hub/daemon-entry",
	"@cline/core/telemetry",
	"@cline/llms",
	"@cline/llms/browser",
	"@cline/shared",
	"@cline/shared/automation",
	"@cline/shared/browser",
	"@cline/shared/storage",
	"@cline/shared/db",
	"@cline/shared/types",
];
const BUILTIN_MODULES = new Set(
	builtinModules.flatMap((id) => [id, id.replace(/^node:/, "")]),
);
const SUPPORTED_PLUGIN_EXTENSIONS = new Set(PLUGIN_FILE_EXTENSIONS);
const WORKSPACE_EXPORT_CONDITIONS = [
	"development",
	"node",
	"import",
	"require",
	"default",
];

export interface ImportPluginModuleOptions {
	useCache?: boolean;
}

function collectWorkspaceAliases(root: string): Record<string, string> {
	const aliases: Record<string, string> = {};
	const candidates: Record<string, string> = {
		"@cline/agents": resolve(root, "packages/agents/src/index.ts"),
		"@cline/core": resolve(root, "packages/core/src/index.ts"),
		"@cline/llms": resolve(root, "packages/llms/src/index.ts"),
		"@cline/shared": resolve(root, "packages/shared/src/index.ts"),
		"@cline/shared/storage": resolve(
			root,
			"packages/shared/src/storage/index.ts",
		),
		"@cline/shared/db": resolve(root, "packages/shared/src/db/index.ts"),
	};
	for (const [key, value] of Object.entries(candidates)) {
		if (existsSync(value)) {
			aliases[key] = value;
		}
	}
	for (const packageName of ["agents", "core", "llms", "shared"]) {
		const packageRoot = resolve(root, "packages", packageName);
		const packageJsonPath = resolve(packageRoot, "package.json");
		if (!existsSync(packageJsonPath)) {
			continue;
		}
		try {
			const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
				name?: unknown;
				exports?: unknown;
			};
			if (typeof pkg.name !== "string" || !pkg.exports) {
				continue;
			}
			if (typeof pkg.exports === "string") {
				const target = resolve(packageRoot, pkg.exports);
				if (existsSync(target)) {
					aliases[pkg.name] = target;
				}
				continue;
			}
			if (typeof pkg.exports !== "object") {
				continue;
			}
			for (const [exportPath, exportValue] of Object.entries(pkg.exports)) {
				const sourcePath = resolveWorkspaceExportSourcePath(
					packageRoot,
					exportValue,
				);
				if (!sourcePath) {
					continue;
				}
				const specifier =
					exportPath === "."
						? pkg.name
						: `${pkg.name}/${exportPath.replace(/^\.\//, "")}`;
				aliases[specifier] = sourcePath;
			}
		} catch {
			// Workspace aliases are a development convenience; ignore malformed
			// package manifests and let normal resolution report any real failure.
		}
	}
	return aliases;
}

function resolveWorkspaceExportSourcePath(
	packageRoot: string,
	exportValue: unknown,
): string | null {
	const exportPath = selectWorkspaceExportPath(exportValue);
	if (!exportPath) {
		return null;
	}
	const candidates = inferWorkspaceSourceCandidates(packageRoot, exportPath);
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	return null;
}

function selectWorkspaceExportPath(
	exportValue: unknown,
	seen = new Set<unknown>(),
): string | null {
	if (typeof exportValue === "string") {
		return exportValue;
	}
	if (!exportValue || typeof exportValue !== "object") {
		return null;
	}
	if (seen.has(exportValue)) {
		return null;
	}
	seen.add(exportValue);
	const exports = exportValue as Record<string, unknown>;
	for (const condition of WORKSPACE_EXPORT_CONDITIONS) {
		const resolved = selectWorkspaceExportPath(exports[condition], seen);
		if (resolved) {
			return resolved;
		}
	}
	return null;
}

function inferWorkspaceSourceCandidates(
	packageRoot: string,
	exportPath: string,
): string[] {
	const normalizedPath = exportPath.replace(/^\.\//, "");
	const candidates = [resolve(packageRoot, exportPath)];
	if (normalizedPath.startsWith("dist/")) {
		const sourceBasePath = normalizedPath
			.replace(/^dist\//, "src/")
			.replace(/\.(mjs|cjs|js)$/, "");
		return [
			resolve(packageRoot, `${sourceBasePath}.ts`),
			resolve(packageRoot, `${sourceBasePath}.tsx`),
			resolve(packageRoot, `${sourceBasePath}.mts`),
			resolve(packageRoot, `${sourceBasePath}.cts`),
			...candidates,
		];
	}
	return candidates;
}

function sortAliasesBySpecificity(
	aliases: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(aliases).sort(
			([left], [right]) => right.length - left.length,
		),
	);
}

function isBareSpecifier(specifier: string): boolean {
	return !(
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("file:") ||
		specifier.startsWith("data:") ||
		specifier.startsWith("http:") ||
		specifier.startsWith("https:")
	);
}

function getPackageName(specifier: string): string {
	if (specifier.startsWith("@")) {
		const [scope, name] = specifier.split("/", 3);
		return name ? `${scope}/${name}` : specifier;
	}
	return specifier.split("/", 1)[0] ?? specifier;
}

function getPackageExportPath(specifier: string): string {
	const packageName = getPackageName(specifier);
	if (specifier === packageName) {
		return ".";
	}
	return `.${specifier.slice(packageName.length)}`;
}

function isClineSdkSpecifier(specifier: string): boolean {
	return getPackageName(specifier).startsWith("@cline/");
}

function hasInstalledDependency(
	pluginFilePath: string,
	specifier: string,
): boolean {
	const packageName = getPackageName(specifier);
	let current = dirname(pluginFilePath);
	while (true) {
		const packageDir = resolve(current, "node_modules", packageName);
		if (
			existsSync(packageDir) ||
			existsSync(resolve(packageDir, "package.json"))
		) {
			return true;
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			return false;
		}
		current = parent;
	}
}

function resolvesFromHostRuntime(specifier: string): boolean {
	return resolveFromHostRuntime(specifier) !== null;
}

function resolveFromHostRuntime(specifier: string): string | null {
	try {
		return HOST_REQUIRE.resolve(specifier);
	} catch {
		// Continue with package export resolution for ESM-only package exports.
	}
	return resolveHostPackageExport(specifier);
}

function resolveHostPackageExport(specifier: string): string | null {
	const packageName = getPackageName(specifier);
	const packageRoot = findHostPackageRoot(packageName);
	if (!packageRoot) {
		return null;
	}
	const packageJsonPath = resolve(packageRoot, "package.json");
	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			exports?: unknown;
			main?: unknown;
		};
		const exportPath = getPackageExportPath(specifier);
		const exportValue =
			exportPath === "." && typeof pkg.exports === "string"
				? pkg.exports
				: pkg.exports &&
						typeof pkg.exports === "object" &&
						Object.hasOwn(pkg.exports, exportPath)
					? (pkg.exports as Record<string, unknown>)[exportPath]
					: undefined;
		const resolvedExportPath =
			selectWorkspaceExportPath(exportValue) ??
			(exportPath === "." && typeof pkg.main === "string" ? pkg.main : null);
		if (!resolvedExportPath) {
			return null;
		}
		const exportTarget = resolve(packageRoot, resolvedExportPath);
		const candidates = [
			exportTarget,
			...inferWorkspaceSourceCandidates(packageRoot, resolvedExportPath).filter(
				(candidate) => candidate !== exportTarget,
			),
		];
		for (const candidate of candidates) {
			if (existsSync(candidate)) {
				return candidate;
			}
		}
		return null;
	} catch {
		return null;
	}
}

function findHostPackageRoot(packageName: string): string | null {
	let current = MODULE_DIR;
	while (true) {
		const packageJsonPath = resolve(current, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
					name?: unknown;
				};
				if (pkg.name === packageName) {
					return current;
				}
			} catch {
				// Keep walking; malformed manifests are not useful for resolution.
			}
		}
		const dependencyPackageJsonPath = resolve(
			current,
			"node_modules",
			packageName,
			"package.json",
		);
		if (existsSync(dependencyPackageJsonPath)) {
			return dirname(dependencyPackageJsonPath);
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			return null;
		}
		current = parent;
	}
}

function isPackageBasedPlugin(pluginFilePath: string): boolean {
	// Walk up from the plugin file looking for a package.json with a `cline`
	// manifest. Stop at the first package.json we encounter; if it doesn't
	// declare `cline` we've left the plugin boundary (e.g. hit the workspace
	// root).  Also cap the traversal so we never wander far from the plugin
	// search root (.cline/plugins).
	const MAX_DEPTH = 4;
	let current = dirname(pluginFilePath);
	for (let depth = 0; depth < MAX_DEPTH; depth++) {
		const packageJsonPath = resolve(current, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
				return pkg != null && typeof pkg === "object" && "cline" in pkg;
			} catch {
				return false;
			}
		}
		const parent = resolve(current, "..");
		if (parent === current) {
			return false;
		}
		current = parent;
	}
	return false;
}

function resolveRelativeImportPath(
	fromPath: string,
	specifier: string,
): string | null {
	const resolvedBase = specifier.startsWith("file:")
		? fileURLToPath(specifier)
		: isAbsolute(specifier)
			? specifier
			: resolve(dirname(fromPath), specifier);
	if (
		existsSync(resolvedBase) &&
		SUPPORTED_PLUGIN_EXTENSIONS.has(extname(resolvedBase))
	) {
		return resolvedBase;
	}
	for (const extension of SUPPORTED_PLUGIN_EXTENSIONS) {
		const withExtension = `${resolvedBase}${extension}`;
		if (existsSync(withExtension)) {
			return withExtension;
		}
	}
	for (const extension of SUPPORTED_PLUGIN_EXTENSIONS) {
		const indexPath = resolve(resolvedBase, `index${extension}`);
		if (existsSync(indexPath)) {
			return indexPath;
		}
	}
	return null;
}

function collectStaticModuleSpecifiers(source: string): string[] {
	const specifiers = new Set<string>();
	const patterns = [
		/\bimport\s+(?:type\s+)?[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
		/\bexport\s+[^"'`]*?\bfrom\s*["'`]([^"'`]+)["'`]/g,
		/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
		/\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1];
			if (specifier) {
				specifiers.add(specifier);
			}
		}
	}
	return [...specifiers];
}

function shouldPreflightBareDependencies(pluginPath: string): boolean {
	// TypeScript source can contain type-only import syntax that is not runtime
	// dependency evidence. Let jiti and Node report real runtime load failures.
	return extname(pluginPath) !== ".ts";
}

function assertPluginDependenciesInstalled(
	pluginPath: string,
	preferHostRuntimeDependencies: boolean,
	seen = new Set<string>(),
): void {
	if (seen.has(pluginPath) || !existsSync(pluginPath)) {
		return;
	}
	seen.add(pluginPath);

	if (!SUPPORTED_PLUGIN_EXTENSIONS.has(extname(pluginPath))) {
		return;
	}

	const source = readFileSync(pluginPath, "utf8");
	const preflightBareDependencies = shouldPreflightBareDependencies(pluginPath);
	for (const specifier of collectStaticModuleSpecifiers(source)) {
		if (specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier)) {
			continue;
		}
		if (isBareSpecifier(specifier)) {
			if (!preflightBareDependencies) {
				continue;
			}
			if (
				Object.hasOwn(WORKSPACE_ALIASES, specifier) ||
				Object.hasOwn(WORKSPACE_ALIASES, getPackageName(specifier)) ||
				hasInstalledDependency(pluginPath, specifier) ||
				(isClineSdkSpecifier(specifier) &&
					resolvesFromHostRuntime(specifier)) ||
				(preferHostRuntimeDependencies && resolvesFromHostRuntime(specifier))
			) {
				continue;
			}
			throw new Error(`Cannot find module '${getPackageName(specifier)}'`);
		}
		const resolvedPath = resolveRelativeImportPath(pluginPath, specifier);
		if (resolvedPath) {
			assertPluginDependenciesInstalled(
				resolvedPath,
				preferHostRuntimeDependencies,
				seen,
			);
		}
	}
}

function collectPluginStaticModuleSpecifiers(
	pluginPath: string,
	seen = new Set<string>(),
	specifiers = new Set<string>(),
): Set<string> {
	if (seen.has(pluginPath) || !existsSync(pluginPath)) {
		return specifiers;
	}
	seen.add(pluginPath);

	if (!SUPPORTED_PLUGIN_EXTENSIONS.has(extname(pluginPath))) {
		return specifiers;
	}

	const source = readFileSync(pluginPath, "utf8");
	for (const specifier of collectStaticModuleSpecifiers(source)) {
		specifiers.add(specifier);
		if (isBareSpecifier(specifier)) {
			continue;
		}
		const resolvedPath = resolveRelativeImportPath(pluginPath, specifier);
		if (resolvedPath) {
			collectPluginStaticModuleSpecifiers(resolvedPath, seen, specifiers);
		}
	}
	return specifiers;
}

function collectPluginImportAliases(
	pluginPath: string,
	preferHostRuntimeDependencies: boolean,
): Record<string, string> {
	const pluginRequire = createRequire(pluginPath);
	const aliases: Record<string, string> = {};
	const staticSpecifiers = collectPluginStaticModuleSpecifiers(pluginPath);
	const hostRuntimeSpecifiers = new Set(HOST_PROVIDED_SDK_SPECIFIERS);
	for (const [specifier, sourcePath] of Object.entries(WORKSPACE_ALIASES)) {
		try {
			pluginRequire.resolve(specifier);
			continue;
		} catch {
			// Use the workspace source only when the plugin package does not provide
			// its own installed SDK dependency.
		}
		aliases[specifier] = sourcePath;
	}
	for (const specifier of staticSpecifiers) {
		if (
			isBareSpecifier(specifier) &&
			(isClineSdkSpecifier(specifier) || preferHostRuntimeDependencies)
		) {
			hostRuntimeSpecifiers.add(specifier);
		}
	}
	for (const specifier of hostRuntimeSpecifiers) {
		if (
			Object.hasOwn(aliases, specifier) ||
			hasInstalledDependency(pluginPath, specifier)
		) {
			continue;
		}
		const resolved = resolveFromHostRuntime(specifier);
		if (resolved) {
			aliases[specifier] = resolved;
		}
	}
	if (!preferHostRuntimeDependencies) {
		return aliases;
	}
	for (const specifier of staticSpecifiers) {
		if (
			!isBareSpecifier(specifier) ||
			Object.hasOwn(aliases, specifier) ||
			hasInstalledDependency(pluginPath, specifier) ||
			specifier.startsWith("node:") ||
			BUILTIN_MODULES.has(specifier)
		) {
			continue;
		}
		const resolved = resolveFromHostRuntime(specifier);
		if (resolved) {
			aliases[specifier] = resolved;
		}
	}
	return aliases;
}

export async function importPluginModule(
	pluginPath: string,
	options: ImportPluginModuleOptions = {},
): Promise<Record<string, unknown>> {
	const preferHostRuntimeDependencies = !isPackageBasedPlugin(pluginPath);
	assertPluginDependenciesInstalled(pluginPath, preferHostRuntimeDependencies);
	const aliases = collectPluginImportAliases(
		pluginPath,
		preferHostRuntimeDependencies,
	);
	const sortedAliases = sortAliasesBySpecificity(aliases);
	const jitiModule = (await import("jiti")) as unknown;
	const createJiti =
		typeof jitiModule === "function"
			? jitiModule
			: typeof (jitiModule as { default?: unknown }).default === "function"
				? (jitiModule as { default: typeof import("jiti").default }).default
				: undefined;
	if (!createJiti) {
		throw new Error("Unable to load jiti");
	}
	const jiti = createJiti(pluginPath, {
		alias: sortedAliases,
		cache: options.useCache,
		requireCache: options.useCache,
		esmResolve: true,
		interopDefault: false,
		nativeModules: [...BUILTIN_MODULES],
		transformModules: Object.keys(sortedAliases),
	});
	return (await jiti.import(pluginPath, {})) as Record<string, unknown>;
}
