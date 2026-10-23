import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import {
	ArchivedChatScreen,
	projectArchivedMessages,
} from "./ArchivedChatScreen";

describe("ArchivedChatScreen", () => {
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
