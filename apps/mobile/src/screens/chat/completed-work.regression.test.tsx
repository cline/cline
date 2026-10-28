import type { PendingApprovalInfo } from "@cline/shared";
import * as Clipboard from "expo-clipboard";
import type { ComponentProps } from "react";
import * as Native from "react-native";
import { FlatList } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageBlock, RunStatus, SessionMessageView } from "@/session";
import {
	createSessionState,
	parseSessionMessagesReply,
	reduceSession,
	selectViewModel,
} from "@/session";
import { render } from "../../ui/__testing__/render";
import {
	containsText,
	emptyView,
	fakeConnection,
	findByLabel,
} from "../__testing__/harness";
import { ArchivedChatScreen } from "../ArchivedChatScreen";
import { ChatScreen } from "../ChatScreen";
import { ConversationNavigator } from "./ConversationNavigator";

const narration = "I will inspect the build configuration first.";
const finalAnswer = "The build configuration is fixed.";
const tool: MessageBlock = {
	kind: "tool",
	toolCallId: "read-config",
	name: "read_file",
	state: "completed",
	input: { path: "config.json" },
	output: "configuration content",
};
const secondTool: MessageBlock = {
	kind: "tool",
	toolCallId: "edit-config",
	name: "apply_patch",
	state: "completed",
	input: { patch: "*** Begin Patch\n*** End Patch" },
	output: "Applied",
};
const user: SessionMessageView = {
	id: "u1",
	role: "user",
	origin: "hydrated",
	blocks: [{ kind: "text", text: "Fix the build" }],
};
function assistant(
	id: string,
	blocks: MessageBlock[],
	origin: "live" | "hydrated" = "hydrated",
): SessionMessageView {
	return { id, role: "assistant", origin, blocks };
}
const canonical = [
	user,
	assistant("a1", [{ kind: "text", text: narration }, tool]),
	assistant("a2", [
		{ kind: "text", text: "I found the setting to change." },
		secondTool,
	]),
	assistant("a3", [{ kind: "text", text: finalAnswer }]),
];
const live = [
	user,
	assistant(
		"live-1",
		[
			{ kind: "text", text: narration },
			tool,
			{ kind: "text", text: "I found the setting to change." },
			secondTool,
			{ kind: "text", text: finalAnswer },
		],
		"live",
	),
];

function connection(
	messages: SessionMessageView[],
	runStatus: RunStatus = "completed",
	pendingApprovals: PendingApprovalInfo[] = [],
) {
	return fakeConnection({
		view: {
			...emptyView(),
			connectionStatus: "live",
			messages,
			runStatus,
			pendingApprovals,
		},
	});
}
function workTrigger(root: ReactTestInstance) {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				typeof node.props.accessibilityLabel === "string" &&
				node.props.accessibilityLabel.startsWith("Work, 2 tools,"),
		)
		.at(-1);
}
beforeEach(() => vi.clearAllMocks());

