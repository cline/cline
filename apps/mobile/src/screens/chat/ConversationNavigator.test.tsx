import { FlatList, ScrollView } from "react-native";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { SessionMessageView } from "@/session";
import { CodeBlock } from "@/ui";
import { render } from "../../ui/__testing__/render";
import {
	containsText,
	emptyView,
	fakeConnection,
	findByLabel,
} from "../__testing__/harness";
import { ArchivedChatScreen } from "../ArchivedChatScreen";
import { ChatScreen } from "../ChatScreen";
import {
	ConversationNavigator,
	conversationEntries,
} from "./ConversationNavigator";
import { messageCopyText } from "./message-text";

const messages: SessionMessageView[] = [
	{
		id: "internal",
		role: "user",
		origin: "hydrated",
		hidden: true,
		blocks: [{ kind: "text", text: "internal summary secret" }],
	},
	{
		id: "u1",
		role: "user",
		origin: "hydrated",
		blocks: [
			{
				kind: "text",
				text: '<user_input mode="act">Please inspect the app.</user_input>',
			},
		],
	},
	{
		id: "a1",
		role: "assistant",
		origin: "hydrated",
		blocks: [
			{
				kind: "text",
				text: `${"Earlier detail. ".repeat(30)}Needle is here. More detail.`,
			},
		],
	},
	{
		id: "u2",
		role: "user",
		origin: "hydrated",
		blocks: [{ kind: "text", text: "Second prompt" }],
	},
];
const longToolOutput = JSON.stringify(
	Array.from(
		{ length: 180 },
		(_, index) => `Output line ${index + 1}: task_id preserved`,
	).join("\n"),
);
const toolMessage: SessionMessageView = {
	id: "tool-only",
	role: "assistant",
	origin: "hydrated",
	blocks: [
		{
			kind: "tool",
			toolCallId: "opaque-call-id-not-visible",
			name: "execute_command",
			state: "completed",
			input: {
				command: "echo visible_command",
				metadata: "hidden-input-metadata",
			},
			output: longToolOutput,
		},
	],
};
const toolHistory = [
	{ role: "user", content: "Run the command" },
	{
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id: "call-1",
				name: "execute_command",
				input: { command: "echo visible_command" },
			},
		],
	},
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call-1",
				content: longToolOutput,
				is_error: false,
			},
		],
	},
	{ role: "assistant", content: "The work is done." },
];

