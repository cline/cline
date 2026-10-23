/**
 * The `@cline/hub-testkit/replay` entry point is imported by browser/jsdom UI
 * tests, so its module graph must stay free of node builtins and of the node-only
 * hub harness. Without this guard it is very easy to reintroduce `node:fs` by
 * re-exporting a fixture helper from the filesystem layer.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPLAY_ENTRY = join(SRC_DIR, "replay.ts");

const IMPORT_PATTERN =
	/(?:^|[\s;])(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const NODE_BUILTINS = new Set([
	"assert",
	"buffer",
	"child_process",
	"crypto",
	"fs",
	"fs/promises",
	"http",
	"https",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"stream",
	"timers",
	"tls",
	"url",
	"util",
	"worker_threads",
	"zlib",
]);

function specifiersIn(source: string): string[] {
	const found: string[] = [];
	for (const match of source.matchAll(IMPORT_PATTERN)) {
		const specifier = match[1] ?? match[2] ?? match[3];
		if (specifier) {
			found.push(specifier);
		}
	}
	return found;
}

/** Transitive closure of relative imports reachable from `entry`. */
function moduleGraph(entry: string): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	const queue = [entry];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (graph.has(file)) {
			continue;
		}
		const specifiers = specifiersIn(readFileSync(file, "utf8"));
		graph.set(file, specifiers);
		for (const specifier of specifiers) {
			if (!specifier.startsWith(".")) {
				continue;
			}
			const resolved = resolve(dirname(file), `${specifier}.ts`);
			queue.push(resolved);
		}
	}
	return graph;
}

describe("replay entry point portability", () => {
	const graph = moduleGraph(REPLAY_ENTRY);

	it("reaches more than just the entry file", () => {
		expect(graph.size).toBeGreaterThan(1);
	});

	it("imports no node builtins", () => {
		const offenders: string[] = [];
		for (const [file, specifiers] of graph) {
			for (const specifier of specifiers) {
				const bare = specifier.replace(/^node:/, "");
				if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
					offenders.push(`${file} -> ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("does not depend on the node-only harness or on @cline/core", () => {
		const offenders: string[] = [];
		for (const [file, specifiers] of graph) {
			for (const specifier of specifiers) {
				if (
					specifier.startsWith("@cline/core") ||
					/\.\/(test-hub|recorder|fixture|verify-fixture|scripted-runtime-host)$/.test(
						specifier,
					)
				) {
					offenders.push(`${file} -> ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("references no node-only globals", () => {
		const offenders: string[] = [];
		for (const file of graph.keys()) {
			const source = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/\/\/[^\n]*/g, "");
			for (const forbidden of [
				/\bBuffer\b/,
				/\bprocess\.(env|cwd|platform)\b/,
				/\b__dirname\b/,
				/\bsetImmediate\b/,
			]) {
				if (forbidden.test(source)) {
					offenders.push(`${file} -> ${forbidden.source}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
