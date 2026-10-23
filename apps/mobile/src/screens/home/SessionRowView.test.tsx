import { describe, expect, it, vi } from "vitest";
import { render } from "@/ui/__testing__/render";
import { StatusDot } from "@/ui/primitives/StatusDot";
import { containsText } from "../__testing__/harness";
import { SessionRowView } from "./SessionRowView";
import type { SessionRow } from "./session-rows";

const row: SessionRow = {
	key: "cloud-a",
	kind: "session",
	title: "Review changes",
	location: { kind: "cloud", name: "cline/cline" },
	online: false,
	status: "completed",
	unread: true,
	descriptor: { mode: "cloud", url: "https://core/session/a" },
};

describe("SessionRowView unread activity", () => {
	it.each([
		true,
		false,
	])("renders an accessible blue marker (compact=%s)", (compact) => {
		const { root } = render(
			<SessionRowView row={row} now={0} compact={compact} onPress={vi.fn()} />,
		);
		expect(
			root.findAll(
				(node) => node.type === StatusDot && node.props.tone === "unread",
			),
		).toHaveLength(1);
		expect(
			root.findAll((node) =>
				node.props.accessibilityHint?.includes("Unread activity"),
			).length,
		).toBeGreaterThan(0);
		expect(containsText(root, "Completed")).toBe(true);
	});
	it("does not show unread on the selected session", () => {
		const { root } = render(
			<SessionRowView row={row} now={0} active compact onPress={vi.fn()} />,
		);
		expect(
			root.findAll(
				(node) => node.type === StatusDot && node.props.tone === "unread",
			),
		).toHaveLength(0);
		expect(
			root.findAll((node) =>
				node.props.accessibilityHint?.includes("Unread activity"),
			),
		).toHaveLength(0);
	});
	it("retains unread after its idle connection is evicted, without inventing run status", () => {
		const { root } = render(
			<SessionRowView
				row={{ ...row, status: undefined }}
				now={0}
				compact
				onPress={vi.fn()}
			/>,
		);
		expect(containsText(root, "Unread activity")).toBe(true);
		expect(containsText(root, "Completed")).toBe(false);
		expect(
			root.findAll(
				(node) => node.type === StatusDot && node.props.tone === "unread",
			),
		).toHaveLength(1);
	});
});
