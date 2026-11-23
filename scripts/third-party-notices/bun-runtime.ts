import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NoticeEntry } from "./index";

// notices.json covers Bun and everything it links or embeds (see update-bun-runtime.ts);
// COPYING.LIB is JavaScriptCore's LGPL-2.0 text from oven-sh/WebKit.
function read(file: string): string {
	return readFileSync(
		join(import.meta.dirname, "bun-runtime", file),
		"utf8",
	).trim();
}

/** Notices for the Bun runtime that `bun build --compile` embeds in every executable. */
export function bunRuntimeEntries(product: string): NoticeEntry[] {
	const vendored = JSON.parse(read("notices.json")) as {
		bunVersion: string;
		entries: NoticeEntry[];
	};
	if (Bun.version !== vendored.bunVersion) {
		throw new Error(
			`[third-party-notices] building with Bun ${Bun.version}, but the Bun runtime notices are for ${vendored.bunVersion}; run bun scripts/third-party-notices/update-bun-runtime.ts`,
		);
	}
	const [bun, ...bundled] = vendored.entries;
	const webkit = process.versions.webkit;
	// The LGPL source link must name the exact commit; never ship it blank.
	if (!webkit)
		throw new Error(
			"[third-party-notices] Bun did not report its WebKit commit",
		);
	const webkitSource = `https://github.com/oven-sh/WebKit/tree/${webkit}`;
	return [
		bun,
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
		...bundled,
	];
}
