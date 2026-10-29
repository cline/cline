import { expect, it } from "vitest";
import {
	agentMessagesToMessages,
	messagesToAgentMessages,
} from "../runtime/config/agent-message-codec";
import { MessageBuilder } from "./services/message-builder";
import { flattenToolResultContent } from "../extensions/context/compaction-shared";
import { stringifyToolResultData, type AgentMessage } from "@cline/shared";
const image = {
	type: "image",
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l3sAAAAASUVORK5CYII=",
	mediaType: "image/png",
};
it("keeps structured tool output native through persistence and API preparation", () => {
	const report = { kind: "ux_verification", title: "Check", screenshot: image };
	const messages: AgentMessage[] = [
		{
			id: "call",
			createdAt: 1,
			role: "assistant",
			content: [
				{
					type: "tool-call",
					toolCallId: "ux",
					toolName: "ux_verifier",
					input: {},
				},
			],
		},
		{
			id: "result",
			createdAt: 2,
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "ux",
					toolName: "ux_verifier",
					output: report,
				},
			],
		},
	];
	const stored = agentMessagesToMessages(messages);
	const prepared = new MessageBuilder().buildForApi(
		JSON.parse(JSON.stringify(stored)),
	);
	const roundtrip = messagesToAgentMessages(prepared);
	const output = roundtrip
		.flatMap((message) => message.content)
		.find((part) => part.type === "tool-result");
	expect(output?.type === "tool-result" && output.output).toEqual(report);
	expect(report.screenshot.data).toBe(image.data);
});
it("omits binary image bytes from text-only summaries and compaction", () => {
	const report = { title: "Evidence", screenshot: image };
	expect(stringifyToolResultData(report)).toContain("[image:image/png]");
	expect(flattenToolResultContent(report)).not.toContain(image.data);
	expect(flattenToolResultContent(report)).toContain("Evidence");
});
