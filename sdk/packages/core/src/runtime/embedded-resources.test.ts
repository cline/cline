import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
	materializeEmbeddedResources,
	packEmbeddedResources,
} from "./embedded-resources";

const roots: string[] = [];
function temporaryRoot() {
	const root = mkdtempSync(join(tmpdir(), "cline-resources-"));
	roots.push(root);
	return root;
}
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

it("preserves binary assets and repairs damaged cached files", () => {
	const bytes = Buffer.from([0, 255, 128, 10]);
	const resources = packEmbeddedResources({
		"assets/font.bin": bytes.toString("base64"),
	});
	const root = temporaryRoot();
	const directory = materializeEmbeddedResources(resources, root);
	expect(readFileSync(join(directory, "assets/font.bin"))).toEqual(bytes);
	writeFileSync(join(directory, "assets/font.bin"), "broken");
	expect(materializeEmbeddedResources(resources, root)).toBe(directory);
	expect(readFileSync(join(directory, "assets/font.bin"))).toEqual(bytes);
});

it("retains the previous build when a new build is materialized", () => {
	const root = temporaryRoot();
	const oldDirectory = materializeEmbeddedResources(
		packEmbeddedResources({
			"index.js": Buffer.from("old").toString("base64"),
		}),
		root,
	);
	const newDirectory = materializeEmbeddedResources(
		packEmbeddedResources({
			"index.js": Buffer.from("new").toString("base64"),
		}),
		root,
	);
	expect(oldDirectory).not.toBe(newDirectory);
	expect(readFileSync(join(oldDirectory, "index.js"), "utf8")).toBe("old");
});

it("rejects a mismatched archive checksum", () => {
	const resources = packEmbeddedResources({ "index.js": "" });
	expect(() =>
		materializeEmbeddedResources(
			{ ...resources, hash: "0".repeat(64) },
			temporaryRoot(),
		),
	).toThrow("checksum");
});

it.each([
	"../outside",
	"/absolute",
	"C:/absolute",
	"..\\outside",
	"a/../outside",
])("rejects resource path %s", (name) => {
	expect(() =>
		materializeEmbeddedResources(
			packEmbeddedResources({ [name]: "" }),
			temporaryRoot(),
		),
	).toThrow("resource path");
});
