import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";

let directory: Promise<string> | undefined;

/** Build once per platform-build invocation; the compiler embeds this tree unchanged. */
export function buildDashboardRuntimeDirectory(): Promise<string> {
	directory ??= buildDirectory();
	return directory;
}

async function buildDirectory(): Promise<string> {
	const root = resolve(import.meta.dir, "../../..");
	await $`bun -F @cline/cline-hub build:webview`.cwd(root).quiet();
	const directory = join(root, "apps/cline-hub/dist/webview");
	if (!existsSync(join(directory, "index.html")))
		throw new Error("Dashboard build produced no index.html");
	return directory;
}
