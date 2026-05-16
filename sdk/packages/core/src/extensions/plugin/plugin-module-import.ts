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
	"@cline/sdk",
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
		"@cline/sdk": resolve(root, "packages/sdk/src/index.ts"),
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

function getHostPackageSearchRoots(): string[] {
	const roots = [MODULE_DIR];
	const wrapperPath = process.env.CLINE_WRAPPER_PATH?.trim();
	if (wrapperPath) {
		roots.push(dirname(dirname(wrapperPath)));
	}
	const execPath = process.execPath?.trim();
	if (execPath) {
		roots.push(dirname(execPath));
	}
	return [...new Set(roots.map((root) => resolve(root)))];
}

function findHostPackageRootFrom(
	startDir: string,
	packageName: string,
): string | null {
	let current = startDir;
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

function findHostPackageRoot(packageName: string): string | null {
	for (const root of getHostPackageSearchRoots()) {
		const packageRoot = findHostPackageRootFrom(root, packageName);
		if (packageRoot) {
			return packageRoot;
		}
	}
	return null;
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

type JitiTransform = (opts: {
	source: string;
	filename?: string;
	ts?: boolean;
	async?: boolean;
	jsx?: unknown;
	[key: string]: unknown;
}) => { code: string; error?: unknown };

let cachedJitiTransform: JitiTransform | null | undefined;

function loadJitiBabelTransform(): JitiTransform | null {
	if (cachedJitiTransform !== undefined) {
		return cachedJitiTransform;
	}
	// jiti's default lazyTransform path is
	//   createRequire(import.meta.url)("../dist/babel.cjs")
	// which fails in a `bun build --compile` binary: `import.meta.url` is
	// `bunfs:/root/chunk-XXXX.js`, so the relative resolve has nothing to
	// walk through. The wrapper install layout still has the real file at
	// <wrapper>/node_modules/jiti/dist/babel.cjs, so locate it on disk via
	// our host-package resolver and createRequire from an actual on-disk
	// path. Returning null falls back to jiti's own loader (works in dev).
	const jitiRoot = findHostPackageRoot("jiti");
	if (!jitiRoot) {
		cachedJitiTransform = null;
		return null;
	}
	const babelPath = resolve(jitiRoot, "dist", "babel.cjs");
	if (!existsSync(babelPath)) {
		cachedJitiTransform = null;
		return null;
	}
	try {
		const requireFromBabel = createRequire(babelPath);
		const transform = requireFromBabel(babelPath) as unknown;
		cachedJitiTransform =
			typeof transform === "function" ? (transform as JitiTransform) : null;
	} catch {
		cachedJitiTransform = null;
	}
	return cachedJitiTransform;
}

let cachedHostVirtualModules: Record<string, unknown> | undefined;

function tryRequireFromPath(fromPath: string, specifier: string): unknown {
	try {
		return createRequire(fromPath)(specifier);
	} catch {
		return undefined;
	}
}

function requireHostModule(specifier: string): unknown {
	const wrapperPath = process.env.CLINE_WRAPPER_PATH?.trim();
	if (wrapperPath) {
		const module = tryRequireFromPath(wrapperPath, specifier);
		if (module) {
			return module;
		}
	}
	return tryRequireFromPath(import.meta.url, specifier);
}

function collectHostVirtualModules(): Record<string, unknown> {
	if (cachedHostVirtualModules) {
		return cachedHostVirtualModules;
	}
	const modules: Record<string, unknown> = {};
	for (const specifier of HOST_PROVIDED_SDK_SPECIFIERS) {
		const value = requireHostModule(specifier);
		if (value && Object.keys(value).length > 0) {
			modules[specifier] = value;
		}
	}
	cachedHostVirtualModules = modules;
	return modules;
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
	// The host packages (@cline/core, @cline/shared, etc.) are already loaded
	// inside this process; the cline binary bundles them. Hand jiti those live
	// module instances as virtual modules so a plugin's `import "@cline/core"`
	// resolves to an object lookup instead of jiti walking + transforming the
	// entire shipped package tree on every load (8s -> ~300ms for `cline config
	// tools` in packaged installs). `virtualModules` lookup keys on the bare
	// specifier before alias rewriting, so we strip any alias entry we'll
	// satisfy virtually. Otherwise the alias rewrites the specifier to an
	// absolute path and we pay the full file-load cost anyway.
	//
	// A plugin that ships its own installed copy of a host package (e.g. a
	// pinned `@cline/shared` in its node_modules) must still see that copy, not
	// our bundled one. `collectPluginImportAliases` already drops workspace
	// aliases for plugin-installed deps; mirror that here so virtualModules
	// behaves the same way.
	const pluginRequire = createRequire(pluginPath);
	const virtualModules: Record<string, unknown> = {};
	for (const [specifier, value] of Object.entries(
		collectHostVirtualModules(),
	)) {
		try {
			pluginRequire.resolve(specifier);
			continue;
		} catch {
			// Plugin doesn't ship its own copy; the bundled host module is
			// what jiti should hand back for this specifier.
		}
		virtualModules[specifier] = value;
	}
	const jitiAliases: Record<string, string> = {};
	for (const [specifier, target] of Object.entries(sortedAliases)) {
		if (!Object.hasOwn(virtualModules, specifier)) {
			jitiAliases[specifier] = target;
		}
	}
	// jiti's lazyTransform uses `createRequire(import.meta.url)("../dist/babel.cjs")`
	// to load its babel transformer on demand. In a `bun build --compile`
	// binary that fails because `import.meta.url` points inside the bunfs
	// bundle; the wrapper install still has the file on real disk though, so
	// we locate it via our host-package resolver and inject the transform.
	//
	// jiti threads its top-level `interopDefault` into babel via the transform
	// call's options (babel uses `noInterop: !interopDefault`). We want babel
	// to emit the CJS interop wrapper so `import YAML from "yaml"` works for
	// CJS deps, but we do not want jiti's runtime to wrap returned modules
	// in a default-synthesizing Proxy (that proxy makes `moduleExports.default`
	// truthy even for namespace-only modules, which breaks named-export
	// plugins). Pin `interopDefault: true` going into babel by overriding it
	// in the transform call, while keeping `interopDefault: false` on the jiti
	// instance so the loader sees raw exports.
	const baseBabelTransform = loadJitiBabelTransform();
	const babelTransform: JitiTransform | undefined = baseBabelTransform
		? (opts) => baseBabelTransform({ ...opts, interopDefault: true })
		: undefined;
	const jiti = createJiti(pluginPath, {
		alias: jitiAliases,
		cache: options.useCache,
		requireCache: options.useCache,
		esmResolve: true,
		interopDefault: false,
		nativeModules: [...BUILTIN_MODULES],
		transformModules: Object.keys(jitiAliases),
		virtualModules,
		// On Bun (the packaged binary), tryNative defaults to true, which makes
		// jiti hand the plugin path straight to Bun's `import()`. Bun then owns
		// every nested import in the plugin, sees `import "@cline/core"` with no
		// node_modules adjacent to the drop-in plugin, and throws ResolveMessage.
		// Forcing tryNative off keeps jiti in charge so bare specifiers route
		// through `virtualModules` first.
		tryNative: false,
		...(babelTransform ? { transform: babelTransform } : {}),
	});
	// Use the synchronous jiti(path) call rather than `jiti.import(path)`.
	// The async path emits ESM, which `vm.runInThisContext` can't compile, so
	// jiti falls back to `nativeImport(data:URL)`, and that Bun-side import
	// has no way to consult our virtualModules map. The sync path emits CJS,
	// wraps it in a function with jiti's own `require` injected, and routes
	// every `require("@cline/core")` back through jitiRequire -> virtualModules.
	return jiti(pluginPath) as Record<string, unknown>;
}
