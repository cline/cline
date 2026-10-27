import { describe, expect, it } from "vitest";
import type { SessionMessageView } from "@/session";
import {
	messageCopyText,
	messageDisplayText,
	visibleTranscriptMessages,
} from "./message-text";

const message = (
	role: "user" | "assistant",
	text: string,
): SessionMessageView => ({
	id: "one",
	role,
	origin: "hydrated",
	blocks: [{ kind: "text", text }],
});
const notice =
	"<mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>";

describe("visible and copied transcript text", () => {
	it("copies the same human text shown for runtime-wrapped input, without hidden mode metadata", () => {
		const item = message(
			"user",
			`${notice}<user_input mode="act">${notice}Please keep \`a < b\` and **bold**.</user_input>`,
		);
		expect(messageDisplayText(item)).toBe("Please keep `a < b` and **bold**.");
		expect(messageCopyText(item)).toBe(messageDisplayText(item));
	});
	it("preserves assistant markup examples, legitimate user XML and fenced mode notices", () => {
		const assistant = message(
			"assistant",
			'Example: <user_input mode="act">hello</user_input> and <analysis>XML</analysis>',
		);
		expect(messageCopyText(assistant)).toBe(
			(assistant.blocks[0] as { text: string }).text,
		);
		const xml =
			"```xml\n<mode_notice>Explain this XML</mode_notice>\n```\n<div>legitimate code</div>";
		expect(
			messageCopyText(
				message("user", `<user_input mode="act">${xml}</user_input>`),
			),
		).toBe(xml);
	});
	it("formats only a complete recognized slash-command envelope", () => {
		expect(
			messageDisplayText(
				message(
					"user",
					'<user_command slash="team">spawn a team of agents for the following task: inspect tests</user_command>',
				),
			),
		).toBe("/team inspect tests");
		const prose =
			'Explain <user_command slash="team">this example</user_command> please';
		expect(messageDisplayText(message("user", prose))).toBe(prose);
	});
	it("omits internal rows, clipboard contents, and their navigation previews without mutating canonical text", () => {
		const hidden = {
			...message("user", "Private runtime recovery context"),
			hidden: true as const,
		};
		const normal = message("assistant", "Visible answer");
		expect(messageDisplayText(hidden)).toBe("");
		expect(messageCopyText(hidden)).toBe("");
		expect(visibleTranscriptMessages([hidden, normal])).toEqual([normal]);
		expect(hidden.blocks).toEqual([
			{ kind: "text", text: "Private runtime recovery context" },
		]);
	});
});
