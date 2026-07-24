import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("file index worker process lifetime", () => {
	it("settles a foreground mention lookup that shares an unref'ed prewarm", async () => {
		const cwd = await mkdtemp(
			path.join(os.tmpdir(), "core-file-index-process-"),
		);
		try {
			await writeFile(path.join(cwd, "README.md"), "# Demo\n", "utf8");
			const moduleUrl = new URL("./mention-enricher.ts", import.meta.url).href;
			const script = `
				import { enrichPromptWithMentions } from ${JSON.stringify(moduleUrl)};
				import { prewarmFileIndex } from ${JSON.stringify(new URL("./file-indexer.ts", import.meta.url).href)};
				void prewarmFileIndex(process.cwd());
				const result = await enrichPromptWithMentions("Inspect @README.md", process.cwd());
				process.stdout.write(JSON.stringify({ mentions: result.mentions, matchedFiles: result.matchedFiles }));
			`;

			const stdout = execFileSync("bun", ["--eval", script], {
				cwd,
				encoding: "utf8",
				timeout: 5_000,
			});

			expect(JSON.parse(stdout)).toEqual({
				mentions: ["README.md"],
				matchedFiles: ["README.md"],
			});
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
