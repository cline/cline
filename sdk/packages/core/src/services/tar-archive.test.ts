import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarGz, readTarEntries } from "./tar-archive";

describe("tar-archive", () => {
	const roots: string[] = [];
	const makeRoot = (): string => {
		const root = mkdtempSync(join(tmpdir(), "core-tar-archive-"));
		roots.push(root);
		return root;
	};
	afterEach(() => {
		for (const root of roots.splice(0)) {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// Longer than the 100-byte ustar name field so every format has to use
	// its long-name mechanism (ustar prefix, pax `path`, GNU `L`).
	const longDir = `plugins/${"very-long-plugin-directory-name-".repeat(3)}x`;

	function createSourceTree(): string {
		const root = makeRoot();
		const top = join(root, "collection-HEAD");
		mkdirSync(join(top, longDir, "skills"), { recursive: true });
		mkdirSync(join(top, "plugins", "other"), { recursive: true });
		writeFileSync(join(top, longDir, "index.ts"), "export default 1;\n");
		writeFileSync(join(top, longDir, "skills", "SKILL.md"), "# skill\n");
		writeFileSync(join(top, longDir, "run.sh"), "#!/bin/sh\n");
		chmodSync(join(top, longDir, "run.sh"), 0o755);
		writeFileSync(join(top, "plugins", "other", "index.ts"), "other\n");
		symlinkSync("index.ts", join(top, longDir, "link.ts"));
		return root;
	}

	// bsdtar (macOS) and GNU tar both accept these two format names.
	for (const format of ["ustar", "pax"]) {
		it(`reads ${format} archives with long paths and extracts a selection`, () => {
			const source = createSourceTree();
			const archivePath = join(source, "archive.tar.gz");
			execFileSync("tar", [
				`--format=${format}`,
				"-czf",
				archivePath,
				"-C",
				source,
				"collection-HEAD",
			]);
			const archive = readFileSync(archivePath);

			const entries = [...readTarEntries(gunzipSync(archive))];
			const byPath = new Map(entries.map((entry) => [entry.path, entry]));
			expect(byPath.get(`collection-HEAD/${longDir}/index.ts`)?.type).toBe(
				"file",
			);
			expect(byPath.get(`collection-HEAD/${longDir}/link.ts`)?.type).toBe(
				"other",
			);
			expect(byPath.get("collection-HEAD/plugins/other/")?.type).toBe(
				"directory",
			);

			const into = join(makeRoot(), "out");
			const marker = `/${longDir}/`;
			const written = extractTarGz(archive, {
				into,
				select: (path) => {
					const start = path.indexOf(marker);
					return start === -1 ? undefined : path.slice(start + marker.length);
				},
			});
			expect(written).toBe(3);
			expect(readFileSync(join(into, "index.ts"), "utf8")).toBe(
				"export default 1;\n",
			);
			expect(readFileSync(join(into, "skills", "SKILL.md"), "utf8")).toBe(
				"# skill\n",
			);
			expect(statSync(join(into, "run.sh")).mode & 0o111).not.toBe(0);
			expect(existsSync(join(into, "link.ts"))).toBe(false);
			expect(existsSync(join(into, "other"))).toBe(false);
		});
	}

	it("reads GNU long-name headers", () => {
		const longPath = `collection-HEAD/${longDir}/index.ts`;
		const longLink = Buffer.alloc(512);
		longLink.write("././@LongLink", 0);
		longLink.write("0000644\0", 100);
		longLink.write(
			`${(longPath.length + 1).toString(8).padStart(11, "0")}\0`,
			124,
		);
		longLink.write("L", 156);
		const longLinkData = Buffer.alloc(512);
		longLinkData.write(`${longPath}\0`);
		const file = Buffer.alloc(512);
		file.write(longPath.slice(0, 100), 0);
		file.write("0000644\0", 100);
		file.write("00000000003\0", 124);
		file.write("0", 156);
		const fileData = Buffer.alloc(512);
		fileData.write("abc");
		const archive = Buffer.concat([
			longLink,
			longLinkData,
			file,
			fileData,
			Buffer.alloc(1024),
		]);
		const entries = [...readTarEntries(archive)];
		expect(entries).toHaveLength(1);
		expect(entries[0]?.path).toBe(longPath);
		expect(entries[0]?.data.toString()).toBe("abc");
	});

	it("refuses destinations that escape the extraction root", () => {
		const header = Buffer.alloc(512);
		header.write("evil.txt", 0);
		header.write("0000644\0", 100);
		header.write("00000000004\0", 124);
		header.write("0", 156);
		const body = Buffer.alloc(512);
		body.write("evil");
		const archive = gzipSync(Buffer.concat([header, body, Buffer.alloc(1024)]));
		expect(() =>
			extractTarGz(archive, {
				into: makeRoot(),
				select: () => "../escaped.txt",
			}),
		).toThrow(/unsafe archive path/);
	});
});
