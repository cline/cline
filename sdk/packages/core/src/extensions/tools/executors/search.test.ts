import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MAX_SEARCH_OUTPUT_CHARS } from "./output-limits";
import { createSearchExecutor } from "./search";

const ctx: AgentToolContext = {
	agentId: "agent-1",
	conversationId: "conv-1",
	iteration: 1,
};

describe("createSearchExecutor", () => {
	it("middle-truncates oversized search output with recovery guidance", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-search-"));
		const filePath = path.join(dir, "large.ts");
		// Many matching lines so the joined output exceeds the cap even though
		// each line stays under the per-line truncation limit.
		const rows = Array.from(
			{ length: 200 },
			(_, i) => `needle ${"x".repeat(900)} row-${i}`,
		);
		await fs.writeFile(filePath, rows.join("\n"), "utf-8");

		try {
			const search = createSearchExecutor({ contextLines: 0 });
			// Lookahead is unsupported by ripgrep, forcing the fallback scan.
			const result = await search("(?=needle)", dir, ctx);

			expect(result.length).toBeGreaterThan(MAX_SEARCH_OUTPUT_CHARS);
			expect(result.length).toBeLessThanOrEqual(50_000);
			expect(result).toContain("Found 100 results for pattern");
			expect(result).toContain("search output truncated");
			expect(result).toContain("Narrow the pattern or scope");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("returns bounded output when a match lands in a giant single-line file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-search-"));
		// Simulates a serialized trace dump. Buffering ripgrep's --json events
		// for such files unbounded previously crashed the host process once
		// accumulated stdout passed the engine's max string length.
		await fs.writeFile(
			path.join(dir, "trace.json"),
			`{"trace": "${"x".repeat(20 * 1024 * 1024)}"}`,
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "small.ts"),
			"const trace = 1;\n",
			"utf-8",
		);

		try {
			const search = createSearchExecutor();
			const result = await search("trace", dir, ctx);

			expect(result.length).toBeLessThanOrEqual(50_000);
			expect(result).toContain("small.ts");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("excludes matches from directories ignored by .gitignore / .clineignore", async () => {
		const dir = await fs.mkdtemp(
			path.join(os.tmpdir(), "agents-search-ignore-"),
		);
		// Use directory names that are NOT in the hard-coded exclude list so the
		// assertion isolates ignore-file handling from the built-in dir skips.
		await fs.writeFile(path.join(dir, ".gitignore"), "generated/\n", "utf-8");
		await fs.writeFile(path.join(dir, ".clineignore"), "secret/\n", "utf-8");

		await fs.mkdir(path.join(dir, "src"), { recursive: true });
		await fs.mkdir(path.join(dir, "generated"), { recursive: true });
		await fs.mkdir(path.join(dir, "secret"), { recursive: true });

		const marker = "ZZ_IGNORE_MARKER_ZZ";
		await fs.writeFile(
			path.join(dir, "src", "keep.ts"),
			`const a = "${marker}";\n`,
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "generated", "gen.ts"),
			`const b = "${marker}";\n`,
			"utf-8",
		);
		await fs.writeFile(
			path.join(dir, "secret", "leak.ts"),
			`const c = "${marker}";\n`,
			"utf-8",
		);

		try {
			const search = createSearchExecutor({ contextLines: 0 });
			const result = await search(marker, dir, ctx);

			expect(result).toContain("src/keep.ts");
			expect(result).not.toContain("generated/gen.ts");
			expect(result).not.toContain("secret/leak.ts");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
