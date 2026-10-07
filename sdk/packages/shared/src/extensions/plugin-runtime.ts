/**
 * Plugin sandbox resources a compiled host carries inside its own binary: the
 * sandbox bootstrap, jiti's transform, and an importable copy of the public
 * SDK. Produced at build time (`sdk/packages/core/scripts/plugin-runtime-resources.ts`)
 * and injected into the host bundle as the `CLINE_PLUGIN_RUNTIME_RESOURCES`
 * define; `@cline/core` extracts them to disk on first plugin load.
 */
export interface PluginRuntimeResources {
	hash: string;
	/** gzip(JSON of relative path -> file content), base64. */
	payload: string;
}

export interface EmbeddedPluginRuntimeRegistry {
	load: () => PluginRuntimeResources;
	/** Set by core once the resources have been materialized. */
	bootstrapPath?: string;
}

// A global so it is shared across every copy of the consuming modules in a
// bundle (core's dist duplicates them between entry points).
const REGISTRY = Symbol.for("cline.plugin-runtime-resources");

/**
 * Called once from a compiled host's entrypoint with a thunk returning the
 * build-time define. A thunk so the host references the identifier exactly
 * once (Bun inlines the literal at every reference), and so a source run,
 * where the define does not exist, throws inside the thunk and is treated as
 * "nothing embedded".
 */
export function registerEmbeddedPluginRuntime(
	load: () => PluginRuntimeResources,
): void {
	(globalThis as Record<symbol, unknown>)[REGISTRY] = {
		load,
	} satisfies EmbeddedPluginRuntimeRegistry;
}

export function getEmbeddedPluginRuntimeRegistry():
	| EmbeddedPluginRuntimeRegistry
	| undefined {
	return (globalThis as Record<symbol, unknown>)[REGISTRY] as
		| EmbeddedPluginRuntimeRegistry
		| undefined;
}
