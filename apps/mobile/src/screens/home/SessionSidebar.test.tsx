import * as Native from "react-native";
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

it("keeps searchable history and Settings reachable on short screens without duplicate chrome", () => {
	const dimensions = vi
		.spyOn(Native, "useWindowDimensions")
		.mockReturnValue({ width: 685, height: 320, scale: 2.625, fontScale: 1.3 });
	try {
		const { root, renderer } = render(
			<SessionSidebar
				open
				rows={[ROW]}
				now={0}
				onClose={() => {}}
				onNew={() => {}}
				onOpen={() => {}}
				onOpenSettings={() => {}}
			/>,
		);
		expect(findByLabel(root, "Settings")).toBeDefined();
		expect(
			root.find((node) => node.props.testID === "sidebar-short-header"),
		).toBeDefined();
		expect(containsText(root, "Sessions")).toBe(false);
		const input = findByLabel(root, "Search sessions")!;
		act(() => input.props.onChangeText("Fix"));
		dimensions.mockReturnValue({
			width: 411,
			height: 923,
			scale: 2.625,
			fontScale: 1.3,
		});
		act(() =>
			renderer.update(
				<SessionSidebar
					open
					rows={[ROW]}
					now={0}
					onClose={() => {}}
					onNew={() => {}}
					onOpen={() => {}}
					onOpenSettings={() => {}}
				/>,
			),
		);
		expect(findByLabel(root, "Search sessions")).toBe(input);
		expect(findByLabel(root, "Search sessions")!.props.value).toBe("Fix");
	} finally {
		dimensions.mockRestore();
	}
});

describe("sidebar virtual keyboard ownership", () => {
	const props = {
		open: true,
		rows: [ROW],
		now: 0,
		onClose: () => {},
		onNew: () => {},
		onOpen: () => {},
		onOpenSettings: () => {},
	};
	const content = (root: ReturnType<typeof render>["root"]) =>
		root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props.testID === "sidebar-keyboard-content",
		);
	it.each([
		"drawer",
		"inline",
	] as const)("keeps search, results and Settings inside %s's own keyboard boundary", (presentation) => {
		const { root } = render(
			<SessionSidebar {...props} presentation={presentation} />,
		);
		const boundary = root.find(
			(node) =>
				typeof node.type === "string" &&
				node.props.testID === "sidebar-keyboard-boundary",
		);
		expect(boundary.props.behavior).toBe("padding");
		expect(findByLabel(boundary, "Search sessions")).toBeDefined();
		expect(
			findByLabel(boundary, "Open Fix mobile navigation on Cline Cloud"),
		).toBeDefined();
		expect(findByLabel(boundary, "Settings")).toBeDefined();
		// The modal backdrop must cover the whole screen instead of shrinking with IME.
		expect(findByLabel(boundary, "Close sessions")).toBeUndefined();
	});
	it("uses available IME-reduced height without remounting or clearing Search", () => {
		const { root } = render(<SessionSidebar {...props} />);
		const input = findByLabel(root, "Search sessions");
		if (!input) throw new Error("Sidebar Search did not mount");
		act(() => input.props.onChangeText("navigation"));
		act(() =>
			content(root).props.onLayout({
				nativeEvent: { layout: { height: 240 } },
			}),
		);
		expect(
			root.find(
				(node) =>
					typeof node.type === "string" &&
					node.props.testID === "sidebar-short-header",
			),
		).toBeDefined();
		expect(findByLabel(root, "Search sessions")).toBe(input);
		expect(input.props.value).toBe("navigation");
		expect(
			findByLabel(root, "Open Fix mobile navigation on Cline Cloud"),
		).toBeDefined();
		act(() =>
			content(root).props.onLayout({
				nativeEvent: { layout: { height: 800 } },
			}),
		);
		expect(containsText(root, "Sessions")).toBe(true);
		expect(findByLabel(root, "Search sessions")).toBe(input);
		expect(input.props.value).toBe("navigation");
	});
	it("retains the open drawer's keyboard and query when rotation changes its width", () => {
		let width = 402;
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockImplementation(() => ({
				width,
				height: width === 402 ? 874 : 402,
				scale: 3,
				fontScale: 1,
			}));
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		try {
			const { root, renderer } = render(<SessionSidebar {...props} />);
			const search = findByLabel(root, "Search sessions");
			if (!search) throw new Error("Search missing");
			act(() => search.props.onChangeText("navigation"));
			dismiss.mockClear();
			width = 874;
			act(() => renderer.update(<SessionSidebar {...props} />));
			expect(dismiss).not.toHaveBeenCalled();
			expect(findByLabel(root, "Search sessions")).toBe(search);
			expect(search.props.value).toBe("navigation");
		} finally {
			dimensions.mockRestore();
			dismiss.mockRestore();
		}
	});

	it("prioritizes Search and explicit results/close actions over account chrome while typing in landscape", () => {
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockReturnValue({ width: 923, height: 411, scale: 2.625, fontScale: 1 });
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		const close = vi.fn();
		try {
			const { root } = render(<SessionSidebar {...props} onClose={close} />);
			const search = findByLabel(root, "Search sessions");
			if (!search) throw new Error("Search missing");
			act(() => {
				search.props.onFocus();
				search.props.onChangeText("navigation");
			});
			dismiss.mockClear();
			expect(findByLabel(root, "Collapse sidebar")).toBeDefined();
			act(() => findByLabel(root, "Show session results")?.props.onPress());
			expect(dismiss).toHaveBeenCalledOnce();
			expect(close).not.toHaveBeenCalled();
			act(() => search.props.onBlur());
			expect(findByLabel(root, "Search sessions")).toBe(search);
			expect(search.props.value).toBe("navigation");
			expect(findByLabel(root, "Show session results")).toBeUndefined();
		} finally {
			dimensions.mockRestore();
			dismiss.mockRestore();
		}
	});

	it("dismisses the keyboard before closing the drawer on Android Back", () => {
		const visible = vi.spyOn(Keyboard, "isVisible").mockReturnValue(true);
		const dismiss = vi.spyOn(Keyboard, "dismiss");
		try {
			const close = vi.fn();
			const { root } = render(<SessionSidebar {...props} onClose={close} />);
			const modal = findAllByType(root, "Modal")[0];
			if (!modal) throw new Error("Sidebar Modal did not mount");
			dismiss.mockClear();
			vi.mocked(withTiming).mockClear();
			act(() => modal.props.onRequestClose());
			expect(dismiss).toHaveBeenCalledOnce();
			expect(close).not.toHaveBeenCalled();
			expect(withTiming).not.toHaveBeenCalled();
			visible.mockReturnValue(false);
			let finish: Parameters<typeof withTiming>[2];
			vi.mocked(withTiming).mockImplementationOnce(
				(target, _config, callback) => {
					finish = callback;
					return target;
				},
			);
			act(() => modal.props.onRequestClose());
			expect(withTiming).toHaveBeenCalledOnce();
			expect(close).not.toHaveBeenCalled();
			act(() => finish?.(true));
			expect(close).toHaveBeenCalledOnce();
		} finally {
			visible.mockRestore();
			dismiss.mockRestore();
		}
	});
});
