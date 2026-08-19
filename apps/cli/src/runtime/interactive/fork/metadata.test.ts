import { SessionSource } from "@cline/core";
import type { Message } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { buildForkSessionMetadata } from "./metadata";

describe("buildForkSessionMetadata", () => {
	it("copies source metadata, replaces fork lineage, and writes a fork title", () => {
		const messages = [
			{
				role: "user",
				content: "Fallback title",
			},
		] satisfies Message[];

		const metadata = buildForkSessionMetadata({
			forkedFromSessionId: "sess_source",
			forkedAt: "2026-04-29T16:00:00.000Z",
			sourceSession: {
				source: SessionSource.CLI,
				prompt: "Prompt title",
				metadata: {
					title: "Source title",
					totalCost: 1.25,
					checkpoint: {
						latest: {
							ref: "abc123",
							runCount: 2,
						},
					},
					fork: {
						forkedFromSessionId: "older_source",
					},
				},
			},
			messages,
		});

		expect(metadata.title).toBe("Source title (fork)");
		expect(metadata.totalCost).toBe(1.25);
		expect(metadata.fork).toEqual({
			forkedFromSessionId: "sess_source",
			forkedAt: "2026-04-29T16:00:00.000Z",
			source: SessionSource.CLI,
			checkpoints: {
				latest: {
					ref: "abc123",
					runCount: 2,
				},
			},
		});
	});
});
