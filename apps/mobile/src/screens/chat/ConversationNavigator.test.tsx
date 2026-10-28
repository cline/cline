import { FlatList } from "react-native";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { SessionMessageView } from "@/session";
import { render } from "../../ui/__testing__/render";
import {
	containsText,
	emptyView,
	fakeConnection,
	findByLabel,
} from "../__testing__/harness";
import { ChatScreen } from "../ChatScreen";
import {
	ConversationNavigator,
	conversationEntries,
} from "./ConversationNavigator";

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

describe("conversation navigation", () => {
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