describe("conversation navigation", () => {
	it("keeps user-role tool results out of authored prompts and labels explicit tool matches as Cline", () => {
		const result = {
			...toolMessage,
			id: "orphan-user-tool-result",
			role: "user" as const,
		};
		expect(
			conversationEntries([messages[1]!, result], "").map((entry) => entry.id),
		).toEqual(["u1"]);
		const matches = conversationEntries([result], "180");
		expect(matches).toHaveLength(1);
		expect(matches[0]?.role).toBe("assistant");
		const { root } = render(
			<ConversationNavigator
				visible
				messages={[messages[1]!, result]}
				onSelect={vi.fn()}
				onClose={vi.fn()}
				onBeginning={vi.fn()}
				onLatest={vi.fn()}
			/>,
		);
		expect(containsText(root, "1 prompt")).toBe(true);
		act(() =>
			findByLabel(root, "Search conversation")?.props.onChangeText("180"),
		);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith(
						"Jump to your prompt:",
					),
			).length,
		).toBe(0);
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith(
						"Jump to Cline message:",
					),
			).length,
		).toBeGreaterThan(0);
	});
	it("finds visible command/output/error text in tool-only messages without broadening copy or indexing provenance/media bytes", () => {
		expect(conversationEntries([toolMessage], "180")[0]?.id).toBe("tool-only");
		expect(conversationEntries([toolMessage], "VISIBLE_COMMAND")).toHaveLength(
			1,
		);
		expect(messageCopyText(toolMessage)).toBe("");
		expect(conversationEntries([toolMessage], "opaque-call-id")).toEqual([]);
		expect(conversationEntries([toolMessage], "hidden-input-metadata")).toEqual(
			[],
		);
		expect(
			conversationEntries([{ ...toolMessage, hidden: true }], "180"),
		).toEqual([]);
		const media: SessionMessageView = {
			...toolMessage,
			blocks: [
				{
					...toolMessage.blocks[0],
					kind: "tool",
					name: "read_file",
					state: "failed",
					input: { command: "read résumé.ts" },
					error: "File résumé.ts was not found",
					output: {
						type: "image",
						mediaType: "image/png",
						data: "PRIVATEBASE64",
					},
				} as Extract<SessionMessageView["blocks"][number], { kind: "tool" }>,
			],
		};
		expect(conversationEntries([media], "RÉSUMÉ.TS")).toHaveLength(1);
		expect(conversationEntries([media], "PRIVATEBASE64")).toEqual([]);
	});
	it.each([
		"live",
		"archive",
	])("reveals a tool search match inside folded %s work, scrolls its raw output, and preserves later manual collapse", (surface) => {
		const element =
			surface === "live" ? (
				<ChatScreen
					connection={fakeConnection({
						view: {
							...emptyView(),
							connectionStatus: "live",
							messages: [
								messages[1]!,
								toolMessage,
								{
									id: "final",
									role: "assistant",
									origin: "hydrated",
									blocks: [{ kind: "text", text: "The work is done." }],
								},
							],
						},
					})}
				/>
			) : (
				<ArchivedChatScreen history={toolHistory} />
			);
		const { root } = render(element);
		act(() => findByLabel(root, "Find in conversation")?.props.onPress());
		act(() =>
			findByLabel(root, "Search conversation")?.props.onChangeText("180"),
		);
		const result = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith(
						"Jump to Cline message:",
					) &&
					String(node.props.accessibilityLabel).includes("180"),
			)
			.at(0);
		expect(result).toBeDefined();
		act(() => result?.props.onPress());
		expect(findByLabel(root, "Copy tool output")).toBeDefined();
		const code = root.find((node) => node.type === CodeBlock);
		expect(code.props.children).toContain(longToolOutput);
		const vertical = code.findAll(
			(node) => node.type === ScrollView && !node.props.horizontal,
		)[0]!;
		const horizontal = code.findAll(
			(node) => node.type === ScrollView && node.props.horizontal,
		)[0]!;
		const scrollTo = vi.fn();
		horizontal.props.ref.current = { scrollTo };
		act(() => vertical.props.onContentSizeChange(45000, 40));
		act(() => horizontal.props.onContentSizeChange(45000, 40));
		expect(scrollTo).toHaveBeenCalledWith(
			expect.objectContaining({ x: expect.any(Number), animated: false }),
		);
		expect(scrollTo.mock.lastCall?.[0].x).toBeGreaterThan(40000);
		expect(vertical.props.onContentSizeChange).toBeDefined();
		const count = scrollTo.mock.calls.length;
		act(() => horizontal.props.onContentSizeChange(46000, 40));
		expect(scrollTo).toHaveBeenCalledTimes(count);
		const tool = root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					String(node.props.accessibilityLabel).startsWith("Tool "),
			)
			.at(0)!;
		act(() => tool.props.onPress());
		expect(findByLabel(root, "Copy tool output")).toBeUndefined();
		act(() => findByLabel(root, "Work, 1 tool")?.props.onPress());
		act(() => findByLabel(root, "Work, 1 tool")?.props.onPress());
		expect(findByLabel(root, "Copy tool output")).toBeUndefined();
		act(() => findByLabel(root, "Find in conversation")?.props.onPress());
		act(() =>
			findByLabel(root, "Search conversation")?.props.onChangeText("180"),
		);
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						String(node.props.accessibilityLabel).startsWith(
							"Jump to Cline message:",
						) &&
						String(node.props.accessibilityLabel).includes("180"),
				)
				.at(0)
				?.props.onPress(),
		);
		expect(findByLabel(root, "Copy tool output")).toBeDefined();
	});
	it("reveals a deep physical line for a live plain-text output without changing its text", () => {
		const text = Array.from(
			{ length: 180 },
			(_, index) => `Output line ${index + 1}`,
		).join("\n");
		const { root } = render(
			<CodeBlock revealText={{ query: "180", sequence: 1 }}>{text}</CodeBlock>,
		);
		const vertical = root.findAll(
			(node) => node.type === ScrollView && !node.props.horizontal,
		)[0]!;
		const horizontal = root.findAll(
			(node) => node.type === ScrollView && node.props.horizontal,
		)[0]!;
		const scrollTo = vi.fn();
		vertical.props.ref.current = { scrollTo };
		act(() => horizontal.props.onContentSizeChange(200, 3600));
		act(() => vertical.props.onContentSizeChange(200, 3600));
		expect(scrollTo).toHaveBeenCalledWith({ y: 3580, animated: false });
		expect(root.find((node) => node.type === CodeBlock).props.children).toBe(
			text,
		);
	});
	it("indexes clean user prompts by default and finds text deep in assistant answers", () => {
		expect(
			conversationEntries(messages, "").map((item) => [item.id, item.preview]),
		).toEqual([
			["u1", "Please inspect the app."],
			["u2", "Second prompt"],
		]);
		const [result] = conversationEntries(messages, "needle");
		expect(result?.id).toBe("a1");
		expect(result?.preview).toContain("Needle is here.");
		expect(result?.preview.startsWith("…")).toBe(true);
		expect(result?.preview.length).toBeLessThanOrEqual(182);
		expect(conversationEntries(messages, "internal")).toEqual([]);
		expect(conversationEntries(messages, "user_input")).toEqual([]);
	});
	it("offers search, clear empty results, and stable message destinations", () => {
		const select = vi.fn();
		const close = vi.fn();
		const beginning = vi.fn();
		const latest = vi.fn();
		const { root } = render(
			<ConversationNavigator
				visible
				messages={messages}
				onSelect={select}
				onClose={close}
				onBeginning={beginning}
				onLatest={latest}
			/>,
		);
		expect(containsText(root, "2 prompts")).toBe(true);
		act(() =>
			findByLabel(root, "Jump to your prompt: Second prompt")?.props.onPress(),
		);
		expect(select).toHaveBeenCalledWith("u2");
		act(() =>
			findByLabel(root, "Search conversation")?.props.onChangeText(
				"missing-query",
			),
		);
		expect(containsText(root, "No messages match your search.")).toBe(true);
		act(() => findByLabel(root, "Beginning")?.props.onPress());
		act(() => findByLabel(root, "Latest")?.props.onPress());
		act(() => findByLabel(root, "Close conversation search")?.props.onPress());
		expect(beginning).toHaveBeenCalledOnce();
		expect(latest).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
	});
	it("jumps to a selected prompt without following incoming transcript growth, then returns to latest", () => {
		const { root } = render(
			<ChatScreen
				connection={fakeConnection({
					view: { ...emptyView(), connectionStatus: "live", messages },
				})}
			/>,
		);
		const list = root.findAll((node) => node.type === FlatList)[0]!;
		const scrollToIndex = vi.fn();
		const scrollToOffset = vi.fn();
		list.props.ref.current = { scrollToIndex, scrollToOffset };
		act(() => findByLabel(root, "Find in conversation")?.props.onPress());
		act(() =>
			findByLabel(root, "Jump to your prompt: Second prompt")?.props.onPress(),
		);
		expect(scrollToIndex).toHaveBeenCalledWith({
			index: 2,
			animated: false,
			viewPosition: 0.1,
		});
		expect(findByLabel(root, "Close conversation search")).toBeUndefined();
		act(() => list.props.onContentSizeChange(400, 9000));
		expect(scrollToOffset).not.toHaveBeenCalled();
		act(() => findByLabel(root, "Jump to latest message")?.props.onPress());
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 9000,
			animated: true,
		});
	});
	it("recovers unmeasured variable-height rows and cancels a queued jump on user scroll", () => {
		vi.useFakeTimers();
		try {
			const { root } = render(
				<ChatScreen
					connection={fakeConnection({
						view: { ...emptyView(), connectionStatus: "live", messages },
					})}
				/>,
			);
			const list = root.findAll((node) => node.type === FlatList)[0]!;
			const scrollToOffset = vi.fn();
			const scrollToIndex = vi.fn().mockImplementationOnce(() =>
				list.props.onScrollToIndexFailed({
					index: 2,
					averageItemLength: 500,
					highestMeasuredFrameIndex: 0,
				}),
			);
			list.props.ref.current = { scrollToIndex, scrollToOffset };
			act(() => findByLabel(root, "Find in conversation")?.props.onPress());
			act(() =>
				findByLabel(
					root,
					"Jump to your prompt: Second prompt",
				)?.props.onPress(),
			);
			expect(scrollToOffset).toHaveBeenCalledWith({
				offset: 1000,
				animated: false,
			});
			act(() => {
				vi.advanceTimersByTime(120);
			});
			expect(scrollToIndex).toHaveBeenCalledTimes(2);
			scrollToIndex.mockImplementationOnce(() =>
				list.props.onScrollToIndexFailed({
					index: 2,
					averageItemLength: 500,
					highestMeasuredFrameIndex: 0,
				}),
			);
			act(() => findByLabel(root, "Find in conversation")?.props.onPress());
			act(() =>
				findByLabel(
					root,
					"Jump to your prompt: Second prompt",
				)?.props.onPress(),
			);
			act(() => list.props.onScrollBeginDrag());
			const count = scrollToIndex.mock.calls.length;
			act(() => {
				vi.advanceTimersByTime(500);
			});
			expect(scrollToIndex).toHaveBeenCalledTimes(count);
		} finally {
			vi.useRealTimers();
		}
	});
});

it("never indexes persisted runtime reminders as authored conversation prompts", async () => {
	const { createSessionState, reduceSession, selectViewModel } = await import(
		"@/session"
	);
	const { parseSessionMessagesReply } = await import("@/session/schemas");
	const parsed = parseSessionMessagesReply({
		messages: [
			{
				role: "user",
				content: "[SYSTEM] INTERNAL_REMINDER_TOOL must finish.",
				metadata: { userRunSpan: 0 },
			},
			{
				role: "user",
				content:
					'<user_input mode="act">Keep [SYSTEM] and <system-reminder>authored XML</system-reminder>.</user_input>',
				metadata: { userRunSpan: 0 },
			},
			{ role: "assistant", content: "Visible answer" },
		],
	});
	if (parsed.status !== "ok") throw new Error("Fixture must parse");
	const view = selectViewModel(
		reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		}),
	);
	expect(conversationEntries(view.messages, "INTERNAL_REMINDER")).toEqual([]);
	expect(conversationEntries(view.messages, "")).toMatchObject([
		{
			role: "user",
			preview:
				"Keep [SYSTEM] and <system-reminder>authored XML</system-reminder>.",
		},
	]);
	expect(conversationEntries(view.messages, "authored XML")).toHaveLength(1);
});
