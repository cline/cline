import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = join(packageRoot, "..");

function readJson(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function listTypeScriptFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = join(root, entry.name);
		return entry.isDirectory()
			? listTypeScriptFiles(path)
			: entry.name.endsWith(".ts")
				? [path]
				: [];
	});
}

describe("Hub package boundary", () => {
	it("keeps the Hub client and lifecycle package independent of Core", () => {
		const imports = listTypeScriptFiles(join(packageRoot, "src"))
			.map((path) => readFileSync(path, "utf8"))
			.join("\n");

		expect(imports).not.toMatch(
			/from ["']@cline\/(?:core|hub-daemon)(?:\/|["'])/,
		);
		const manifest = readJson(join(packageRoot, "package.json"));
		expect(manifest.dependencies).toEqual({ "@cline/shared": "workspace:*" });
	});

	it("keeps the daemon out of the Core public package", () => {
		const core = readJson(join(packagesRoot, "core", "package.json"));
		const exports = core.exports as Record<string, unknown>;
		const dependencies = core.dependencies as Record<string, string>;

		expect(exports["./hub"]).toBeUndefined();
		expect(exports["./hub/daemon-entry"]).toBeUndefined();
		expect(dependencies["@cline/hub"]).toBe("workspace:*");
		expect(dependencies["@cline/hub-daemon"]).toBeUndefined();
	});

	it("puts Core server composition in the standalone daemon package", () => {
		const daemon = readJson(join(packagesRoot, "hub-daemon", "package.json"));
		const dependencies = daemon.dependencies as Record<string, string>;

		expect(dependencies["@cline/core"]).toBe("workspace:*");
		expect(dependencies["@cline/hub"]).toBe("workspace:*");
	});
});
