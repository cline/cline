import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseChangelog, releaseUrl } from "./changelog";

describe("parseChangelog", () => {
	it("splits versions and bullets, folding continuation lines", () => {
		const releases = parseChangelog(
			[
				"# Cline Desktop Changelog",
				"",
				"## 0.0.2",
				"",
				"- First **bold** change",
				"  continued here",
				"- Second `code` change",
				"",
				"## 0.0.1",
				"",
				"## 0.0.0",
				"",
				"- Initial release",
			].join("\n"),
		);
		expect(releases).toEqual([
			{
				version: "0.0.2",
				notes: [
					"First **bold** change\ncontinued here",
					"Second `code` change",
				],
			},
			{ version: "0.0.0", notes: ["Initial release"] },
		]);
	});

	it("parses the real changelog with the current version first", async () => {
		const markdown = await readFile(
			new URL("../../CHANGELOG.md", import.meta.url),
			"utf8",
		);
		const packageJson = JSON.parse(
			await readFile(new URL("../../package.json", import.meta.url), "utf8"),
		) as { version: string };
		const releases = parseChangelog(markdown);
		expect(releases[0]?.version).toBe(packageJson.version);
		expect(releases[0]?.notes.length).toBeGreaterThan(0);
		expect(releaseUrl(releases[0].version)).toBe(
			`https://github.com/cline/cline/releases/tag/desktop-v${packageJson.version}`,
		);
	});
});
