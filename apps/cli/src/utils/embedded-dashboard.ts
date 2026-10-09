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

declare const CLINE_DASHBOARD_RUNTIME_RESOURCES:
	| { hash: string; payload: string }
	| undefined;

/** Native installs carry the dashboard with the executable, including binary assets. */
export function resolveEmbeddedDashboard(): string | undefined {
	if (typeof CLINE_DASHBOARD_RUNTIME_RESOURCES === "undefined")
		return undefined;
	const resources = CLINE_DASHBOARD_RUNTIME_RESOURCES;
	const json = gunzipSync(Buffer.from(resources.payload, "base64")).toString(
		"utf8",
	);
	if (createHash("sha256").update(json).digest("hex") !== resources.hash)
		throw new Error("Invalid embedded dashboard");
	const directory = join(
		homedir(),
		".cline",
		"runtime",
		"dashboard",
		resources.hash,
	);
	for (const [name, encoded] of Object.entries(
		JSON.parse(json) as Record<string, string>,
	)) {
		if (
			name.startsWith("/") ||
			name.split(/[\\/]/).some((part) => part === "..")
		)
			throw new Error("Invalid dashboard resource path");
		const content = Buffer.from(encoded, "base64");
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
