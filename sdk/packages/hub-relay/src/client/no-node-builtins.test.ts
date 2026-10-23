/**
 * The RN-facing entry (`@cline/hub-relay/client`) must be importable under
 * Hermes. Metro will happily bundle `node:net` and then explode at runtime, so
 * walk the entry's transitive import graph and assert it is free of node builtins,
 * node-only globals and external packages.
 *
 * Copied from `@cline/hub-client`'s `no-node-builtins.test.ts` and extended to a
 * graph walk, because this package deliberately DOES contain node-only modules
 * (`src/server`, `src/host`) — a flat directory scan would be meaningless here.
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RN_ENTRY = fileURLToPath(new URL("./index.ts", import.meta.url));

const IMPORT_PATTERN =
	/(?:^|[\s;])(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

const NODE_BUILTINS = new Set([
	"assert",
	"buffer",
	"child_process",
	"crypto",
	"dns",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"querystring",
	"readline",
	"stream",
	"timers",
	"tls",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"worker_threads",
	"zlib",
]);

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

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

function resolveRelative(fromFile: string, specifier: string): string {
	const base = resolve(dirname(fromFile), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
		try {
			if (statSync(candidate).isFile()) {
				return candidate;
			}
		} catch {
			// try the next shape
		}
	}
	throw new Error(`could not resolve ${specifier} from ${fromFile}`);
}

interface GraphWalk {
	files: string[];
	externals: Set<string>;
	builtins: string[];
}

function walkGraph(entry: string): GraphWalk {
	const seen = new Set<string>();
	const queue = [entry];
	const externals = new Set<string>();
	const builtins: string[] = [];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) {
			continue;
		}
		seen.add(file);
		for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
			const bare = specifier.replace(/^node:/, "");
			if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
				builtins.push(`${file} -> ${specifier}`);
				continue;
			}
			if (specifier.startsWith(".") || specifier.startsWith("/")) {
				queue.push(resolveRelative(file, specifier));
				continue;
			}
			externals.add(specifier);
		}
	}
	return { files: [...seen], externals, builtins };
}

describe("react-native entry graph", () => {
	const graph = walkGraph(RN_ENTRY);

	it("reaches more than just the entry file", () => {
		expect(graph.files.length).toBeGreaterThan(2);
	});

	it("imports no node builtin modules", () => {
		expect(graph.builtins).toEqual([]);
	});

	it("imports no external packages at all", () => {
		expect([...graph.externals].sort()).toEqual([]);
	});

	it("never reaches the node-only server or host modules", () => {
		const nodeOnly = graph.files.filter(
			(file) => file.includes("/server/") || file.includes("/host/"),
		);
		expect(nodeOnly).toEqual([]);
	});

	it("references no node-only globals", () => {
		const offenders: string[] = [];
		for (const file of graph.files) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const forbidden of [
				/\bBuffer\b/,
				/\bprocess\.(env|cwd|platform)\b/,
				/\b__dirname\b/,
				/\b__filename\b/,
			]) {
				if (forbidden.test(source)) {
					offenders.push(`${file} -> ${forbidden.source}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
