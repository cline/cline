/**
 * Cross-package dependency rules of the Gateway RFC, machine-checked:
 *
 *     gateway -> bot -> engine -> agents -> llms -> shared
 *
 * - Engine never imports bot or Gateway types.
 * - Bot never imports Gateway implementations.
 * - No new package (engine, bot, gateway) depends on `@cline/core`.
 * - `@cline/core` is untouched: it gains no dependency on the new packages.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGES_DIR = join(import.meta.dirname, "..", "..");

function sourceFiles(packageName: string): string[] {
	const dir = join(PACKAGES_DIR, packageName, "src");
	return readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
		.map((name) => join(dir, name));
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

function assertNeverImports(
	packageName: string,
	forbidden: readonly RegExp[],
): void {
	const files = sourceFiles(packageName);
	expect(files.length).toBeGreaterThan(0);
	for (const file of files) {
		for (const specifier of importsOf(file)) {
			for (const pattern of forbidden) {
				expect(
					pattern.test(specifier),
					`${file} imports "${specifier}" which violates the Gateway RFC dependency rules`,
				).toBe(false);
			}
		}
	}
}

function dependenciesOf(packageName: string): string[] {
	const manifest = JSON.parse(
		readFileSync(join(PACKAGES_DIR, packageName, "package.json"), "utf8"),
	) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
		peerDependencies?: Record<string, string>;
	};
	return [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.devDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
	];
}

describe("Gateway RFC dependency direction", () => {
	it("engine never imports bot or Gateway types", () => {
		assertNeverImports("engine", [
			/^@cline\/bot(\/|$)/,
			/^@cline\/gateway(\/|$)/,
		]);
	});

	it("bot never imports Gateway implementations", () => {
		assertNeverImports("bot", [/^@cline\/gateway(\/|$)/]);
	});

	it("no new package imports or depends on @cline/core", () => {
		for (const packageName of ["engine", "bot", "gateway"]) {
			assertNeverImports(packageName, [/^@cline\/core(\/|$)/]);
			expect(
				dependenciesOf(packageName),
				`${packageName} must not depend on @cline/core`,
			).not.toContain("@cline/core");
		}
	});

	it("declared dependencies only point down the stack", () => {
		expect(dependenciesOf("engine")).not.toContain("@cline/bot");
		expect(dependenciesOf("engine")).not.toContain("@cline/gateway");
		expect(dependenciesOf("bot")).not.toContain("@cline/gateway");
	});

	it("@cline/core gains no dependency on the new packages (core untouched)", () => {
		const coreDependencies = dependenciesOf("core");
		expect(coreDependencies).not.toContain("@cline/engine");
		expect(coreDependencies).not.toContain("@cline/bot");
		expect(coreDependencies).not.toContain("@cline/gateway");
	});

	it("there is no implicit in-process fallback anywhere in the new packages", () => {
		// The only sanctioned fallback value is the literal "none" in the
		// shared connect policy; no new-package source mentions an in-process
		// fallback path.
		for (const packageName of ["engine", "bot", "gateway"]) {
			for (const file of sourceFiles(packageName)) {
				const source = readFileSync(file, "utf8");
				expect(
					/fallback\s*[:=]\s*["'](?!none)/.test(source),
					`${file} defines a non-"none" fallback`,
				).toBe(false);
			}
		}
	});
});
