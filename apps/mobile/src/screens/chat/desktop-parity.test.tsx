import type { PendingApprovalInfo } from "@cline/shared";
import { Keyboard, Platform } from "react-native";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { createSessionState, reduceSession, selectViewModel } from "@/session";
import { parseSessionMessagesReply } from "@/session/schemas";
import { findAllByType, render } from "@/ui/__testing__/render";
import { flattenStyle } from "@/ui/__testing__/rn-host";
import { containsText, fakeConnection } from "../__testing__/harness";
import { ChatScreen, groupReasoningMessages } from "../ChatScreen";
import { ApprovalSheet } from "./ApprovalSheet";
import { AutoApprovePill, AutoApproveSheet } from "./AutoApproveControl";
import { ChatHeader } from "./ChatHeader";

function savedErrorView() {
	const parsed = parseSessionMessagesReply({
		messages: [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: '{"error":{"message":"Provider unavailable. Try again."}}',
					},
				],
				metadata: { displayOnly: true, displayRole: "error" },
			},
		],
	});
	if (parsed.status !== "ok") throw new Error("Invalid fixture");
	return selectViewModel(
		reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		}),
	);
}

describe("desktop conversation UX parity", () => {
	it("keeps long repository/branch context shrinkable and accessible", () => {
		const subtitle =
			"organization/very-long-repository-name · feature/very-long-branch-name";
		const { root } = render(
			<ChatHeader
				title="Review mobile"
				subtitle={subtitle}
				runStatus="running"
			/>,
		);
		const label = findAllByType(root, "Text").find(
			(node) => node.props.accessibilityLabel === subtitle,
		);
		expect(label?.props.numberOfLines).toBe(1);
		expect(flattenStyle(label?.props.style)).toMatchObject({
			flexShrink: 1,
			minWidth: 0,
		});
	});
	it.each([
		"local",
		"cloud",
		undefined,
	] as const)("only exposes approval settings for a local chat (%s)", (connectionKind) => {
		const { root } = render(
			<ChatScreen
				connection={fakeConnection()}
				connectionKind={connectionKind}
			/>,
		);
		const count = connectionKind === "local" ? 1 : 0;
		expect(root.findAll((node) => node.type === AutoApprovePill)).toHaveLength(
			count,
		);
		expect(root.findAll((node) => node.type === AutoApproveSheet)).toHaveLength(
			count,
		);
	});
	it.each([
		"ios",
		"android",
	] as const)("explicitly avoids the %s keyboard in existing chats", (os) => {
		const previousOS = Platform.OS;
		Platform.OS = os;
		try {
			const mounted = render(<ChatScreen connection={fakeConnection()} />);
			expect(
				findAllByType(mounted.root, "KeyboardAvoidingView")[0]?.props.behavior,
			).toBe(os === "ios" ? "padding" : "height");
			mounted.unmount();
		} finally {
			Platform.OS = previousOS;
		}
	});
	it("opens a new session directly from chat without sending or aborting", () => {
		const onNewChat = vi.fn();
		const connection = fakeConnection({ abort: vi.fn(), sendInput: vi.fn() });
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const { root } = render(
			<ChatScreen connection={connection} onNewChat={onNewChat} />,
		);
		const button = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "New session",
			)
			.at(-1);
		expect(button).toBeDefined();
		act(() => button?.props.onPress());
		expect(onNewChat).toHaveBeenCalledOnce();
		expect(dismiss).toHaveBeenCalled();
		expect(connection.abort).not.toHaveBeenCalled();
		expect(connection.sendInput).not.toHaveBeenCalled();
		dismiss.mockRestore();
	});

	it("preserves saved error presentation from the existing Hub metadata", () => {
		const view = savedErrorView();
		expect(view.messages[0]).toMatchObject({ displayRole: "error" });
		const { root } = render(
			<ChatScreen connection={fakeConnection({ view })} />,
		);
		expect(containsText(root, "Provider unavailable. Try again.")).toBe(true);
		expect(containsText(root, '{"error"')).toBe(false);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityRole === "alert",
			).length,
		).toBeGreaterThan(0);
	});

	it("keeps saved errors separate from preceding reasoning", () => {
		const error = savedErrorView().messages[0];
		if (!error) throw new Error("Missing saved error fixture");
		const result = groupReasoningMessages([
			{
				id: "thought",
				role: "assistant",
				origin: "hydrated",
				blocks: [{ kind: "reasoning", text: "Thinking", redacted: false }],
			},
			error,
		]);
		expect(result).toHaveLength(2);
		expect(result[1]).toMatchObject({ displayRole: "error" });
	});

	it("places the complete tool input in a scrollable sheet without an inner height limit", () => {
		const input = `${"line\n".repeat(100)}END OF INPUT`;
		const approval: PendingApprovalInfo = {
			approvalId: "a",
			sessionId: "s",
			agentId: "agent",
			conversationId: "c",
			iteration: 1,
			toolCallId: "t",
			toolName: "bash",
			policy: {},
			createdAt: Date.now(),
			inputJson: input,
		};
		const { root } = render(
			<ApprovalSheet approvals={[approval]} onRespond={async () => {}} />,
		);
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Deny",
				)
				.at(-1)
				?.props.onPress(),
		);
		expect(
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Denial reason",
				)
				.at(-1)?.type,
		).toBe("BottomSheetTextInput");
		const inputText = findAllByType(root, "Text").find(
			(node) => node.props.children === input,
		);
		expect(inputText).toBeDefined();
		let container = inputText?.parent;
		while (container && container.type !== "BottomSheetScrollView") {
			if (typeof container.type === "string") {
				const style = flattenStyle(container.props.style);
				expect(style.height).toBeUndefined();
				expect(style.maxHeight).toBeUndefined();
				expect(style.overflow).not.toBe("hidden");
			}
			container = container.parent;
		}
		expect(container?.type).toBe("BottomSheetScrollView");
	});
});
