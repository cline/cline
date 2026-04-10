import { existsSync, readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_FILE_EXTENSIONS } from "@clinebot/shared";
import createJiti from "jiti";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const HOST_REQUIRE = createRequire(import.meta.url);
// `plugin-module-import.ts` lives at `packages/core/src/extensions/plugin`, so
// walking up five levels lands at the repo root.
const WORKSPACE_ROOT = resolve(MODULE_DIR, "..", "..", "..", "..", "..");
const WORKSPACE_ALIASES = collectWorkspaceAliases(WORKSPACE_ROOT);
const BUILTIN_MODULES = new Set(
	builtinModules.flatMap((id) => [id, id.replace(/^node:/, "")]),
);
const SUPPORTED_PLUGIN_EXTENSIONS = new Set(PLUGIN_FILE_EXTENSIONS);

export interface ImportPluginModuleOptions {
	useCache?: boolean;
}

function collectWorkspaceAliases(root: string): Record<string, string> {
	const aliases: Record<string, string> = {};
	const candidates: Record<string, string> = {
		"@clinebot/agents": resolve(root, "packages/agents/src/index.ts"),
		"@clinebot/core": resolve(root, "packages/core/src/index.ts"),
		"@clinebot/llms": resolve(root, "packages/llms/src/index.ts"),
		"@clinebot/rpc": resolve(root, "packages/rpc/src/index.ts"),
		"@clinebot/scheduler": resolve(root, "packages/scheduler/src/index.ts"),
		"@clinebot/shared": resolve(root, "packages/shared/src/index.ts"),
		"@clinebot/shared/storage": resolve(
			root,
			"packages/shared/src/storage/index.ts",
		),
		"@clinebot/shared/db": resolve(root, "packages/shared/src/db/index.ts"),
	};
	for (const [key, value] of Object.entries(candidates)) {
		if (existsSync(value)) {
			aliases[key] = value;
		}
	}
	return aliases;
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
	try {
		HOST_REQUIRE.resolve(specifier);
		return true;
	} catch {
		return false;
	}
}

function resolveFromHostRuntime(specifier: string): string | null {
	try {
		return HOST_REQUIRE.resolve(specifier);
	} catch {
		return null;
	}
}

function isPackageBasedPlugin(pluginFilePath: string): boolean {
	// Walk up from the plugin file looking for a package.json with a `cline`
	// manifest.  Stop at the first package.json we encounter — if it doesn't
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
	for (const specifier of collectStaticModuleSpecifiers(source)) {
		if (specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier)) {
			continue;
		}
		if (isBareSpecifier(specifier)) {
			if (
				Object.hasOwn(WORKSPACE_ALIASES, specifier) ||
				Object.hasOwn(WORKSPACE_ALIASES, getPackageName(specifier)) ||
				hasInstalledDependency(pluginPath, specifier) ||
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

function collectPluginImportAliases(
	pluginPath: string,
	preferHostRuntimeDependencies: boolean,
): Record<string, string> {
	const pluginRequire = createRequire(pluginPath);
	const aliases: Record<string, string> = {};
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
	if (preferHostRuntimeDependencies) {
		const source = readFileSync(pluginPath, "utf8");
		for (const specifier of collectStaticModuleSpecifiers(source)) {
			if (
				!isBareSpecifier(specifier) ||
				specifier.startsWith("node:") ||
				BUILTIN_MODULES.has(specifier) ||
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
	const jiti = createJiti(pluginPath, {
		alias: aliases,
		cache: options.useCache,
		requireCache: options.useCache,
		esmResolve: true,
		interopDefault: false,
		nativeModules: [...BUILTIN_MODULES],
		transformModules: Object.keys(aliases),
	});
	return (await jiti.import(pluginPath, {})) as Record<string, unknown>;
}
