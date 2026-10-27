import { FlatList } from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import {
	ArchivedChatScreen,
	projectArchivedMessages,
} from "./ArchivedChatScreen";
import { ConversationNavigator } from "./chat/ConversationNavigator";

describe("ArchivedChatScreen", () => {
	it("filters internal reasoning before grouping it with the next archived assistant answer", () => {
		const projected = projectArchivedMessages([
			{
				role: "assistant",
				metadata: { displayRole: "system" },
				content: [{ type: "thinking", thinking: "Private runtime context" }],
			},
			{ role: "assistant", content: "Visible archived answer" },
		]);
		expect(projected.messages).toHaveLength(1);
		expect(projected.messages[0]?.blocks).toEqual([
			{ kind: "text", text: "Visible archived answer" },
		]);
	});
	it("retains a failed workspace reason even when no archive exists", () => {
		const { root } = render(
			<ArchivedChatScreen notice="This Cloud workspace failed. Repository checkout failed." />,
		);
		expect(containsText(root, "Repository checkout failed.")).toBe(true);
		expect(containsText(root, "No saved conversation is available")).toBe(true);
	});
	it("reuses persisted-message rendering without send, stop, model, or idle controls", () => {
		const { root } = render(
			<ArchivedChatScreen
				history={[
					{ role: "user", content: "Please fix this" },
					{
						role: "assistant",
						content: [{ type: "text", text: "Fixed the issue" }],
					},
				]}
			/>,
		);
		expect(containsText(root, "Please fix this")).toBe(true);
		expect(containsText(root, "Fixed the issue")).toBe(true);
		expect(containsText(root, "read-only")).toBe(true);
		expect(containsText(root, "Idle")).toBe(false);
		expect(
			root.findAll((node) =>
				["Message composer", "Send message", "Stop", "Choose model"].includes(
					node.props.accessibilityLabel,
				),
			),
		).toHaveLength(0);
	});
	it("distinguishes absent history, empty history, loading, and failed fetches", () => {
		expect(
			containsText(
				render(<ArchivedChatScreen />).root,
				"No saved conversation is available",
			),
		).toBe(true);
		expect(
			containsText(
				render(<ArchivedChatScreen history={[]} />).root,
				"has no messages",
			),
		).toBe(true);
		expect(
			containsText(
				render(<ArchivedChatScreen loading />).root,
				"Loading saved conversation…",
			),
		).toBe(true);
		expect(
			containsText(
				render(
					<ArchivedChatScreen error={new Error("offline")} onRetry={vi.fn()} />,
				).root,
				"Retry",
			),
		).toBe(true);
	});
	it("salvages valid rows and reports malformed entries", () => {
		const result = projectArchivedMessages([
			{ role: "user", content: "Keep me" },
			{ nope: true },
		]);
		expect(result.invalidCount).toBe(1);
		expect(result.messages).toHaveLength(1);
		const { root } = render(<ArchivedChatScreen history={[{ nope: true }]} />);
		expect(containsText(root, "could not be displayed")).toBe(true);
		expect(containsText(root, "has no messages")).toBe(false);
	});
	it("starts a new session from the header without connecting to the archive", () => {
		const onNewChat = vi.fn();
		const { root } = render(
			<ArchivedChatScreen history={[]} onNewChat={onNewChat} />,
		);
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "New session",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(onNewChat).toHaveBeenCalledOnce();
	});
});

describe("archived conversation navigation", () => {
	afterEach(() => vi.useRealTimers());
	const history = Array.from({ length: 40 }, (_, index) => ({
		role: index % 2 ? "assistant" : "user",
		content: `Archived section ${index}`,
	}));
	function setup() {
		const rendered = render(<ArchivedChatScreen history={history} />);
		const list = rendered.root.findAll((node) => node.type === FlatList)[0]!;
		const scrollToIndex = vi.fn();
		const scrollToOffset = vi.fn();
		list.props.ref.current = { scrollToIndex, scrollToOffset };
		const navigator = () =>
			rendered.root.find((node) => node.type === ConversationNavigator);
		return { ...rendered, list, scrollToIndex, scrollToOffset, navigator };
	}
	it("opens the shared prompt/search navigator and jumps to an older result, Beginning and Latest", () => {
		const { root, list, navigator, scrollToIndex, scrollToOffset } = setup();
		act(() =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Find in conversation",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(navigator().props.visible).toBe(true);
		const messages = navigator().props.messages;
		act(() => navigator().props.onSelect(messages[18].id));
		expect(scrollToIndex).toHaveBeenLastCalledWith({
			index: 18,
			animated: false,
			viewPosition: 0.1,
		});
		expect(navigator().props.visible).toBe(false);
		act(() => navigator().props.onBeginning());
		expect(scrollToIndex).toHaveBeenLastCalledWith({
			index: 0,
			animated: false,
			viewPosition: 0.1,
		});
		act(() => {
			list.props.onContentSizeChange(400, 9000);
			navigator().props.onLatest();
		});
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 9000,
			animated: true,
		});
	});
	it("retries unmeasured rows after approximate positioning and stops with useful feedback", () => {
		vi.useFakeTimers();
		const { root, list, navigator, scrollToIndex, scrollToOffset } = setup();
		scrollToIndex.mockImplementation(({ index }) =>
			list.props.onScrollToIndexFailed({ index, averageItemLength: 100 }),
		);
		act(() => navigator().props.onSelect(navigator().props.messages[18].id));
		expect(scrollToOffset).toHaveBeenLastCalledWith({
			offset: 1800,
			animated: false,
		});
		act(() => {
			vi.advanceTimersByTime(120);
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(2);
		act(() => {
			vi.runAllTimers();
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(9);
		expect(containsText(root, "This message could not be located")).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("cancels a pending retry when Latest, user scrolling or unmount supersedes it", () => {
		vi.useFakeTimers();
		const { list, navigator, scrollToIndex, unmount } = setup();
		scrollToIndex.mockImplementation(({ index }) =>
			list.props.onScrollToIndexFailed({ index, averageItemLength: 100 }),
		);
		const select = () =>
			navigator().props.onSelect(navigator().props.messages[18].id);
		act(select);
		act(() => navigator().props.onLatest());
		act(() => {
			vi.runAllTimers();
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		act(select);
		act(() => list.props.onScrollBeginDrag());
		act(() => {
			vi.runAllTimers();
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(2);
		act(select);
		unmount();
		act(() => {
			vi.runAllTimers();
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("cancels pending jumps and closes search when the archive changes", () => {
		vi.useFakeTimers();
		const { list, navigator, scrollToIndex, renderer } = setup();
		scrollToIndex.mockImplementation(({ index }) =>
			list.props.onScrollToIndexFailed({ index, averageItemLength: 100 }),
		);
		act(() => navigator().props.onSelect(navigator().props.messages[18].id));
		act(() =>
			renderer.update(
				<ArchivedChatScreen
					history={[{ role: "user", content: "Replacement archive" }]}
				/>,
			),
		);
		act(() => {
			vi.runAllTimers();
		});
		expect(scrollToIndex).toHaveBeenCalledTimes(1);
		expect(navigator().props.visible).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
});
