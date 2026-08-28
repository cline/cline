/**
 * Machine-checked package boundaries (Gateway RFC dependency rules).
 *
 * `@cline/bot` never imports Gateway implementations (`@cline/gateway`),
 * never depends on `@cline/core`, and — since the Gateway is the only
 * new-path writer — never opens SQLite, watches files, exposes sockets,
 * or spawns processes. Everything stateful arrives through ports.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(import.meta.dirname, ".");
const PACKAGE_JSON = join(import.meta.dirname, "..", "package.json");

const FORBIDDEN_IMPORTS: readonly { pattern: RegExp; why: string }[] = [
	{
		pattern: /^@cline\/gateway(\/|$)/,
		why: "bot never imports Gateway implementations",
	},
	{
		pattern: /^@cline\/core(\/|$)/,
		why: "no new package depends on @cline/core",
	},
	{
		pattern: /^(node:)?fs(\/|$)/,
		why: "no file watching / direct file access",
	},
	{ pattern: /^(bun:)?sqlite$/, why: "bot never opens SQLite" },
	{ pattern: /^better-sqlite3$/, why: "bot never opens SQLite" },
	{ pattern: /^(node:)?net$/, why: "no sockets" },
	{ pattern: /^(node:)?tls$/, why: "no sockets" },
	{ pattern: /^(node:)?dgram$/, why: "no sockets" },
	{ pattern: /^(node:)?http2?$/, why: "no listeners" },
	{ pattern: /^(node:)?https$/, why: "no listeners" },
	{ pattern: /^ws$/, why: "no sockets" },
	{ pattern: /^(node:)?child_process$/, why: "no unsupervised children" },
	{ pattern: /^(node:)?cluster$/, why: "no daemons" },
	{ pattern: /^(node:)?worker_threads$/, why: "no daemons" },
];

function listSourceFiles(): string[] {
	return readdirSync(SRC_DIR)
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.map((name) => join(SRC_DIR, name));
}

function extractImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const patterns = [
		/from\s+["']([^"']+)["']/g,
		/import\s+["']([^"']+)["']/g,
		/import\s*\(\s*["']([^"']+)["']\s*\)/g,
		/require\s*\(\s*["']([^"']+)["']\s*\)/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) {
			specifiers.push(match[1]);
		}
	}
	return specifiers;
}

describe("@cline/bot boundaries", () => {
	it("source files import no gateway/core, storage, socket, or process code", () => {
		const files = listSourceFiles();
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const specifiers = extractImportSpecifiers(readFileSync(file, "utf8"));
			for (const specifier of specifiers) {
				for (const { pattern, why } of FORBIDDEN_IMPORTS) {
					expect(
						pattern.test(specifier),
						`${file} imports "${specifier}" (${why})`,
					).toBe(false);
				}
			}
		}
	});

	it("package.json declares no dependency on @cline/core or @cline/gateway", () => {
		const manifest = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
			peerDependencies?: Record<string, string>;
		};
		const declared = [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.devDependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
		];
		expect(declared).not.toContain("@cline/core");
		expect(declared).not.toContain("@cline/gateway");
		// The dependency direction bot -> engine is allowed and expected.
		expect(declared).toContain("@cline/engine");
	});
});
