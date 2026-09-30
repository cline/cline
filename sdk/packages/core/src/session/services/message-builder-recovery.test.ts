import type { ImageContent, Message, ToolResultContent } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "./message-builder";

function history(
	content: ToolResultContent["content"],
	name = "gmail_fetch_emails",
): Message[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool_use", id: "call", name, input: {} }],
		},
		{
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "call", name, content }],
		},
	];
}
function result(messages: Message[]): ToolResultContent {
	for (const message of messages)
		if (Array.isArray(message.content))
			for (const block of message.content)
				if (block.type === "tool_result") return block;
	throw new Error("Missing tool result");
}

describe("model-only tool result recovery", () => {
	it("awaits a successful save before exposing the recovery path and preserves original history", async () => {
		const full = "original response\n".repeat(1000);
		const messages = history(full);
		let resolveSave!: (path: string) => void;
		const save = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveSave = resolve;
				}),
		);
		const pending = new MessageBuilder({
			maxToolResultChars: 500,
		}).buildForApiWithRecovery(messages, { shouldCache: () => true, save });
		let completed = false;
		void pending.then(() => {
			completed = true;
		});
		await Promise.resolve();
		expect(completed).toBe(false);
		resolveSave("/cache/full.txt");
		const prepared = result(await pending);
		expect(JSON.stringify(prepared.content)).toContain("/cache/full.txt");
		expect(JSON.stringify(prepared.content)).not.toContain(full);
		expect(save).toHaveBeenCalledWith("call", full);
		expect(result(messages).content).toBe(full);
	});

	it("caches a whole structured response made of many small fields", async () => {
		const rows = Array.from({ length: 300 }, (_, id) => ({
			id,
			title: "small item",
		}));
		const messages = history(rows as unknown as ToolResultContent["content"]);
		const save = vi.fn(async () => "/cache/rows.txt");
		const prepared = await new MessageBuilder({
			maxToolResultChars: 500,
		}).buildForApiWithRecovery(messages, { shouldCache: () => true, save });
		expect(save).toHaveBeenCalledWith("call", JSON.stringify(rows, null, 2));
		expect(JSON.stringify(prepared)).toContain("/cache/rows.txt");
		expect(result(messages).content).toBe(rows);
	});

	it("keeps native images attached while bounding text", async () => {
		const image: ImageContent = {
			type: "image",
			data: "aGVsbG8=",
			mediaType: "image/png",
		};
		const messages = history([
			{ type: "text", text: "x".repeat(10000) },
			image,
		]);
		const prepared = await new MessageBuilder({
			maxToolResultChars: 500,
		}).buildForApiWithRecovery(messages, {
			shouldCache: () => true,
			save: async () => "/cache/media.txt",
		});
		expect(result(prepared).content).toContainEqual(image);
		expect(result(messages).content).toContainEqual(image);
	});

	it("does not cache short responses or tools that did not opt in", async () => {
		const save = vi.fn(async () => "/cache/full.txt");
		const builder = new MessageBuilder({ maxToolResultChars: 500 });
		await builder.buildForApiWithRecovery(history("short"), {
			shouldCache: () => true,
			save,
		});
		await builder.buildForApiWithRecovery(
			history("x".repeat(10000), "team_list_runs"),
			{ shouldCache: () => false, save },
		);
		expect(save).not.toHaveBeenCalled();
	});

	it.each([
		40, 1000,
	])("keeps a failed save bounded by a %i-byte aggregate budget", async (maxTotalTextBytes) => {
		const messages = history("x".repeat(500000));
		const onSaveFailure = vi.fn();
		const prepared = await new MessageBuilder({
			maxTotalTextBytes,
		}).buildForApiWithRecovery(messages, {
			shouldCache: () => true,
			save: async () => {
				throw new Error("disk full");
			},
			onSaveFailure,
		});
		const content = result(prepared).content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((entry) => entry.type === "text")
						.map((entry) => entry.text)
						.join("");
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(maxTotalTextBytes);
		expect(text).not.toContain("cached temporarily");
		expect(onSaveFailure).toHaveBeenCalledOnce();
		expect(result(messages).content).toHaveLength(500000);
	});

	it("keeps generated recovery instructions intact under aggregate truncation", async () => {
		const path = `/cache/${"nested/".repeat(30)}full.txt`;
		const prepared = await new MessageBuilder({
			maxToolResultChars: 1000,
			maxTotalTextBytes: 1000,
		}).buildForApiWithRecovery(history("x".repeat(10000)), {
			shouldCache: () => true,
			save: async () => path,
		});
		expect(JSON.stringify(result(prepared))).toContain(path);
		const entries = result(prepared).content as Array<{ text?: string }>;
		expect(
			entries.some((entry) => entry.text?.includes("provider request budget")),
		).toBe(true);
		expect(
			entries.reduce(
				(bytes, entry) => bytes + Buffer.byteLength(entry.text ?? ""),
				0,
			),
		).toBeLessThanOrEqual(1000);
	});
});
