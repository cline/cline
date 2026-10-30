// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	ConversationWorkspace,
	type ConversationWorkspaceControls,
	useConversationWorkspace,
} from "./conversation-workspace";

vi.mock("@/lib/prompt-input-focus", () => ({
	requestPromptInputFocus: vi.fn(),
}));
let root: Root;
let host: HTMLDivElement;
let width = 1200;
let observers: (() => void)[];
let rail: ConversationWorkspaceControls;
const mounts = { main: 0, side: 0 };
function Chat({ surface }: { surface: "main" | "side" }) {
	useEffect(() => {
		mounts[surface]++;
	}, [surface]);
	return (
		<textarea
			aria-label={`${surface} draft`}
			defaultValue={`${surface} unsent text`}
		/>
	);
}
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	width = 1200;
	window.localStorage.clear();
	observers = [];
	mounts.main = 0;
	mounts.side = 0;
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
		() => ({
			width,
			height: 800,
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			bottom: 800,
			right: width,
			toJSON() {},
		}),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: () => void) {
				observers.push(callback);
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	host = document.createElement("div");
	host.dataset.slot = "sidebar-inset";
	document.body.append(host);
	root = createRoot(host);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function Harness({
	version = 1,
	child = "child",
	ready = true,
	onDetail,
}: {
	version?: number;
	child?: string;
	ready?: boolean;
	onDetail?: () => void;
}) {
	rail = useConversationWorkspace({
		mainThreadId: "parent",
		sideThreadId: child || undefined,
		openVersion: version,
	});
	return (
		<ConversationWorkspace
			controls={rail}
			main={ready ? <Chat surface="main" /> : <div>Connecting…</div>}
			side={
				<>
					<Chat surface="side" />
					{onDetail &&
						rail.target &&
						rail.surface.kind === "changes" &&
						createPortal(
							<button type="button" onClick={onDetail}>
								Detail action
							</button>,
							rail.target,
						)}
				</>
			}
		/>
	);
}
async function render(version = 1) {
	await act(async () => root.render(<Harness version={version} />));
}
it("retains both controllers and drafts through close, reopen, and narrow switching", async () => {
	await render();
	const main = host.querySelector<HTMLTextAreaElement>(
		'[aria-label="main draft"]',
	);
	const side = host.querySelector<HTMLTextAreaElement>(
		'[aria-label="side draft"]',
	);
	if (!main || !side) throw new Error("Missing drafts");
	main.value = "parent edited draft";
	side.value = "side edited draft";
	await act(async () => rail.close());
	expect(rail.sideVisible).toBe(false);
	await render(2);
	expect(host.querySelector('[aria-label="main draft"]')).toBe(main);
	expect(host.querySelector('[aria-label="side draft"]')).toBe(side);
	await act(async () => {
		width = 800;
		for (const observer of observers) observer();
	});
	expect(rail.mainVisible).toBe(false);
	expect(main.closest("[inert]")).not.toBeNull();
	await act(async () => rail.showMain());
	expect(rail.sideVisible).toBe(false);
	expect(
		host.querySelector('section[aria-label="Main conversation"]'),
	).not.toBeNull();
	expect(side.closest("[inert]")).not.toBeNull();
	expect(main.value).toBe("parent edited draft");
	expect(side.value).toBe("side edited draft");
	expect(mounts).toEqual({ main: 1, side: 1 });
});
it("retains the source thread when a side review uses the one detail rail", async () => {
	await render();
	await act(async () => rail.open({ threadId: "child", kind: "changes" }));
	expect(rail.surface).toEqual({ kind: "changes", threadId: "child" });
	expect(rail.sideVisible).toBe(false);
	await act(async () => rail.close());
	expect(rail.surface.kind).toBe("hidden");
	expect(rail.sideVisible).toBe(false);
	await act(async () => rail.open({ threadId: "parent", kind: "changes" }));
	expect(rail.surface).toEqual({ kind: "changes", threadId: "parent" });
	expect(mounts).toEqual({ main: 1, side: 1 });
});

it("explicit review stays open while toggle and close hide without revealing a saved side", async () => {
	await render();
	await act(async () => rail.open({ kind: "changes", threadId: "child" }));
	await act(async () => rail.open({ kind: "changes", threadId: "child" }));
	expect(rail.surface).toEqual({ kind: "changes", threadId: "child" });
	await act(async () => rail.toggle("child", "changes"));
	expect(rail.surface.kind).toBe("hidden");
	await act(async () => rail.toggle("parent", "files"));
	expect(rail.surface).toEqual({ kind: "files", threadId: "parent" });
	await act(async () => rail.close());
	expect(rail.sideVisible).toBe(false);
});
it("retains saved desktop width across narrow mode and supports keyboard resizing", async () => {
	window.localStorage.setItem("cline.code.side-chat-width.v1", "700");
	await render();
	expect(host.querySelector("aside")?.style.width).toBe("700px");
	await act(async () => {
		width = 700;
		for (const callback of observers) callback();
	});
	expect(host.querySelector("aside")?.style.width).toBe("100%");
	expect(window.localStorage.getItem("cline.code.side-chat-width.v1")).toBe(
		"700",
	);
	await act(async () => {
		width = 1200;
		for (const callback of observers) callback();
	});
	expect(host.querySelector("aside")?.style.width).toBe("700px");
	await act(async () =>
		host
			.querySelector('[role="separator"]')
			?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
			),
	);
	expect(host.querySelector("aside")?.style.width).toBe("720px");
	expect(window.localStorage.getItem("cline.code.side-chat-width.v1")).toBe(
		"720",
	);
});
it("does not reveal a late selected child without an open version change", async () => {
	await act(async () => root.render(<Harness version={0} child="" />));
	const before = rail.getCloseRevision();
	await act(async () => rail.close());
	expect(rail.getCloseRevision()).toBeGreaterThan(before);
	await render(0);
	expect(rail.surface.kind).toBe("hidden");
	expect(rail.sideVisible).toBe(false);
});

