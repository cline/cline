import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { SessionActions, type SessionActionsProps } from "./SessionActions";
import { SessionRowView } from "./SessionRowView";
import type { SessionRow } from "./session-rows";

const row: SessionRow = {
	key: "cloud-1",
	title: "Fix the issue",
	kind: "session",
	location: { kind: "cloud", name: "Cline Cloud" },
	online: false,
	descriptor: {
		mode: "cloud",
		remoteSessionId: "s1",
		url: "https://api.cline.bot",
	},
};

function controls(root: ReturnType<typeof render>["root"]) {
	return (label: string) =>
		root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === label,
			)
			.at(-1)!;
}

function Actions(props: Omit<SessionActionsProps, "children">) {
	return (
		<SessionActions {...props}>
			{(trigger) => (
				<SessionRowView
					{...trigger}
					row={props.row}
					now={0}
					onPress={() => {}}
				/>
			)}
		</SessionActions>
	);
}

afterEach(() => vi.restoreAllMocks());

describe("SessionActions", () => {
	it("confirms a resumable workspace stop while retaining its conversation", async () => {
		const onStopWorkspace = vi.fn(async () => {});
		const stoppable = { ...row, canStopWorkspace: true };
		const mounted = render(
			<Actions row={stoppable} onStopWorkspace={onStopWorkspace} />,
		);
		const get = controls(mounted.root);
		act(() => get("Open Fix the issue on Cline Cloud").props.onLongPress());
		act(() => get("Stop workspace").props.onPress());
		expect(onStopWorkspace).not.toHaveBeenCalled();
		expect(containsText(mounted.root, "Open the session again to resume")).toBe(
			true,
		);
		await act(async () => get("Confirm stop").props.onPress());
		expect(onStopWorkspace).toHaveBeenCalledExactlyOnceWith(stoppable);
		expect(get("Confirm stop")).toBeUndefined();
		act(() =>
			mounted.renderer.update(
				<Actions row={row} onStopWorkspace={onStopWorkspace} />,
			),
		);
		expect(
			get("Open Fix the issue on Cline Cloud").props.onLongPress,
		).toBeUndefined();
	});
	it("dismisses a stale menu on resize but preserves an edited rename", async () => {
		let width = 834;
		vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
			width,
			height: width === 834 ? 1194 : 834,
			scale: 2,
			fontScale: 1,
		}));
		const onRenameSession = vi.fn(async () => {});
		const mounted = render(
			<Actions row={row} onRenameSession={onRenameSession} />,
		);
		const get = controls(mounted.root);
		act(() => get("Open Fix the issue on Cline Cloud").props.onLongPress());
		expect(get("Rename session")).toBeDefined();
		act(() => {
			width = 1194;
			mounted.renderer.update(
				<Actions row={row} onRenameSession={onRenameSession} />,
			);
		});
		expect(findAllByType(mounted.root, "Modal")).toHaveLength(0);
		act(() => get("Open Fix the issue on Cline Cloud").props.onLongPress());
		act(() => get("Rename session").props.onPress());
		act(() => get("Session title").props.onChangeText("Unsubmitted title"));
		act(() => {
			width = 834;
			mounted.renderer.update(
				<Actions row={row} onRenameSession={onRenameSession} />,
			);
		});
		expect(get("Session title").props.value).toBe("Unsubmitted title");
		expect(onRenameSession).not.toHaveBeenCalled();
		await act(async () => get("Save title").props.onPress());
		expect(onRenameSession).toHaveBeenCalledExactlyOnceWith(
			row,
			"Unsubmitted title",
		);
		mounted.unmount();
	});
	it("requires an explicit confirmation before deleting, awaits the call, and reports failures", async () => {
		let reject!: (reason: Error) => void;
		const onDeleteSession = vi.fn(
			() =>
				new Promise<void>((_resolve, no) => {
					reject = no;
				}),
		);
		const { root } = render(
			<Actions row={row} onDeleteSession={onDeleteSession} />,
		);
		const get = controls(root);
		act(() => get("Open Fix the issue on Cline Cloud").props.onLongPress());
		act(() => get("Delete session").props.onPress());
		expect(onDeleteSession).not.toHaveBeenCalled();
		expect(containsText(root, "cannot be undone")).toBe(true);
		await act(async () => get("Confirm delete").props.onPress());
		expect(onDeleteSession).toHaveBeenCalledExactlyOnceWith(row);
		expect(
			get("Open Fix the issue on Cline Cloud").props.accessibilityHint,
		).toContain("Updating session");
		await act(async () => reject(new Error("Network unavailable")));
		expect(
			get("Open Fix the issue on Cline Cloud").props.accessibilityHint,
		).not.toContain("Updating session");
		expect(containsText(root, "Network unavailable")).toBe(true);
		expect(get("Confirm delete")).toBeDefined();
	});
	it("renames using trimmed nonempty text", async () => {
		const onRenameSession = vi.fn(async () => {});
		const { root } = render(
			<Actions row={row} onRenameSession={onRenameSession} />,
		);
		const get = controls(root);
		act(() => get("Open Fix the issue on Cline Cloud").props.onLongPress());
		act(() => get("Rename session").props.onPress());
		expect(get("Session title").props.autoFocus).toBe(true);
		act(() => get("Session title").props.onChangeText("  New name  "));
		await act(async () => get("Save title").props.onPress());
		expect(onRenameSession).toHaveBeenCalledWith(row, "New name");
		expect(get("Save title")).toBeUndefined();
	});
	it("opens actions in an overlay and dismisses without changing the session", () => {
		const onRenameSession = vi.fn(async () => {});
		const { root } = render(
			<Actions row={row} onRenameSession={onRenameSession} />,
		);
		const get = controls(root);
		expect(get("More actions for Fix the issue")).toBeUndefined();
		act(() =>
			get("Open Fix the issue on Cline Cloud").props.onAccessibilityAction({
				nativeEvent: { actionName: "sessionActions" },
			}),
		);
		const modal = findAllByType(root, "Modal").at(-1)!;
		expect(modal.props.transparent).toBe(true);
		expect(
			modal.findAll((node) => node.props.testID === "session-actions-menu")
				.length,
		).toBeGreaterThan(0);
		act(() => get("Dismiss session actions").props.onPress());
		expect(findAllByType(root, "Modal")).toHaveLength(0);
		expect(onRenameSession).not.toHaveBeenCalled();
	});
	it("never exposes Cloud deletion for a local conversation", () => {
		const local: SessionRow = {
			...row,
			descriptor: { mode: "local", url: "ws://127.0.0.1:4599/hub" },
		};
		const { root } = render(<Actions row={local} onDeleteSession={vi.fn()} />);
		expect(
			controls(root)("Open Fix the issue on Cline Cloud").props.onLongPress,
		).toBeUndefined();
	});
});
