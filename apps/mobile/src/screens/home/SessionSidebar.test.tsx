import { Keyboard } from "react-native";
import { withTiming } from "react-native-reanimated";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDescriptor } from "@/connection";
import { findAllByType, render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { SessionSidebar } from "./SessionSidebar";
import type { SessionRow } from "./session-rows";

const DESCRIPTOR: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://pod.cline.bot/hub",
	remoteSessionId: "session-1",
	label: "Fix mobile navigation",
};

const ROW: SessionRow = {
	key: '["cloud","https://pod.cline.bot/hub"]',
	kind: "session",
	title: "Fix mobile navigation",
	location: { kind: "cloud", name: "Cline Cloud" },
	online: true,
	status: "running",
	activity: { at: 1_699_999_940_000, kind: "updated" },
	descriptor: DESCRIPTOR,
};

function findByLabel(root: ReturnType<typeof render>["root"], label: string) {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1);
}

describe("SessionSidebar", () => {
	it("offers Retry without losing cached rows or opening a session", () => {
		const refresh = vi.fn();
		const open = vi.fn();
		const { root, renderer } = render(
			<SessionSidebar
				open
				rows={[ROW]}
				now={0}
				error="Offline"
				onRefresh={refresh}
				onClose={vi.fn()}
				onNew={vi.fn()}
				onOpen={open}
			/>,
		);
		act(() => findByLabel(root, "Retry session history")?.props.onPress());
		expect(refresh).toHaveBeenCalledOnce();
		expect(open).not.toHaveBeenCalled();
		expect(containsText(root, ROW.title)).toBe(true);
		act(() =>
			renderer.update(
				<SessionSidebar
					open
					rows={[ROW]}
					now={0}
					error="Offline"
					refreshing
					onRefresh={refresh}
					onClose={vi.fn()}
					onNew={vi.fn()}
					onOpen={open}
				/>,
			),
		);
		expect(findByLabel(root, "Retry session history")?.props.disabled).toBe(
			true,
		);
	});
	it("does not claim an empty or cached history when its first load failed", () => {
		const { root } = render(
			<SessionSidebar
				open
				rows={[]}
				now={0}
				error="Could not refresh sessions."
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
			/>,
		);
		expect(containsText(root, "Session history is unavailable.")).toBe(true);
		expect(containsText(root, "No sessions yet.")).toBe(false);
		expect(
			containsText(root, "Showing the last sessions available on this device."),
		).toBe(false);
	});
	it("renders inline navigation without a modal, backdrop or keyboard dismissal", () => {
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const { root, unmount } = render(
			<SessionSidebar
				presentation="inline"
				open
				rows={[ROW]}
				now={1_700_000_000_000}
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
				onOpenSettings={() => {}}
			/>,
		);
		expect(findAllByType(root, "Modal")).toHaveLength(0);
		expect(findByLabel(root, "Close sessions")).toBeUndefined();
		for (const label of [
			"New",
			"Search sessions",
			"Collapse sidebar",
			"Settings",
		])
			expect(findByLabel(root, label)).toBeDefined();
		act(() => findByLabel(root, "Collapse sidebar")?.props.onPress());
		expect(
			root.findAll((node) => node.props.accessibilityViewIsModal === true),
		).toHaveLength(0);
		expect(dismiss).not.toHaveBeenCalled();
		unmount();
		dismiss.mockRestore();
	});
	it.each([
		"running",
		"idle",
		"failed",
		"provisioning",
	] as const)("shows %s independently of machine reachability", (status) => {
		const { root } = render(
			<SessionSidebar
				now={1_700_000_000_000}
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
				open
				rows={[{ ...ROW, status, online: true }]}
			/>,
		);
		expect(
			containsText(
				root,
				status === "provisioning"
					? "Starting"
					: status[0]!.toUpperCase() + status.slice(1),
			),
		).toBe(true);
		expect(findByLabel(root, "Cline Cloud is online")).toBeUndefined();
	});
	it("opens a full-height leading drawer after native presentation", () => {
		vi.mocked(withTiming).mockClear();
		const { root } = render(
			<SessionSidebar
				now={1_700_000_000_000}
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
				open
				rows={[ROW]}
			/>,
		);
		const modal = findAllByType(root, "Modal").at(0);
		expect(modal?.props.visible).toBe(true);
		expect(modal?.props.animationType).toBe("none");
		expect(withTiming).not.toHaveBeenCalled();
		act(() => modal?.props.onShow());
		expect(withTiming).toHaveBeenCalledOnce();
		expect(
			root.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.testID === "session-sidebar",
			),
		).toHaveLength(1);
		expect(findAllByType(root, "BottomSheet")).toHaveLength(0);
	});
	it.each([
		false,
		true,
	])("dismisses only after an uninterrupted exit (finished=%s)", (finished) => {
		const onClose = vi.fn();
		let complete: Parameters<typeof withTiming>[2];
		const { root } = render(
			<SessionSidebar
				open
				rows={[]}
				now={0}
				onClose={onClose}
				onNew={() => {}}
				onOpen={() => {}}
			/>,
		);
		vi.mocked(withTiming).mockImplementationOnce(
			(target, _config, callback) => {
				complete = callback;
				return target;
			},
		);
		act(() => findByLabel(root, "Collapse sidebar")?.props.onPress());
		expect(onClose).not.toHaveBeenCalled();
		expect(complete).toBeDefined();
		const animationCount = vi.mocked(withTiming).mock.calls.length;
		act(() => findAllByType(root, "Modal").at(0)?.props.onShow());
		expect(withTiming).toHaveBeenCalledTimes(animationCount);
		act(() => complete?.(finished));
		expect(onClose).toHaveBeenCalledTimes(finished ? 1 : 0);
	});

	it("exposes desktop's New, session, close, and Settings actions", () => {
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const onClose = vi.fn();
		const onNew = vi.fn();
		const onOpen = vi.fn();
		const onOpenSettings = vi.fn();
		const { root } = render(
			<SessionSidebar
				activeKey={ROW.key}
				now={1_700_000_000_000}
				onClose={onClose}
				onNew={onNew}
				onOpen={onOpen}
				onOpenSettings={onOpenSettings}
				open
				rows={[ROW]}
			/>,
		);

		dismiss.mockClear();
		act(() => findByLabel(root, "New")?.props.onPress());
		expect(dismiss).toHaveBeenCalledOnce();
		dismiss.mockClear();
		act(() =>
			findByLabel(
				root,
				"Open Fix mobile navigation on Cline Cloud",
			)?.props.onPress(),
		);
		expect(dismiss).toHaveBeenCalledOnce();
		dismiss.mockClear();
		act(() => findByLabel(root, "Settings")?.props.onPress());
		expect(dismiss).toHaveBeenCalledOnce();
		act(() => findByLabel(root, "Collapse sidebar")?.props.onPress());

		expect(onNew).toHaveBeenCalledOnce();
		expect(onOpen).toHaveBeenCalledWith(ROW);
		expect(onOpenSettings).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
		dismiss.mockRestore();
	});

	it("filters long session history from its persistent search field", () => {
		const { root } = render(
			<SessionSidebar
				now={1_700_000_000_000}
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
				open
				rows={[ROW, { ...ROW, key: "other", title: "Unrelated session" }]}
			/>,
		);
		act(() => {
			findByLabel(root, "Search sessions")?.props.onChangeText("navigation");
		});
		expect(
			findByLabel(root, "Open Fix mobile navigation on Cline Cloud"),
		).toBeDefined();
		expect(
			findByLabel(root, "Open Unrelated session on Cline Cloud"),
		).toBeUndefined();
	});
});
