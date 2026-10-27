import * as Clipboard from "expo-clipboard";
import { act } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import type { SessionMessageView } from "@/session";
import { render } from "../../ui/__testing__/render";
import { allText, findByLabel } from "../__testing__/harness";
import { MessageRow } from "../ChatScreen";

function user(text: string): SessionMessageView {
	return {
		id: "one",
		role: "user",
		origin: "hydrated",
		blocks: [{ kind: "text", text }],
	};
}

describe("transcript clipboard presentation", () => {
	it("copies the displayed human prompt rather than the persisted transport envelope", async () => {
		const raw =
			'<user_input mode="act"><mode_notice>The user switched from plan mode to act mode before sending this message.</mode_notice>Keep <div>my code</div> and task_id.</user_input>';
		const { root } = render(<MessageRow message={user(raw)} />);
		expect(allText(root)).toContain("Keep <div>my code</div> and task_id.");
		expect(allText(root)).not.toContain("mode_notice");
		await act(async () =>
			findByLabel(root, "Copy user message")?.props.onPress(),
		);
		expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(
			"Keep <div>my code</div> and task_id.",
		);
	});
	it("renders no row or copy action for runtime-internal history", () => {
		const { root } = render(
			<MessageRow
				message={{ ...user("Runtime private summary"), hidden: true }}
			/>,
		);
		expect(allText(root)).not.toContain("Runtime private summary");
		expect(findByLabel(root, "Copy user message")).toBeUndefined();
	});
	it("copies only visible assistant text, keeping authored markup and excluding reasoning/tool payloads", async () => {
		const assistant: SessionMessageView = {
			id: "a",
			role: "assistant",
			origin: "live",
			blocks: [
				{ kind: "reasoning", text: "Private reasoning", redacted: true },
				{
					kind: "text",
					text: 'Here is literal XML: <user_input mode="act">example</user_input> and **Markdown**.',
				},
			],
		};
		const { root } = render(<MessageRow message={assistant} />);
		await act(async () =>
			findByLabel(root, "Copy assistant message")?.props.onPress(),
		);
		expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(
			'Here is literal XML: <user_input mode="act">example</user_input> and **Markdown**.',
		);
	});
	it("copies the visible extracted error sentence rather than its hidden JSON envelope", async () => {
		const { root } = render(
			<MessageRow
				message={{
					id: "error",
					role: "assistant",
					origin: "hydrated",
					displayRole: "error",
					blocks: [
						{
							kind: "text",
							text: JSON.stringify({
								message: "Request was refused.",
								trace: "implementation details hidden by display",
							}),
						},
					],
				}}
			/>,
		);
		expect(allText(root)).toContain("Request was refused.");
		expect(allText(root)).not.toContain("implementation details");
		await act(async () =>
			findByLabel(root, "Copy assistant message")?.props.onPress(),
		);
		expect(Clipboard.setStringAsync).toHaveBeenLastCalledWith(
			"Request was refused.",
		);
	});
});
