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
		await fs.writeFile(
			filePath,
			`needle ${"x".repeat(MAX_SEARCH_OUTPUT_CHARS * 2)} TAIL`,
			"utf-8",
		);

		try {
			const search = createSearchExecutor({ contextLines: 0 });
			const result = await search("(?=needle)", dir, ctx);

			expect(result.length).toBeGreaterThan(MAX_SEARCH_OUTPUT_CHARS);
			expect(result.length).toBeLessThanOrEqual(50_000);
			expect(result).toContain("Found 1 result for pattern");
			expect(result).toContain("search output truncated");
			expect(result).toContain("Narrow the pattern or scope");
			expect(result).toContain("TAIL");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
