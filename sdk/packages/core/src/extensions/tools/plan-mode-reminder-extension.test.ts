import type {
	AgentExtensionApi,
	AgentExtensionMessageBuilder,
	AgentTool,
	Message,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	appendPlanModeReminder,
	createPlanModeReminderExtension,
	PLAN_MODE_REMINDER_EXTENSION_NAME,
	PLAN_MODE_REMINDER_TEXT,
} from "./plan-mode-reminder-extension";

function textOf(message: Message): string {
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

describe("appendPlanModeReminder", () => {
	it("appends the reminder to the latest string user message", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: '<user_input mode="plan">add a login page</user_input>',
			},
		];
		const result = appendPlanModeReminder(messages);
		expect(textOf(result[0])).toBe(
			`<user_input mode="plan">add a login page</user_input>\n\n${PLAN_MODE_REMINDER_TEXT}`,
		);
	});

	it("appends a text block to the latest block-content user message", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "look at this" },
					{ type: "image", data: "abc", mediaType: "image/png" },
				],
			},
		];
		const result = appendPlanModeReminder(messages);
		const content = result[0].content as Exclude<Message["content"], string>;
		expect(content).toHaveLength(3);
		expect(content[2]).toEqual({ type: "text", text: PLAN_MODE_REMINDER_TEXT });
	});

	it("targets the newest user turn, skipping tool-result messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "first message" },
			{ role: "assistant", content: "reading files" },
			{ role: "user", content: "second message" },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "t1", name: "read_files", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						name: "read_files",
						content: "file contents",
					},
				],
			},
		];
		const result = appendPlanModeReminder(messages);
		expect(textOf(result[0])).toBe("first message");
		expect(textOf(result[2])).toContain(PLAN_MODE_REMINDER_TEXT);
		expect(textOf(result[4])).not.toContain(PLAN_MODE_REMINDER_TEXT);
	});

	it("does not mutate the input messages", () => {
		const original: Message[] = [{ role: "user", content: "hello" }];
		const result = appendPlanModeReminder(original);
		expect(original[0].content).toBe("hello");
		expect(result).not.toBe(original);
		expect(result[0]).not.toBe(original[0]);
	});

	it("is idempotent when the reminder is already present", () => {
		const messages: Message[] = [{ role: "user", content: "hello" }];
		const once = appendPlanModeReminder(messages);
		const twice = appendPlanModeReminder(once);
		expect(twice).toBe(once);
		const occurrences =
			textOf(twice[0]).split(PLAN_MODE_REMINDER_TEXT).length - 1;
		expect(occurrences).toBe(1);
	});

	it("returns the input unchanged when there is no user turn", () => {
		const toolResultOnly: Message[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t1",
						name: "read_files",
						content: "data",
					},
				],
			},
		];
		expect(appendPlanModeReminder([])).toEqual([]);
		expect(appendPlanModeReminder(toolResultOnly)).toBe(toolResultOnly);
	});
});

describe("createPlanModeReminderExtension", () => {
	it("registers a message builder that appends the reminder", async () => {
		const extension = createPlanModeReminderExtension();
		expect(extension.name).toBe(PLAN_MODE_REMINDER_EXTENSION_NAME);
		expect(extension.manifest.capabilities).toContain("messageBuilders");

		const builders: AgentExtensionMessageBuilder<Message[]>[] = [];
		const api = {
			registerMessageBuilder: (
				builder: AgentExtensionMessageBuilder<Message[]>,
			) => builders.push(builder),
		} as unknown as AgentExtensionApi<AgentTool, Message[]>;
		await extension.setup?.(api, {});

		expect(builders).toHaveLength(1);
		expect(builders[0].name).toBe(PLAN_MODE_REMINDER_EXTENSION_NAME);
		const built = await builders[0].build([{ role: "user", content: "hi" }]);
		expect(textOf(built[0])).toBe(`hi\n\n${PLAN_MODE_REMINDER_TEXT}`);
	});
});
