/**
 * Seeds the plugins bundled with the CLI (see assets/bundled-plugins/) into
 * `~/.cline/plugins/_bundled/` so regular plugin discovery picks them up.
 * Bundled plugins can be disabled from settings like any other plugin, but
 * they can't be uninstalled — the CLI re-seeds them on startup.
 *
 * Set CLINE_BUNDLED_PLUGINS=0 to opt out (useful for tests and automation).
 */
export async function ensureBundledPluginsSeeded(): Promise<void> {
	if (process.env.CLINE_BUNDLED_PLUGINS?.trim() === "0") {
		return;
	}
	try {
		const [{ syncBundledPlugins }, { BUNDLED_PLUGINS }] = await Promise.all([
			import("@cline/core"),
			import("./generated"),
		]);
		syncBundledPlugins(BUNDLED_PLUGINS);
	} catch {
		// Best effort: seeding must never block the CLI from starting.
	}
}
