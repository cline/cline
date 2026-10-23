import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
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

/** Packages the published graph is allowed to import. */
const ALLOWED_EXTERNAL = [
	"@noble/ciphers/chacha.js",
	"@noble/curves/ed25519.js",
	"@noble/hashes/hmac.js",
	"@noble/hashes/sha2.js",
];

/**
 * Mirrors tsconfig.build.json's exclusions: `*.test.ts` and anything under
 * `__tests__/` is not published, so it is not part of the graph under test.
 */
function listPublishedSources(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__") {
				continue;
			}
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

	it("excludes test-only helpers from the published graph", () => {
		expect(
			files.filter((file) => file.includes(`${sep}__tests__${sep}`)),
		).toEqual([]);
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

	it("only depends on audited pure-JS @noble packages", () => {
		const external = new Set<string>();
		for (const file of files) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				if (specifier.startsWith(".") || specifier.startsWith("/")) {
					continue;
				}
				external.add(specifier);
			}
		}
		expect([...external].sort()).toEqual(ALLOWED_EXTERNAL);
	});

	it("pulls in no WebAssembly, which Hermes cannot run", () => {
		const offenders: string[] = [];
		for (const file of files) {
			const source = stripComments(readFileSync(file, "utf8"));
			if (/WebAssembly|\.wasm\b/.test(source)) {
				offenders.push(file);
			}
		}
		expect(offenders).toEqual([]);
	});
});

/**
 * Our own sources being clean is only half the claim: whatever `@noble` pulls in
 * ships to React Native too. This walks the transitive graph of the four entry
 * points we import and holds it to the same bar, so a dependency bump that adds
 * a `node:crypto` import cannot slip through unnoticed.
 */
describe("@noble transitive graph", () => {
	const require_ = createRequire(join(SRC_DIR, "no-node-builtins.test.ts"));

	function walk(entry: string): string[] {
		const seen = new Set<string>();
		const queue = [entry];
		while (queue.length > 0) {
			const current = queue.pop() as string;
			if (seen.has(current)) {
				continue;
			}
			seen.add(current);
			for (const specifier of specifiersIn(readFileSync(current, "utf8"))) {
				// @noble refers to its own modules by package-relative specifiers, so
				// those are followed; anything else is reported by the assertion below
				// rather than walked.
				if (!specifier.startsWith(".") && !specifier.startsWith("@noble/")) {
					continue;
				}
				queue.push(require_.resolve(specifier, { paths: [dirname(current)] }));
			}
		}
		return [...seen];
	}

	const graph = ALLOWED_EXTERNAL.flatMap((entry) =>
		walk(require_.resolve(entry)),
	);

	it("resolves a non-trivial graph", () => {
		expect(new Set(graph).size).toBeGreaterThan(4);
	});

	it("imports nothing outside @noble, least of all a node builtin", () => {
		const offenders: string[] = [];
		for (const file of new Set(graph)) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				if (specifier.startsWith(".") || specifier.startsWith("@noble/")) {
					continue;
				}
				offenders.push(`${file} -> ${specifier}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("references no node-only globals and no WebAssembly", () => {
		const offenders: string[] = [];
		for (const file of new Set(graph)) {
			const source = stripComments(readFileSync(file, "utf8"));
			for (const forbidden of [
				/\bBuffer\b/,
				/\bprocess\.(env|cwd|platform)\b/,
				/\b__dirname\b/,
				/\b__filename\b/,
				/WebAssembly|\.wasm\b/,
			]) {
				if (forbidden.test(source)) {
					offenders.push(`${file} -> ${forbidden.source}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
