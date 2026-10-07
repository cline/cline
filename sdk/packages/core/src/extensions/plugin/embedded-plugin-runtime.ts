import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
	getEmbeddedPluginRuntimeRegistry,
	type PluginRuntimeResources,
} from "@cline/shared";
import { resolveClineDir } from "@cline/shared/storage";

/**
 * Materialize the embedded resources on first use and return the bootstrap
 * path. A `bun build --compile` child cannot read files inside its parent's
 * binary, so the sandbox needs them on real disk; keying the directory by
 * content hash lets different builds (stable, beta, CLI) coexist.
 */
export function resolveEmbeddedPluginBootstrap(): string | undefined {
	const registry = getEmbeddedPluginRuntimeRegistry();
	if (!registry) {
		return undefined;
	}
	let resources: PluginRuntimeResources;
	try {
		resources = registry.load();
	} catch {
		return undefined;
	}
	// Re-extract if the runtime directory was cleared while this process ran.
	if (registry.bootstrapPath && !existsSync(registry.bootstrapPath)) {
		registry.bootstrapPath = undefined;
	}
	registry.bootstrapPath ??= materializePluginRuntime(
		resources,
		join(resolveClineDir(), "runtime", "plugin-sandbox"),
	);
	return registry.bootstrapPath;
}

export function materializePluginRuntime(
	resources: PluginRuntimeResources,
	root: string,
): string {
	const json = gunzipSync(Buffer.from(resources.payload, "base64")).toString(
		"utf8",
	);
	if (createHash("sha256").update(json).digest("hex") !== resources.hash) {
		throw new Error("Invalid embedded plugin runtime");
	}
	const directory = join(root, resources.hash);
	const files = JSON.parse(json) as Record<string, string>;
	for (const [name, content] of Object.entries(files)) {
		if (
			name.startsWith("/") ||
			name.split(/[\\/]/).some((part) => part === "..")
		) {
			throw new Error(`Invalid plugin resource path: ${name}`);
		}
		const path = join(directory, name);
		if (existsSync(path) && readFileSync(path, "utf8") === content) {
			continue;
		}
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		// Write-then-rename so a concurrent host (or a crash) never leaves a
		// half-written module for the sandbox to load.
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, content, { mode: 0o600 });
			renameSync(temporary, path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	return join(directory, "plugin-sandbox-bootstrap.js");
}
