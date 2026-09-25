import { describe, expect, it } from "vitest";
import { isBunEmbeddedModulePath } from "./bun-embedded-path";

describe("isBunEmbeddedModulePath", () => {
	it.each([
		"/$bunfs/root/entry.js",
		"/$bunfs/root/cline",
		"B:\\~BUN\\root\\entry.js",
		"B:/~BUN/root/entry.js",
		"b:\\~bun\\root\\entry.js",
		"  B:\\~BUN\\root\\entry.js  ",
	])("detects the embedded path %s", (path) => {
		expect(isBunEmbeddedModulePath(path)).toBe(true);
	});

	it.each([
		undefined,
		"",
		"   ",
		"/usr/local/bin/cline",
		"C:\\Users\\me\\AppData\\Local\\Cline\\code-sidecar.exe",
		"./entry.js",
		"B:\\real-drive\\entry.js",
		"/home/user/$bunfs/root/entry.js",
	])("rejects the ordinary path %s", (path) => {
		expect(isBunEmbeddedModulePath(path)).toBe(false);
	});
});
