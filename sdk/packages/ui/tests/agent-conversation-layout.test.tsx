// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentConversationHeader,
	AgentConversationLayout,
	AgentSessionContent,
} from "../components/agent-conversation-layout.js";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("conversation presentation", () => {
	it("preserves the desktop header's element order and native offset classes", () => {
		const primary = (
			<>
				<span>Working</span>
				<button type="button">Rename</button>
			</>
		);
		const actions = <button type="button">New session</button>;
		expect(
			renderToStaticMarkup(
				<AgentConversationHeader
					className="max-md:h-7 max-md:pl-28 md:group-data-[state=collapsed]/sidebar-wrapper:pl-7"
					actions={actions}
				>
					{primary}
				</AgentConversationHeader>,
			),
		).toBe(
			renderToStaticMarkup(
				<header className="flex h-12 items-center justify-between gap-2 px-4 max-md:h-7 max-md:pl-28 md:group-data-[state=collapsed]/sidebar-wrapper:pl-7">
					<div className="flex min-w-0 flex-1 items-center gap-2">
						{primary}
					</div>
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				</header>,
			),
		);
	});

	it("does not add an action container or drag region when absent", async () => {
		await act(async () =>
			root.render(<AgentConversationHeader>Title</AgentConversationHeader>),
		);
		const header = container.querySelector("header");
		expect(header?.children).toHaveLength(1);
		expect(header?.hasAttribute("data-tauri-drag-region")).toBe(false);
	});

	it("keeps host action callbacks and accessibility attributes intact", async () => {
		const onClick = vi.fn();
		await act(async () =>
			root.render(
				<AgentConversationHeader
					aria-label="Session"
					actions={
						<button aria-label="Resume session" onClick={onClick} type="button">
							Resume
						</button>
					}
				>
					Title
				</AgentConversationHeader>,
			),
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onClick).toHaveBeenCalledOnce();
		expect(container.querySelector("header")?.getAttribute("aria-label")).toBe(
			"Session",
		);
	});

	it("preserves the existing transcript width and host padding without a wrapper", () => {
		expect(
			renderToStaticMarkup(
				<AgentSessionContent className="relative min-h-full pt-6 pb-16">
					Transcript
				</AgentSessionContent>,
			),
		).toBe(
			'<div class="mx-auto w-full min-w-0 max-w-(--breakpoint-lg) relative min-h-full pt-6 pb-16">Transcript</div>',
		);
	});

	it("preserves hidden transcript state across welcome transitions", async () => {
		const mounted = vi.fn();
		const unmounted = vi.fn();
		function Transcript() {
			useEffect(() => {
				mounted();
				return unmounted;
			}, []);
			return <input aria-label="Transcript state" defaultValue="retained" />;
		}
		const render = (welcome: boolean) => (
			<AgentConversationLayout
				welcome={welcome}
				bodyClassName="cline-view-enter"
				body={<Transcript />}
				composer={<textarea />}
				welcomeHeader={<h1>Welcome</h1>}
			/>
		);
		await act(async () => root.render(render(true)));
		const input = container.querySelector("input");
		expect(input?.parentElement?.className).toBe("hidden");
		await act(async () => root.render(render(false)));
		expect(container.querySelector("input")).toBe(input);
		expect(input?.parentElement?.className).toBe(
			"cline-view-enter h-full min-h-0 overflow-hidden",
		);
		expect(container.querySelector("h1")).toBeNull();
		expect(mounted).toHaveBeenCalledOnce();
		expect(unmounted).not.toHaveBeenCalled();
	});

	it("hides the welcome composer during setup without losing its input node", async () => {
		const render = (hidden: boolean) => (
			<AgentConversationLayout
				welcome
				body={<p>Transcript</p>}
				composer={<textarea defaultValue="draft" />}
				hideWelcomeComposer={hidden}
				welcomeSetup={hidden ? <p>Set up</p> : null}
			/>
		);
		await act(async () => root.render(render(false)));
		const textarea = container.querySelector("textarea");
		await act(async () => root.render(render(true)));
		expect(container.querySelector("textarea")).toBe(textarea);
		expect(textarea?.parentElement?.className).toBe("mt-4 w-full hidden");
		await act(async () => root.render(render(false)));
		expect(textarea?.value).toBe("draft");
		expect(textarea?.parentElement?.className).toBe("mt-4 w-full");
	});
});