it("keeps source-owned detail controls usable when their narrow conversation is hidden", async () => {
	width = 700;
	const onReview = () => rail.open({ kind: "changes", threadId: "child" });
	const clicked = vi.fn();
	await act(async () => root.render(<Harness onDetail={clicked} />));
	await act(async () => onReview());
	const button = [...host.querySelectorAll("button")].find(
		(element) => element.textContent === "Detail action",
	);
	expect(button?.closest("[inert]")).toBeNull();
	expect(button).toBeDefined();
	await act(async () => button?.click());
	expect(clicked).toHaveBeenCalledOnce();
	await act(async () => rail.showMain());
	await act(async () => rail.toggle("child", "changes"));
	expect(rail.surface).toEqual({ kind: "changes", threadId: "child" });
	expect(rail.mainVisible).toBe(false);
});

it("opens an empty side host immediately and retains its draft through main readiness changes", async () => {
	const renderReady = async (ready: boolean) => {
		await act(async () =>
			root.render(<Harness version={0} child="" ready={ready} />),
		);
	};
	await renderReady(true);
	await act(async () => rail.open({ kind: "side" }));
	expect(rail.sideVisible).toBe(true);
	expect(host.querySelector("aside")?.style.display).toBe("flex");
	const draft = host.querySelector<HTMLTextAreaElement>(
		'[aria-label="side draft"]',
	);
	if (!draft) throw new Error("Missing side draft");
	draft.value = "Keep this side draft";
	await renderReady(false);
	await renderReady(true);
	expect(host.querySelector('[aria-label="side draft"]')).toBe(draft);
	expect(draft.value).toBe("Keep this side draft");
	expect(mounts.side).toBe(1);
	await act(async () => rail.close());
	expect(rail.sideVisible).toBe(false);
});

it("keeps side and file widths independent without remounting either chat", async () => {
	await render();
	const panel = host.querySelector("aside");
	const resize = host.querySelector('[role="separator"]');
	if (!panel || !resize) throw new Error("Missing resizable panel");
	expect(panel.style.width).toBe("480px");
	await act(async () =>
		resize.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
		),
	);
	expect(panel.style.width).toBe("500px");
	await act(async () => rail.open({ kind: "files", threadId: "parent" }));
	expect(panel.style.width).toBe("720px");
	await act(async () =>
		resize.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
		),
	);
	await act(async () => rail.open({ kind: "side" }));
	expect(panel.style.width).toBe("500px");
	await act(async () => rail.open({ kind: "changes", threadId: "parent" }));
	expect(panel.style.width).toBe("740px");
	expect(mounts).toEqual({ main: 1, side: 1 });
});
