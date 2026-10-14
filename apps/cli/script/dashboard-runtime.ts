import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type EmbeddedResources, packEmbeddedResources } from "@cline/core";
import { $ } from "bun";

let resources: Promise<EmbeddedResources> | undefined;

/** Build the dashboard once per platform-build invocation and include every static asset. */
export function buildDashboardRuntimeResources(): Promise<EmbeddedResources> {
	resources ??= buildResources();
	return resources;
}

async function buildResources(): Promise<EmbeddedResources> {
	const root = resolve(import.meta.dir, "../../..");
	await $`bun -F @cline/cline-hub build:webview`.cwd(root).quiet();
	const directory = join(root, "apps/cline-hub/dist/webview");
	const files: Record<string, string> = {};
	function collect(relative = "") {
		for (const entry of readdirSync(join(directory, relative), {
			withFileTypes: true,
		})) {
			const name = relative + entry.name;
			if (entry.isDirectory()) collect(`${name}/`);
			else if (entry.isFile())
				files[name] = readFileSync(join(directory, name)).toString("base64");
		}
	}
	collect();
	if (!files["index.html"])
		throw new Error("Dashboard build produced no index.html");
	return packEmbeddedResources(files);
}
