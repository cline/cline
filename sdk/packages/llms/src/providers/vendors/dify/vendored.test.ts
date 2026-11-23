import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here).filter(
	(file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
);
const llmsManifest = JSON.parse(
	readFileSync(join(here, "../../../../package.json"), "utf8"),
) as { dependencies?: Record<string, string> };

// The Dify provider is vendored so @cline/llms does not depend on
// dify-ai-provider, whose @ai-sdk/provider-utils@3 dependency installs
// undici@5.29.0 in every published consumer (CVE-2026-1525 and others; the
// 5.x line has no patched release). These guards keep the old path closed.
describe("vendored Dify provider", () => {
	it("is not a dependency of @cline/llms", () => {
		expect(llmsManifest.dependencies).not.toHaveProperty("dify-ai-provider");
	});

	it("imports only the AI SDK packages @cline/llms already ships", () => {
		const imports = new Set<string>();
		for (const file of sources) {
			const text = readFileSync(join(here, file), "utf8");
			for (const match of text.matchAll(/from\s+"([^"./][^"]*)"/g)) {
				imports.add(match[1]);
			}
		}
		expect([...imports].sort()).toEqual([
			"@ai-sdk/provider",
			"@ai-sdk/provider-utils",
			"zod",
		]);
		for (const name of imports) {
			expect(llmsManifest.dependencies).toHaveProperty(name);
		}
	});

	it("keeps the upstream MIT license and attribution", () => {
		expect(readFileSync(join(here, "LICENSE"), "utf8")).toContain(
			"Copyright (c) 2024 Oscar Jiang",
		);
		for (const file of sources.filter((name) => name !== "index.ts")) {
			expect(readFileSync(join(here, file), "utf8")).toMatch(
				/^\/\*![\s\S]*dify-ai-provider v1\.1\.1[\s\S]*MIT/,
			);
		}
	});
});
