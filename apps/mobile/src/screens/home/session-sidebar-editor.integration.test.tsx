import { NavigationContext } from "expo-router/react-navigation";
import type { ContextType } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findAllByType, render } from "@/ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import {
	AdaptiveSessionLayout,
	useAdaptiveSessionLayout,
} from "./AdaptiveSessionLayout";
import { SessionSidebar, type SessionSidebarProps } from "./SessionSidebar";
import type { SessionRow } from "./session-rows";

const row: SessionRow = {
	key: "owned-A",
	kind: "session",
	title: "Original title",
	location: { kind: "cloud", name: "fixture/repo" },
	online: true,
	descriptor: {
		mode: "cloud",
		remoteSessionId: "outer-A",
		url: "https://fixture/session/A",
	},
};
const other: SessionRow = {
	...row,
	key: "owned-B",
	title: "Other title",
	descriptor: {
		...row.descriptor,
		remoteSessionId: "outer-B",
		url: "https://fixture/session/B",
	},
};
function ResponsiveSidebar({
	rows,
	onRenameSession,
}: Pick<SessionSidebarProps, "rows" | "onRenameSession">) {
	const layout = useAdaptiveSessionLayout();
	return (
		<AdaptiveSessionLayout
			inlineSidebar={layout.wide && layout.visible}
			sidebar={
				<SessionSidebar
					rows={rows}
					now={0}
					open={layout.visible}
					presentation={layout.wide ? "inline" : "drawer"}
					onClose={layout.close}
					onNew={vi.fn()}
					onOpen={vi.fn()}
					onRenameSession={onRenameSession}
				/>
			}
		>
			<Native.Pressable
				accessibilityLabel="Open test sessions"
				onPress={layout.open}
			/>
		</AdaptiveSessionLayout>
	);
}
function dimensions() {
	let width = 390;
	vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
		width,
		height: width === 390 ? 1000 : 390,
		scale: 2,
		fontScale: 1,
	}));
	return (next: number) => {
		width = next;
	};
}
afterEach(() => vi.restoreAllMocks());

