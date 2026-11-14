import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SubprocessSandboxLauncher } from "../../runtime/tools/subprocess-sandbox";

export const CLINE_PLUGIN_RUNTIME_DIR_ENV = "CLINE_PLUGIN_RUNTIME_DIR";
declare const __CLINE_PLUGIN_RUNTIME_DIR__: string | undefined;
let searched = false;
let discoveredDirectory: string | undefined;

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
		const resolved = resolve(configured);
		if (!isPluginRuntime(resolved))
			throw new Error(
				`${CLINE_PLUGIN_RUNTIME_DIR_ENV} does not contain a complete plugin runtime: ${configured}`,
			);
		return resolved;
	}
	if (typeof __CLINE_PLUGIN_RUNTIME_DIR__ !== "undefined")
		return __CLINE_PLUGIN_RUNTIME_DIR__;
	if (searched) return discoveredDirectory;
	searched = true;
	let current = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		for (const candidate of [
			current,
			join(current, "plugin-runtime"),
			join(current, "dist", "plugin-runtime"),
		]) {
			if (isPluginRuntime(candidate)) {
				discoveredDirectory = candidate;
				return candidate;
			}
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

let sandboxLauncher: SubprocessSandboxLauncher | undefined;

/** Let a compiled host launch plugin children with its embedded filesystem mounted. */
export function setPluginSandboxLauncher(
	launcher: SubprocessSandboxLauncher | undefined,
): void {
	sandboxLauncher = launcher
		? { command: launcher.command, argsPrefix: [...launcher.argsPrefix] }
		: undefined;
}

export function getPluginSandboxLauncher():
	| SubprocessSandboxLauncher
	| undefined {
	return sandboxLauncher;
}
