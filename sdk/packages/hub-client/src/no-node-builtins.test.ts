import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

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

function listPublishedSources(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listPublishedSources(full));
			continue;
		}
		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
			continue;
		}
		files.push(full);
	}
	return files;
}

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

describe("published source graph", () => {
	const files = listPublishedSources(SRC_DIR);

	it("contains source files to scan", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it("imports no node builtin modules", () => {
		const offenders: string[] = [];
		for (const file of files) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				const bare = specifier.replace(/^node:/, "");
				if (specifier.startsWith("node:") || NODE_BUILTINS.has(bare)) {
					offenders.push(`${file} -> ${specifier}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("references no node-only globals", () => {
		const offenders: string[] = [];
		for (const file of files) {
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

	it("only depends on @cline/shared for external packages", () => {
		const external = new Set<string>();
		for (const file of files) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				if (specifier.startsWith(".") || specifier.startsWith("/")) {
					continue;
				}
				external.add(specifier);
			}
		}
		expect([...external].sort()).toEqual(["@cline/shared"]);
	});
});
