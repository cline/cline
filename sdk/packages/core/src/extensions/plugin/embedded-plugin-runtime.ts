import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

declare const CLINE_PLUGIN_RUNTIME_RESOURCES:
	| { hash: string; payload: string }
	| undefined;
let bootstrap: string | undefined;

/** Materialize the exact plugin SDK shipped inside a compiled host, without Node or downloads. */
export function resolveEmbeddedPluginBootstrap(): string | undefined {
	if (typeof CLINE_PLUGIN_RUNTIME_RESOURCES === "undefined") return undefined;
	bootstrap ??= materializePluginRuntime(
		CLINE_PLUGIN_RUNTIME_RESOURCES,
		join(homedir(), ".cline", "runtime", "plugin-sandbox"),
	);
	return bootstrap;
}

export function materializePluginRuntime(
	resources: { hash: string; payload: string },
	root: string,
): string {
	const json = gunzipSync(Buffer.from(resources.payload, "base64")).toString(
		"utf8",
	);
	if (createHash("sha256").update(json).digest("hex") !== resources.hash)
		throw new Error("Invalid embedded plugin runtime");
	const directory = join(root, resources.hash);
	const files = JSON.parse(json) as Record<string, string>;
	for (const [name, content] of Object.entries(files)) {
		if (
			name.split(/[\\/]/).some((part) => part === "..") ||
			name.startsWith("/")
		)
			throw new Error("Invalid plugin resource path");
		const path = join(directory, name);
		if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
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
