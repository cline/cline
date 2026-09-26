import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type AgentToolContext, sanitizeSurrogates } from "@cline/shared";
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
	it("cuts a long matching line on a code point boundary", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-search-"));
		// MAX_LINE_CHARS is 2000, and the leading "a" puts that cut at an odd
		// offset inside the emoji run — the offset where a raw slice leaves an
		// unpaired surrogate that later reads as U+FFFD.
		await fs.writeFile(
			path.join(dir, "wide.ts"),
			`a${"\u{1F3AE}".repeat(1_100)}\n`,
			"utf-8",
		);

		try {
			const search = createSearchExecutor({ contextLines: 0 });
			// Lookahead is unsupported by ripgrep, forcing the fallback scan.
			const result = await search("(?=a\u{1F3AE})", dir, ctx);

			expect(result).toContain("wide.ts");
			expect(sanitizeSurrogates(result)).toBe(result);
			expect(Buffer.from(result, "utf8").toString("utf8")).toBe(result);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
