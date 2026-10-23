/**
 * Metro in a Bun workspace. Bun uses an *isolated* linker: a package's own
 * dependencies live in `node_modules/.bun/<pkg>@<hash>/node_modules/`, not
 * hoisted to the repo root. Metro therefore has to keep hierarchical lookup
 * enabled so that walking up from an origin module inside `.bun/` finds that
 * package's private dependency links (e.g. expo-router -> @expo/metro-runtime).
 * Setting `disableHierarchicalLookup` — as the pnpm-oriented Expo monorepo
 * recipe does — makes every nested transitive import unresolvable.
 *
 * `nodeModulesPaths` still lists both roots so the app's own (and workspace)
 * dependencies resolve, and `watchFolders` covers the linked workspace packages.
 */
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
	path.resolve(projectRoot, "node_modules"),
	path.resolve(workspaceRoot, "node_modules"),
];

// `@cline/shared`'s default (`import`/`default`) build is the Node bundle, which
// pulls `node:fs/promises`, `node:crypto`, etc. — unresolvable in a React Native
// bundle. The package also ships a self-contained `browser` build (only `zod`
// external, no node built-ins) behind its `browser` export condition, which
// Metro applies only to the `web` platform by default. The connection layer
// (`@cline/hub-client` -> `@cline/shared`) only needs the shared *types* and hub
// protocol schemas, all present in the browser build, so redirect the bare
// specifier there for every platform. It is imported bare everywhere (no
// subpaths), so a single redirect is sufficient.
const sharedBrowser = path.resolve(
	workspaceRoot,
	"sdk/packages/shared/dist/index.browser.js",
);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
	if (moduleName === "@cline/shared") {
		return { type: "sourceFile", filePath: sharedBrowser };
	}
	const next = defaultResolveRequest ?? context.resolveRequest;
	return next(context, moduleName, platform);
};

module.exports = config;
