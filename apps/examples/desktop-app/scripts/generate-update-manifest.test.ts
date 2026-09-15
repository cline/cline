import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildUpdateManifest } from "./generate-update-manifest";

const makeUniversalArtifactDir = (): string => {
	const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
	writeFileSync(path.join(dir, "Cline-Code_0.1.0_universal.app.tar.gz"), "tar");
	writeFileSync(
		path.join(dir, "Cline-Code_0.1.0_universal.app.tar.gz.sig"),
		"sig-universal\n",
	);
	writeFileSync(path.join(dir, "Cline-Code_0.1.0_universal.dmg"), "dmg");
	return dir;
};

const makePerArchArtifactDir = (): string => {
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

// Mirrors how the Tauri bundler names Linux artifacts: `amd64` for the
// AppImage and deb, and the RPM's own `x86_64` release token.
const makeLinuxArtifactDir = (): string => {
	const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
	const artifacts = [
		["Cline_0.1.0_amd64.AppImage.tar.gz", "sig-appimage"],
		["Cline_0.1.0_amd64.deb", "sig-deb"],
		["Cline-0.1.0-1.x86_64.rpm", "sig-rpm"],
	] as const;
	for (const [name, signature] of artifacts) {
		writeFileSync(path.join(dir, name), "payload");
		writeFileSync(path.join(dir, `${name}.sig`), `${signature}\n`);
	}
	return dir;
};

describe("buildUpdateManifest", () => {
	test("maps a universal artifact to both darwin platform entries", () => {
		const dir = makeUniversalArtifactDir();
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir,
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});

		expect(manifest.version).toBe("0.1.0");
		const universalEntry = {
			signature: "sig-universal",
			url: "https://github.com/cline/cline/releases/download/desktop-v0.1.0/Cline-Code_0.1.0_universal.app.tar.gz",
		};
		expect(manifest.platforms["darwin-aarch64"]).toEqual(universalEntry);
		expect(manifest.platforms["darwin-x86_64"]).toEqual(universalEntry);
		// The DMG is a first-install artifact, not an updater artifact.
		expect(Object.keys(manifest.platforms)).toHaveLength(2);
	});

	test("maps per-arch updater artifacts to darwin platform entries", () => {
		const dir = makePerArchArtifactDir();
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
		expect(Object.keys(manifest.platforms)).toHaveLength(2);
	});

	test("maps a Windows NSIS setup artifact to windows-x86_64", () => {
		const dir = makeUniversalArtifactDir();
		writeFileSync(path.join(dir, "Cline-Code_0.1.0_x64-setup.exe"), "nsis");
		writeFileSync(
			path.join(dir, "Cline-Code_0.1.0_x64-setup.exe.sig"),
			"sig-windows-x64\n",
		);
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir,
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});

		expect(manifest.platforms["windows-x86_64"]).toEqual({
			signature: "sig-windows-x64",
			url: "https://github.com/cline/cline/releases/download/desktop-v0.1.0/Cline-Code_0.1.0_x64-setup.exe",
		});
		// darwin entries from the universal artifact are unaffected.
		expect(Object.keys(manifest.platforms).sort()).toEqual([
			"darwin-aarch64",
			"darwin-x86_64",
			"windows-x86_64",
		]);
	});

	test("ignores non-updater exe files without a setup arch suffix", () => {
		const dir = makeUniversalArtifactDir();
		writeFileSync(path.join(dir, "Cline-Code_0.1.0_x64.exe"), "exe");
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir,
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});
		expect(Object.keys(manifest.platforms).sort()).toEqual([
			"darwin-aarch64",
			"darwin-x86_64",
		]);
	});

	test("maps Linux packages to their installer-specific platform entries", () => {
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir: makeLinuxArtifactDir(),
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});

		const asset = (name: string) => ({
			url: `https://github.com/cline/cline/releases/download/desktop-v0.1.0/${name}`,
		});
		// A Linux install asks for its own package's key, so a deb or rpm copy
		// has to find an entry for the format it came from. The AppImage also
		// owns the bare key, which is what the updater falls back to.
		expect(manifest.platforms["linux-x86_64"]).toEqual({
			...asset("Cline_0.1.0_amd64.AppImage.tar.gz"),
			signature: "sig-appimage",
		});
		expect(manifest.platforms["linux-x86_64-appimage"]).toEqual({
			...asset("Cline_0.1.0_amd64.AppImage.tar.gz"),
			signature: "sig-appimage",
		});
		expect(manifest.platforms["linux-x86_64-deb"]).toEqual({
			...asset("Cline_0.1.0_amd64.deb"),
			signature: "sig-deb",
		});
		expect(manifest.platforms["linux-x86_64-rpm"]).toEqual({
			...asset("Cline-0.1.0-1.x86_64.rpm"),
			signature: "sig-rpm",
		});
		expect(Object.keys(manifest.platforms)).toHaveLength(4);
	});

	test("maps a Linux aarch64 artifact to the aarch64 platform keys", () => {
		const dir = mkdtempSync(path.join(tmpdir(), "update-manifest-"));
		writeFileSync(path.join(dir, "Cline_0.1.0_aarch64.AppImage.tar.gz"), "tar");
		writeFileSync(
			path.join(dir, "Cline_0.1.0_aarch64.AppImage.tar.gz.sig"),
			"sig-aarch64-appimage\n",
		);
		const manifest = buildUpdateManifest({
			version: "0.1.0",
			tag: "desktop-v0.1.0",
			dir,
			repo: "cline/cline",
			notes: "notes",
			pubDate: "2026-07-21T00:00:00.000Z",
		});

		expect(Object.keys(manifest.platforms).sort()).toEqual([
			"linux-aarch64",
			"linux-aarch64-appimage",
		]);
	});

	test("throws when a Windows setup artifact is missing its signature", () => {
		const dir = makeUniversalArtifactDir();
		writeFileSync(path.join(dir, "Cline-Code_0.1.0_x64-setup.exe"), "nsis");
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

	test("throws when universal and per-arch artifacts claim the same platform", () => {
		const dir = makePerArchArtifactDir();
		writeFileSync(
			path.join(dir, "Cline-Code_0.1.0_universal.app.tar.gz"),
			"tar",
		);
		writeFileSync(
			path.join(dir, "Cline-Code_0.1.0_universal.app.tar.gz.sig"),
			"sig-universal\n",
		);
		expect(() =>
			buildUpdateManifest({
				version: "0.1.0",
				tag: "desktop-v0.1.0",
				dir,
				repo: "cline/cline",
				notes: "notes",
				pubDate: "2026-07-21T00:00:00.000Z",
			}),
		).toThrow(/multiple updater artifacts/);
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