describe("completed work folds across real transcript shapes", () => {
	it.each([
		["one live message", live],
		["canonical iteration messages", canonical],
	] as const)("keeps only the final answer visible for %s", (_label, messages) => {
		const { root } = render(
			<ChatScreen connection={connection([...messages])} />,
		);
		expect(containsText(root, finalAnswer)).toBe(true);
		expect(containsText(root, narration)).toBe(false);
		expect(workTrigger(root)?.props.accessibilityState.expanded).toBe(false);
	});
	it.each([
		["one live message", live],
		["canonical iteration messages", canonical],
	] as const)("copies only the final answer for %s", async (_label, messages) => {
		const { root } = render(
			<ChatScreen connection={connection([...messages])} />,
		);
		const copies = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Copy assistant message",
		);
		expect(copies).toHaveLength(1);
		await act(async () => copies[0]?.props.onPress());
		expect(Clipboard.setStringAsync).toHaveBeenCalledWith(finalAnswer);
	});
	it("expands all intermediate narration and tool headers in chronological order", () => {
		const { root } = render(<ChatScreen connection={connection(canonical)} />);
		const trigger = workTrigger(root);
		expect(trigger).toBeDefined();
		act(() => trigger!.props.onPress());
		expect(containsText(root, narration)).toBe(true);
		expect(containsText(root, "I found the setting to change.")).toBe(true);
		expect(workTrigger(root)?.props.accessibilityState.expanded).toBe(true);
	});
	it.each([
		"running",
		"failed",
		"aborted",
	] as const)("keeps the trailing %s work visible", (runStatus) => {
		const { root } = render(
			<ChatScreen connection={connection(canonical, runStatus)} />,
		);
		expect(containsText(root, narration)).toBe(true);
	});
	it("does not hide the work that owns a pending approval", () => {
		const approval: PendingApprovalInfo = {
			approvalId: "ap1",
			sessionId: "s1",
			agentId: "a",
			conversationId: "c",
			iteration: 2,
			toolCallId: "edit-config",
			toolName: "apply_patch",
			inputJson: "{}",
			policy: {},
			createdAt: Date.now(),
		};
		const { root } = render(
			<ChatScreen
				connection={connection(canonical, "completed", [approval])}
			/>,
		);
		expect(containsText(root, narration)).toBe(true);
		expect(findByLabel(root, "Approve")).toBeDefined();
	});
	it("keeps a failed tool diagnostic visible even if the run finishes with an answer", () => {
		const failed = assistant("a2", [
			{
				...secondTool,
				state: "failed",
				error: "Permission denied writing configuration",
			} as MessageBlock,
		]);
		const messages = [canonical[0]!, canonical[1]!, failed, canonical[3]!];
		const { root } = render(<ChatScreen connection={connection(messages)} />);
		expect(containsText(root, "Permission denied writing configuration")).toBe(
			true,
		);
	});
	it("leaves a generated deliverable accessible while the earlier work is folded", () => {
		const media: MessageBlock = {
			kind: "media",
			media: {
				id: "report",
				modality: "file",
				name: "report.txt",
				mediaType: "text/plain",
				source: { type: "base64", data: "ZG9uZQ==" },
			},
		};
		const messages = [
			...canonical.slice(0, -1),
			assistant("a3", [{ kind: "text", text: finalAnswer }, media]),
		];
		const { root } = render(<ChatScreen connection={connection(messages)} />);
		expect(containsText(root, narration)).toBe(false);
		expect(findByLabel(root, "Save or share file")).toBeDefined();
		expect(containsText(root, finalAnswer)).toBe(true);
	});
	it("preserves an explicit open choice when a live block sequence hydrates", () => {
		const screen = render(<ChatScreen connection={connection(live)} />);
		const trigger = workTrigger(screen.root);
		expect(trigger).toBeDefined();
		act(() => trigger!.props.onPress());
		act(() =>
			screen.renderer.update(<ChatScreen connection={connection(canonical)} />),
		);
		expect(workTrigger(screen.root)?.props.accessibilityState.expanded).toBe(
			true,
		);
		expect(containsText(screen.root, narration)).toBe(true);
	});
	it("opens folded work before jumping to a search result inside it", () => {
		const screen = render(<ChatScreen connection={connection(canonical)} />);
		expect(containsText(screen.root, narration)).toBe(false);
		const scrollToIndex = vi.fn();
		screen.root.findAll(
			(node) => node.type === FlatList,
		)[0]!.props.ref.current = { scrollToIndex, scrollToOffset: vi.fn() };
		act(() =>
			screen.root
				.find((node) => node.type === ConversationNavigator)
				.props.onSelect("a2"),
		);
		expect(containsText(screen.root, narration)).toBe(true);
		expect(workTrigger(screen.root)?.props.accessibilityState.expanded).toBe(
			true,
		);
		expect(scrollToIndex).toHaveBeenCalled();
		const jump = scrollToIndex.mock.calls.at(-1)?.[0];
		const row = screen.root.findAll((node) => node.type === FlatList)[0]!.props
			.data[jump.index];
		expect(row.blocks).toEqual([
			{ kind: "text", text: "I found the setting to change." },
		]);
	});
	it("scopes identical provider tool IDs to their user turn through row virtualization", () => {
		const messages = [
			...canonical,
			{ ...user, id: "u2" },
			...canonical
				.slice(1)
				.map((message) => ({ ...message, id: `${message.id}-second` })),
		];
		const OriginalFlatList = Native.FlatList;
		let hideAssistantRows = false;
		const virtualize = vi
			.spyOn(Native, "FlatList")
			.mockImplementation((props: ComponentProps<typeof FlatList>) => (
				<OriginalFlatList
					{...props}
					data={
						hideAssistantRows
							? Array.from(props.data ?? []).filter(
									(entry) => (entry as { role?: string }).role === "user",
								)
							: props.data
					}
				/>
			));
		try {
			const screen = render(<ChatScreen connection={connection(messages)} />);
			const triggers = () =>
				screen.root.findAll(
					(node) =>
						typeof node.type === "string" &&
						typeof node.props.accessibilityLabel === "string" &&
						node.props.accessibilityLabel.startsWith("Work, 2 tools,"),
				);
			expect(triggers()).toHaveLength(2);
			act(() => triggers()[0]!.props.onPress());
			expect(
				triggers().map((node) => node.props.accessibilityState.expanded),
			).toEqual([true, false]);
			hideAssistantRows = true;
			act(() =>
				screen.renderer.update(
					<ChatScreen connection={connection(messages)} />,
				),
			);
			expect(triggers()).toHaveLength(0);
			hideAssistantRows = false;
			act(() =>
				screen.renderer.update(
					<ChatScreen connection={connection(messages)} />,
				),
			);
			expect(
				triggers().map((node) => node.props.accessibilityState.expanded),
			).toEqual([true, false]);
		} finally {
			virtualize.mockRestore();
		}
	});
	it("keeps generated media between the work spans that precede and follow it", () => {
		const media: MessageBlock = {
			kind: "media",
			media: {
				id: "report",
				modality: "file",
				name: "between-work.txt",
				mediaType: "text/plain",
				source: { type: "base64", data: "ZG9uZQ==" },
			},
		};
		const messages = [
			user,
			assistant(
				"mixed-media",
				[
					{ kind: "text", text: "Before generated media" },
					tool,
					media,
					{ kind: "text", text: "After generated media" },
					secondTool,
					{ kind: "text", text: finalAnswer },
				],
				"live",
			),
		];
		const { root } = render(<ChatScreen connection={connection(messages)} />);
		const groups = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				typeof node.props.accessibilityLabel === "string" &&
				node.props.accessibilityLabel.startsWith("Work, 1 tool,"),
		);
		expect(groups).toHaveLength(2);
		act(() =>
			groups.forEach((group) => {
				group.props.onPress();
			}),
		);
		const hostText = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					typeof node.props.children === "string",
			)
			.map((node) => node.props.children)
			.join("\n");
		expect(hostText.indexOf("Before generated media")).toBeLessThan(
			hostText.indexOf("between-work.txt"),
		);
		expect(hostText.indexOf("between-work.txt")).toBeLessThan(
			hostText.indexOf("After generated media"),
		);
	});
	it("folds saved Cloud work and expands its matched source before archive navigation", () => {
		const history = [
			{ role: "user", content: "Fix the build" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: narration },
					{
						type: "tool_use",
						id: "read-config",
						name: "read_file",
						input: { path: "config.json" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "read-config",
						content: "configuration content",
					},
				],
			},
			{ role: "assistant", content: finalAnswer },
		];
		const screen = render(<ArchivedChatScreen history={history} />);
		expect(containsText(screen.root, narration)).toBe(false);
		expect(containsText(screen.root, finalAnswer)).toBe(true);
		const scrollToIndex = vi.fn();
		screen.root.find((node) => node.type === FlatList).props.ref.current = {
			scrollToIndex,
			scrollToOffset: vi.fn(),
		};
		act(() =>
			screen.root
				.find((node) => node.type === ConversationNavigator)
				.props.onSelect("h1"),
		);
		expect(containsText(screen.root, narration)).toBe(true);
		expect(scrollToIndex).toHaveBeenCalled();
	});
	it.each([
		"live",
		"hydrated",
	] as const)("shows and copies the SDK submit_and_exit input summary as the %s final deliverable", async (origin) => {
		// createSubmitAndExitTool consumes {summary, verified}; desktop extracts
		// input.summary rather than rendering the execution echo or raw tool JSON.
		const summary = "# Verified result\nThe build passed and the fix is ready.";
		const submit = {
			kind: "tool",
			toolCallId: "submit",
			name: "submit_and_exit",
			state: "completed",
			input: { summary, verified: true },
			output: "Submission recorded",
		} satisfies MessageBlock;
		let messages = [
			user,
			assistant(
				"final",
				[{ kind: "text", text: narration }, tool, submit],
				"live",
			),
		];
		if (origin === "hydrated") {
			const parsed = parseSessionMessagesReply({
				messages: [
					{ role: "user", content: "Fix the build" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: narration },
							{
								type: "tool_use",
								id: "read-config",
								name: "read_file",
								input: {},
							},
							{
								type: "tool_use",
								id: "submit",
								name: "submit_and_exit",
								input: { summary, verified: true },
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "read-config",
								content: "configuration content",
							},
							{
								type: "tool_result",
								tool_use_id: "submit",
								content: "Submission recorded",
							},
						],
					},
				],
			});
			if (parsed.status !== "ok") throw new Error("SDK transcript must parse");
			messages = selectViewModel(
				reduceSession(createSessionState(), {
					type: "hydrated",
					messages: parsed.messages,
				}),
			).messages;
		}
		const { root } = render(<ChatScreen connection={connection(messages)} />);
		expect(containsText(root, "The build passed and the fix is ready.")).toBe(
			true,
		);
		expect(containsText(root, narration)).toBe(false);
		expect(containsText(root, "Submission recorded")).toBe(false);
		await act(async () =>
			findByLabel(root, "Copy assistant message")?.props.onPress(),
		);
		expect(Clipboard.setStringAsync).toHaveBeenCalledWith(summary);
	});
});
