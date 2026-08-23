import { describe, expect, it } from "vitest";
import { generateConversationHTML } from "./export";

describe("generateConversationHTML", () => {
	it("renders provider model activity with the ordinary tool HTML", () => {
		const html = generateConversationHTML(
			{
				version: 1,
				updated_at: "2026-08-13T00:00:00.000Z",
				messages: [
					{
						id: "assistant-search",
						role: "assistant",
						content: "Bun 1.3.14 is current.",
						metadata: {
							modelToolActivities: [
								{
									toolCallId: "search-1",
									toolName: "web_search",
									execution: "provider",
									input: { query: "latest Bun release" },
									output: "Bun 1.3.14",
								},
							],
						},
					},
				],
			},
			"session",
		);

		expect(html).toContain("web_search");
		expect(html).toContain("latest Bun release");
		expect(html).toContain('<span class="success">Success</span>');
		expect(html).toContain("Bun 1.3.14 is current.");
	});
});
