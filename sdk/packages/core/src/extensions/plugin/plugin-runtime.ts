import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveClineDir } from "@cline/shared/storage";
import {
	type EmbeddedResources,
	materializeEmbeddedResources,
} from "../../runtime/embedded-resources";

export const CLINE_PLUGIN_RUNTIME_DIR_ENV = "CLINE_PLUGIN_RUNTIME_DIR";
declare const __CLINE_PLUGIN_RUNTIME_RESOURCES__: EmbeddedResources | undefined;
const embeddedDirectories = new Map<string, string>();

function isPluginRuntime(directory: string): boolean {
	return (
		existsSync(join(directory, "plugin-sandbox-bootstrap.js")) &&
		existsSync(
			join(directory, "node_modules", "@cline", "core", "package.json"),
		)
	);
}

/** Core owns the bootstrap and SDK as one artifact for every host and transport. */
export function resolvePluginRuntimeDirectory(): string | undefined {
	const configured = process.env[CLINE_PLUGIN_RUNTIME_DIR_ENV]?.trim();
	if (configured) {
		if (!isPluginRuntime(configured))
			throw new Error(
				`${CLINE_PLUGIN_RUNTIME_DIR_ENV} does not contain a complete plugin runtime: ${configured}`,
			);
		return configured;
	}
	let current = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		for (const candidate of [
			current,
			join(current, "plugin-runtime"),
			join(current, "dist", "plugin-runtime"),
		]) {
			if (isPluginRuntime(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	if (typeof __CLINE_PLUGIN_RUNTIME_RESOURCES__ === "undefined")
		return undefined;
	const root = join(resolveClineDir(), "runtime", "plugins");
	let directory = embeddedDirectories.get(root);
	if (!directory) {
		directory = materializeEmbeddedResources(
			__CLINE_PLUGIN_RUNTIME_RESOURCES__,
			root,
		);
		embeddedDirectories.set(root, directory);
	}
	return directory;
}