describe("actual responsive sidebar editor ownership", () => {
	it("retains exact request locks across route blur without leaking retired drafts or unlocking another pending row", async () => {
		dimensions();
		let focused = true;
		const blur = new Set<() => void>();
		const navigation = {
			isFocused: () => focused,
			addListener: (event: string, listener: () => void) => {
				if (event === "blur") blur.add(listener);
				return () => {
					blur.delete(listener);
				};
			},
		};
		const completions = new Map<
			string,
			{ resolve(): void; reject(error: Error): void }
		>();
		const rename = vi.fn(
			(selected: SessionRow) =>
				new Promise<void>((resolve, reject) => {
					completions.set(selected.key, { resolve, reject });
				}),
		);
		const screen = render(
			<NavigationContext.Provider value={navigation as never}>
				<ResponsiveSidebar rows={[row, other]} onRenameSession={rename} />
			</NavigationContext.Provider>,
		);
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		const open = (title: string) =>
			act(() =>
				findByLabel(
					screen.root,
					`Open ${title} on fixture/repo`,
				)?.props.onLongPress(),
			);
		const blurAndReturn = () =>
			act(() => {
				focused = false;
				for (const listener of blur) listener();
				focused = true;
			});
		open("Original title");
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"PRIVATE_PENDING_A",
			),
		);
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		blurAndReturn();
		expect(findByLabel(screen.root, "Session title")).toBeUndefined();
		open("Original title");
		expect(findByLabel(screen.root, "Rename session")).toBeUndefined();
		open("Other title");
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
			"Other title",
		);
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		await act(async () =>
			completions.get(row.key)?.reject(new Error("PRIVATE_LATE_A_ERROR")),
		);
		expect(containsText(screen.root, "PRIVATE_LATE_A_ERROR")).toBe(false);
		expect(findByLabel(screen.root, "Session title")?.props.editable).toBe(
			false,
		);
		blurAndReturn();
		open("Other title");
		expect(findByLabel(screen.root, "Rename session")).toBeUndefined();
		open("Original title");
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
			"Original title",
		);
		act(() => findByLabel(screen.root, "Cancel")?.props.onPress());
		await act(async () => completions.get(other.key)?.resolve());
		open("Other title");
		expect(findByLabel(screen.root, "Rename session")).toBeDefined();
		expect(rename).toHaveBeenCalledTimes(2);
	});
	it.each([
		390, 1000,
	])("keeps the same native editor presenter across resize from %i until dismissal", (initialWidth) => {
		const resize = dimensions();
		resize(initialWidth);
		const element = () => (
			<ResponsiveSidebar rows={[row]} onRenameSession={vi.fn()} />
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onLongPress(),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		const presenters = findAllByType(screen.root, "Modal");
		for (const width of [initialWidth === 390 ? 1000 : 390, initialWidth]) {
			act(() => {
				resize(width);
				screen.renderer.update(element());
			});
			const current = findAllByType(screen.root, "Modal");
			expect(current).toHaveLength(presenters.length);
			expect(
				current.every(
					(modal, index) => modal === presenters[index] && modal.props.visible,
				),
			).toBe(true);
		}
		act(() => {
			resize(initialWidth === 390 ? 1000 : 390);
			screen.renderer.update(element());
		});
		act(() => findByLabel(screen.root, "Cancel")?.props.onPress());
		expect(Boolean(findByLabel(screen.root, "Session title"))).toBe(false);
		expect(findAllByType(screen.root, "Modal")).toHaveLength(
			initialWidth === 390 ? 0 : 1,
		);
	});
	it("presents actions beneath the active drawer modal host, with state outside that host", () => {
		dimensions();
		const screen = render(
			<ResponsiveSidebar rows={[row]} onRenameSession={vi.fn()} />,
		);
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		const drawer = findAllByType(screen.root, "Modal")[0];
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onLongPress(),
		);
		const modals = findAllByType(screen.root, "Modal");
		expect(modals).toHaveLength(2);
		let ancestor = modals[1]?.parent;
		while (ancestor && ancestor !== modals[0]) ancestor = ancestor.parent;
		expect(ancestor === modals[0]).toBe(true);
		// Opening/closing actions must not tear down and re-present the drawer.
		expect(modals[0] === drawer).toBe(true);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() => findByLabel(screen.root, "Cancel")?.props.onPress());
		expect(findAllByType(screen.root, "Modal")[0] === drawer).toBe(true);
	});
	it("retires a stable editor on route blur and rejects delayed triggers while another route owns focus", () => {
		dimensions();
		let focused = true;
		const blurListeners = new Set<() => void>();
		const navigation = {
			isFocused: () => focused,
			addListener: (event: string, listener: () => void) => {
				if (event === "blur") blurListeners.add(listener);
				return () => {
					blurListeners.delete(listener);
				};
			},
		} as unknown as NonNullable<ContextType<typeof NavigationContext>>;
		const rename = vi.fn(async () => {});
		const element = () => (
			<NavigationContext.Provider value={navigation}>
				<ResponsiveSidebar rows={[row]} onRenameSession={rename} />
			</NavigationContext.Provider>
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		const trigger = findByLabel(
			screen.root,
			"Open Original title on fixture/repo",
		)?.props.onLongPress;
		act(() => trigger?.());
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"PRIVATE_ROUTE_DRAFT",
			),
		);
		act(() => {
			focused = false;
			for (const listener of blurListeners) listener();
		});
		expect(Boolean(findByLabel(screen.root, "Session title"))).toBe(false);
		act(() => trigger?.());
		expect(Boolean(findByLabel(screen.root, "Rename session"))).toBe(false);
		act(() => {
			focused = true;
			screen.renderer.update(element());
			findByLabel(screen.root, "Open test sessions")?.props.onPress();
		});
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onLongPress(),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
			"Original title",
		);
		expect(containsText(screen.root, "PRIVATE_ROUTE_DRAFT")).toBe(false);
		expect(rename).not.toHaveBeenCalled();
	});
	it("closes only the stale anchored menu on resize and wires hardware Back to dismiss the stable dialog", () => {
		const resize = dimensions();
		const rename = vi.fn(async () => {});
		const element = () => (
			<ResponsiveSidebar rows={[row]} onRenameSession={rename} />
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		const openActions = () =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onAccessibilityAction({
				nativeEvent: { actionName: "sessionActions" },
			});
		act(openActions);
		expect(Boolean(findByLabel(screen.root, "Rename session"))).toBe(true);
		act(() => {
			resize(1000);
			screen.renderer.update(element());
		});
		expect(Boolean(findByLabel(screen.root, "Rename session"))).toBe(false);
		act(openActions);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"Unsubmitted draft",
			),
		);
		act(() =>
			findAllByType(screen.root, "Modal").at(-1)?.props.onRequestClose(),
		);
		expect(Boolean(findByLabel(screen.root, "Session title"))).toBe(false);
		expect(rename).not.toHaveBeenCalled();
		expect(Boolean(findByLabel(screen.root, "Search sessions"))).toBe(true);
	});
	it("retains rejected rename text/error and exact row through drawer-inline-drawer, reorder and remote title refresh", async () => {
		const resize = dimensions();
		const rename = vi
			.fn()
			.mockRejectedValueOnce(new Error("Fixture rename-error503"))
			.mockResolvedValueOnce(undefined);
		let rows = [row, other];
		const element = () => (
			<ResponsiveSidebar rows={rows} onRenameSession={rename} />
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onLongPress(),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"CONT_ANDROID_RENAMED",
			),
		);
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		expect(containsText(screen.root, "Fixture rename-error503")).toBe(true);
		rows = [other, { ...row, title: "A newer remote title" }];
		for (const width of [1000, 390]) {
			act(() => {
				resize(width);
				screen.renderer.update(element());
			});
			// Returning narrow closes the navigation drawer, but every native
			// presenter ancestor must stay visible until this editor is dismissed.
			const presenters = findAllByType(screen.root, "Modal");
			expect(presenters).toHaveLength(2);
			expect(presenters.every((modal) => modal.props.visible)).toBe(true);
			expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
				"CONT_ANDROID_RENAMED",
			);
			expect(containsText(screen.root, "Fixture rename-error503")).toBe(true);
		}
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		expect(rename).toHaveBeenCalledTimes(2);
		for (const [selected, title] of rename.mock.calls) {
			expect(selected.descriptor.remoteSessionId).toBe("outer-A");
			expect(title).toBe("CONT_ANDROID_RENAMED");
		}
		expect(findByLabel(screen.root, "Session title")).toBeUndefined();
	});
	it("keeps one pending save locked to its exact row across both layout transitions", async () => {
		const resize = dimensions();
		let finish = () => {};
		const rename = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const element = () => (
			<ResponsiveSidebar rows={[row, other]} onRenameSession={rename} />
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onAccessibilityAction({
				nativeEvent: { actionName: "sessionActions" },
			}),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"Pending exact title",
			),
		);
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		for (const width of [1000, 390]) {
			act(() => {
				resize(width);
				screen.renderer.update(element());
			});
			expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
				"Pending exact title",
			);
			expect(findByLabel(screen.root, "Session title")?.props.editable).toBe(
				false,
			);
			act(() => {
				findByLabel(screen.root, "Save title")?.props.onPress();
				findByLabel(
					screen.root,
					"Open Other title on fixture/repo",
				)?.props.onLongPress?.();
			});
		}
		expect(rename).toHaveBeenCalledExactlyOnceWith(row, "Pending exact title");
		await act(async () => finish());
		expect(findByLabel(screen.root, "Session title")).toBeUndefined();
	});
	it("retires an editor when its row/account rows disappear and ignores its late result after another row opens", async () => {
		dimensions();
		let reject = (_error: Error) => {};
		const rename = vi.fn(
			() =>
				new Promise<void>((_resolve, no) => {
					reject = no;
				}),
		);
		let rows = [row];
		const element = () => (
			<ResponsiveSidebar rows={rows} onRenameSession={rename} />
		);
		const screen = render(element());
		act(() => findByLabel(screen.root, "Open test sessions")?.props.onPress());
		act(() =>
			findByLabel(
				screen.root,
				"Open Original title on fixture/repo",
			)?.props.onLongPress(),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"PRIVATE_OLD_ROW_TITLE",
			),
		);
		await act(async () =>
			findByLabel(screen.root, "Save title")?.props.onPress(),
		);
		act(() => {
			rows = [];
			screen.renderer.update(element());
		});
		expect(Boolean(findByLabel(screen.root, "Session title"))).toBe(false);
		act(() => {
			rows = [other];
			screen.renderer.update(element());
		});
		act(() =>
			findByLabel(
				screen.root,
				"Open Other title on fixture/repo",
			)?.props.onLongPress(),
		);
		act(() => findByLabel(screen.root, "Rename session")?.props.onPress());
		act(() =>
			findByLabel(screen.root, "Session title")?.props.onChangeText(
				"New row draft",
			),
		);
		await act(async () => reject(new Error("PRIVATE_OLD_ROW_ERROR")));
		expect(findByLabel(screen.root, "Session title")?.props.value).toBe(
			"New row draft",
		);
		expect(containsText(screen.root, "PRIVATE_OLD_ROW_TITLE")).toBe(false);
		expect(containsText(screen.root, "PRIVATE_OLD_ROW_ERROR")).toBe(false);
	});
});
