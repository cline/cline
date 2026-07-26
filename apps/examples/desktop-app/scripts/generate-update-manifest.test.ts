import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildUpdateManifest } from "./generate-update-manifest";

const makeArtifactDir = (): string => {
	const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
	writeFileSync(path.join(dir, "Cline-Code_0.1.0_aarch64.app.tar.gz"), "tar");
	writeFileSync(
		path.join(dir, "Cline-Code_0.1.0_aarch64.app.tar.gz.sig"),
		"sig-aarch64\n",
	);
	writeFileSync(path.join(dir, "Cline-Code_0.1.0_x86_64.app.tar.gz"), "tar");
	writeFileSync(
		path.join(dir, "Cline-Code_0.1.0_x86_64.app.tar.gz.sig"),
		"sig-x86_64\n",
	);
	writeFileSync(path.join(dir, "Cline-Code_0.1.0_aarch64.dmg"), "dmg");
	return dir;
};

describe("buildUpdateManifest", () => {
	test("maps updater artifacts to darwin platform entries", () => {
		const dir = makeArtifactDir();
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir,
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});

		expect(manifest.version).toBe("0.1.0");
		expect(manifest.platforms["darwin-aarch64"]).toEqual({
			signature: "sig-aarch64",
			url: "https://github.com/cline/cline/releases/download/desktop-v0.1.0/Cline-Code_0.1.0_aarch64.app.tar.gz",
		});
		expect(manifest.platforms["darwin-x86_64"]).toEqual({
			signature: "sig-x86_64",
			url: "https://github.com/cline/cline/releases/download/desktop-v0.1.0/Cline-Code_0.1.0_x86_64.app.tar.gz",
		});
		// The DMG is a first-install artifact, not an updater artifact.
		expect(Object.keys(manifest.platforms)).toHaveLength(2);
	});

	test("throws when a signature file is missing", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
		writeFileSync(path.join(dir, "Cline-Code_0.1.0_aarch64.app.tar.gz"), "tar");
		expect(() =>
			buildUpdateManifest({
				version: "0.1.0",
				tag: "desktop-v0.1.0",
				dir,
				repo: "cline/cline",
				notes: "notes",
				pubDate: "2026-07-21T00:00:00.000Z",
			}),
		).toThrow();
	});

	test("throws when no updater artifacts exist", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
		writeFileSync(path.join(dir, "Cline-Code_0.1.0_aarch64.dmg"), "dmg");
		expect(() =>
			buildUpdateManifest({
				version: "0.1.0",
				tag: "desktop-v0.1.0",
				dir,
				repo: "cline/cline",
				notes: "notes",
				pubDate: "2026-07-21T00:00:00.000Z",
			}),
		).toThrow(/no updater artifacts/);
	});
});
