import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, win32 } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export interface EmbeddedResources {
	hash: string;
	payload: string;
}

/** Values are base64 so the same archive preserves JavaScript and binary assets. */
export function packEmbeddedResources(
	files: Record<string, string>,
): EmbeddedResources {
	const json = JSON.stringify(
		Object.fromEntries(
			Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
		),
	);
	return {
		hash: createHash("sha256").update(json).digest("hex"),
		payload: gzipSync(json).toString("base64"),
	};
}

/** Restores a build's exact resources, repairing corrupt files without modifying another build. */
export function materializeEmbeddedResources(
	resources: EmbeddedResources,
	root: string,
): string {
	const json = gunzipSync(Buffer.from(resources.payload, "base64")).toString(
		"utf8",
	);
	if (
		!/^[a-f0-9]{64}$/.test(resources.hash) ||
		createHash("sha256").update(json).digest("hex") !== resources.hash
	) {
		throw new Error("Invalid embedded resource checksum");
	}
	const files = JSON.parse(json) as Record<string, unknown>;
	const entries = Object.entries(files).map(([name, encoded]) => {
		if (
			!name ||
			name.startsWith("/") ||
			win32.isAbsolute(name) ||
			name.includes("\\") ||
			name.split("/").some((part) => !part || part === ".." || part === ".") ||
			typeof encoded !== "string"
		) {
			throw new Error("Invalid embedded resource path or content");
		}
		return [name, Buffer.from(encoded, "base64")] as const;
	});
	const directory = join(root, resources.hash);
	for (const [name, content] of entries) {
		const path = join(directory, name);
		if (existsSync(path) && readFileSync(path).equals(content)) continue;
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		const temporary = `${path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, content, { mode: 0o600 });
			renameSync(temporary, path);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	return directory;
}
