import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NoticeEntry } from "./index";

// bun-runtime/LICENSE.md is Bun's own notice at this tag; COPYING.LIB is JavaScriptCore's
// LGPL-2.0 text from oven-sh/WebKit. Refresh both when the repo's Bun version changes.
const VENDORED_BUN_VERSION = "1.4.2";

function read(file: string): string {
	return readFileSync(
		join(import.meta.dirname, "bun-runtime", file),
		"utf8",
	).trim();
}

/** Notices for the Bun runtime that `bun build --compile` embeds in every executable. */
export function bunRuntimeEntries(product: string): NoticeEntry[] {
	if (Bun.version !== VENDORED_BUN_VERSION) {
		throw new Error(
			`[third-party-notices] building with Bun ${Bun.version}, but the vendored Bun notices are for ${VENDORED_BUN_VERSION}; update scripts/third-party-notices/bun-runtime/`,
		);
	}
	const webkit = process.versions.webkit;
	const webkitSource = `https://github.com/oven-sh/WebKit/tree/${webkit}`;
	return [
		{
			name: "Bun",
			version: Bun.version,
			license: "MIT",
			repository: `https://github.com/oven-sh/bun/tree/bun-v${Bun.version}`,
			texts: [{ file: "LICENSE.md", content: read("LICENSE.md") }],
		},
		{
			name: "JavaScriptCore (WebKit, as patched by Bun)",
			version: webkit,
			license: "LGPL-2.0",
			repository: webkitSource,
			texts: [
				{
					file: "Corresponding source",
					content: [
						`${product} is built with Bun ${Bun.version}, which statically links JavaScriptCore`,
						`and WebCore from WebKit. These libraries are licensed under the GNU Library`,
						`General Public License, version 2 (reproduced below).`,
						``,
						`The complete corresponding source code for the exact version included is`,
						`available at:`,
						``,
						`  ${webkitSource}`,
						``,
						`The Bun source code, including the bindings that link against JavaScriptCore`,
						`and instructions for rebuilding and relinking it, is available at:`,
						``,
						`  https://github.com/oven-sh/bun/tree/bun-v${Bun.version}`,
					].join("\n"),
				},
				{ file: "COPYING.LIB", content: read("COPYING.LIB") },
			],
		},
	];
}
