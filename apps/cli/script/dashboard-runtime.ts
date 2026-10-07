import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { $ } from "bun";

let resources: Promise<{ hash: string; payload: string }> | undefined;

/** Build and embed the dashboard once for all native targets in this build. */
export function buildDashboardRuntimeResources() {
	resources ??= buildResources();
	return resources;
}

async function buildResources() {
	const root = resolve(import.meta.dir, "../../..");
	await $`bun -F @cline/cline-hub build:webview`.cwd(root);
	const directory = join(root, "apps/cline-hub/dist/webview");
	const files: Record<string, string> = {};
	function collect(relative = "") {
		for (const entry of readdirSync(join(directory, relative), {
			withFileTypes: true,
		}).sort((a, b) => a.name.localeCompare(b.name))) {
			const name = relative + entry.name;
			if (entry.isDirectory()) collect(`${name}/`);
			else if (entry.isFile())
				files[name] = readFileSync(join(directory, name)).toString("base64");
		}
	}
	collect();
	if (!files["index.html"])
		throw new Error("Dashboard build produced no index.html");
	const json = JSON.stringify(files);
	return {
		hash: createHash("sha256").update(json).digest("hex"),
		payload: gzipSync(json).toString("base64"),
	};
}
