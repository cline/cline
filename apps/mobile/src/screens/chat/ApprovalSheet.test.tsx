import type { PendingApprovalInfo } from "@cline/shared";
import { Keyboard, TextInput } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { ApprovalSheet } from "./ApprovalSheet";

const approval: PendingApprovalInfo = {
	approvalId: "approval",
	sessionId: "session",
	agentId: "agent",
	conversationId: "conversation",
	iteration: 1,
	toolCallId: "tool",
	toolName: "bash",
	policy: {},
	createdAt: 0,
	inputJson: '{"command":"echo hello"}',
};
function field(root: ReactTestInstance, label: string) {
	const result = root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1);
	if (!result) throw new Error(`Missing ${label}`);
	return result;
}
const originalState = TextInput.State;
afterEach(() => {
	TextInput.State = originalState;
	vi.restoreAllMocks();
});

describe("approval reason keyboard lifecycle", () => {
	it("blurs its reason before awaiting denial and preserves the reason after failure without touching a new input", async () => {
		const blur = vi.fn();
		const owned = { blur } as unknown as ReturnType<
			typeof TextInput.State.currentlyFocusedInput
		>;
		let focused = owned;
		TextInput.State = {
			...originalState,
			currentlyFocusedInput: () => focused,
		};
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		let rejectResponse!: (error: Error) => void;
		const response = new Promise<void>((_resolve, reject) => {
			rejectResponse = reject;
		});
		const respond = vi.fn(() => {
			expect(blur).toHaveBeenCalledOnce();
			expect(dismiss).toHaveBeenCalledOnce();
			return response;
		});
		const { root } = render(
			<ApprovalSheet approvals={[approval]} onRespond={respond} />,
		);
		dismiss.mockClear();
		act(() => field(root, "Deny").props.onPress());
		const input = field(root, "Denial reason");
		act(() => {
			input.props.onChangeText("Keep my files");
			input.props.onFocus({});
		});
		act(() => field(root, "Confirm deny").props.onPress());
		expect(respond).toHaveBeenCalledWith("approval", false, "Keep my files");
		const newBlur = vi.fn();
		focused = { blur: newBlur } as unknown as typeof owned;
		await act(async () => {
			rejectResponse(new Error("offline"));
			await response.catch(() => {});
		});
		expect(field(root, "Denial reason").props.value).toBe("Keep my files");
		expect(containsText(root, "Could not send your response")).toBe(true);
		expect(newBlur).not.toHaveBeenCalled();
		expect(dismiss).toHaveBeenCalledOnce();
	});
	it("does not blur another focused field when approving after editing a reason", async () => {
		const blur = vi.fn();
		const owned = { blur } as unknown as ReturnType<
			typeof TextInput.State.currentlyFocusedInput
		>;
		let focused = owned;
		TextInput.State = {
			...originalState,
			currentlyFocusedInput: () => focused,
		};
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const respond = vi.fn(async () => {});
		const { root } = render(
			<ApprovalSheet approvals={[approval]} onRespond={respond} />,
		);
		dismiss.mockClear();
		act(() => field(root, "Deny").props.onPress());
		act(() => field(root, "Denial reason").props.onFocus({}));
		focused = { blur: vi.fn() } as unknown as typeof owned;
		await act(async () => field(root, "Approve").props.onPress());
		expect(respond).toHaveBeenCalledWith("approval", true, undefined);
		expect(blur).not.toHaveBeenCalled();
		expect(dismiss).not.toHaveBeenCalled();
	});
});
