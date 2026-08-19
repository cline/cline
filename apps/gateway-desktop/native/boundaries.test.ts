/**
 * Machine-checked process boundaries of Gateway Desktop:
 *
 * - The webview imports NO Cline SDK protocol package. The single
 *   allowed exception is `@cline/ui` (presentation-only theme and
 *   components shared with the Cline Code desktop app).
 * - The webview never reads environment variables.
 * - The broker (native/) talks to the Gateway ONLY through
 *   `@cline/gateway/client` and `@cline/shared/gateway` wire contracts —
 *   never `@cline/core`, the Hub, or Gateway server internals.
 * - The shared bridge/projection/error contracts import no SDK package
 *   at all (they are the webview's only typed dependency surface).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(import.meta.dirname, "..");

function sourceFiles(dir: string, extensions: string[]): string[] {
	let names: string[];
	try {
		names = readdirSync(join(APP_ROOT, dir), {
			recursive: true,
			encoding: "utf8",
		});
	} catch {
		return [];
	}
	return names
		.filter(
			(name) =>
				extensions.some((extension) => name.endsWith(extension)) &&
				!name.includes("node_modules") &&
				!name.includes(".next"),
		)
		.map((name) => join(APP_ROOT, dir, name));
}

function importsOf(file: string): string[] {
	const source = readFileSync(file, "utf8");
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

describe("webview boundary", () => {
	const files = sourceFiles("webview", [".ts", ".tsx"]);

	it("has webview sources to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it("imports no Cline SDK protocol package (only @cline/ui allowed)", () => {
		for (const file of files) {
			for (const specifier of importsOf(file)) {
				if (specifier.startsWith("@cline/")) {
					expect(
						specifier === "@cline/ui" || specifier.startsWith("@cline/ui/"),
						`${file} imports "${specifier}" — the webview may only use the presentation package @cline/ui`,
					).toBe(true);
				}
				expect(
					specifier.includes("sdk/packages"),
					`${file} imports "${specifier}" which reaches into sdk/packages`,
				).toBe(false);
				expect(
					/^\.\.?\/.*native\//.test(specifier),
					`${file} imports broker code "${specifier}"`,
				).toBe(false);
			}
		}
	});

	it("never reads environment variables", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(
				/process\.env/.test(source),
				`${file} reads process.env — the webview must not consume env vars`,
			).toBe(false);
		}
	});

	it("never renders raw HTML from model or tool output", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(
				/dangerouslySetInnerHTML/.test(source),
				`${file} uses dangerouslySetInnerHTML`,
			).toBe(false);
		}
	});
});

describe("broker boundary", () => {
	const files = [
		...sourceFiles("native", [".ts"]),
		...sourceFiles("e2e", [".ts"]),
	];

	it("never imports @cline/core, the Hub, or app UIs", () => {
		for (const file of files) {
			for (const specifier of importsOf(file)) {
				for (const forbidden of [
					/^@cline\/core(\/|$)/,
					/^@cline\/sdk(\/|$)/,
					/^@cline\/cline-hub(\/|$)/,
					/^@cline\/ui(\/|$)/,
					/^next(\/|$)/,
					/^react(\/|$)/,
				]) {
					expect(
						forbidden.test(specifier),
						`${file} imports "${specifier}" which violates the broker boundary`,
					).toBe(false);
				}
			}
		}
	});

	it("uses only the supported Gateway client entrypoints (production code)", () => {
		for (const file of files) {
			if (
				file.includes(`${join("native", "testing")}`) ||
				file.endsWith(".test.ts") ||
				file.includes(`${join(APP_ROOT, "e2e")}`)
			) {
				// Test harnesses may run a real in-process Gateway server.
				continue;
			}
			for (const specifier of importsOf(file)) {
				if (specifier.startsWith("@cline/gateway")) {
					expect(
						specifier === "@cline/gateway/client",
						`${file} imports "${specifier}" — production broker code may only use @cline/gateway/client`,
					).toBe(true);
				}
			}
		}
	});
});

describe("shared contract boundary", () => {
	it("shared bridge/projection/errors import no SDK package", () => {
		for (const file of sourceFiles("shared", [".ts"])) {
			for (const specifier of importsOf(file)) {
				expect(
					specifier.startsWith("@cline/"),
					`${file} imports "${specifier}" — shared contracts must stay SDK-free`,
				).toBe(false);
			}
		}
	});
});

describe("projection safety", () => {
	it("fixture projections contain no filesystem paths or secrets", async () => {
		const { FIXTURE_PROJECTIONS } = await import("../shared/fixtures");
		for (const [name, factory] of Object.entries(FIXTURE_PROJECTIONS)) {
			const serialized = JSON.stringify(factory());
			for (const pattern of [
				/\/Users\//,
				/\/home\//,
				/"secret"/i,
				/"auth"/,
				/"token"/i,
				/"rootPath"/,
			]) {
				expect(
					pattern.test(serialized),
					`fixture ${name} leaks ${pattern}`,
				).toBe(false);
			}
		}
	});
});
