import { createGateway } from "@cline/llms";
import { describe, expect, it, vi } from "vitest";
import { Agent } from "./index";

function content(parts: Record<string, unknown>[], finishReason?: string) {
	return {
		candidates: [
			{
				content: { role: "model", parts },
				index: 0,
				...(finishReason ? { finishReason } : {}),
			},
		],
	};
}

function sse(chunks: unknown[]): string {
	return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");
}

const overloaded = {
	error: {
		code: 503,
		message: "The model is overloaded. Please try again later.",
		status: "UNAVAILABLE",
	},
};

describe.each(["gemini", "vertex"])("%s in-stream errors", (providerId) => {
	it.each([
		{
			name: "retries an error after partial text",
			part: { text: "Partial response" },
			fails: true,
		},
		{
			name: "discards a tool call followed by an error and retries",
			part: { functionCall: { name: "delete_file", args: { path: "a.txt" } } },
			fails: true,
		},
		{
			name: "executes a tool call from a successful response",
			part: { functionCall: { name: "delete_file", args: { path: "a.txt" } } },
			fails: false,
		},
	])("$name", async ({ part, fails }) => {
		const requests: Record<string, unknown>[] = [];
		const execute = vi.fn(async () => "deleted");
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId,
					apiKey: "test-key",
					fetch: (async (_url, init) => {
						requests.push(JSON.parse(String(init?.body)));
						const chunks =
							requests.length === 1
								? [
										content([part], fails ? undefined : "STOP"),
										...(fails ? [overloaded] : []),
									]
								: [content([{ text: "Done." }], "STOP")];
						return new Response(sse(chunks), {
							headers: { "content-type": "text/event-stream" },
						});
					}) as typeof fetch,
				},
			],
		});
		const agent = new Agent({
			model: gateway.createAgentModel({
				providerId,
				modelId: "gemini-2.5-flash",
			}),
			tools: [
				{
					name: "delete_file",
					description: "Delete a file.",
					inputSchema: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
					execute,
				},
			],
		});

		const result = await agent.run("Delete a.txt.");

		expect(result.status).toBe("completed");
		expect(requests).toHaveLength(2);
		if (fails) {
			expect(execute).not.toHaveBeenCalled();
			expect(requests[1]?.contents).toEqual(requests[0]?.contents);
		} else {
			expect(execute).toHaveBeenCalledOnce();
			expect(JSON.stringify(requests[1]?.contents)).toContain(
				'"functionResponse"',
			);
		}
	}, 15_000);
});
